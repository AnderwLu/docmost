import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { UserRepo } from '@docmost/db/repos/user/user.repo';
import { WorkspaceRepo } from '@docmost/db/repos/workspace/workspace.repo';
import { TokenService } from '../../core/auth/services/token.service';
import { JwtApiKeyPayload, JwtType } from '../../core/auth/dto/jwt-payload';
import { isUserDisabled } from '../../common/helpers';

export type McpPrincipal = {
  user: Awaited<ReturnType<UserRepo['findById']>>;
  workspace: Awaited<ReturnType<WorkspaceRepo['findById']>>;
  apiKeyId: string;
};

@Injectable()
export class McpApiKeyService {
  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    private readonly tokenService: TokenService,
    private readonly userRepo: UserRepo,
    private readonly workspaceRepo: WorkspaceRepo,
  ) {}

  async authenticate(authorization?: string): Promise<McpPrincipal> {
    const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) throw new UnauthorizedException('Bearer API key required');

    let payload: JwtApiKeyPayload;
    try {
      payload = (await this.tokenService.verifyJwt(
        token,
        JwtType.API_KEY,
      )) as JwtApiKeyPayload;
    } catch {
      throw new UnauthorizedException('Invalid or expired API key');
    }
    if (
      payload.type !== JwtType.API_KEY ||
      !payload.apiKeyId ||
      !payload.sub ||
      !payload.workspaceId
    ) {
      throw new UnauthorizedException('Invalid API key');
    }

    const apiKey = await this.db
      .selectFrom('apiKeys')
      .select(['id', 'creatorId', 'workspaceId', 'expiresAt', 'deletedAt'])
      .where('id', '=', payload.apiKeyId)
      .where('creatorId', '=', payload.sub)
      .where('workspaceId', '=', payload.workspaceId)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();
    if (!apiKey || (apiKey.expiresAt && apiKey.expiresAt <= new Date())) {
      throw new UnauthorizedException('API key has expired or been revoked');
    }

    const [user, workspace] = await Promise.all([
      this.userRepo.findById(payload.sub, payload.workspaceId),
      this.workspaceRepo.findById(payload.workspaceId),
    ]);
    if (!user || !workspace || isUserDisabled(user)) {
      throw new UnauthorizedException('API key owner is unavailable');
    }

    await this.db
      .updateTable('apiKeys')
      .set({ lastUsedAt: new Date() })
      .where('id', '=', apiKey.id)
      .execute();
    return { user, workspace, apiKeyId: apiKey.id };
  }

  async list(userId: string, workspaceId: string) {
    const items = await this.db
      .selectFrom('apiKeys')
      .innerJoin('users', 'users.id', 'apiKeys.creatorId')
      .select([
        'apiKeys.id',
        'apiKeys.name',
        'apiKeys.creatorId',
        'apiKeys.workspaceId',
        'apiKeys.expiresAt',
        'apiKeys.lastUsedAt',
        'apiKeys.createdAt',
        'users.id as creatorUserId',
        'users.name as creatorName',
        'users.email as creatorEmail',
        'users.avatarUrl as creatorAvatarUrl',
      ])
      .where('apiKeys.creatorId', '=', userId)
      .where('apiKeys.workspaceId', '=', workspaceId)
      .where('apiKeys.deletedAt', 'is', null)
      .orderBy('apiKeys.createdAt', 'desc')
      .limit(100)
      .execute();
    return {
      items: items.map(
        ({
          creatorUserId,
          creatorName,
          creatorEmail,
          creatorAvatarUrl,
          ...key
        }) => ({
          ...key,
          creator: {
            id: creatorUserId,
            name: creatorName,
            email: creatorEmail,
            avatarUrl: creatorAvatarUrl,
          },
        }),
      ),
      meta: { hasNextPage: false, hasPrevPage: false },
    };
  }

  async create(
    user: McpPrincipal['user'],
    workspaceId: string,
    input: { name: string; expiresAt?: string },
  ) {
    const name = input.name?.trim();
    if (!name || name.length > 100) {
      throw new BadRequestException('API key name must be 1-100 characters');
    }
    const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
    if (
      expiresAt &&
      (!Number.isFinite(expiresAt.getTime()) || expiresAt <= new Date())
    ) {
      throw new BadRequestException('Expiration must be in the future');
    }
    if (isUserDisabled(user)) throw new ForbiddenException();

    const key = await this.db
      .insertInto('apiKeys')
      .values({ name, creatorId: user.id, workspaceId, expiresAt })
      .returningAll()
      .executeTakeFirstOrThrow();
    const expiresIn = expiresAt
      ? Math.max(1, Math.floor((expiresAt.getTime() - Date.now()) / 1000))
      : undefined;
    const token = await this.tokenService.generateApiToken({
      apiKeyId: key.id,
      user,
      workspaceId,
      expiresIn,
    });
    return { ...key, token, creator: user };
  }

  async rename(
    userId: string,
    workspaceId: string,
    apiKeyId: string,
    name: string,
  ) {
    const normalized = name?.trim();
    if (!normalized || normalized.length > 100)
      throw new BadRequestException('Invalid name');
    const key = await this.db
      .updateTable('apiKeys')
      .set({ name: normalized, updatedAt: new Date() })
      .where('id', '=', apiKeyId)
      .where('creatorId', '=', userId)
      .where('workspaceId', '=', workspaceId)
      .where('deletedAt', 'is', null)
      .returningAll()
      .executeTakeFirst();
    if (!key) throw new BadRequestException('API key not found');
    return key;
  }

  async revoke(userId: string, workspaceId: string, apiKeyId: string) {
    await this.db
      .updateTable('apiKeys')
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where('id', '=', apiKeyId)
      .where('creatorId', '=', userId)
      .where('workspaceId', '=', workspaceId)
      .where('deletedAt', 'is', null)
      .execute();
  }
}
