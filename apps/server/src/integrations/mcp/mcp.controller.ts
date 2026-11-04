import {
  Controller,
  Get,
  HttpCode,
  Logger,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { Public } from '../../common/decorators/public.decorator';
import { OAuthService } from './oauth/oauth.service';
import { McpServerFactory } from './mcp-server.factory';
import { McpPrincipal } from './mcp-principal';
import { observeMcpRequest } from './mcp-diagnostics';

@Public()
@Controller('mcp')
export class McpController {
  private readonly logger = new Logger(McpController.name);
  constructor(
    private readonly oauth: OAuthService,
    private readonly servers: McpServerFactory,
  ) {}

  @HttpCode(200)
  @Post()
  async handle(@Req() request: FastifyRequest, @Res() reply: FastifyReply) {
    if (process.env.MCP_PROTOCOL_DIAGNOSTICS === 'true')
      observeMcpRequest(request, reply, this.logger);
    let principal: McpPrincipal;
    try {
      const token = request.headers.authorization?.match(
        /^Bearer\s+(mcp_at_[A-Za-z0-9_-]{43})$/i,
      )?.[1];
      if (!token) throw new UnauthorizedException();
      principal = await this.oauth.authenticate(token);
      if (
        request.raw['workspaceId'] &&
        request.raw['workspaceId'] !== principal.workspace.id
      )
        throw new UnauthorizedException();
    } catch (error) {
      if (!(error instanceof UnauthorizedException)) throw error;
      reply.header(
        'WWW-Authenticate',
        `Bearer resource_metadata="${this.oauth.issuer}/.well-known/oauth-protected-resource", scope="mcp"`,
      );
      return reply.code(401).send({ error: 'invalid_token' });
    }
    const server = this.servers.create(principal);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    reply.hijack();
    try {
      await server.connect(transport);
      await transport.handleRequest(request.raw, reply.raw, request.body);
    } finally {
      reply.raw.once('close', () => {
        void transport.close();
        void server.close();
      });
    }
  }

  @Get()
  getNotSupported(@Req() request: FastifyRequest, @Res() reply: FastifyReply) {
    if (process.env.MCP_PROTOCOL_DIAGNOSTICS === 'true')
      observeMcpRequest(request, reply, this.logger);
    // Streamable HTTP clients probe GET after initialization. This stateless
    // server has no separate SSE stream; 405 prevents a spurious OAuth retry.
    return reply
      .header('Allow', 'POST')
      .code(405)
      .send({ error: 'method_not_allowed' });
  }
}
