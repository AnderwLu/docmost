import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AuthUser } from '../../common/decorators/auth-user.decorator';
import { AuthWorkspace } from '../../common/decorators/auth-workspace.decorator';
import { User, Workspace } from '@docmost/db/types/entity.types';
import { McpApiKeyService } from './mcp-api-key.service';

@UseGuards(JwtAuthGuard)
@Controller('api-keys')
export class McpApiKeyController {
  constructor(private readonly apiKeys: McpApiKeyService) {}

  @Post()
  list(@AuthUser() user: User, @AuthWorkspace() workspace: Workspace) {
    return this.apiKeys.list(user.id, workspace.id);
  }

  @Post('create')
  create(
    @Body() body: { name: string; expiresAt?: string },
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.apiKeys.create(user, workspace.id, body);
  }

  @Post('update')
  update(
    @Body() body: { apiKeyId: string; name: string },
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.apiKeys.rename(user.id, workspace.id, body.apiKeyId, body.name);
  }

  @HttpCode(204)
  @Post('revoke')
  revoke(
    @Body() body: { apiKeyId: string },
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.apiKeys.revoke(user.id, workspace.id, body.apiKeyId);
  }
}
