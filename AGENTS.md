# Docmost ONLYOFFICE OEM Integration

## Objective

Implement the requirements in `Docmost-ONLYOFFICE集成需求开发规格.md` as a maintainable Docmost customization. Keep ONLYOFFICE business logic isolated and limit upstream Docmost changes to small, documented registration or UI mount points.

## Source of truth

- Read `Docmost-ONLYOFFICE集成需求开发规格.md` before planning or changing code.
- Read the "Upstream baseline" section in `integrations/onlyoffice/README.md` for the currently pinned Docmost tag and commit.
- Treat its confirmed facts, scope, security rules, and acceptance criteria as authoritative.
- Do not silently resolve an item listed under “未决问题和假设”. Inspect the actual deployment or upstream code first; ask the user when evidence is unavailable.
- If implementation facts conflict with the specification, stop and report the conflict before broadening scope.

## Required preflight

Before implementation, establish and record:

1. The exact production Docmost version or upstream commit.
2. Whether attachment storage is local filesystem or S3-compatible object storage.
3. The existing Docmost service/API used to read and replace attachment content.
4. The existing authentication, module registration, frontend routing, and attachment-action extension points.
5. The Docmost upload-size configuration that Office editing must reuse.

Do not build against a floating `latest` tag.

## Architecture constraints

- Put integration code under `integrations/onlyoffice/`, divided into `server/`, `client/`, and `shared/` where the upstream stack permits.
- Keep changes to upstream-owned files minimal. For every mount-point change, document the upstream file, reason, and verification method in `integrations/onlyoffice/README.md`.
- Do not scatter ONLYOFFICE-specific business rules through core Docmost components.
- Do not add business tables for sessions, versions, conflicts, or audit history in the first release.
- Preserve attachment ID, filename, page relationship, and download URL when saving.
- Continue to use the original download behavior for unsupported formats.

## Supported behavior

- Online editing is limited to `.docx`, `.xlsx`, and `.pptx` (case-insensitive).
- The editor opens in a new browser tab at `/office/edit/:attachmentId` or the closest route compatible with the pinned upstream version.
- Creating an editing session requires a valid Docmost login.
- Document Server file reads use short-lived signed URLs and must not depend on browser cookies.
- ONLYOFFICE configuration and callbacks use JWT secrets supplied only through environment variables.
- The first release uses last-successful-save-wins semantics and does not implement collaborative conflict handling.

## Security and data-integrity rules

- Bind signed tokens to attachment ID, user ID, purpose, document key, and expiration.
- Use separate token purposes for file reads and callbacks; reject cross-purpose use.
- Validate callback JWTs and callback tokens before processing their payloads.
- Accept edited-file downloads only from the configured ONLYOFFICE origin. Prevent redirects or DNS/origin changes from bypassing SSRF controls.
- Apply timeouts and bounded response sizes when downloading edited files.
- Save through the existing Docmost storage abstraction. Never guess filesystem paths or bypass object-storage APIs.
- Download to a temporary object/file, verify nonzero size and expected OOXML type, then replace atomically where the storage backend supports it.
- On any failure, preserve the original attachment and return a nonzero ONLYOFFICE callback error.
- Never log JWTs, signed URLs, document contents, or secret values. Logs may include request ID, attachment ID, callback status, and error category.

## Configuration

Use explicit environment-backed configuration with startup validation for at least:

- Public Docmost URL reachable by ONLYOFFICE.
- Internal ONLYOFFICE Document Server URL used by Docmost.
- Browser-facing ONLYOFFICE URL when it differs from the internal URL.
- ONLYOFFICE JWT secret.
- Signed file/callback token secret and lifetime (default target: 30 minutes).

Document exact variable names after they are aligned with the pinned upstream configuration conventions.

## Implementation workflow

1. Pin and import the correct Docmost upstream source.
2. Inspect existing patterns before introducing dependencies or abstractions.
3. Implement server-side primitives and tests first: format mapping, signed tokens, session config, file streaming, callback validation, safe download, and storage replacement.
4. Add the editor route/page and supported-attachment action with loading and error states plus a download fallback.
5. Add Docker/Compose integration without embedding secrets in images.
6. Document upstream mount points, build steps, environment variables, upgrade procedure, smoke tests, and rollback.
7. Run the repository's native formatting, lint, typecheck, unit, integration, and build commands relevant to changed files.

## Git branch workflow

- `upstream` points to `https://github.com/docmost/docmost.git`; `origin` points to `https://github.com/AnderwLu/docmost.git`.
- `docmost-upstream-baseline` is the clean Docmost upstream baseline branch. Do not place OEM or ONLYOFFICE changes on it.
- `onlyoffice-integration` is the customization development branch and contains all project-specific code and documentation.
- For an official Docmost upgrade, first fetch `upstream`, merge the selected official release into `docmost-upstream-baseline`, resolve and verify that baseline, and push it to `origin`.
- Only after the baseline upgrade succeeds, merge `docmost-upstream-baseline` into `onlyoffice-integration`, resolve integration conflicts, run the full verification suite, and push the development branch.
- Never merge a new official release directly from `upstream` into `onlyoffice-integration`.
- After every baseline upgrade, update the exact official tag and full commit in both `Docmost-ONLYOFFICE集成需求开发规格.md` and the "Upstream baseline" section of `integrations/onlyoffice/README.md`.
- Never track a floating release.

## Testing requirements

Cover at minimum:

- Format detection and document-type mapping for docx/xlsx/pptx and rejection of legacy/other extensions.
- Authentication failure, missing attachment, tampered/expired/wrong-purpose token, and invalid JWT.
- File-read streaming and preservation of filename/content type.
- Callback states, especially final-save `status=2` and non-save statuses.
- Rejection of untrusted download origins, redirects, empty files, oversized files, malformed OOXML, download errors, and replacement errors.
- Original attachment preservation on every failed save path.
- UI visibility rules, new-tab behavior, editor initialization, loading/error states, and retained download behavior.
- Successful open/edit/save/reopen flows for Word, spreadsheet, and presentation files.

Prefer deterministic unit tests for security and storage logic. Add a documented Docker smoke test for the real Docmost/ONLYOFFICE flow.

## Change discipline

- Preserve unrelated user changes and do not reformat unrelated upstream files.
- Do not commit generated secrets, local deployment data, database files, attachment contents, or temporary downloads.
- Add dependencies only when the pinned upstream stack lacks a suitable existing facility; explain each new dependency.
- Do not weaken authentication, JWT validation, origin checks, file validation, or atomic-save behavior to make a test pass.
- Do not implement out-of-scope features without explicit user approval.

## Definition of done

The work is complete only when the acceptance criteria in the requirement document are met, relevant automated checks pass, the Docker image builds, the three supported formats pass an end-to-end save/reopen smoke test, failure cases preserve the original file, and upgrade/rollback documentation identifies every upstream mount point.
