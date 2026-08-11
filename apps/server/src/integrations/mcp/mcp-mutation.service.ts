import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { AttachmentRepo } from '@docmost/db/repos/attachment/attachment.repo';
import { PageRepo } from '@docmost/db/repos/page/page.repo';
import { SpaceService } from '../../core/space/services/space.service';
import { UpdateSpaceDto } from '../../core/space/dto/update-space.dto';
import SpaceAbilityFactory from '../../core/casl/abilities/space-ability.factory';
import {
  SpaceCaslAction,
  SpaceCaslSubject,
} from '../../core/casl/interfaces/space-ability.type';
import { PageAccessService } from '../../core/page/page-access/page-access.service';
import { AttachmentService } from '../../core/attachment/services/attachment.service';
import { StorageService } from '../storage/storage.service';
import { EnvironmentService } from '../environment/environment.service';
import { getMimeType, sanitizeFileName } from '../../common/helpers';
import { Readable } from 'stream';
import bytes from 'bytes';
import path from 'path';
import { v7 as uuid7 } from 'uuid';
import { McpPrincipal } from './mcp-api-key.service';
import { McpWriteService } from './mcp-write.service';

type EncodedFile = { fileName: string; contentBase64: string };

@Injectable()
export class McpMutationService {
  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    private readonly attachments: AttachmentRepo,
    private readonly pages: PageRepo,
    private readonly spaces: SpaceService,
    private readonly spaceAbility: SpaceAbilityFactory,
    private readonly pageAccess: PageAccessService,
    private readonly attachmentService: AttachmentService,
    private readonly storage: StorageService,
    private readonly environment: EnvironmentService,
    private readonly writes: McpWriteService,
  ) {}

  private async manageSpace(principal: McpPrincipal, spaceId: string) {
    const ability = await this.spaceAbility.createForUser(
      principal.user,
      spaceId,
    );
    if (ability.cannot(SpaceCaslAction.Manage, SpaceCaslSubject.Settings))
      throw new ForbiddenException();
  }

  async updateSpace(
    principal: McpPrincipal,
    input: { spaceId: string; name?: string; description?: string },
  ) {
    if (input.name === undefined && input.description === undefined)
      throw new BadRequestException('Provide name and/or description');
    await this.manageSpace(principal, input.spaceId);
    return this.spaces.updateSpace(
      {
        ...input,
        disablePublicSharing: undefined,
        allowViewerComments: undefined,
      } as UpdateSpaceDto,
      principal.workspace.id,
    );
  }

  async deleteSpace(principal: McpPrincipal, spaceId: string) {
    await this.manageSpace(principal, spaceId);
    await this.spaces.deleteSpace(spaceId, principal.workspace.id);
    return { deleted: true, spaceId };
  }

  async listPageAttachments(principal: McpPrincipal, pageId: string) {
    const page = await this.requireEditablePage(principal, pageId, false);
    return this.db
      .selectFrom('attachments')
      .select([
        'id',
        'fileName',
        'fileExt',
        'mimeType',
        'fileSize',
        'pageId',
        'spaceId',
        'createdAt',
        'updatedAt',
      ])
      .where('pageId', '=', page.id)
      .where('workspaceId', '=', principal.workspace.id)
      .where('deletedAt', 'is', null)
      .orderBy('createdAt', 'asc')
      .execute();
  }

  async deleteAttachment(principal: McpPrincipal, attachmentId: string) {
    const attachment = await this.requireEditableAttachment(
      principal,
      attachmentId,
    );
    await this.storage.delete(attachment.filePath);
    await this.attachments.deleteAttachmentById(attachment.id);
    return { deleted: true, attachmentId };
  }

  async replaceAttachment(
    principal: McpPrincipal,
    attachmentId: string,
    file: EncodedFile,
  ) {
    const attachment = await this.requireEditableAttachment(
      principal,
      attachmentId,
    );
    const prepared = this.decode(file);
    const extension = path.extname(prepared.fileName).toLowerCase();
    if (extension !== attachment.fileExt.toLowerCase())
      throw new BadRequestException('Replacement file extension must match');
    const temporaryPath = `${attachment.filePath}.mcp-${uuid7()}.tmp`;
    const backupPath = `${attachment.filePath}.mcp-${uuid7()}.backup`;
    await this.storage.copy(attachment.filePath, backupPath);
    let updated;
    try {
      await this.storage.upload(temporaryPath, prepared.buffer);
      await this.storage.replace(temporaryPath, attachment.filePath);
      updated = await this.attachments.updateAttachment(
        {
          fileName: prepared.fileName,
          fileSize: prepared.buffer.length,
          mimeType: getMimeType(prepared.fileName),
          textContent: null,
          updatedAt: new Date(),
        },
        attachment.id,
      );
    } catch (error) {
      await this.storage.delete(temporaryPath).catch(() => undefined);
      await this.storage
        .replace(backupPath, attachment.filePath)
        .catch(() => undefined);
      throw error;
    }
    await this.storage.delete(backupPath).catch(() => undefined);
    return updated;
  }

  async uploadAttachment(
    principal: McpPrincipal,
    pageId: string,
    file: EncodedFile,
  ) {
    const page = await this.requireEditablePage(principal, pageId, true);
    const prepared = this.decode(file);
    const multipart = {
      filename: prepared.fileName,
      mimetype: getMimeType(prepared.fileName),
      encoding: '7bit',
      file: Readable.from(prepared.buffer),
      fields: {},
      type: 'file',
      toBuffer: async () => prepared.buffer,
    } as any;
    const attachment = await this.attachmentService.uploadFile({
      filePromise: Promise.resolve(multipart),
      pageId: page.id,
      spaceId: page.spaceId,
      userId: principal.user.id,
      workspaceId: principal.workspace.id,
    });
    if (!attachment) throw new BadRequestException('Attachment upload failed');
    return attachment;
  }

  async createPageWithAttachments(
    principal: McpPrincipal,
    input: {
      spaceId: string;
      title?: string;
      parentPageId?: string;
      content?: string;
      attachments?: EncodedFile[];
    },
  ) {
    const page = await this.writes.createPage(principal, input);
    const uploaded = [];
    for (const file of input.attachments || [])
      uploaded.push(await this.uploadAttachment(principal, page.id, file));
    return { page, attachments: uploaded };
  }

  private decode(file: EncodedFile) {
    const fileName = sanitizeFileName(file.fileName).slice(0, 255);
    if (!fileName || !path.extname(fileName))
      throw new BadRequestException('A filename with extension is required');
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(file.contentBase64))
      throw new BadRequestException('Invalid base64 content');
    const buffer = Buffer.from(file.contentBase64, 'base64');
    if (!buffer.length) throw new BadRequestException('File is empty');
    const limit = bytes(this.environment.getFileUploadSizeLimit());
    if (limit && buffer.length > limit)
      throw new BadRequestException('File exceeds the upload-size limit');
    return { fileName, buffer };
  }

  private async requireEditablePage(
    principal: McpPrincipal,
    pageId: string,
    edit: boolean,
  ) {
    const page = await this.pages.findById(pageId);
    if (!page || page.deletedAt || page.workspaceId !== principal.workspace.id)
      throw new NotFoundException('Page not found');
    if (edit) await this.pageAccess.validateCanEdit(page, principal.user);
    else await this.pageAccess.validateCanView(page, principal.user);
    return page;
  }

  private async requireEditableAttachment(
    principal: McpPrincipal,
    attachmentId: string,
  ) {
    const attachment = await this.attachments.findById(attachmentId);
    if (
      !attachment ||
      attachment.deletedAt ||
      !attachment.pageId ||
      attachment.workspaceId !== principal.workspace.id
    )
      throw new NotFoundException('Attachment not found');
    await this.requireEditablePage(principal, attachment.pageId, true);
    return attachment;
  }
}
