# MCP OAuth verification — 2026-11-04

Final source is pinned by Git tag `mcp-v1.4.0` on `onlyoffice-integration`. Production was updated on 2026-11-04 to
`anderwlu/docmost-onlyoffice:mcp-v1.4.0-oauth-20261104` at `https://doc.lujianning.cn`.

## Identity and migration

- OAuth consent uses the existing knowledge-base `JwtAuthGuard`, `authToken`,
  active session, user and workspace. No additional user model or password handling.
- `/mcp` accepts only issued OAuth access tokens. Legacy personal API keys are
  rejected; the OEM API-key controller/service are removed. Database rows remain
  untouched for rollback.
- Account settings now manage OAuth grants. The existing MCP tool services and
  content permission checks remain in place.

## Checks

- Server MCP/security regressions plus real Redis/HTTP OAuth integration:
  **71 tests passed**, including atomic code redemption, secure browser redirect,
  PKCE, expiration, refresh rotation/replay, revocation, user/workspace identity,
  actual knowledge-base JWT session validation, legacy-key rejection and log redaction.
- Client consent and connection management: **4 tests passed** (loading, identity,
  error states, explicit consent and revoke/empty state).
- Server and client TypeScript checks: passed.
- New OAuth/MCP server code and new client components: lint passed.
- Formatting of all new integration files: passed.
- Real disposable Docmost + PostgreSQL + Redis smoke: **passed**. Existing account
  setup, logout/login, OAuth consent, 24 tools, `get_current_user` matching the
  logged-in knowledge-base user/workspace, refresh, revocation and old-key rejection.
  This uses the actual application, JWT guard, sessions, database repositories and
  the pinned MCP SDK. Its optional GET/SSE probe returns 405 without triggering
  an OAuth retry loop.
- Server and client native builds: passed. Client retains the existing large-chunk
  warning.

Full changed-file lint encounters two existing upstream issues, unchanged here:
`apps/server/src/common/helpers/utils.ts:3` uses a TypeScript require-style import;
`apps/client/src/components/settings/settings-sidebar.tsx` synchronizes active
state in an effect. The pinned `@tanstack/eslint-plugin-query@5.94.4` npm artifact
also omits its declared compiled entrypoint. Client lint was additionally run with
that package's published source condition and the existing TSX loader; this retains
its configured rules. No dependency/lockfile changes were made. The missing pinned
macOS Rolldown native binding was supplied from a temporary directory for local
UI tests/build.

- Final Docker image **built successfully** as `docmost-oem:oauth-local-review`
  (local `linux/arm64` review image). The full real-account + MCP SDK smoke above
  also **passed inside this image**, using separate disposable PostgreSQL and Redis.
  The image was not pushed or deployed to production.

## Remaining release verification

- The isolated HTTP suite mocks the browser guard and repositories; the separate
  full-application smoke above verifies actual password login, guard, sessions and
  MCP identity against a real temporary database. Real ChatGPT connection via production HTTPS passed as recorded below.
  Other native clients and enabled MFA/SSO remain unverified.
- Run the documented two-user permission smoke and real ONLYOFFICE Word, Excel and
  PowerPoint save/reopen regression on a disposable deployment before production.
- Verify public HTTPS APP_URL, proxy forwarding, callback allowlist and Redis
  persistence. Redis state loss requires clients to register/connect again.

## NAS deployment verification

- Production native amd64 image built successfully, with byte-identical runtime
  dependency manifests to the previous fixed production image.
- Database, 1.7GB attachment directory and configuration backup completed before
  switching. Old image remains available for rollback.
- Only Docmost was recreated. Existing PostgreSQL, Redis and ONLYOFFICE container
  IDs/start times were checked and unchanged.
- Runtime environment/mount comparison passed: only APP_URL changed to the public
  HTTPS origin; secrets, ONLYOFFICE endpoints, upload limit and storage are preserved.
- Public HTTPS health, discovery, dynamic registration, secure browser authorization
  redirect, consent page and existing-login requirement passed after deployment.
- User confirmed successful real ChatGPT login/authorization and tool discovery.

## Client connection diagnosis — 2026-11-04

The user reported ChatGPT's OAuth metadata discovery timing out. Rechecking both
network families showed that the previous public check used a working IPv6 path;
it did not establish external IPv4 accessibility.

| Path | Observed result |
| --- | --- |
| NAS localhost OAuth metadata | HTTP 200 |
| Public Docmost HTTPS over IPv6 | HTTP 200, correct issuer and DCR metadata |
| Public Docmost HTTPS over IPv4 (`43.142.59.123`) | TLS connection reset |
| IPv4 entry server loopback HTTPS with Docmost SNI | HTTP 200 through existing stream forwarding |
| Learning Path over the same public IPv4 | HTTP 200 |
| Public Docmost HTTP over IPv4 | HTTP 302 to Tencent Cloud `https://dnspod.qcloud.com/static/webblock.html?d=doc.hnjnth.com` |

This places the confirmed failure at the public IPv4 domain ingress, before
Docmost. The Tencent block page is filing/access-related; the exact account-side
reason has not been verified. Do not change OAuth secrets, disable authentication,
remove DNS records or alter working stream forwarding to mask the block. Resolve
this domain's Tencent Cloud access status, then repeat public IPv4 discovery and
real ChatGPT login. For this server the intended client registration method is
DCR, token endpoint authentication `none`, scope `mcp`; manual blank client ID
configuration is not its automatic registration flow.

## Domain migration resolution — 2026-11-04

The user selected `doc.lujianning.cn`. DNS/HTTPS routing for that domain became
available, but the NAS initially continued to advertise `doc.hnjnth.com` in OAuth
metadata. APP_URL was therefore updated to `https://doc.lujianning.cn` and only
Docmost was recreated. Image ID and all other environment values remained the
same; database, Redis and ONLYOFFICE container IDs/start times were unchanged.

- Resource identifier, issuer, authorization, token, registration and revocation
  endpoints all now use `doc.lujianning.cn`.
- Explicit public IPv4 and IPv6 metadata requests passed.
- Proxy-path public health, metadata, DCR registration, secure cookie/consent
  redirect and existing-login requirement checks passed.
- Rollback configuration: `backups/domain-doc-lujianning-20261104-121913` on NAS.
- ChatGPT's “CIMD unavailable” message is informational for this DCR-only server;
  use DCR, token endpoint authentication `none` and scope `mcp`.

## Real client authorization and tool discovery — 2026-11-04

The user completed real ChatGPT authorization on `doc.lujianning.cn`, then
initially received “Authentication succeeded, action discovery failed”. A
short-lived diagnostic build added opt-in protocol category/status logging on
root `/mcp`, which is outside the regular `/api` request logger. It logged no
headers, token values, RPC parameters or content. Diagnostics showed successful
`initialize` (200), `notifications/initialized` (202) and `tools/list` (200).
The user subsequently confirmed the connection works. The exact cause of the
initial intermittent client discovery failure has not been established; no
unsupported schema or authentication bypass was applied.

The temporary diagnostic override was removed and the stable production image
`mcp-v1.4.0-oauth-20261104` restored. LOG_HTTP and MCP_PROTOCOL_DIAGNOSTICS are off;
existing Redis authorizations and the new public domain are retained.
