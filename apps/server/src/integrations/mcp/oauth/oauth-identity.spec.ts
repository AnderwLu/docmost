import { JwtStrategy } from '../../../core/auth/strategies/jwt.strategy';
import { JwtType } from '../../../core/auth/dto/jwt-payload';
import { UnauthorizedException } from '@nestjs/common';

// Exercise the real knowledge-base strategy used by OAuthAccountController.
describe('OAuth reuses the knowledge-base JWT/session identity', () => {
  const user = { id: 'user-1', workspaceId: 'workspace-1' };
  const workspace = { id: 'workspace-1' };
  let strategy: JwtStrategy;
  let session: any;
  const activity = { trackActivity: jest.fn() };
  beforeEach(() => {
    session = { userId: user.id, workspaceId: workspace.id };
    strategy = new JwtStrategy(
      { findById: async () => user } as any,
      { findById: async () => workspace } as any,
      { findActiveById: async () => session } as any,
      activity as any,
      { getAppSecret: () => 'unit-test-secret' } as any,
      {} as any,
    );
  });
  const payload = {
    sub: user.id,
    workspaceId: workspace.id,
    type: JwtType.ACCESS,
    sessionId: 'knowledge-base-session',
  } as any;
  it('returns the existing user/workspace and active browser session', async () => {
    const req = { raw: { workspaceId: workspace.id } };
    expect(await strategy.validate(req, payload)).toEqual({ user, workspace });
    expect(req.raw['sessionId']).toBe('knowledge-base-session');
  });
  it('rejects a revoked session', async () => {
    session = undefined;
    await expect(strategy.validate({ raw: {} }, payload)).rejects.toThrow(
      UnauthorizedException,
    );
  });
  it('rejects a session belonging to another user or workspace', async () => {
    session = { userId: 'other-user', workspaceId: workspace.id };
    await expect(strategy.validate({ raw: {} }, payload)).rejects.toThrow(
      UnauthorizedException,
    );
    session = { userId: user.id, workspaceId: 'other-workspace' };
    await expect(strategy.validate({ raw: {} }, payload)).rejects.toThrow(
      UnauthorizedException,
    );
  });
  it('rejects tokens at the wrong workspace origin', async () => {
    await expect(
      strategy.validate({ raw: { workspaceId: 'other-workspace' } }, payload),
    ).rejects.toThrow(UnauthorizedException);
  });
});
