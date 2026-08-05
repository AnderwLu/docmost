# ONLYOFFICE integration

This customization adds authenticated online editing for Docmost `.docx`, `.xlsx`, and `.pptx` attachments. It is based on Docmost `v0.80.2` (`b99e3d67f58be988b7372db838532f640b1b5500`).

## Configuration

| Variable                       | Purpose                                                                                                                                           |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ONLYOFFICE_INTERNAL_URL`      | Document Server origin reachable by the Docmost container, for example `http://onlyoffice`. Edited-file callback URLs must use this exact origin. |
| `ONLYOFFICE_BROWSER_URL`       | Document Server origin reachable by users' browsers. Defaults to the internal URL.                                                                |
| `ONLYOFFICE_DOCMOST_URL`       | Docmost origin reachable by Document Server, for example `http://docmost:3000`.                                                                   |
| `ONLYOFFICE_JWT_SECRET`        | Shared Document Server JWT secret. Configure the same value in ONLYOFFICE.                                                                        |
| `ONLYOFFICE_TOKEN_SECRET`      | Independent secret for short-lived file and callback URLs. Use at least 32 random bytes and do not reuse `APP_SECRET`.                            |
| `ONLYOFFICE_TOKEN_TTL_SECONDS` | Signed URL lifetime; defaults to 1800 seconds.                                                                                                    |

All URL variables are normalized to origins. Paths, embedded credentials, redirects, and edited-file origins other than `ONLYOFFICE_INTERNAL_URL` are rejected.

## Build and run

The repository Dockerfile builds the customized source. Do not deploy `docmost/docmost:latest` for this integration.

```bash
docker compose -f docker-compose.yml -f docker-compose.onlyoffice.yml build docmost
docker compose -f docker-compose.yml -f docker-compose.onlyoffice.yml up -d
```

The override assumes the existing ONLYOFFICE service is reachable at the configured URLs. If it runs in a separate Compose project, attach both services to a shared external Docker network or use a resolvable internal hostname. Document Server must be able to call `ONLYOFFICE_DOCMOST_URL`; users' browsers must be able to load `ONLYOFFICE_BROWSER_URL`.

## Storage behavior

- The current upstream storage abstraction supports both local volumes and S3-compatible storage.
- A save is downloaded with a 30-second timeout and bounded by `FILE_UPLOAD_SIZE_LIMIT`.
- The edited file must be a non-empty OOXML ZIP with the expected Word, Excel, or PowerPoint structure.
- The module uploads a staged object, copies the original to a backup object, replaces the original, then updates attachment size and timestamp.
- If the database update or replacement fails, it restores the backup. Temporary and backup objects are cleaned up on all paths.

## Core mount points

| Upstream file                                                               | Reason                                                    | Verification                                                                       |
| --------------------------------------------------------------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `apps/server/src/core/core.module.ts`                                       | Register `OnlyOfficeModule`.                              | Server build and session/callback tests.                                           |
| `apps/client/src/App.tsx`                                                   | Register `/office/edit/:attachmentId`.                    | Client typecheck/build and manual route smoke test.                                |
| `apps/client/src/features/editor/components/attachment/attachment-view.tsx` | Display the online-open action for supported attachments. | Client build plus format visibility smoke test.                                    |
| Storage driver interface, local driver, S3 driver, and service              | Add backend-neutral staged replacement.                   | Local-driver atomic replacement test; S3 smoke test required before S3 deployment. |
| `apps/server/src/integrations/environment/environment.service.ts`           | Read and validate integration configuration.              | Server build and startup with/without required values.                             |

All other server and client business logic is under each application's `src/integrations/onlyoffice/` directory.

## Smoke test

1. Back up the Docmost database and attachment volume/bucket.
2. Start Docmost with all six configuration values and the existing Document Server JWT secret.
3. Upload one valid `.docx`, `.xlsx`, and `.pptx` attachment below `FILE_UPLOAD_SIZE_LIMIT`.
4. Confirm “Open online” appears for those files and not for `.doc`, `.xls`, `.ppt`, or unrelated files.
5. Open each supported file in a new tab, edit it, use the ONLYOFFICE save action, close the tab, and reopen it.
6. Confirm the new content is present and the attachment ID, filename, page association, and download URL are unchanged.
7. Stop Document Server and confirm Docmost still loads and original attachment downloads still work.
8. Test an invalid JWT and a failed edited-file download; confirm the callback returns nonzero and the original file remains readable.
9. Restart both containers and confirm successfully saved content persists.

## Upgrade and rollback

1. Fetch the selected official release from `upstream` and record its tag and commit.
2. Merge it into `docmost-v0.80.2`; do not add customization code to that branch.
3. Build and verify the clean baseline, then push it to `origin`.
4. Merge `docmost-v0.80.2` into `onlyoffice-integration`.
5. Resolve the mount points listed above. A missing route, module registration, attachment action, or storage replacement implementation must fail build/tests rather than be silently omitted.
6. Build the custom image and run the smoke test against a disposable database and attachment volume/bucket.
7. Back up production data, deploy the new immutable image tag, and verify all three formats.
8. On failure, redeploy the previous image tag while preserving the database and attachment volume/bucket. Restore data only if a database/storage migration explicitly requires it.
