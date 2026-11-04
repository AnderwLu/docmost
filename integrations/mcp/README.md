# MCP integration

This OEM integration makes Docmost a Model Context Protocol server without using
the unbundled Docmost Enterprise MCP implementation. It uses the public MCP SDK
already pinned by Docmost and keeps all attachment and write behavior inside the
isolated integration.

## Upstream baseline

| Item                     | Current value                              |
| ------------------------ | ------------------------------------------ |
| Official Docmost release | `v0.95.0`                                  |
| Official upstream commit | `4132dd59be05a507dad76d1e01c48c9af2fd90f0` |
| OEM development branch   | `onlyoffice-integration`                   |

MCP release `mcp-v1.3.4` is commit
`d3c97918227bdc4298e594fcef7d98b521982a8f`. Its immutable production image is
`anderwlu/docmost-onlyoffice:mcp-v1.3.4` with image ID
`sha256:3ef9e3cc7b9384bf74dac45d2be1d7baac03a67c95a7cac27d7bcebc26f4b2b0`.
The preceding read-only release is tagged `mcp-readonly-v1.0.0` at commit
`0366245e445d4f12846f8da056c0767c38b52819`.

## Current production deployment — 2026-11-04

- NAS production was updated in place to `anderwlu/docmost-onlyoffice:mcp-v1.4.0-oauth-20261104`.
- Native platform: `linux/amd64`; image ID: `sha256:b427b99506329c38445f936c14cbdab7e8989a61ba9894ce1da15b88c4563fb4`.
- Current public Docmost URL: `https://doc.lujianning.cn`; MCP: `https://doc.lujianning.cn/mcp`.
- Domain migration completed on 2026-11-04 after the original `doc.hnjnth.com`
  IPv4 ingress was found to be blocked by Tencent Cloud. Only APP_URL and the
  Docmost container were updated; the image and dependency services are unchanged.
  Domain rollback configuration: `backups/domain-doc-lujianning-20261104-121913`.
  IPv4, IPv6 and proxy-path discovery/registration/consent checks passed with the
  new domain; all OAuth endpoints now advertise it consistently.
- MCP server reports version `1.4.0`. Only the Docmost service was recreated with
  `--no-deps`; PostgreSQL, Redis and ONLYOFFICE container IDs/start times were unchanged.
- Existing environment and storage mounts were compared before/after: only
  `APP_URL` changed from the NAS HTTP address to the existing public HTTPS origin.
  Upload limit remains `10gb`; all secrets and ONLYOFFICE URLs are preserved.
- Database, attachments and Compose/secret configuration backup:
  `/vol1/1000/docker/docmost/backups/mcp-v1.4.0-oauth-20261104-before`.
- Release artifacts, checksums and full source snapshot:
  `/vol1/1000/docker/docmost/releases/mcp-v1.4.0-oauth-20261104`.
- This deployment uses source HEAD `cdba3f3209cfebc04803d1a8996df8fc23df264d` plus the uncommitted
  OAuth customization, captured in `source.tar.gz` and `source.patch`. It has no
  Git release tag at deployment time. The finalized source is now pinned by Git tag
  `mcp-v1.4.0`; it additionally contains the optional, default-off protocol
  diagnostics used during client verification and finalized release documentation.
  The running stable image remains the original verified build. Source archive SHA-256: `f1fd82d79152b73a49b2e741538895c4b250eb59950d85bb31042a6ccd55e109`.
- Public HTTPS checks passed: health/database/Redis, issuer/resource metadata,
  dynamic client registration, Secure/HttpOnly cookie and consent redirect,
  consent-page delivery and requirement for the existing Docmost login. Public
  MCP POST requires OAuth; optional GET/SSE returns 405. Real-user sign-in and
  client authorization passed the user's real ChatGPT connection validation.

### NAS build and rollback

