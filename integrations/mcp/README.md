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

MCP release `mcp-v1.3.2` is commit
`6f5f31f06626115eb9c38c5ba90c3a270e2090a7`. Its immutable production image is
`anderwlu/docmost-onlyoffice:mcp-v1.3.2` with image ID
`sha256:70ca5471895296f336f284339cf9ae2ada2ce2e38c2ebe273a1f1c88b2ee04e9`.
The preceding read-only release is tagged `mcp-readonly-v1.0.0` at commit
`0366245e445d4f12846f8da056c0767c38b52819`.

## Production deployment

- Deployed on `2026-08-11` to the existing Docmost Compose project.
- Only the `docmost` service was recreated with `--no-deps`.
- PostgreSQL, Redis and ONLYOFFICE were not restarted.
- Pre-deployment rollback data is stored at
  `/vol1/1000/docker/docmost/backups/mcp-v1.3.2-20260811-121155` on the deployment
  host. The PostgreSQL custom-format dump was verified with `pg_restore -l`.
- The previous image `anderwlu/docmost-onlyoffice:mcp-v1.1.0` remains
  the immediate rollback target.
- Production smoke verification passed for API-key authentication, all twenty-two
  tools, attachment upload and listing, numeric `fileSize` serialization, database
  and storage persistence, page/workspace relationships, invalid and wrong-workspace
  key rejection, inaccessible-page isolation, attachment/space cleanup and immediate
  key revocation. Temporary verification data was removed.

## Endpoint and authentication

- Streamable HTTP endpoint: `POST /mcp`
- Authentication: `Authorization: Bearer <personal API key>`
- Create and revoke keys under **Settings → Account → API keys**.
- API keys are JWTs signed with the existing `APP_SECRET`. The token embeds the
  user, workspace and revocable `api_keys` row ID. Every MCP request verifies the
  signature, expiration, database row, owner, workspace and active-user state.
- Revoking a key invalidates it immediately. Tokens and page content are never logged.

No additional environment variables or business tables are introduced. The
upstream `api_keys` migration is reused.

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
- `create_page_with_attachments`

The eleven read tools carry the MCP read-only annotation. The eleven write tools are
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

## Upstream mount points

| Upstream-owned file                                        | Reason                                                                               | Verification                                 |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------ | -------------------------------------------- |
| `apps/server/src/core/core.module.ts`                      | Registers the isolated `McpModule`.                                                  | Server build and MCP factory test.           |
| `apps/client/src/components/settings/settings-sidebar.tsx` | Makes personal API keys available in the OEM build.                                  | Client build and manual settings smoke test. |
| `apps/client/src/ee/ai/components/mcp-settings.tsx`        | Replaces the enterprise license switch with truthful read-only OEM endpoint details. | Client build and manual settings smoke test. |
| `apps/client/src/ee/api-key/pages/user-api-keys.tsx`       | Always shows the MCP connection hint in this OEM build.                              | Client build and manual settings smoke test. |

Server business logic is isolated under `apps/server/src/integrations/mcp/`.

## Smoke test

1. Sign in and create a personal API key. Copy it before closing the dialog.
2. Configure an MCP client with the Docmost public URL ending in `/mcp` and the
   key as its Bearer token.
3. Confirm `tools/list` returns exactly the twenty-two tools above.
4. Call `get_current_user`; confirm it returns the key owner and current workspace.
5. Test page, child-page, space and attachment queries against accessible content.
6. Create a restricted page and an inaccessible space; confirm neither is returned
   by search/list and direct IDs return a tool error.
7. Revoke the key and confirm the next MCP request returns HTTP 401.

## Upgrade check

After merging a pinned Docmost release into the baseline branch, verify the four
mount points above, the `api_keys` schema, `TokenService.generateApiToken`, space
membership queries and inherited page permissions. Then run server tests/build,
client build and the smoke test. Do not silently fall back to raw database reads if
an upstream permission API changes.
