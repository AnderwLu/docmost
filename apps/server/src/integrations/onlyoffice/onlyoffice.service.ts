import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { sign, verify } from 'jsonwebtoken';
import * as bytes from 'bytes';
import { AttachmentRepo } from '@docmost/db/repos/attachment/attachment.repo';
import { PageRepo } from '@docmost/db/repos/page/page.repo';
import { User } from '@docmost/db/types/entity.types';
import { PageAccessService } from '../../core/page/page-access/page-access.service';
import { EnvironmentService } from '../environment/environment.service';
import { StorageService } from '../storage/storage.service';
import {
  OnlyOfficeAccessToken,
  OnlyOfficeCallbackBody,
  OnlyOfficeTokenPurpose,
} from './onlyoffice.types';
import {
  getOnlyOfficeDocumentType,
  getOnlyOfficeExtension,
  validateOoxmlBuffer,
} from './onlyoffice.utils';

@Injectable()
export class OnlyOfficeService implements OnModuleInit {
  private readonly logger = new Logger(OnlyOfficeService.name);

  constructor(
    private readonly attachmentRepo: AttachmentRepo,
    private readonly pageRepo: PageRepo,
    private readonly pageAccessService: PageAccessService,
    private readonly environmentService: EnvironmentService,
    private readonly storageService: StorageService,
  ) {}

  onModuleInit() {
    this.environmentService.getOnlyOfficeInternalUrl();
    this.environmentService.getOnlyOfficeBrowserUrl();
    this.environmentService.getOnlyOfficeDocmostUrl();
    this.environmentService.getOnlyOfficeJwtSecret();
    this.environmentService.getOnlyOfficeTokenSecret();
  }

  async createSession(attachmentId: string, user: User, workspaceId: string) {
    const attachment = await this.getSupportedAttachment(
      attachmentId,
      workspaceId,
    );
    const page = await this.pageRepo.findById(attachment.pageId);
    if (!page) throw new NotFoundException('File not found');
    await this.pageAccessService.validateCanEdit(page, user);

    const extension = getOnlyOfficeExtension(attachment.fileName)!;
    const documentKey = createHash('sha256')
      // OEM 缓存键：同一附件版本保持稳定以复用转换缓存，保存更新时间变化后自动换键。
      .update(`${attachment.id}:${attachment.updatedAt.toISOString()}`)
      .digest('hex')
      .slice(0, 40);
    const tokenBase = {
      attachmentId: attachment.id,
      userId: user.id,
      workspaceId,
      documentKey,
    };
    const baseUrl = this.environmentService.getOnlyOfficeDocmostUrl();
    const readToken = this.signAccessToken({ ...tokenBase, purpose: 'read' });
    const callbackToken = this.signAccessToken({
      ...tokenBase,
      purpose: 'callback',
    });

    const config: Record<string, any> = {
      documentType: getOnlyOfficeDocumentType(extension),
      document: {
        fileType: extension.slice(1),
        key: documentKey,
        title: attachment.fileName,
        url: `${baseUrl}/api/office/files/${encodeURIComponent(readToken)}`,
        permissions: { edit: true, download: true },
      },
      editorConfig: {
        mode: 'edit',
        callbackUrl: `${baseUrl}/api/office/callback/${encodeURIComponent(callbackToken)}`,
        user: { id: user.id, name: user.name || user.email },
      },
    };
    config.token = sign(
      config,
      this.environmentService.getOnlyOfficeJwtSecret(),
      {
        algorithm: 'HS256',
        expiresIn: this.environmentService.getOnlyOfficeTokenTtlSeconds(),
      },
    );

    return {
      documentServerUrl: this.environmentService.getOnlyOfficeBrowserUrl(),
      downloadUrl: `/api/files/${attachment.id}/${encodeURIComponent(attachment.fileName)}`,
      config,
    };
  }

  verifyAccessToken(token: string, purpose: OnlyOfficeTokenPurpose) {
    let payload: OnlyOfficeAccessToken;
    try {
      payload = verify(
        token,
        this.environmentService.getOnlyOfficeTokenSecret(),
        {
          algorithms: ['HS256'],
        },
      ) as OnlyOfficeAccessToken;
    } catch {
      throw new UnauthorizedException('Invalid or expired Office token');
    }
    if (payload.purpose !== purpose) {
      throw new UnauthorizedException('Invalid Office token purpose');
    }
    return payload;
  }

