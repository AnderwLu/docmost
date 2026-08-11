import {
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { Public } from '../../common/decorators/public.decorator';
import { McpApiKeyService } from './mcp-api-key.service';
import { McpServerFactory } from './mcp-server.factory';

@Public()
@Controller('mcp')
export class McpController {
  constructor(
    private readonly apiKeys: McpApiKeyService,
    private readonly servers: McpServerFactory,
  ) {}

  @HttpCode(200)
  @Post()
  async handle(@Req() request: FastifyRequest, @Res() reply: FastifyReply) {
    const principal = await this.apiKeys.authenticate(
      request.headers.authorization,
    );
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
  getNotSupported() {
    throw new UnauthorizedException('Use an authenticated MCP POST request');
  }
}
