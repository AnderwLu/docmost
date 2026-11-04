// Run against an isolated Redis, never production: MCP_OAUTH_TEST_REDIS_URL=...
import { Test } from '@nestjs/testing';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import cookie from '@fastify/cookie';
import Redis from 'ioredis';
import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';
import { RedisService } from '@nestjs-labs/nestjs-ioredis';
import { OAuthService } from './oauth.service';
import { OAuthStore } from './oauth.store';
import {
  OAuthProtocolController,
  OAuthAccountController,
} from './oauth.controller';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { TransformHttpResponseInterceptor } from '../../../common/interceptors/http-response.interceptor';
import { Reflector } from '@nestjs/core';
import { OAUTH_PUBLIC_ROUTES } from './oauth.http';
import { opaque, digest } from './oauth.protocol';

const integration = process.env.MCP_OAUTH_TEST_REDIS_URL
  ? describe
  : describe.skip;
integration('OAuth HTTP + real Redis integration', () => {
  let app: NestFastifyApplication;
  let redis: Redis;
  let oauth: OAuthService;
  let store: OAuthStore;
  const issuer = 'https://docs.example.test';
  const callback = 'https://chatgpt.com/connector_platform_oauth_redirect';
  const user = {
    id: 'user-1',
    workspaceId: 'workspace-1',
    name: 'Ada',
    email: 'ada@example.test',
  };
  const workspace = { id: 'workspace-1', name: 'Knowledge base' };
  let disabled = false;
  const users = {
    findById: jest.fn(async (id, wid) =>
      !disabled && id === user.id && wid === workspace.id ? user : undefined,
    ),
  };
  const workspaces = {
    findById: jest.fn(async (id) =>
      id === workspace.id ? workspace : undefined,
    ),
  };
  beforeAll(async () => {
    redis = new Redis(process.env.MCP_OAUTH_TEST_REDIS_URL!, {
      retryStrategy: () => null,
      connectTimeout: 1500,
      maxRetriesPerRequest: 0,
    });
    store = new OAuthStore({ getOrThrow: () => redis } as RedisService);
    oauth = new OAuthService(
      store,
      { getAppUrl: () => issuer } as any,
      new ConfigService(),
      users as any,
      workspaces as any,
    );
    const module = await Test.createTestingModule({
      controllers: [OAuthProtocolController, OAuthAccountController],
      providers: [
        { provide: OAuthService, useValue: oauth },
        { provide: OAuthStore, useValue: store },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (ctx) => {
          const req = ctx.switchToHttp().getRequest();
          if (req.cookies.authToken !== 'knowledge-base-session')
            throw new UnauthorizedException();
          req.user = { user, workspace };
          req.raw.sessionId = 'existing-session';
          return true;
        },
      })
      .compile();
    app = module.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    app.setGlobalPrefix('api', { exclude: OAUTH_PUBLIC_ROUTES });
    await app.register(cookie);
    app.useGlobalInterceptors(
      new TransformHttpResponseInterceptor(new Reflector()),
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });
  afterAll(async () => {
    await app?.close();
    await redis?.quit();
  });
  async function createRequest(overrides = {}) {
    const client = await oauth.register({
      client_name: 'Test client',
      redirect_uris: [callback],
    });
    const verifier = opaque();
    const browser = opaque();
    const id = await oauth.authorize(
      {
        client_id: client.client_id,
        redirect_uri: callback,
        response_type: 'code',
        code_challenge_method: 'S256',
        code_challenge: digest(verifier),
        state: 'client-state',
        resource: oauth.resource,
        ...overrides,
      },
      browser,
    );
    return { client, verifier, browser, id };
  }
  const headers = (browser: string, origin = issuer) => ({
    cookie: `authToken=knowledge-base-session; mcp_oauth_browser=${browser}`,
    origin,
  });
  async function issue() {
    const r = await createRequest();
    const res = await app.inject({
      method: 'POST',
      url: `/api/mcp-oauth/requests/${r.id}`,
      headers: headers(r.browser),
      payload: { approved: true, userId: user.id, workspaceId: workspace.id },
    });
    expect(res.statusCode).toBe(200);
    const url = new URL(res.json().data.redirect);
    expect(url.searchParams.get('state')).toBe('client-state');
    expect(url.searchParams.get('iss')).toBe(issuer);
    const body = {
      grant_type: 'authorization_code',
      client_id: r.client.client_id,
      code: url.searchParams.get('code'),
      code_verifier: r.verifier,
      redirect_uri: callback,
      resource: oauth.resource,
    };
    const tokens = await oauth.token(body);
    return { ...r, tokens, body };
  }
  it('serves raw OAuth discovery outside /api, without Docmost envelopes', async () => {
    for (const path of [
      '/.well-known/oauth-protected-resource',
      '/.well-known/oauth-protected-resource/mcp',
    ]) {
      const res = await app.inject({ method: 'GET', url: path });
      expect(res.json()).toMatchObject({
        resource: oauth.resource,
        authorization_servers: [issuer],
      });
      expect(res.json().data).toBeUndefined();
    }
    const res = await app.inject({
      method: 'GET',
      url: '/.well-known/oauth-authorization-server',
    });
    expect(res.json().code_challenge_methods_supported).toEqual(['S256']);
  });
  it('requires knowledge-base login and the initiating browser, rejects cross-origin consent', async () => {
    const r = await createRequest();
    const path = `/api/mcp-oauth/requests/${r.id}`;
    expect((await app.inject({ method: 'GET', url: path })).statusCode).toBe(
      401,
    );
    expect(
      (
        await app.inject({
          method: 'GET',
          url: path,
          headers: headers('different-browser'),
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: path,
          headers: headers(r.browser, 'https://evil.test'),
          payload: {
            approved: true,
            userId: user.id,
            workspaceId: workspace.id,
          },
        })
      ).statusCode,
    ).toBe(400);
    const res = await app.inject({
      method: 'GET',
      url: path,
      headers: headers(r.browser),
    });
    expect(res.json().data).toMatchObject({
      user: { email: user.email },
      workspaceName: workspace.name,
    });
  });
  it('refuses consent when the displayed account changed before approval', async () => {
    const r = await createRequest();
    const res = await app.inject({
      method: 'POST',
      url: `/api/mcp-oauth/requests/${r.id}`,
      headers: headers(r.browser),
      payload: {
        approved: true,
        userId: 'previous-account',
        workspaceId: workspace.id,
      },
    });
    expect(res.statusCode).toBe(400);
    expect(await oauth.pending(r.id, r.browser)).toBeTruthy();
  });
  it('denial returns access_denied, state, and no code; request cannot be replayed', async () => {
    const r = await createRequest();
    const url = new URL(
      await oauth.consent(r.id, r.browser, user.id, workspace.id, false),
    );
    expect(url.searchParams.get('error')).toBe('access_denied');
    expect(url.searchParams.has('code')).toBe(false);
    await expect(
      oauth.consent(r.id, r.browser, user.id, workspace.id, true),
    ).rejects.toThrow();
  });
  it('binds tokens to the SAME knowledge-base user/workspace and revokes immediately', async () => {
    const r = await issue();
    expect(await oauth.authenticate(r.tokens.access_token)).toMatchObject({
      user,
      workspace,
    });
    await expect(oauth.token(r.body)).rejects.toThrow('invalid_grant');
    const grants = await oauth.list(user.id, workspace.id);
    const principal = await oauth.authenticate(r.tokens.access_token);
    expect(grants.some((g) => g.id === principal.oauthGrantId)).toBe(true);
    await expect(
      oauth.revoke(principal.oauthGrantId!, 'other-user', workspace.id),
    ).rejects.toThrow();
    await oauth.revoke(principal.oauthGrantId!, user.id, workspace.id);
    await expect(oauth.authenticate(r.tokens.access_token)).rejects.toThrow(
      UnauthorizedException,
    );
  });
  it('rotates refresh tokens atomically and revokes the family on replay', async () => {
    const r = await issue();
    const body = {
      grant_type: 'refresh_token',
      client_id: r.client.client_id,
      resource: oauth.resource,
      refresh_token: r.tokens.refresh_token,
    };
    const next = await oauth.token(body);
    expect(await oauth.authenticate(next.access_token)).toMatchObject({ user });
    await expect(oauth.token(body)).rejects.toThrow('invalid_grant');
    await expect(oauth.authenticate(next.access_token)).rejects.toThrow();
  });
  it('rejects wrong resource, client, PKCE, disabled users and expired access tokens', async () => {
    const r = await createRequest();
    const url = new URL(
      await oauth.consent(r.id, r.browser, user.id, workspace.id, true),
    );
    const body = {
      grant_type: 'authorization_code',
      client_id: r.client.client_id,
      resource: oauth.resource,
      redirect_uri: callback,
      code: url.searchParams.get('code'),
      code_verifier: r.verifier,
    };
    await expect(
      oauth.token({ ...body, resource: 'https://evil.test/mcp' }),
    ).rejects.toThrow('invalid_target');
    await expect(
      oauth.token({ ...body, code_verifier: opaque() }),
    ).rejects.toThrow('invalid_grant');
    const other = await oauth.register({ redirect_uris: [callback] });
    await expect(
      oauth.token({ ...body, client_id: other.client_id }),
    ).rejects.toThrow('invalid_grant');
    const tokens = await oauth.token(body);
    disabled = true;
    try {
      await expect(oauth.authenticate(tokens.access_token)).rejects.toThrow();
    } finally {
      disabled = false;
    }
    await redis.expire(store.key('access', digest(tokens.access_token)), 0);
    await expect(oauth.authenticate(tokens.access_token)).rejects.toThrow();
  });
  it('starts authorization with a secure browser cookie and a local consent route', async () => {
    const r = await createRequest();
    const query = new URLSearchParams({
      client_id: r.client.client_id,
      redirect_uri: callback,
      response_type: 'code',
      code_challenge_method: 'S256',
      code_challenge: digest(r.verifier),
      state: 'client-state',
      resource: oauth.resource,
    });
    const res = await app.inject({
      method: 'GET',
      url: `/oauth/authorize?${query}`,
    });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toMatch(
      /^\/mcp\/authorize\/[A-Za-z0-9_-]{43}$/,
    );
    for (const flag of ['HttpOnly', 'Secure', 'SameSite=Lax'])
      expect(res.headers['set-cookie']).toEqual(expect.stringContaining(flag));
  });
  it('rejects expired requests and codes', async () => {
    const r = await createRequest();
    await redis.expire(store.key('request', digest(r.id)), 0);
    await expect(oauth.pending(r.id, r.browser)).rejects.toThrow();
    const next = await createRequest();
    const url = new URL(
      await oauth.consent(next.id, next.browser, user.id, workspace.id, true),
    );
    const code = url.searchParams.get('code')!;
    await redis.expire(store.key('code', digest(code)), 0);
    await expect(
      oauth.token({
        grant_type: 'authorization_code',
        client_id: next.client.client_id,
        resource: oauth.resource,
        redirect_uri: callback,
        code,
        code_verifier: next.verifier,
      }),
    ).rejects.toThrow('invalid_grant');
  });
  it('allows one concurrent redemption and blocks refresh after revocation', async () => {
    const r = await createRequest();
    const url = new URL(
      await oauth.consent(r.id, r.browser, user.id, workspace.id, true),
    );
    const body = {
      grant_type: 'authorization_code',
      client_id: r.client.client_id,
      resource: oauth.resource,
      redirect_uri: callback,
      code: url.searchParams.get('code'),
      code_verifier: r.verifier,
    };
    const results = await Promise.allSettled([
      oauth.token(body),
      oauth.token(body),
    ]);
    const success = results.filter((r) => r.status === 'fulfilled');
    expect(success).toHaveLength(1);
    const tokens = (
      success[0] as PromiseFulfilledResult<
        Awaited<ReturnType<OAuthService['token']>>
      >
    ).value;
    await oauth.revokeToken({
      client_id: r.client.client_id,
      token: tokens.access_token,
    });
    await expect(
      oauth.token({
        grant_type: 'refresh_token',
        client_id: r.client.client_id,
        resource: oauth.resource,
        refresh_token: tokens.refresh_token,
      }),
    ).rejects.toThrow('invalid_grant');
  });
  it('rejects insecure startup configuration, unapproved scope and missing resource', async () => {
    const unsafe = new OAuthService(
      store,
      { getAppUrl: () => 'http://public.test' } as any,
      new ConfigService(),
      users as any,
      workspaces as any,
    );
    expect(() => unsafe.onModuleInit()).toThrow('HTTPS');
    const invalidProtocol = new OAuthService(
      store,
      { getAppUrl: () => 'ftp://localhost' } as any,
      new ConfigService(),
      users as any,
      workspaces as any,
    );
    expect(() => invalidProtocol.onModuleInit()).toThrow('HTTPS');
    await expect(createRequest({ scope: 'admin' })).rejects.toThrow(
      'invalid_scope',
    );
    await expect(createRequest({ resource: undefined })).rejects.toThrow(
      'invalid_target',
    );
  });
  it('supports standard form-encoded token requests and no-store responses', async () => {
    const r = await createRequest();
    const url = new URL(
      await oauth.consent(r.id, r.browser, user.id, workspace.id, true),
    );
    const payload = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: r.client.client_id,
      resource: oauth.resource,
      redirect_uri: callback,
      code: url.searchParams.get('code')!,
      code_verifier: r.verifier,
    }).toString();
    const res = await app.inject({
      method: 'POST',
      url: '/oauth/token',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().token_type).toBe('Bearer');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.json().data).toBeUndefined();
  });
});
