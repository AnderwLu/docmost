import { sign } from 'jsonwebtoken';
import { OnlyOfficeService } from './onlyoffice.service';

describe('OnlyOfficeService', () => {
  const attachment = {
    id: '0198d2af-ae02-7000-8000-000000000001',
    fileName: 'Plan.DOCX',
    filePath: 'workspace/files/id/Plan.DOCX',
    fileSize: 100,
    fileExt: '.docx',
    mimeType:
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    workspaceId: 'workspace-1',
    pageId: 'page-1',
    updatedAt: new Date('2026-08-05T00:00:00Z'),
  };
  const user = {
    id: 'user-1',
    name: 'Test User',
    email: 'test@example.com',
  };
  const attachmentRepo = {
    findById: jest.fn().mockResolvedValue(attachment),
    updateAttachment: jest.fn(),
  };
  const pageRepo = { findById: jest.fn().mockResolvedValue({ id: 'page-1' }) };
  const pageAccessService = { validateCanEdit: jest.fn() };
  const environmentService = {
    getOnlyOfficeInternalUrl: () => 'http://onlyoffice:80',
    getOnlyOfficeBrowserUrl: () => 'https://office.example.test',
    getOnlyOfficeDocmostUrl: () => 'http://docmost:3000',
    getOnlyOfficeJwtSecret: () => 'document-server-secret',
    getOnlyOfficeTokenSecret: () => 'access-token-secret',
    getOnlyOfficeTokenTtlSeconds: () => 1800,
    getFileUploadSizeLimit: () => '50mb',
  };
  const storageService = {
    readStream: jest.fn(),
    upload: jest.fn(),
    copy: jest.fn(),
    replace: jest.fn(),
    delete: jest.fn(),
  };

  const service = new OnlyOfficeService(
    attachmentRepo as any,
    pageRepo as any,
    pageAccessService as any,
    environmentService as any,
    storageService as any,
  );

  beforeEach(() => jest.clearAllMocks());

  it('creates an editable, signed session using internal Docmost URLs', async () => {
    const session = await service.createSession(
      attachment.id,
      user as any,
      'workspace-1',
    );

    expect(pageAccessService.validateCanEdit).toHaveBeenCalled();
    expect(session.documentServerUrl).toBe('https://office.example.test');
    expect(session.config.documentType).toBe('word');
    expect(session.config.document.url).toContain(
      'http://docmost:3000/api/office/files/',
    );
    expect(session.config.editorConfig.callbackUrl).toContain(
      'http://docmost:3000/api/office/callback/',
    );
    expect(session.config.token).toEqual(expect.any(String));
  });

  it('uses a fresh document key for every non-collaborative editing session', async () => {
    const first = await service.createSession(
      attachment.id,
      user as any,
      'workspace-1',
    );
    const second = await service.createSession(
      attachment.id,
      user as any,
      'workspace-1',
    );

    expect(first.config.document.key).not.toBe(second.config.document.key);
  });

  it('rejects a token used for the wrong purpose', async () => {
    const session = await service.createSession(
      attachment.id,
      user as any,
      'workspace-1',
    );
    const readToken = decodeURIComponent(
      new URL(session.config.document.url).pathname.split('/').pop()!,
    );
    expect(() => service.verifyAccessToken(readToken, 'callback')).toThrow(
      'Invalid Office token purpose',
    );
  });

  it('requires a valid callback Authorization JWT', () => {
    expect(() => service.verifyCallbackJwt()).toThrow(
      'Missing ONLYOFFICE callback JWT',
    );
    expect(() => service.verifyCallbackJwt('Bearer invalid')).toThrow(
      'Invalid ONLYOFFICE callback JWT',
    );
    expect(() =>
      service.verifyCallbackJwt(
        `Bearer ${sign({ payload: true }, 'document-server-secret')}`,
      ),
    ).not.toThrow();
    expect(() =>
      service.verifyCallbackJwt(
        sign({ payload: true }, 'document-server-secret'),
      ),
    ).not.toThrow();
    expect(() =>
      service.verifyCallbackJwt(
        undefined,
        sign({ payload: true }, 'document-server-secret'),
      ),
    ).not.toThrow();
  });

  it('ignores callback statuses that do not represent a final save', async () => {
    const session = await service.createSession(
      attachment.id,
      user as any,
      'workspace-1',
    );
    const callbackToken = decodeURIComponent(
      new URL(session.config.editorConfig.callbackUrl).pathname
        .split('/')
        .pop()!,
    );
    await expect(
      service.handleCallback(callbackToken, { status: 1 }),
    ).resolves.toBeUndefined();
    expect(storageService.upload).not.toHaveBeenCalled();
  });

  it('rejects edited-file URLs outside the configured Document Server origin', async () => {
    const session = await service.createSession(
      attachment.id,
      user as any,
      'workspace-1',
    );
    const callbackUrl = new URL(session.config.editorConfig.callbackUrl);
    const callbackToken = decodeURIComponent(
      callbackUrl.pathname.split('/').pop()!,
    );
    await expect(
      service.handleCallback(callbackToken, {
        status: 2,
        key: session.config.document.key,
        url: 'http://attacker.invalid/document.docx',
      }),
    ).rejects.toThrow('Untrusted ONLYOFFICE download URL');
    expect(storageService.upload).not.toHaveBeenCalled();
  });
});
