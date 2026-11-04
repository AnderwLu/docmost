import { Module } from '@nestjs/common';
// Attachment download URLs still use Docmost's signed file tokens.
import { TokenModule } from '../../core/auth/token.module';
import { McpController } from './mcp.controller';
import {
  OAuthProtocolController,
  OAuthAccountController,
} from './oauth/oauth.controller';
import { OAuthService } from './oauth/oauth.service';
import { OAuthStore } from './oauth/oauth.store';
import { McpReadService } from './mcp-read.service';
import { McpServerFactory } from './mcp-server.factory';
import { McpAttachmentService } from './mcp-attachment.service';
import { McpWriteService } from './mcp-write.service';
import { McpMutationService } from './mcp-mutation.service';
import { SpaceModule } from '../../core/space/space.module';
import { AttachmentModule } from '../../core/attachment/attachment.module';
import { PageModule } from '../../core/page/page.module';
import { CommentModule } from '../../core/comment/comment.module';

@Module({
  imports: [
    TokenModule,
    PageModule,
    CommentModule,
    SpaceModule,
    AttachmentModule,
  ],
  controllers: [McpController, OAuthProtocolController, OAuthAccountController],
  providers: [
    OAuthService,
    OAuthStore,
    McpReadService,
    McpAttachmentService,
    McpWriteService,
    McpMutationService,
    McpServerFactory,
  ],
})
export class McpModule {}
