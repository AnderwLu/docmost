import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
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

  it('exposes exactly the first-release read-only tools', async () => {
    const reads = {
      searchPages: jest.fn().mockResolvedValue([]),
      getPage: jest.fn().mockResolvedValue({ id: 'page-1' }),
      listPages: jest.fn().mockResolvedValue([]),
      getSpace: jest.fn().mockResolvedValue({ id: 'space-1' }),
      listSpaces: jest.fn().mockResolvedValue([]),
      searchAttachments: jest.fn().mockResolvedValue([]),
      getCurrentUser: jest.fn().mockReturnValue({ id: 'user-1' }),
    } as any;
    const server = new McpServerFactory(reads).create(principal);
    const client = new Client({ name: 'test', version: '1.0.0' });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name).sort()).toEqual([
      'get_current_user',
      'get_page',
      'get_space',
      'list_child_pages',
      'list_pages',
      'list_spaces',
      'search_attachments',
      'search_pages',
    ]);
    expect(tools.tools.every((tool) => tool.annotations?.readOnlyHint)).toBe(
      true,
    );

    const response = await client.callTool({
      name: 'get_current_user',
      arguments: {},
    });
    expect(response.isError).not.toBe(true);
    expect(reads.getCurrentUser).toHaveBeenCalledWith(principal);
    await client.close();
    await server.close();
  });
});