Runtime package manifests and `pnpm-lock.yaml` were byte-identical to the old
production image. The NAS release Dockerfile therefore uses the immutable old
runtime digest `andrew988/docmost-onlyoffice@sha256:e0fd768140b9e5a776ea8e6ce07bb7ff69c8dc5b8ba588da88de68af0cb918b5`,
removes the old server/client build directories and copies the newly compiled
portable JavaScript/browser assets. It installs no dependencies and embeds no
secrets. The source snapshot, source patch, manifest and Dockerfile remain with
the release. If runtime dependencies change, use a full native source build instead.

For rollback, restore the two backed-up Compose files, then run the existing
Compose project with `up -d --no-deps docmost`. The old image
`anderwlu/docmost-onlyoffice:mcp-v1.3.4` is retained. Database and attachment
restoration is unnecessary for a container rollback because this release adds no
schema migration. Restoring the original Compose also restores the old HTTP
`APP_URL`; MCP clients then need the old API-key connection again.

## Historical production deployment — mcp-v1.3.4

- Deployed on `2026-08-11` to the existing Docmost Compose project.
- Only the `docmost` service was recreated with `--no-deps`.
- PostgreSQL, Redis and ONLYOFFICE were not restarted.
- Pre-deployment rollback data is stored at
  `/vol1/1000/docker/docmost/backups/mcp-v1.3.4-20260811-152130` on the deployment
  host. The PostgreSQL dump is compressed as `docmost.sql.gz`.
- The previous image `anderwlu/docmost-onlyoffice:mcp-v1.3.3` remains
  the immediate rollback target.
- Production smoke verification passed for API-key authentication, all twenty-four
  tools, MCP server version `1.3.4`, direct attachment/image node insertion into page
  content, `upload_attachment` insertion parameters, invalid and wrong-workspace key
  rejection, and valid-key principal mapping.

## Endpoint and authentication

Production now uses OAuth authorization code + PKCE S256, referencing English's
Learning Path connection flow. The current NAS release is `mcp-v1.4.0-oauth-20261104`. **Personal API keys are no longer accepted by the
new `/mcp` handler**. The OEM API-key create/list/update/revoke endpoints have been
removed; existing database rows are left intact for rollback.

- Streamable HTTP resource: `POST /mcp`.
- Identity: exactly the existing Docmost knowledge-base user and workspace. No
  second account/password store. Consent uses `JwtAuthGuard`, `authToken`, the
  existing active session validation, `AuthUser` and `AuthWorkspace`. Existing
  login, MFA and SSO return-path handling are reused.
- The browser signs in at the existing login page and returns to
  `/mcp/authorize/:requestId`. A separate explicit consent grants all current MCP
  read/write tools (`mcp` scope); the screen discloses destructive permissions.
- Tokens are bound to the client, user, workspace and exact `APP_URL/mcp` resource.
  Every MCP request rechecks the current user and workspace; space/page/attachment
  permissions continue to use the existing tool services. OAuth does not enlarge
  content permissions.
- Access tokens last 15 minutes; grants/refresh token families have an absolute
  30-day lifetime, without sliding extension. Codes expire after 60 seconds,
  browser requests after 10 minutes. Only SHA-256 credential hashes are stored.
- Refresh rotation uses a Redis Lua transaction. Reuse of a previously consumed
  refresh token revokes the whole grant and its access tokens. Parallel refreshes
  must be serialized by clients. Consent and code redemption use atomic
  compare-and-delete to prevent reuse.
- Consent is bound to an HttpOnly, SameSite=Lax browser cookie and requires a
  same-origin POST from an active Docmost browser session. Knowledge-base API keys
  and OAuth access tokens cannot approve a grant.
- View/revoke connections under **Settings → Account → MCP 授权连接** (existing
  `/settings/account/api-keys` URL retained as a compatibility mount). Revocation
  invalidates both access and refresh tokens immediately.
