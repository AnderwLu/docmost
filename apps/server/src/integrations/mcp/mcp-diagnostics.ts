import { Logger } from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';

const METHODS = new Set([
  'initialize',
  'notifications/initialized',
  'ping',
  'tools/list',
  'tools/call',
  'resources/list',
  'resources/templates/list',
  'resources/read',
  'prompts/list',
  'prompts/get',
]);

// Root /mcp is excluded from Nest's /api prefix and its HTTP log middleware.
// Log only protocol categories, never headers, tokens, RPC IDs or parameters.
export function observeMcpRequest(
  request: FastifyRequest,
  reply: FastifyReply,
  logger: Logger,
) {
  const method = (request.body as { method?: unknown })?.method;
  const rpcMethod =
    typeof method === 'string' && METHODS.has(method) ? method : 'unknown';
  const started = Date.now();
  const accept = request.headers.accept || '';
  reply.raw.once('finish', () => {
    const type = String(reply.raw.getHeader('content-type') || '');
    logger.log({
      event: 'mcp_response',
      httpMethod:
        request.method === 'POST'
          ? 'POST'
          : request.method === 'GET'
            ? 'GET'
            : 'other',
      rpcMethod,
      status: reply.raw.statusCode,
      responseType: type.includes('text/event-stream')
        ? 'sse'
        : type.includes('application/json')
          ? 'json'
          : 'other',
      acceptsJson: accept.includes('application/json'),
      acceptsSse: accept.includes('text/event-stream'),
      elapsedMs: Date.now() - started,
    });
  });
}
