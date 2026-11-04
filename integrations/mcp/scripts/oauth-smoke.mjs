// Creates a workspace and user. Run ONLY against a disposable loopback deployment.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomBytes, createHash } from "node:crypto";

const root = process.env.MCP_OAUTH_SMOKE_URL;
assert(
  root && process.env.MCP_OAUTH_SMOKE_DISPOSABLE === "1",
  "Explicit disposable deployment opt-in is required",
);
const origin = new URL(root);
assert(
  origin.protocol === "http:" &&
    ["localhost", "127.0.0.1"].includes(origin.hostname),
  "Only loopback test deployments are permitted",
);
const base = origin.origin;
const cookies = new Map();
const random = () => randomBytes(32).toString("base64url");
async function request(
  path,
  { method = "GET", body, browser = true, headers = {} } = {},
) {
  const response = await fetch(`${base}${path}`, {
    method,
    redirect: "manual",
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(browser
        ? {
            cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join("; "),
            origin: base,
          }
        : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (browser)
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(";")[0];
      const at = pair.indexOf("=");
      cookies.set(pair.slice(0, at), pair.slice(at + 1));
    }
  return response;
}
async function json(path, options) {
  const response = await request(path, options);
  assert(
    response.ok,
    `Unexpected HTTP ${response.status} at ${path.split("?")[0]}`,
  );
  return response.json();
}
const email = `oauth-smoke-${random().slice(0, 8).toLowerCase()}@example.test`;
const password = random();
await json("/api/auth/setup", {
  method: "POST",
  body: {
    name: "OAuth Smoke",
    workspaceName: "Disposable OAuth",
    email,
    password,
  },
});
await json("/api/auth/logout", { method: "POST", body: {} });
await json("/api/auth/login", { method: "POST", body: { email, password } });
const me = (await json("/api/users/me", { method: "POST", body: {} })).data;
assert.equal(me.user.email, email);
const metadata = await json("/.well-known/oauth-authorization-server", {
  browser: false,
});
assert.equal(metadata.issuer, base);
const resource = `${base}/mcp`;
const client = await json("/oauth/register", {
  method: "POST",
  browser: false,
  body: {
    client_name: "Disposable smoke client",
    token_endpoint_auth_method: "none",
    redirect_uris: ["http://localhost:19039/callback"],
  },
});
const verifier = random();
const query = new URLSearchParams({
  client_id: client.client_id,
  redirect_uri: client.redirect_uris[0],
  response_type: "code",
  code_challenge_method: "S256",
  code_challenge: createHash("sha256").update(verifier).digest("base64url"),
  resource,
  state: "smoke-state",
});
const start = await request(`/oauth/authorize?${query}`);
assert.equal(start.status, 302);
const route = start.headers.get("location");
assert.match(route, /^\/mcp\/authorize\/[A-Za-z0-9_-]{43}$/);
const page = await request(route);
assert.equal(page.status, 200);
assert.match(await page.text(), /<html/i);
const handle = route.split("/").at(-1);
const info = (await json(`/api/mcp-oauth/requests/${handle}`)).data;
assert.equal(info.user.id, me.user.id);
const consent = (
  await json(`/api/mcp-oauth/requests/${handle}`, {
    method: "POST",
    body: { approved: true, userId: me.user.id, workspaceId: me.workspace.id },
  })
).data;
const callback = new URL(consent.redirect);
assert.equal(callback.searchParams.get("state"), "smoke-state");
const tokens = await json("/oauth/token", {
  method: "POST",
  browser: false,
  body: {
    grant_type: "authorization_code",
    client_id: client.client_id,
    redirect_uri: client.redirect_uris[0],
    code: callback.searchParams.get("code"),
    code_verifier: verifier,
    resource,
  },
});
const serverRequire = createRequire(
  new URL("../../../apps/server/package.json", import.meta.url),
);
const { Client } = serverRequire("@modelcontextprotocol/sdk/client/index.js");
const { StreamableHTTPClientTransport } = serverRequire(
  "@modelcontextprotocol/sdk/client/streamableHttp.js",
);
const clientErrors = [];
async function connect(token) {
  const client = new Client({ name: "OAuth smoke", version: "1" });
  client.onerror = (error) => clientErrors.push(error);
  await client.connect(
    new StreamableHTTPClientTransport(new URL(resource), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    }),
  );
  return client;
}
const sdk = await connect(tokens.access_token);
const tools = await sdk.listTools();
assert.equal(tools.tools.length, 24);
const current = await sdk.callTool({ name: "get_current_user", arguments: {} });
assert(!current.isError);
const principal = JSON.parse(current.content[0].text);
assert.equal(principal.id, me.user.id);
assert.equal(principal.workspace.id, me.workspace.id);
assert.equal((await request("/mcp", { browser: false })).status, 405);
const refreshed = await json("/oauth/token", {
  method: "POST",
  browser: false,
  body: {
    grant_type: "refresh_token",
    client_id: client.client_id,
    refresh_token: tokens.refresh_token,
    resource,
  },
});
const refreshedSdk = await connect(refreshed.access_token);
assert.equal((await refreshedSdk.listTools()).tools.length, 24);
await sdk.close();
await refreshedSdk.close();
assert.equal(
  clientErrors.length,
  0,
  "SDK must not report errors or trigger SSE authentication loops",
);
const grants = (
  await json("/api/mcp-oauth/grants", { method: "POST", body: {} })
).data;
assert.equal(grants.length, 1);
await json(`/api/mcp-oauth/grants/${grants[0].id}/revoke`, {
  method: "POST",
  body: {},
});
for (const token of [
  tokens.access_token,
  refreshed.access_token,
  "legacy-personal-api-key",
]) {
  const denied = await request("/mcp", {
    method: "POST",
    browser: false,
    headers: { authorization: `Bearer ${token}` },
    body: {},
  });
  assert.equal(denied.status, 401);
  assert.match(denied.headers.get("www-authenticate"), /resource_metadata/);
}
console.log(
  "PASS: real Docmost setup → logout/login → same knowledge-base user → OAuth consent → 24 MCP tools → get_current_user identity match → refresh → revoke → old-key rejection.",
);