- No new dependencies, user tables or business tables. OAuth state uses the
  existing Redis service under `mcp:oauth:*`, with bounded TTLs. Redis is part of
  the authorization state, not merely an optional cache: retain its volume and
  enable persistence if authorizations must survive Redis restarts. Flush,
  eviction or loss of Redis state requires clients to register/connect again;
  there is no fallback to unauthenticated access or API keys.

### Configuration and proxy

`APP_URL` is the public issuer origin and must be HTTPS, except explicit loopback
development (`localhost`/`127.0.0.1`). Startup fails for non-loopback HTTP. Use the
existing `REDIS_URL`; no new secrets are required because tokens are random opaque
credentials. Production proxies must forward `/.well-known/*`, `/oauth/*`, `/mcp`,
`/mcp/authorize/*` and `/api/mcp-oauth/*` to Docmost, preserving cookies, Origin and
Authorization headers. Terminate HTTPS at the trusted proxy.

`MCP_OAUTH_REDIRECT_URIS` is a comma-separated exact HTTPS callback allowlist.
Defaults: `https://chatgpt.com/connector_platform_oauth_redirect` and
`https://chat.openai.com/aip/g/callback`. Add an explicitly verified client callback
when needed; wildcards are not supported. Native callbacks accept only
`http://localhost:<port>/...` or `http://127.0.0.1:<port>/...`, with an explicit valid
port, no credentials and no fragments. Registered redirect strings must match
exactly during authorization and code redemption. No client-provided URL is fetched.

### Protocol endpoints

| Endpoint | Behavior |
| --- | --- |
| `GET /.well-known/oauth-protected-resource[/mcp]` | MCP resource discovery |
| `GET /.well-known/oauth-authorization-server` | Issuer, endpoints, S256 and scope discovery |
| `POST /oauth/register` | Public dynamic registration (`token_endpoint_auth_method=none`) |
| `GET /oauth/authorize` | Validate client, redirect, state, S256, resource; open consent |
| `POST /oauth/token` | Form-encoded or JSON code redemption/refresh; resource required |
| `POST /oauth/revoke` | Revoke access/refresh grant using token and client ID |
| `/api/mcp-oauth/requests/:id` | Browser-session protected consent details/decision |
| `POST /api/mcp-oauth/grants` | Current user's current-workspace connections |
| `POST /api/mcp-oauth/grants/:id/revoke` | Revoke an owned connection |

Protocol endpoints return raw OAuth JSON, with no Docmost response envelope.
Unauthenticated MCP POST returns HTTP 401 and a `WWW-Authenticate` resource metadata
challenge. GET returns 405 because the stateless transport does not expose a
separate SSE subscription (avoiding client reauthorization loops).
Registration/authorization/token/revocation are rate-limited in Redis
per IP. Authorization errors never redirect to an unvalidated callback. OAuth
query parameters and consent request handles are redacted from HTTP logs.

### Preflight record

- User confirmed production `mcp-v1.3.4` on 2026-11-04; exact commit above.
- Official base stays `v0.95.0` / `4132dd59be05a507dad76d1e01c48c9af2fd90f0`.
- Repository Compose uses a local storage volume at `/app/data/storage`; actual
  production storage has not been re-inspected in this OAuth change. OAuth does
  not read/replace attachments outside the existing MCP tool services.
- Attachment content uses `StorageService` (read/upload/replace); Office and MCP
  keep the existing `FILE_UPLOAD_SIZE_LIMIT`. No storage changes are needed here.
- Server registration is `CoreModule → McpModule`; login is `JwtStrategy` plus
  active `UserSessionRepo`; frontend routing is `App.tsx`. Attachment action
  mounts remain unchanged.

## Tools

- `search_pages`
- `get_page`
- `list_pages`
- `list_child_pages`
- `get_space`
- `list_spaces`
- `search_attachments`
- `get_attachment`
- `download_attachment`
- `get_current_user`
- `create_page`
- `update_page`
- `move_page`
- `create_comment`
- `create_space`
- `update_space`
- `delete_space`
- `list_page_attachments`
- `delete_attachment`
- `replace_attachment`
- `upload_attachment`
- `insert_attachment_node`
- `insert_image_node`
- `create_page_with_attachments`

