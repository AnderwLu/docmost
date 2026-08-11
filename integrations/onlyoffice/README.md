# ONLYOFFICE integration

This customization adds authenticated online editing for Docmost `.docx`, `.xlsx`, and `.pptx` attachments.

## Upstream baseline

| Item | Current value |
| --- | --- |
| Official Docmost release | `v0.95.0` |
| Official upstream commit | `4132dd59be05a507dad76d1e01c48c9af2fd90f0` |
| Long-lived baseline branch | `docmost-upstream-baseline` |
| Baseline branch head | `3dc85bd99fe1337cd9f8ecd0a45463563fde9c9b` |
| Current OEM image | `anderwlu/docmost-onlyoffice:0.95.0-mcp-0366245e` |
| Current OEM commit | `0366245e445d4f12846f8da056c0767c38b52819` (`mcp-readonly-v1.0.0`) |

The branch name is intentionally version-independent. After every official Docmost upgrade, update this table and the matching confirmed fact in `Docmost-ONLYOFFICE集成需求开发规格.md` in the same change that adapts the integration. Do not leave an old release or commit recorded after an upgrade.

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

- The current upstream storage abstraction supports local volumes, S3-compatible storage, and Azure Blob Storage.
- A save is downloaded with a 30-second timeout and bounded by `FILE_UPLOAD_SIZE_LIMIT`.
- The edited file must be a non-empty OOXML ZIP with the expected Word, Excel, or PowerPoint structure.
- The module uploads a staged object, copies the original to a backup object, replaces the original, then updates attachment size and timestamp.
- If the database update or replacement fails, it restores the backup. Temporary and backup objects are cleaned up on all paths.
- The document key is stable for the same attachment ID and `updatedAt` value so Document Server can reuse its conversion cache. A successful save updates `updatedAt`, which automatically produces a new key for the next version.

## Docmost 官方文件修改记录

下面逐一记录相对于官方 `v0.95.0` 修改过的文件。升级 Docmost 时必须逐项核对；表中未列出的 ONLYOFFICE 代码均为本项目新增文件。

| 官方文件                                                                      | 修改原因                                                      | 中文注释位置                                 | 验证方式                                     |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------- | -------------------------------------------- | -------------------------------------------- |
| `.env.example`                                                                | 声明定制镜像所需的 ONLYOFFICE 地址、JWT 密钥和短期令牌配置。  | ONLYOFFICE 环境变量区块上方。                | Compose 配置检查、容器启动配置校验。         |
| `apps/server/src/common/helpers/utils.ts`                                     | 对日志中的 ONLYOFFICE 文件与回调路径令牌进行脱敏。            | `redactSensitiveUrl` 内的 OEM 安全挂载点。   | 回调失败日志检查，不得出现 JWT 或签名 URL。  |
| `apps/server/src/common/helpers/utils.spec.ts`                                | 增加 ONLYOFFICE 路径令牌脱敏的回归测试。                      | 新增 `redactSensitiveUrl` 测试套件。         | Jest。                                       |
| `apps/server/src/core/core.module.ts`                                         | 注册独立 `OnlyOfficeModule`，让会话、文件读取和回调接口生效。 | 模块 import 和 imports 数组项旁。            | 服务端构建、会话与回调测试。                 |
| `apps/server/src/integrations/environment/environment.service.ts`             | 读取并校验三个网络地址、两个密钥和令牌时效。                  | ONLYOFFICE getter 区块及必填值校验方法上方。 | 服务端构建、缺失配置启动失败。               |
| `apps/server/src/integrations/storage/interfaces/storage-driver.interface.ts` | 给存储抽象增加后端无关的 `replace` 能力。                     | `replace` 接口上方。                         | TypeScript 构建。                            |
| `apps/server/src/integrations/storage/storage.service.ts`                     | 暴露统一替换入口，避免 ONLYOFFICE 模块直接访问磁盘或 S3 SDK。 | `replace` 方法上方。                         | 服务端构建、保存服务测试。                   |
| `apps/server/src/integrations/storage/drivers/local.driver.ts`                | 本地卷通过同文件系统 `rename` 原子发布已验证的暂存文件。      | `replace` 方法上方。                         | 本地驱动原子替换测试。                       |
| `apps/server/src/integrations/storage/drivers/local.driver.spec.ts`           | 增加本地替换行为的回归测试。                                  | 新增测试套件上方。                           | Jest。                                       |
| `apps/server/src/integrations/storage/drivers/s3.driver.ts`                   | S3 通过服务端复制发布暂存对象并删除暂存对象。                 | `replace` 方法上方。                         | 服务端构建；正式使用 S3 前执行 S3 冒烟测试。 |
| `apps/server/src/integrations/storage/drivers/azure.driver.ts`                | Azure Blob 通过服务端复制发布暂存对象并删除暂存对象。         | `replace` 方法上方。                         | 服务端构建；正式使用 Azure 前执行冒烟测试。  |
| `apps/client/src/App.tsx`                                                     | 注册新标签页编辑路由 `/office/edit/:attachmentId`。           | 页面 import 和 Route 上方。                  | 客户端构建、路由冒烟测试。                   |
| `apps/client/src/features/editor/components/attachment/attachment-view.tsx`   | 对支持格式显示“在线打开”，同时保留官方的下载入口。            | 集成 import、格式判断和操作按钮旁。          | 客户端构建、附件格式显示测试。               |

独立业务代码位于：

- `apps/server/src/integrations/onlyoffice/`
- `apps/client/src/integrations/onlyoffice/`
- `integrations/onlyoffice/`
- `docker-compose.onlyoffice.yml`

升级时如果官方文件路径或职责发生变化，必须先更新本表和源码中的 `OEM 挂载点` / `OEM 存储扩展点` 注释，再完成合并，不能静默删除功能。

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
2. Merge it into `docmost-upstream-baseline`; do not add customization code to that branch.
3. Build and verify the clean baseline, then push it to `origin`.
4. Merge `docmost-upstream-baseline` into `onlyoffice-integration`.
5. Update the "Upstream baseline" table above and the matching confirmed fact in `Docmost-ONLYOFFICE集成需求开发规格.md` with the new official tag and full commit.
6. Resolve the mount points listed above. A missing route, module registration, attachment action, or storage replacement implementation must fail build/tests rather than be silently omitted.
7. Build the custom image and run the smoke test against a disposable database and attachment volume/bucket.
8. Back up production data, deploy the new immutable image tag, and verify all three formats.
9. On failure, redeploy the previous image tag while preserving the database and attachment volume/bucket. Restore data only if a database/storage migration explicitly requires it.
