// OAuth discovery and protocol endpoints must be reachable without /api.
export const OAUTH_PUBLIC_ROUTES = ['.well-known/{*path}', 'oauth/{*path}'];
