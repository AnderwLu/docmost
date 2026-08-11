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
import WorkspaceAbilityFactory from '../../core/casl/abilities/workspace-ability.factory';
import {
  SpaceCaslAction,
  SpaceCaslSubject,
} from '../../core/casl/interfaces/space-ability.type';
import {
  WorkspaceCaslAction,
  WorkspaceCaslSubject,
} from '../../core/casl/interfaces/workspace-ability.type';
import { PageAccessService } from '../../core/page/page-access/page-access.service';
import { AttachmentService } from '../../core/attachment/services/attachment.service';
import { StorageService } from '../storage/storage.service';
import { EnvironmentService } from '../environment/environment.service';
import { getMimeType, sanitizeFileName } from '../../common/helpers';
import * as bytes from 'bytes';
import * as path from 'path';
import { v7 as uuid7 } from 'uuid';
import {
  getAttachmentFolderPath,
  PreparedFile,
} from '../../core/attachment/attachment.utils';
import { AttachmentType } from '../../core/attachment/attachment.constants';
import { McpPrincipal } from './mcp-api-key.service';
import { McpWriteService } from './mcp-write.service';

type EncodedFile = { fileName: string; contentBase64: string };
type AttachmentDisplay = 'attachment_card' | 'image';

type AttachmentDto = {
  id: string;
  fileName: string;
  fileExt: string;
  mimeType: string | null;
  fileSize: number;
  pageId: string | null;
  spaceId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

@Injectable()
export class McpMutationService {
  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    private readonly attachments: AttachmentRepo,
    private readonly pages: PageRepo,
    private readonly spaces: SpaceService,
    private readonly spaceAbility: SpaceAbilityFactory,
    private readonly workspaceAbility: WorkspaceAbilityFactory,
    private readonly pageAccess: PageAccessService,
    private readonly attachmentService: AttachmentService,
    private readonly storage: StorageService,
    private readonly environment: EnvironmentService,
    private readonly writes: McpWriteService,
  ) {}

  async createSpace(
    principal: McpPrincipal,
    input: { name: string; slug: string; description?: string },
  ) {
    const ability = this.workspaceAbility.createForUser(
      principal.user,
      principal.workspace,
    );
    if (ability.cannot(WorkspaceCaslAction.Manage, WorkspaceCaslSubject.Space))
      throw new ForbiddenException();
    return this.spaces.createSpace(
      principal.user,
      principal.workspace.id,
      input,
    );
  }

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
    const attachments = await this.db
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
    return attachments.map((attachment) => this.toAttachmentDto(attachment));
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
    return this.toAttachmentDto(updated);
  }

  async uploadAttachment(
    principal: McpPrincipal,
    pageId: string,
    file: EncodedFile,
    options: { insertIntoPage?: boolean; display?: AttachmentDisplay } = {},
  ) {
    const page = await this.requireEditablePage(principal, pageId, true);
    const prepared = this.decode(file);
    const mimeType = getMimeType(prepared.fileName);
    if (options.insertIntoPage && options.display === 'image') {
      if (!mimeType?.startsWith('image/'))
        throw new BadRequestException('Attachment is not an image');
    }
    const attachmentId = uuid7();
    const filePath = `${getAttachmentFolderPath(AttachmentType.File, principal.workspace.id)}/${attachmentId}/${prepared.fileName}`;
    const preparedFile: PreparedFile = {
      buffer: prepared.buffer,
      fileName: prepared.fileName,
      fileSize: prepared.buffer.length,
      fileExtension: path.extname(prepared.fileName).toLowerCase(),
      mimeType,
    };
    await this.attachmentService.uploadToDrive(filePath, prepared.buffer);
    let attachment;
    try {
      attachment = await this.attachmentService.saveAttachment({
        attachmentId,
        preparedFile,
        filePath,
        type: AttachmentType.File,
        userId: principal.user.id,
        workspaceId: principal.workspace.id,
        pageId: page.id,
        spaceId: page.spaceId,
      });
    } catch (error) {
      await this.storage.delete(filePath).catch(() => undefined);
      throw error;
    }
    const dto = this.toAttachmentDto(attachment);
    if (options.insertIntoPage) {
      if (options.display === 'image') {
        await this.insertImageNode(principal, page.id, attachment.id);
      } else {
        await this.insertAttachmentNode(principal, page.id, attachment.id);
      }
    }
    return dto;
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

  async insertAttachmentNode(
    principal: McpPrincipal,
    pageId: string,
    attachmentId: string,
  ) {
    const { page, attachment } = await this.requirePageAttachment(
      principal,
      pageId,
      attachmentId,
    );
    const node = {
      type: 'attachment',
      attrs: {
        url: this.attachmentUrl(attachment),
        name: attachment.fileName,
        size: Number(attachment.fileSize ?? 0),
        mime: attachment.mimeType,
        attachmentId: attachment.id,
      },
    };
    await this.writes.updatePage(principal, {
      pageId: page.id,
      content: node,
      operation: 'append',
      format: 'json',
    });
    return { pageId: page.id, attachment: this.toAttachmentDto(attachment) };
  }

  async insertImageNode(
    principal: McpPrincipal,
    pageId: string,
    attachmentId: string,
  ) {
    const { page, attachment } = await this.requirePageAttachment(
      principal,
      pageId,
      attachmentId,
    );
    if (!attachment.mimeType?.startsWith('image/'))
      throw new BadRequestException('Attachment is not an image');
    const node = {
      type: 'image',
      attrs: {
        src: this.attachmentUrl(attachment),
        alt: attachment.fileName,
        align: 'center',
        attachmentId: attachment.id,
        size: Number(attachment.fileSize ?? 0),
      },
    };
    await this.writes.updatePage(principal, {
      pageId: page.id,
      content: node,
      operation: 'append',
      format: 'json',
    });
    return { pageId: page.id, attachment: this.toAttachmentDto(attachment) };
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

  private toAttachmentDto(attachment: {
    id: string;
    fileName: string;
    fileExt: string;
    mimeType: string | null;
    fileSize: bigint | number | string | null;
    pageId: string | null;
    spaceId: string | null;
    createdAt: Date;
    updatedAt: Date;
  }): AttachmentDto {
    return {
      id: attachment.id,
      fileName: attachment.fileName,
      fileExt: attachment.fileExt,
      mimeType: attachment.mimeType,
      fileSize: Number(attachment.fileSize ?? 0),
      pageId: attachment.pageId,
      spaceId: attachment.spaceId,
      createdAt: attachment.createdAt,
      updatedAt: attachment.updatedAt,
    };
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

  private async requirePageAttachment(
    principal: McpPrincipal,
    pageId: string,
    attachmentId: string,
  ) {
    const page = await this.requireEditablePage(principal, pageId, true);
    const attachment = await this.attachments.findById(attachmentId);
    if (
      !attachment ||
      attachment.deletedAt ||
      attachment.workspaceId !== principal.workspace.id ||
      attachment.pageId !== page.id
    )
      throw new NotFoundException('Attachment not found');
    return { page, attachment };
  }

  private attachmentUrl(attachment: { id: string; fileName: string }) {
    return `/api/files/${attachment.id}/${attachment.fileName}`;
  }
}
