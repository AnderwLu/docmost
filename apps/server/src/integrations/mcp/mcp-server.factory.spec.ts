import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
jest.mock('./mcp-write.service', () => ({ McpWriteService: class {} }));
jest.mock('./mcp-attachment.service', () => ({
  McpAttachmentService: class {},
}));
jest.mock('./mcp-mutation.service', () => ({ McpMutationService: class {} }));
import { McpServerFactory } from './mcp-server.factory';

describe('McpServerFactory', () => {
  const principal = {
    user: {
      id: 'user-1',
      name: 'Ada',
      email: 'ada@example.com',
      role: 'member',
    },
    workspace: { id: 'workspace-1', name: 'Docs' },
    apiKeyId: 'key-1',
  } as any;

  it('exposes the attachment and page tools with accurate annotations', async () => {
    const reads = {
      searchPages: jest.fn().mockResolvedValue([]),
      getPage: jest.fn().mockResolvedValue({ id: 'page-1' }),
      listPages: jest.fn().mockResolvedValue([]),
      getSpace: jest.fn().mockResolvedValue({ id: 'space-1' }),
      listSpaces: jest.fn().mockResolvedValue([]),
      searchAttachments: jest.fn().mockResolvedValue([]),
      getCurrentUser: jest.fn().mockReturnValue({ id: 'user-1' }),
    } as any;
    const attachments = {
      getAttachment: jest.fn().mockResolvedValue({ id: 'attachment-1' }),
      downloadAttachment: jest.fn().mockResolvedValue({
        id: 'attachment-1',
        fileName: 'cases.xlsx',
        mimeType: 'application/octet-stream',
        fileSize: 10,
        url: 'https://docmost.test/files/public/attachment-1/cases.xlsx?jwt=signed',
        expiresInSeconds: 3600,
      }),
    } as any;
    const writes = {
      createPage: jest.fn(),
      updatePage: jest.fn(),
      movePage: jest.fn(),
      createComment: jest.fn(),
    } as any;
    const mutations = {
      createSpace: jest.fn(),
      updateSpace: jest.fn(),
      deleteSpace: jest.fn(),
      listPageAttachments: jest.fn(),
      deleteAttachment: jest.fn(),
      replaceAttachment: jest.fn(),
      createPageWithAttachments: jest.fn(),
      uploadAttachment: jest.fn(),
    } as any;
    const server = new McpServerFactory(
      reads,
      attachments,
      writes,
      mutations,
    ).create(principal);
    const client = new Client({ name: 'test', version: '1.0.0' });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name).sort()).toEqual([
      'create_comment',
      'create_page',
      'create_page_with_attachments',
      'create_space',
      'delete_attachment',
      'delete_space',
      'download_attachment',
      'get_attachment',
      'get_current_user',
      'get_page',
      'get_space',
      'list_child_pages',
      'list_page_attachments',
      'list_pages',
      'list_spaces',
      'move_page',
      'replace_attachment',
      'search_attachments',
      'search_pages',
      'update_page',
      'update_space',
      'upload_attachment',
    ]);
    expect(
      tools.tools.filter((tool) => tool.annotations?.readOnlyHint),
    ).toHaveLength(11);
    expect(
      tools.tools.filter((tool) => !tool.annotations?.readOnlyHint),
    ).toHaveLength(11);
    expect(
      tools.tools.filter((tool) => tool.annotations?.destructiveHint),
    ).toHaveLength(2);

    const response = await client.callTool({
      name: 'get_current_user',
      arguments: {},
    });
    expect(response.isError).not.toBe(true);
    expect(reads.getCurrentUser).toHaveBeenCalledWith(principal);
    await client.close();
    await server.close();
  });

  it('serializes bigint attachment sizes in text and structured output', async () => {
    const reads = { getCurrentUser: jest.fn() } as any;
    const attachments = {} as any;
    const writes = {} as any;
    const mutations = {
      uploadAttachment: jest.fn().mockResolvedValue({
        id: '0198a000-0000-7000-8000-000000000001',
        fileName: 'cases.xlsx',
        fileSize: 42n,
      }),
    } as any;
    const server = new McpServerFactory(
      reads,
      attachments,
      writes,
      mutations,
    ).create(principal);
    const client = new Client({ name: 'test', version: '1.0.0' });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    const response = await client.callTool({
      name: 'upload_attachment',
      arguments: {
        pageId: '0198a000-0000-7000-8000-000000000002',
        fileName: 'cases.xlsx',
        contentBase64: 'eA==',
      },
    });
    expect(response.isError).not.toBe(true);
    expect(response.structuredContent).toEqual({
      result: {
        id: '0198a000-0000-7000-8000-000000000001',
        fileName: 'cases.xlsx',
        fileSize: 42,
      },
    });
    expect(response.content).toEqual([
      {
        type: 'text',
        text: expect.stringContaining('"fileSize": 42'),
      },
    ]);
    await client.close();
    await server.close();
  });
});
