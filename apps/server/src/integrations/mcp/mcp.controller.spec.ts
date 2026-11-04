jest.mock('./mcp-server.factory', () => ({ McpServerFactory: class {} }));
import { EventEmitter } from 'node:events';
import { UnauthorizedException } from '@nestjs/common';
import { McpController } from './mcp.controller';

describe('MCP OAuth authentication boundary', () => {
  const oauth = { issuer: 'https://docs.test', authenticate: jest.fn() };
  const servers = { create: jest.fn() };
  let controller: McpController;
  let reply: any;
  beforeEach(() => {
    jest.resetAllMocks();
    controller = new McpController(oauth as any, servers as any);
    reply = {
      raw: Object.assign(new EventEmitter(), {
        statusCode: 200,
        getHeader: () => 'application/json',
      }),
      header: jest.fn().mockReturnThis(),
      code: jest.fn().mockReturnThis(),
      send: jest.fn().mockReturnThis(),
    };
  });
  it.each([
    undefined,
    'Bearer legacy-personal-api-key',
    'Bearer mcp_rt_refresh',
    'Basic password',
  ])(
    'rejects missing, legacy or wrong-purpose credentials: %s',
    async (authorization) => {
      await controller.handle(
        { headers: { authorization }, raw: {} } as any,
        reply,
      );
      expect(reply.code).toHaveBeenCalledWith(401);
      expect(reply.header).toHaveBeenCalledWith(
        'WWW-Authenticate',
        expect.stringContaining(
          'resource_metadata="https://docs.test/.well-known/oauth-protected-resource"',
        ),
      );
      expect(oauth.authenticate).not.toHaveBeenCalled();
      expect(servers.create).not.toHaveBeenCalled();
    },
  );
  it('reports the optional GET SSE stream as unsupported, avoiding OAuth retry loops', () => {
    controller.getNotSupported({ headers: {} } as any, reply);
    expect(reply.code).toHaveBeenCalledWith(405);
    expect(reply.header).toHaveBeenCalledWith('Allow', 'POST');
  });
  it('rejects expired or revoked OAuth tokens before creating any tools', async () => {
    oauth.authenticate.mockRejectedValue(new UnauthorizedException());
    await controller.handle(
      {
        headers: { authorization: `Bearer mcp_at_${'x'.repeat(43)}` },
        raw: {},
      } as any,
      reply,
    );
    expect(reply.code).toHaveBeenCalledWith(401);
    expect(servers.create).not.toHaveBeenCalled();
  });
  it('rejects a valid token belonging to another workspace', async () => {
    oauth.authenticate.mockResolvedValue({ workspace: { id: 'workspace-a' } });
    await controller.handle(
      {
        headers: { authorization: `Bearer mcp_at_${'x'.repeat(43)}` },
        raw: { workspaceId: 'workspace-b' },
      } as any,
      reply,
    );
    expect(reply.code).toHaveBeenCalledWith(401);
    expect(servers.create).not.toHaveBeenCalled();
  });
});
