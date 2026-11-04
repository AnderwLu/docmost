import { redactSensitiveUrl } from '../../../common/helpers/utils';

// OEM OAuth credentials and browser request handles must never enter HTTP logs.
describe('OAuth URL redaction', () => {
  it.each([
    '/oauth/authorize?state=secret&code_challenge=secret',
    '/mcp/authorize/browser-request-secret',
    '/api/mcp-oauth/requests/browser-request-secret',
  ])('redacts sensitive parameters or handles in %s', (url) => {
    expect(redactSensitiveUrl(url)).not.toContain('secret');
  });
});