The eleven read tools carry the MCP read-only annotation. The thirteen write tools are
explicitly annotated as non-read-only and non-idempotent. `delete_space` and
`delete_attachment` additionally carry `destructiveHint: true`. All page and attachment
operations enforce space membership and Docmost's inherited page permissions.
Deleted records and other workspaces are excluded.

`get_attachment` reads through Docmost's storage abstraction. It uses existing
indexed text when present and otherwise extracts text from XLSX, DOCX, PPTX and
common text files. XLSX output preserves worksheet, row and cell structure as
tab-separated text. Parsing is bounded to 25 MiB and returned text to 1,000,000
characters. `download_attachment` generates the existing Docmost signed attachment
URL only after permission validation; the URL expires after one hour.

Write tools reuse `PageService`, `CommentService`, page-access validation and
space CASL abilities. Page content uses Markdown. `update_page` supports `replace`,
`append` and `prepend`; `move_page` supports reparenting, moving to root and moving
to another writable space.

`list_page_attachments` returns attachment metadata only after page-view validation.
Attachment deletion and replacement require page-edit permission. Replacement copies
the original storage object to a temporary rollback object, replaces the bytes through
the storage abstraction, and preserves the attachment ID, path and page relationship.
Files are base64 encoded and reuse Docmost's configured upload-size limit.
`create_page_with_attachments` reuses `create_page` and the same attachment upload
pipeline, accepting at most twenty files per call. Space update and deletion require
the same settings-management CASL ability as the native Docmost endpoints.

`insert_attachment_node` appends an existing page attachment as a native ProseMirror
`attachment` card node. `insert_image_node` appends an existing image attachment as
a native ProseMirror `image` node and rejects non-image MIME types. `upload_attachment`
accepts `insertIntoPage` and `display` (`attachment_card` or `image`) to upload bytes
and insert the corresponding editor node in one call.

## Upstream mount points

| Upstream-owned file | Reason | Verification |
| --- | --- | --- |
| `apps/server/src/core/core.module.ts` | Registers isolated `McpModule` (existing mount). | Server build and MCP factory tests. |
| `apps/server/src/main.ts` | Excludes OAuth protocol/discovery from `/api`; exposes discovery challenge headers in CORS. Native Nest Fastify form parsing is reused. | OAuth HTTP integration tests and server build. |
| `apps/server/src/common/helpers/utils.ts` | Redacts OAuth query parameters and request handles from logs. | Isolated OAuth logging unit tests. |
| `apps/client/src/App.tsx` | Registers independent consent route, compatible with existing login return paths. | Client typecheck/build and UI tests. |
| `apps/client/src/components/settings/settings-sidebar.tsx` | Replaces personal API-key label with OAuth connections; removes obsolete API-key prefetch. | Client build and settings smoke. |
| `apps/client/src/ee/ai/components/mcp-settings.tsx` | Explains browser OAuth connection. | Client build and settings smoke. |
| `apps/client/src/ee/api-key/pages/user-api-keys.tsx` | Mounts isolated connection manager instead of API-key CRUD. | Connection UI tests and client build. |
| `.env.example` | Documents exact callback allowlist and public issuer requirements. | Startup config checks and deployment smoke. |

Server business logic is isolated under `apps/server/src/integrations/mcp/`;
OAuth primitives, store, services and controllers are in its `oauth/` subdirectory.
Client pages are under `apps/client/src/integrations/mcp/`.

## Verification and smoke test

```sh
pnpm --filter server test --runInBand --testPathPatterns='integrations/mcp|common/helpers/utils.spec'
pnpm --filter client test src/integrations/mcp/mcp-authorization-page.test.tsx
pnpm --filter server exec tsc --noEmit
pnpm --filter client exec tsc --noEmit
pnpm --filter server build
pnpm --filter client build
docker build -t docmost-oem:oauth-review .
```

