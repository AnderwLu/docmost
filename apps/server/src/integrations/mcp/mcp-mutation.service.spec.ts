jest.mock('./mcp-write.service', () => ({ McpWriteService: class {} }));
jest.mock('uuid', () => ({
  v7: () => '0198a000-0000-7000-8000-000000000001',
}));
import { McpMutationService } from './mcp-mutation.service';

describe('McpMutationService', () => {
  it('uploads through storage and returns a JSON-safe attachment DTO', async () => {
    const page = {
      id: '0198a000-0000-7000-8000-000000000002',
      spaceId: '0198a000-0000-7000-8000-000000000003',
      workspaceId: '0198a000-0000-7000-8000-000000000004',
      deletedAt: null,
    };
    const saved = {
      id: '0198a000-0000-7000-8000-000000000001',
      fileName: 'smoke.txt',
      fileExt: '.txt',
      mimeType: 'text/plain',
      fileSize: 5n,
      pageId: page.id,
      spaceId: page.spaceId,
      createdAt: new Date('2026-08-11T00:00:00.000Z'),
      updatedAt: new Date('2026-08-11T00:00:00.000Z'),
    };
    const pages = { findById: jest.fn().mockResolvedValue(page) } as any;
    const pageAccess = {
      validateCanEdit: jest.fn().mockResolvedValue(undefined),
    } as any;
    const attachmentService = {
      uploadToDrive: jest.fn().mockResolvedValue(undefined),
      saveAttachment: jest.fn().mockResolvedValue(saved),
    } as any;
    const service = new McpMutationService(
      {} as any,
      {} as any,
      pages,
      {} as any,
      {} as any,
      {} as any,
      pageAccess,
      attachmentService,
      { delete: jest.fn() } as any,
      { getFileUploadSizeLimit: jest.fn().mockReturnValue('10mb') } as any,
      {} as any,
    );
    const principal = {
      user: { id: '0198a000-0000-7000-8000-000000000005' },
      workspace: { id: page.workspaceId },
    } as any;

    const result = await service.uploadAttachment(principal, page.id, {
      fileName: 'smoke.txt',
      contentBase64: Buffer.from('smoke').toString('base64'),
    });

    expect(pageAccess.validateCanEdit).toHaveBeenCalledWith(
      page,
      principal.user,
    );
    expect(attachmentService.uploadToDrive).toHaveBeenCalledWith(
      expect.stringContaining('/smoke.txt'),
      Buffer.from('smoke'),
    );
    expect(result).toEqual({ ...saved, fileSize: 5 });
    expect(JSON.stringify(result)).toContain('"fileSize":5');
  });

  it('can insert an attachment-card node immediately after upload', async () => {
    const page = {
      id: '0198a000-0000-7000-8000-000000000002',
      spaceId: '0198a000-0000-7000-8000-000000000003',
      workspaceId: '0198a000-0000-7000-8000-000000000004',
      deletedAt: null,
    };
    const saved = {
      id: '0198a000-0000-7000-8000-000000000001',
      fileName: 'smoke.txt',
      fileExt: '.txt',
      mimeType: 'text/plain',
      fileSize: 5n,
      pageId: page.id,
      spaceId: page.spaceId,
      workspaceId: page.workspaceId,
      deletedAt: null,
      createdAt: new Date('2026-08-11T00:00:00.000Z'),
      updatedAt: new Date('2026-08-11T00:00:00.000Z'),
    };
    const pages = { findById: jest.fn().mockResolvedValue(page) } as any;
    const attachments = {
      findById: jest.fn().mockResolvedValue(saved),
    } as any;
    const pageAccess = {
      validateCanEdit: jest.fn().mockResolvedValue(undefined),
    } as any;
    const attachmentService = {
      uploadToDrive: jest.fn().mockResolvedValue(undefined),
      saveAttachment: jest.fn().mockResolvedValue(saved),
    } as any;
    const writes = { updatePage: jest.fn().mockResolvedValue(page) } as any;
    const service = new McpMutationService(
      {} as any,
      attachments,
      pages,
      {} as any,
      {} as any,
      {} as any,
      pageAccess,
      attachmentService,
      { delete: jest.fn() } as any,
      { getFileUploadSizeLimit: jest.fn().mockReturnValue('10mb') } as any,
      writes,
    );
    const principal = {
      user: { id: '0198a000-0000-7000-8000-000000000005' },
      workspace: { id: page.workspaceId },
    } as any;

    await service.uploadAttachment(
      principal,
      page.id,
      {
        fileName: 'smoke.txt',
        contentBase64: Buffer.from('smoke').toString('base64'),
      },
      { insertIntoPage: true, display: 'attachment_card' },
    );

    expect(writes.updatePage).toHaveBeenCalledWith(
      principal,
      expect.objectContaining({
        pageId: page.id,
        operation: 'append',
        format: 'json',
        content: expect.objectContaining({ type: 'attachment' }),
      }),
    );
  });

  it('inserts attachment and image editor nodes through the page update service', async () => {
    const page = {
      id: '0198a000-0000-7000-8000-000000000002',
      spaceId: '0198a000-0000-7000-8000-000000000003',
      workspaceId: '0198a000-0000-7000-8000-000000000004',
      deletedAt: null,
    };
    const attachment = {
      id: '0198a000-0000-7000-8000-000000000001',
      fileName: 'diagram.png',
      fileExt: '.png',
      mimeType: 'image/png',
      fileSize: 123n,
      pageId: page.id,
      spaceId: page.spaceId,
      workspaceId: page.workspaceId,
      deletedAt: null,
      createdAt: new Date('2026-08-11T00:00:00.000Z'),
      updatedAt: new Date('2026-08-11T00:00:00.000Z'),
    };
    const pages = { findById: jest.fn().mockResolvedValue(page) } as any;
    const attachments = {
      findById: jest.fn().mockResolvedValue(attachment),
    } as any;
    const pageAccess = {
      validateCanEdit: jest.fn().mockResolvedValue(undefined),
    } as any;
    const writes = { updatePage: jest.fn().mockResolvedValue(page) } as any;
    const service = new McpMutationService(
      {} as any,
      attachments,
      pages,
      {} as any,
      {} as any,
      {} as any,
      pageAccess,
      {} as any,
      {} as any,
      { getFileUploadSizeLimit: jest.fn().mockReturnValue('10mb') } as any,
      writes,
    );
    const principal = {
      user: { id: '0198a000-0000-7000-8000-000000000005' },
      workspace: { id: page.workspaceId },
    } as any;

    await service.insertAttachmentNode(principal, page.id, attachment.id);
    await service.insertImageNode(principal, page.id, attachment.id);

    expect(writes.updatePage).toHaveBeenNthCalledWith(
      1,
      principal,
      expect.objectContaining({
        pageId: page.id,
        operation: 'append',
        format: 'json',
        content: {
          type: 'attachment',
          attrs: {
            url: `/api/files/${attachment.id}/${attachment.fileName}`,
            name: attachment.fileName,
            size: 123,
            mime: attachment.mimeType,
            attachmentId: attachment.id,
          },
        },
      }),
    );
    expect(writes.updatePage).toHaveBeenNthCalledWith(
      2,
      principal,
      expect.objectContaining({
        pageId: page.id,
        operation: 'append',
        format: 'json',
        content: {
          type: 'image',
          attrs: {
            src: `/api/files/${attachment.id}/${attachment.fileName}`,
            alt: attachment.fileName,
            align: 'center',
            attachmentId: attachment.id,
            size: 123,
          },
        },
      }),
    );
  });
});
