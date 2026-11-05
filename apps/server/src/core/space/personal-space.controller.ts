import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthUser } from '../../common/decorators/auth-user.decorator';
import { AuthWorkspace } from '../../common/decorators/auth-workspace.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Space, User, Workspace } from '@docmost/db/types/entity.types';
import { SpaceRepo } from '@docmost/db/repos/space/space.repo';
import { SpaceService } from './services/space.service';
import { generateSlugId } from '../../common/helpers/nanoid.utils';

type CreatePersonalSpaceBody = {
  name?: string;
};

@UseGuards(JwtAuthGuard)
@Controller('personal-space')
export class PersonalSpaceController {
  constructor(
    private readonly spaceRepo: SpaceRepo,
    private readonly spaceService: SpaceService,
  ) {}

  @HttpCode(HttpStatus.OK)
  @Post('info')
  async getPersonalSpace(
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ): Promise<Space | null> {
    return (
      (await this.spaceRepo.findPersonalSpace(user.id, workspace.id)) ?? null
    );
  }

  @HttpCode(HttpStatus.OK)
  @Post('create')
  async createPersonalSpace(
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
    @Body() body: CreatePersonalSpaceBody,
  ): Promise<Space> {
    const settings = workspace.settings as
      | { spaces?: { allowPersonal?: boolean } }
      | undefined;
    if (settings?.spaces?.allowPersonal !== true) {
      throw new ForbiddenException('Personal spaces are disabled');
    }

    const existing = await this.spaceRepo.findPersonalSpace(
      user.id,
      workspace.id,
    );
    if (existing) {
      throw new BadRequestException('Personal space already exists');
    }

    const name = body?.name?.trim();
    if (!name || name.length < 2 || name.length > 100) {
      throw new BadRequestException(
        'Personal space name must be between 2 and 100 characters',
      );
    }

    return this.spaceService.createSpace(
      user,
      workspace.id,
      {
        name,
        slug: `personal-${generateSlugId()}`,
      },
      undefined,
      { isPersonal: true },
    );
  }
}
