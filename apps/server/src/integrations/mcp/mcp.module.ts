import { Module } from '@nestjs/common';
import { TokenModule } from '../../core/auth/token.module';
import { McpController } from './mcp.controller';
import { McpApiKeyController } from './mcp-api-key.controller';
import { McpApiKeyService } from './mcp-api-key.service';
import { McpReadService } from './mcp-read.service';
import { McpServerFactory } from './mcp-server.factory';

@Module({
  imports: [TokenModule],
  controllers: [McpController, McpApiKeyController],
  providers: [McpApiKeyService, McpReadService, McpServerFactory],
  exports: [McpApiKeyService],
})
export class McpModule {}
