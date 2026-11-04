import { EventEmitter } from 'node:events';
import { observeMcpRequest } from './mcp-diagnostics';

describe('MCP safe transport diagnostics', () => {
  it('records protocol/status categories without credentials or RPC parameters', () => {
    const raw = Object.assign(new EventEmitter(), {
      statusCode: 406,
      getHeader: () => 'application/json',
    });
    const logger = { log: jest.fn() };
    observeMcpRequest(
      {
        headers: {
          accept: 'application/json',
          authorization: 'Bearer secret-token',
        },
        body: {
          method: 'tools/list',
          id: 'private-id',
          params: { secret: 'document-content' },
        },
      } as any,
      { raw } as any,
      logger as any,
    );
    raw.emit('finish');
    expect(logger.log).toHaveBeenCalledWith(
      expect.objectContaining({
        rpcMethod: 'tools/list',
        status: 406,
        acceptsJson: true,
        acceptsSse: false,
        responseType: 'json',
      }),
    );
    const text = JSON.stringify(logger.log.mock.calls);
    for (const secret of ['secret-token', 'private-id', 'document-content'])
      expect(text).not.toContain(secret);
  });
  it('does not log an arbitrary method value that could contain secrets', () => {
    const raw = Object.assign(new EventEmitter(), {
      statusCode: 400,
      getHeader: () => 'text/event-stream',
    });
    const logger = { log: jest.fn() };
    observeMcpRequest(
      { headers: {}, body: { method: 'Bearer secret-value' } } as any,
      { raw } as any,
      logger as any,
    );
    raw.emit('finish');
    expect(logger.log).toHaveBeenCalledWith(
      expect.objectContaining({ rpcMethod: 'unknown' }),
    );
    expect(JSON.stringify(logger.log.mock.calls)).not.toContain('secret-value');
  });
});