Run Redis-backed HTTP tests against an **isolated disposable** Redis (tests create
only `mcp:oauth:*` keys with TTL and never flush the database):

```sh
docker run --rm -d --name docmost-oauth-test-redis -p 127.0.0.1:16389:6379 redis:7.2-alpine
MCP_OAUTH_TEST_REDIS_URL=redis://127.0.0.1:16389 pnpm --filter server test --runInBand --testPathPatterns='oauth'
docker stop docmost-oauth-test-redis
```

The HTTP/Redis suite uses mocked knowledge-base user repositories and an overridden
browser guard to isolate OAuth. A separate real-application smoke verifies the
actual login, JWT guard, database user/workspace and MCP identity using the pinned
MCP SDK (run with Node 22+). It creates a
workspace/account and **must only run against an empty disposable loopback deployment**:

```sh
MCP_OAUTH_SMOKE_DISPOSABLE=1 MCP_OAUTH_SMOKE_URL=http://localhost:13039 node integrations/mcp/scripts/oauth-smoke.mjs
```

The local `docmost-oem:oauth-local-review` Docker image also passed this full
login/authorization/SDK smoke with disposable PostgreSQL and Redis.
See [verification results](OAUTH-VERIFICATION.md). Configured MFA/SSO and real client
connection via public HTTPS still require release verification. Complete these
steps on a disposable full deployment before production:

1. Configure public HTTPS `APP_URL`, the verified callback allowlist and persistent
   Redis. Confirm discovery is public and raw JSON; old API keys get 401 at `/mcp`.
2. Connect ChatGPT or a compatible native client using only the `/mcp` URL. Confirm
   existing Docmost login (including enabled MFA/SSO) returns to explicit consent.
3. Deny once: client receives `access_denied`; no grant is issued. Connect again
   and approve. `get_current_user` must match the knowledge-base user/workspace.
4. `tools/list` must expose exactly the existing twenty-four tools. Exercise page,
   space and attachment reads/writes within the user's current permissions.
5. Restricted pages, other users' inaccessible spaces and other workspaces must
   remain inaccessible by list/search and direct ID. Test with two real users.
6. Refresh after access expiry, revoke under account settings, and confirm both
   existing access and refresh tokens fail. Confirm disabled/deleted users fail.
7. Test tampered codes, wrong PKCE/client/resource, expired requests/codes/tokens,
   cross-origin consent, callback mismatch and replay; none may produce access.
8. Restart the application with Redis retained; grants continue to work. Loss of
   Redis state must force reconnection. Original attachments stay unchanged.
9. Verify ONLYOFFICE Word/spreadsheet/presentation open/edit/save/reopen still work.

## Upgrade and rollback

After merging a pinned Docmost release into the baseline branch, verify every
mount above, `JwtStrategy`/session validation, safe post-login redirects, space
membership and inherited page permissions. Run native checks and full smoke.
Do not bypass permission APIs if upstream changes.

For future rollout, publish a new immutable image tag after verification; never overwrite
a deployed tag. Existing MCP clients must reconnect via OAuth, since their API keys
will be rejected. No database migration or user recreation is required. For
rollback redeploy `anderwlu/docmost-onlyoffice:mcp-v1.3.4`; its existing API-key
rows remain intact. OAuth tokens are unusable by the old handler. Reconnect
clients with the old API-key mechanism only if intentionally rolling back.

## Optional protocol diagnostics

Root `/mcp` is outside the default `/api` HTTP logger. The development helper
`MCP_PROTOCOL_DIAGNOSTICS=true` records only allowlisted RPC method categories,
HTTP status, accepted media-type booleans and timing. It never records authorization
headers, tokens, RPC IDs, parameters or document contents. It defaults off and
is not enabled in the stable NAS release. On 2026-11-04 the actual ChatGPT client
completed login and tool discovery; the user confirmed successful connection.
