import { digest, OAuthError, validateRedirect } from './oauth.protocol';

describe('OAuth protocol primitives', () => {
  const callback = 'https://chatgpt.com/connector_platform_oauth_redirect';
  it('implements the RFC 7636 S256 test vector', () => {
    expect(digest('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    );
  });
  it.each([
    callback,
    'http://localhost:34321/callback',
    'http://127.0.0.1:54321/callback',
  ])('allows registered callback %s', (uri) => {
    expect(validateRedirect(uri, [callback])).toBe(uri);
  });
  it.each([
    'https://evil.test/callback',
    'https://chatgpt.com.evil.test/connector_platform_oauth_redirect',
    'https://chatgpt.com/other',
    'https://chatgpt.com/connector_platform_oauth_redirect#fragment',
    'http://192.168.1.5:8080/callback',
    'http://localhost/callback',
    'http://localhost:0/callback',
    'http://user:pass@localhost:8080/callback',
    'javascript:alert(1)',
    'https://chatgpt.com\\@evil.test/callback',
  ])('rejects unsafe callback %s', (uri) => {
    expect(() => validateRedirect(uri, [callback])).toThrow(OAuthError);
  });
});
