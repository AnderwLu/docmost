import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
  UseFilters,
  Catch,
  ExceptionFilter,
  ArgumentsHost,
} from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';
import { Public } from '../../../common/decorators/public.decorator';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { AuthUser } from '../../../common/decorators/auth-user.decorator';
import { AuthWorkspace } from '../../../common/decorators/auth-workspace.decorator';
import { User, Workspace } from '@docmost/db/types/entity.types';
import { OAuthService } from './oauth.service';
import { OAuthStore } from './oauth.store';
import { OAuthError, opaque, requireOAuth, SCOPE } from './oauth.protocol';

const COOKIE = 'mcp_oauth_browser';
// OAuth protocol responses are written directly, bypassing Docmost's API envelope.
@Public()
@Controller()
export class OAuthProtocolController {
  constructor(
    private readonly oauth: OAuthService,
    private readonly store: OAuthStore,
  ) {}
  private headers(reply: FastifyReply) {
    reply
      .header('Cache-Control', 'no-store')
      .header('Pragma', 'no-cache')
      .header('Referrer-Policy', 'no-referrer');
  }
  private async respond(
    reply: FastifyReply,
    action: () => Promise<unknown>,
    status = 200,
  ) {
    this.headers(reply);
    try {
      return reply.code(status).send(await action());
    } catch (error) {
      if (error instanceof UnauthorizedException)
        return reply.code(400).send({ error: 'invalid_grant' });
      if (!(error instanceof OAuthError)) throw error;
      return reply.code(400).send({ error: error.code });
    }
  }
  @Get([
    '.well-known/oauth-protected-resource',
    '.well-known/oauth-protected-resource/mcp',
  ])
  resource(@Res() reply: FastifyReply) {
    this.headers(reply);
    return reply.send({
      resource: this.oauth.resource,
      authorization_servers: [this.oauth.issuer],
      scopes_supported: [SCOPE],
      bearer_methods_supported: ['header'],
    });
  }
  @Get('.well-known/oauth-authorization-server')
  metadata(@Res() reply: FastifyReply) {
    this.headers(reply);
    const root = `${this.oauth.issuer}/oauth`;
    return reply.send({
      issuer: this.oauth.issuer,
      authorization_endpoint: `${root}/authorize`,
      token_endpoint: `${root}/token`,
      registration_endpoint: `${root}/register`,
      revocation_endpoint: `${root}/revoke`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      token_endpoint_auth_methods_supported: ['none'],
      code_challenge_methods_supported: ['S256'],
      scopes_supported: [SCOPE],
      authorization_response_iss_parameter_supported: true,
    });
  }
  @Post('oauth/register')
  register(
    @Body() body: Record<string, unknown>,
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    return this.respond(
      reply,
      async () => {
        requireOAuth(
          await this.store.limit(req.ip, 'register', 10),
          'temporarily_unavailable',
        );
        return this.oauth.register(body);
      },
      201,
    );
  }
  @Get('oauth/authorize')
  async authorize(
    @Query() query: Record<string, unknown>,
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    this.headers(reply);
    try {
      requireOAuth(
        await this.store.limit(req.ip, 'authorize', 30),
        'temporarily_unavailable',
      );
      const existing = req.cookies[COOKIE];
      const browser =
        existing && /^[A-Za-z0-9_-]{43}$/.test(existing) ? existing : opaque();
      const id = await this.oauth.authorize(query, browser);
      reply.setCookie(COOKIE, browser, {
        path: '/',
        httpOnly: true,
        sameSite: 'lax',
        secure: this.oauth.issuer.startsWith('https:'),
        maxAge: 600,
      });
      return reply.code(302).redirect(`/mcp/authorize/${id}`);
    } catch (error) {
      if (!(error instanceof OAuthError)) throw error;
      return reply.code(400).send({ error: error.code });
    }
  }
  @Post('oauth/token')
  token(
    @Body() body: Record<string, unknown>,
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    return this.respond(reply, async () => {
      requireOAuth(
        await this.store.limit(req.ip, 'token', 60),
        'temporarily_unavailable',
      );
      return this.oauth.token(body);
    });
  }
  @Post('oauth/revoke')
  revoke(
    @Body() body: Record<string, unknown>,
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    return this.respond(reply, async () => {
      requireOAuth(
        await this.store.limit(req.ip, 'revoke', 30),
        'temporarily_unavailable',
      );
      await this.oauth.revokeToken(body);
      return {};
    });
  }
}

// This controller uses the SAME JwtAuthGuard, authToken cookie, active session,
// AuthUser and AuthWorkspace as the knowledge base. It accepts no passwords.
@Catch(OAuthError)
export class OAuthAccountErrorFilter implements ExceptionFilter {
  catch(_error: OAuthError, host: ArgumentsHost) {
    host
      .switchToHttp()
      .getResponse<FastifyReply>()
      .code(400)
      .send({ message: 'Authorization request is invalid or expired' });
  }
}
@UseFilters(OAuthAccountErrorFilter)
@UseGuards(JwtAuthGuard)
@Controller('mcp-oauth')
export class OAuthAccountController {
  constructor(private readonly oauth: OAuthService) {}
  private browserSession(req: FastifyRequest, mutation = false) {
    requireOAuth(req.cookies.authToken && req.raw['sessionId']);
    if (mutation) requireOAuth(req.headers.origin === this.oauth.issuer);
  }
  @Get('requests/:id')
  async pending(
    @Param('id') id: string,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    reply
      .header('Cache-Control', 'no-store')
      .header('Referrer-Policy', 'no-referrer');
    this.browserSession(req);
    const { client, request } = await this.oauth.pending(
      id,
      req.cookies[COOKIE],
    );
    return {
      clientName: client.name,
      redirect: request.redirect,
      user: {
        id: user.id,
        workspaceId: workspace.id,
        name: user.name,
        email: user.email,
      },
      workspaceName: workspace.name,
    };
  }
  @Post('requests/:id')
  @HttpCode(200)
  async consent(
    @Param('id') id: string,
    @Body() body: { approved: boolean; userId: string; workspaceId: string },
    @Req() req: FastifyRequest,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    this.browserSession(req, true);
    // Refuse approval if the account changed after the consent screen loaded.
    requireOAuth(
      typeof body?.approved === 'boolean' &&
        body.userId === user.id &&
        body.workspaceId === workspace.id,
    );
    return {
      redirect: await this.oauth.consent(
        id,
        req.cookies[COOKIE],
        user.id,
        workspace.id,
        body.approved,
      ),
    };
  }
  @Post('grants')
  @HttpCode(200)
  list(
    @Req() req: FastifyRequest,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    this.browserSession(req, true);
    return this.oauth.list(user.id, workspace.id);
  }
  @Post('grants/:id/revoke')
  @HttpCode(200)
  async revoke(
    @Param('id') id: string,
    @Req() req: FastifyRequest,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    this.browserSession(req, true);
    await this.oauth.revoke(id, user.id, workspace.id);
    return {};
  }
}
