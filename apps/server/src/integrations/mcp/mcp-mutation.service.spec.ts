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
});
