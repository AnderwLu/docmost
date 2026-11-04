import { createHash, randomBytes } from 'node:crypto';

export const SCOPE = 'mcp';
export const ACCESS_TTL = 15 * 60;
export const GRANT_TTL = 30 * 24 * 60 * 60;
export const opaque = () => randomBytes(32).toString('base64url');
export const digest = (value: string) =>
  createHash('sha256').update(value).digest('base64url');

export class OAuthError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}
export function requireOAuth(
  condition: unknown,
  code = 'invalid_request',
): asserts condition {
  if (!condition) throw new OAuthError(code);
}
export function textParam(value: unknown, max = 2048): string {
  requireOAuth(
    typeof value === 'string' && value.length > 0 && value.length <= max,
  );
  return value;
}

// Exact HTTPS callbacks plus RFC 8252 loopback callbacks. Never fetch client URLs.
export function validateRedirect(value: unknown, allowed: string[]): string {
  const raw = textParam(value);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new OAuthError('invalid_redirect_uri');
  }
  requireOAuth(
    !url.username && !url.password && !url.hash && !/[\s\\]/.test(raw),
    'invalid_redirect_uri',
  );
  const loopback =
    url.protocol === 'http:' &&
    ['localhost', '127.0.0.1'].includes(url.hostname) &&
    /^http:\/\/(localhost|127\.0\.0\.1):[0-9]+\//.test(raw) &&
    Number(url.port || 80) > 0;
  requireOAuth(
    loopback || (url.protocol === 'https:' && allowed.includes(raw)),
    'invalid_redirect_uri',
  );
  return raw;
}
export type OAuthClient = { id: string; name: string; redirects: string[] };
export type Authorization = {
  clientId: string;
  redirect: string;
  challenge: string;
  state: string;
  resource: string;
  browserHash: string;
};
export type OAuthGrant = {
  id: string;
  clientId: string;
  clientName: string;
  userId: string;
  workspaceId: string;
  resource: string;
  refreshHash: string;
  expiresAt: number;
  createdAt: number;
};
