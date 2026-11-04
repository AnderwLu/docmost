import { UserRepo } from '@docmost/db/repos/user/user.repo';
import { WorkspaceRepo } from '@docmost/db/repos/workspace/workspace.repo';

export type McpPrincipal = {
  user: Awaited<ReturnType<UserRepo['findById']>>;
  workspace: Awaited<ReturnType<WorkspaceRepo['findById']>>;
  oauthGrantId?: string;
};
