import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Res,
  UseGuards,
  Logger,
} from '@nestjs/common';
import { FastifyReply } from 'fastify';
import { AuthUser } from '../../common/decorators/auth-user.decorator';
import { AuthWorkspace } from '../../common/decorators/auth-workspace.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { User, Workspace } from '@docmost/db/types/entity.types';
import { OnlyOfficeService } from './onlyoffice.service';
import { OnlyOfficeCallbackBody } from './onlyoffice.types';

@Controller('office')
export class OnlyOfficeController {
  private readonly logger = new Logger(OnlyOfficeController.name);
  constructor(private readonly onlyOfficeService: OnlyOfficeService) {}

  @UseGuards(JwtAuthGuard)
  @Post('sessions')
  @HttpCode(HttpStatus.OK)
  createSession(
    @Body('attachmentId') attachmentId: string,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.onlyOfficeService.createSession(
      attachmentId,
      user,
      workspace.id,
    );
  }

  @Get('files/:token')
  async getFile(@Param('token') token: string, @Res() response: FastifyReply) {
    const { attachment, stream } = await this.onlyOfficeService.getFile(token);
    response.headers({
      'Content-Type': attachment.mimeType,
      'Content-Length': Number(attachment.fileSize),
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(attachment.fileName)}`,
      'Cache-Control': 'private, no-store',
    });
    return response.send(stream);
  }

  @Post('callback/:token')
  @HttpCode(HttpStatus.OK)
  async callback(
    @Param('token') token: string,
    @Body() body: OnlyOfficeCallbackBody,
    @Headers('authorization') authorization?: string,
  ) {
    try {
      this.onlyOfficeService.verifyCallbackJwt(authorization);
      await this.onlyOfficeService.handleCallback(token, body);
      return { error: 0 };
    } catch (error) {
      this.logger.error(
        `ONLYOFFICE callback failed with status ${body?.status ?? 'unknown'}`,
        error,
      );
      return { error: 1 };
    }
  }
}
