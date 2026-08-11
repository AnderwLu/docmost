import { Module } from '@nestjs/common';
import { TokenModule } from '../../core/auth/token.module';
import { McpController } from './mcp.controller';
import { McpApiKeyController } from './mcp-api-key.controller';
import { McpApiKeyService } from './mcp-api-key.service';
import { McpReadService } from './mcp-read.service';
import { McpServerFactory } from './mcp-server.factory';
import { McpAttachmentService } from './mcp-attachment.service';
import { McpWriteService } from './mcp-write.service';
import { PageModule } from '../../core/page/page.module';
import { CommentModule } from '../../core/comment/comment.module';

@Module({
  imports: [TokenModule, PageModule, CommentModule],
  controllers: [McpController, McpApiKeyController],
  providers: [
    McpApiKeyService,
    McpReadService,
    McpAttachmentService,
    McpWriteService,
    McpServerFactory,
  ],
  exports: [McpApiKeyService],
})
export class McpModule {}
