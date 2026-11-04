import {
  Injectable,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EnvironmentService } from '../../environment/environment.service';
import { UserRepo } from '@docmost/db/repos/user/user.repo';
import { WorkspaceRepo } from '@docmost/db/repos/workspace/workspace.repo';
import { isUserDisabled } from '../../../common/helpers';
import { McpPrincipal } from '../mcp-principal';
import { OAuthStore } from './oauth.store';
import {
  ACCESS_TTL,
  GRANT_TTL,
  SCOPE,
  opaque,
  digest,
  requireOAuth,
  textParam,
  validateRedirect,
  OAuthClient,
  Authorization,
  OAuthGrant,
} from './oauth.protocol';

@Injectable()
export class OAuthService implements OnModuleInit {
  readonly issuer: string;
  readonly resource: string;
  readonly redirects: string[];
  constructor(
    private readonly store: OAuthStore,
    environment: EnvironmentService,
    config: ConfigService,
    private readonly users: UserRepo,
    private readonly workspaces: WorkspaceRepo,
  ) {
    this.issuer = environment.getAppUrl();
    this.resource = `${this.issuer}/mcp`;
    this.redirects = config
      .get<string>(
        'MCP_OAUTH_REDIRECT_URIS',
        'https://chatgpt.com/connector_platform_oauth_redirect,https://chat.openai.com/aip/g/callback',
      )
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  onModuleInit() {
    const url = new URL(this.issuer);
    if (
      !(
        url.protocol === 'https:' ||
        (url.protocol === 'http:' &&
          ['localhost', '127.0.0.1'].includes(url.hostname))
      )
    ) {
      throw new Error(
        'MCP OAuth requires an HTTPS APP_URL (except loopback development)',
      );
    }
    for (const redirect of this.redirects)
      validateRedirect(redirect, this.redirects);
  }
  async register(body: Record<string, unknown>) {
    requireOAuth(body && typeof body === 'object');
    requireOAuth(
      !body.token_endpoint_auth_method ||
        body.token_endpoint_auth_method === 'none',
      'invalid_client_metadata',
    );
    requireOAuth(
      !body.grant_types ||
        (Array.isArray(body.grant_types) &&
          body.grant_types.every((v) =>
            ['authorization_code', 'refresh_token'].includes(v),
          )),
      'invalid_client_metadata',
    );
    requireOAuth(
      !body.response_types ||
        (Array.isArray(body.response_types) &&
          body.response_types.length === 1 &&
          body.response_types[0] === 'code'),
      'invalid_client_metadata',
    );
    requireOAuth(
      Array.isArray(body.redirect_uris) &&
        body.redirect_uris.length > 0 &&
        body.redirect_uris.length <= 10,
      'invalid_client_metadata',
    );
    const client: OAuthClient = {
      id: opaque(),
      name: body.client_name ? textParam(body.client_name, 100) : 'MCP client',
      redirects: body.redirect_uris.map((uri) =>
        validateRedirect(uri, this.redirects),
      ),
    };
    await this.store.put('client', client.id, client, 365 * 86400);
    return {
      client_id: client.id,
      client_name: client.name,
      redirect_uris: client.redirects,
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    };
  }
  async authorize(query: Record<string, unknown>, browser: string) {
    const client = await this.store.get<OAuthClient>(
      'client',
      textParam(query.client_id),
    );
    requireOAuth(client, 'invalid_client');
    const redirect = validateRedirect(query.redirect_uri, this.redirects);
    requireOAuth(client.redirects.includes(redirect), 'invalid_redirect_uri');
    requireOAuth(
      query.response_type === 'code' && query.code_challenge_method === 'S256',
    );
    const challenge = textParam(query.code_challenge, 43);
    requireOAuth(/^[A-Za-z0-9_-]{43}$/.test(challenge));
    requireOAuth(query.resource === this.resource, 'invalid_target');
    requireOAuth(
      query.scope === undefined || query.scope === SCOPE,
      'invalid_scope',
    );
    const state = query.state === undefined ? '' : textParam(query.state);
    const request: Authorization = {
      clientId: client.id,
      redirect,
      challenge,
      state,
      resource: this.resource,
      browserHash: digest(browser),
    };
    const id = opaque();
    await this.store.put('request', digest(id), request, 600);
    return id;
  }
  async pending(id: string, browser?: string) {
    const request = await this.store.get<Authorization>(
      'request',
      digest(textParam(id)),
    );
    requireOAuth(request && browser && request.browserHash === digest(browser));
    const client = await this.store.get<OAuthClient>(
      'client',
      request.clientId,
    );
    requireOAuth(client, 'invalid_client');
    return { request, client };
  }
  async consent(
    id: string,
    browser: string,
    userId: string,
    workspaceId: string,
    approved: boolean,
  ) {
    const { request, client } = await this.pending(id, browser);
    requireOAuth(await this.store.consume('request', digest(id), request));
    const redirect = new URL(request.redirect);
    if (request.state) redirect.searchParams.set('state', request.state);
    // Explicit issuer prevents authorization-server mix-up in supporting clients.
    redirect.searchParams.set('iss', this.issuer);
    if (!approved) redirect.searchParams.set('error', 'access_denied');
    else {
      await this.principal(userId, workspaceId);
      const code = opaque();
      await this.store.put(
        'code',
        digest(code),
        { ...request, userId, workspaceId, clientName: client.name },
        60,
      );
      redirect.searchParams.set('code', code);
    }
    return redirect.toString();
  }
  private async principal(
    userId: string,
    workspaceId: string,
  ): Promise<McpPrincipal> {
    const [user, workspace] = await Promise.all([
      this.users.findById(userId, workspaceId),
      this.workspaces.findById(workspaceId),
    ]);
    if (!user || !workspace || isUserDisabled(user))
      throw new UnauthorizedException();
    return { user, workspace };
  }
  async authenticate(token: string): Promise<McpPrincipal> {
    const id = await this.store.get<string>('access', digest(token));
    const grant = id && (await this.store.get<OAuthGrant>('grant', id));
    if (
      !grant ||
      grant.resource !== this.resource ||
      grant.expiresAt <= Date.now()
    )
      throw new UnauthorizedException();
    return {
      ...(await this.principal(grant.userId, grant.workspaceId)),
      oauthGrantId: grant.id,
    };
  }
  async token(body: Record<string, unknown>) {
    requireOAuth(body && typeof body === 'object');
    const clientId = textParam(body.client_id);
    requireOAuth(await this.store.get('client', clientId), 'invalid_client');
    requireOAuth(body.resource === this.resource, 'invalid_target');
    requireOAuth(
      body.scope === undefined || body.scope === SCOPE,
      'invalid_scope',
    );
    const access = `mcp_at_${opaque()}`;
    const refresh = `mcp_rt_${opaque()}`;
    if (body.grant_type === 'authorization_code') {
      const codeHash = digest(textParam(body.code));
      const code = await this.store.get<
        Authorization & {
          userId: string;
          workspaceId: string;
          clientName: string;
        }
      >('code', codeHash);
      requireOAuth(
        code &&
          code.clientId === clientId &&
          code.redirect === body.redirect_uri &&
          code.resource === this.resource,
        'invalid_grant',
      );
      const verifier = textParam(body.code_verifier, 128);
      requireOAuth(
        /^[A-Za-z0-9._~-]{43,128}$/.test(verifier) &&
          digest(verifier) === code.challenge,
        'invalid_grant',
      );
      await this.principal(code.userId, code.workspaceId);
      requireOAuth(
        await this.store.consume('code', codeHash, code),
        'invalid_grant',
      );
      const grant: OAuthGrant = {
        id: opaque(),
        clientId,
        clientName: code.clientName,
        userId: code.userId,
        workspaceId: code.workspaceId,
        resource: this.resource,
        refreshHash: digest(refresh),
        createdAt: Date.now(),
        expiresAt: Date.now() + GRANT_TTL * 1000,
      };
      await this.store.issue(grant, digest(access), digest(refresh));
    } else {
      requireOAuth(
        body.grant_type === 'refresh_token',
        'unsupported_grant_type',
      );
      const hash = digest(textParam(body.refresh_token));
      const id = await this.store.get<string>('refresh', hash);
      const grant = id && (await this.store.get<OAuthGrant>('grant', id));
      requireOAuth(
        grant &&
          grant.clientId === clientId &&
          grant.resource === this.resource &&
          grant.expiresAt > Date.now(),
        'invalid_grant',
      );
      await this.principal(grant.userId, grant.workspaceId);
      requireOAuth(
        await this.store.rotate(grant, hash, digest(access), digest(refresh)),
        'invalid_grant',
      );
    }
    return {
      access_token: access,
      refresh_token: refresh,
      token_type: 'Bearer',
      expires_in: ACCESS_TTL,
      scope: SCOPE,
    };
  }
  async revokeToken(body: Record<string, unknown>) {
    requireOAuth(body && typeof body === 'object');
    const token = textParam(body.token);
    const client = textParam(body.client_id);
    const kind = token.startsWith('mcp_rt_') ? 'refresh' : 'access';
    const id = await this.store.get<string>(kind, digest(token));
    const grant = id && (await this.store.get<OAuthGrant>('grant', id));
    if (grant && grant.clientId === client)
      await this.store.remove('grant', grant.id);
  }
  async list(userId: string, workspaceId: string) {
    return (await this.store.list(userId, workspaceId)).map(
      ({ id, clientName, createdAt, expiresAt }) => ({
        id,
        clientName,
        createdAt,
        expiresAt,
      }),
    );
  }
  async revoke(id: string, userId: string, workspaceId: string) {
    const grant = await this.store.get<OAuthGrant>('grant', textParam(id));
    requireOAuth(
      grant && grant.userId === userId && grant.workspaceId === workspaceId,
    );
    await this.store.remove('grant', id);
  }
}