  verifyCallbackJwt(authorization?: string, bodyToken?: string) {
    const headerToken = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]
      ?? authorization?.trim();
    const token = headerToken || bodyToken;
    if (!token)
      throw new UnauthorizedException('Missing ONLYOFFICE callback JWT');
    try {
      verify(token, this.environmentService.getOnlyOfficeJwtSecret(), {
        algorithms: ['HS256'],
      });
    } catch {
      throw new UnauthorizedException('Invalid ONLYOFFICE callback JWT');
    }
  }

  async getFile(token: string) {
    const payload = this.verifyAccessToken(token, 'read');
    const attachment = await this.getSupportedAttachment(
      payload.attachmentId,
      payload.workspaceId,
    );
    return {
      attachment,
      stream: await this.storageService.readStream(attachment.filePath),
    };
  }

  async handleCallback(
    token: string,
    body: OnlyOfficeCallbackBody,
  ): Promise<void> {
    const payload = this.verifyAccessToken(token, 'callback');
    if (body.status !== 2) return;
    if (!body.url) throw new BadRequestException('Missing edited document URL');

    const attachment = await this.getSupportedAttachment(
      payload.attachmentId,
      payload.workspaceId,
    );
    if (body.key && body.key !== payload.documentKey) {
      throw new BadRequestException('Document key does not match');
    }

    const extension = getOnlyOfficeExtension(attachment.fileName)!;
    const editedFile = await this.downloadEditedFile(body.url);
    await validateOoxmlBuffer(editedFile, extension);
    await this.replaceAttachment(
      attachment.id,
      attachment.filePath,
      editedFile,
    );
  }

  private signAccessToken(payload: OnlyOfficeAccessToken): string {
    return sign(payload, this.environmentService.getOnlyOfficeTokenSecret(), {
      algorithm: 'HS256',
      expiresIn: this.environmentService.getOnlyOfficeTokenTtlSeconds(),
    });
  }

  private async getSupportedAttachment(
    attachmentId: string,
    workspaceId: string,
  ) {
    const attachment = await this.attachmentRepo.findById(attachmentId);
    const extension = attachment
      ? getOnlyOfficeExtension(attachment.fileName)
      : null;
    if (
      !attachment ||
      attachment.workspaceId !== workspaceId ||
      !attachment.pageId ||
      !extension ||
      attachment.fileExt.toLowerCase() !== extension
    ) {
      throw new NotFoundException('Supported Office file not found');
    }
    return attachment;
  }

  private async downloadEditedFile(downloadUrl: string): Promise<Buffer> {
    const configuredOrigin = new URL(
      this.environmentService.getOnlyOfficeInternalUrl(),
    ).origin;
    const url = new URL(downloadUrl);
    if (url.origin !== configuredOrigin || url.username || url.password) {
      throw new BadRequestException('Untrusted ONLYOFFICE download URL');
    }

    const maxBytes = Number(
      bytes(this.environmentService.getFileUploadSizeLimit()),
    );
    const response = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok || response.status >= 300 || !response.body) {
      throw new Error(
        `ONLYOFFICE download failed with status ${response.status}`,
      );
    }
    const declaredLength = Number(response.headers.get('content-length') || 0);
    if (declaredLength > maxBytes)
      throw new BadRequestException('Edited file is too large');

    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of response.body as any) {
      const buffer = Buffer.from(chunk);
      total += buffer.length;
      if (total > maxBytes)
        throw new BadRequestException('Edited file is too large');
      chunks.push(buffer);
    }
    if (total === 0) throw new BadRequestException('Edited file is empty');
    return Buffer.concat(chunks, total);
  }

  private async replaceAttachment(
    attachmentId: string,
    filePath: string,
    content: Buffer,
  ): Promise<void> {
    const suffix = randomUUID();
    const stagedPath = `${filePath}.onlyoffice-new-${suffix}`;
    const backupPath = `${filePath}.onlyoffice-backup-${suffix}`;
    let replaced = false;
    try {
      await this.storageService.upload(stagedPath, content);
      await this.storageService.copy(filePath, backupPath);
      await this.storageService.replace(stagedPath, filePath);
      replaced = true;
      await this.attachmentRepo.updateAttachment(
        { fileSize: content.length, updatedAt: new Date() },
        attachmentId,
      );
    } catch (error) {
      if (replaced) {
        try {
          await this.storageService.replace(backupPath, filePath);
        } catch (rollbackError) {
          this.logger.error(
            `Office save rollback failed for attachment ${attachmentId}`,
            rollbackError,
          );
        }
      }
      throw error;
    } finally {
      await Promise.allSettled([
        this.storageService.delete(stagedPath),
        this.storageService.delete(backupPath),
      ]);
    }
  }
}
