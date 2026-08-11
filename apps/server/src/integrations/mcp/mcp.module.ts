import { Module } from '@nestjs/common';
import { TokenModule } from '../../core/auth/token.module';
import { McpController } from './mcp.controller';
import { McpApiKeyController } from './mcp-api-key.controller';
import { McpApiKeyService } from './mcp-api-key.service';
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
  controllers: [McpController, McpApiKeyController],
  providers: [
    McpApiKeyService,
    McpReadService,
    McpAttachmentService,
    McpWriteService,
    McpMutationService,
    McpServerFactory,
  ],
  exports: [McpApiKeyService],
})
export class McpModule {}
