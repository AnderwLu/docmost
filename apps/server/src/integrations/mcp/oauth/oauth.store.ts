import { Injectable } from '@nestjs/common';
import { RedisService } from '@nestjs-labs/nestjs-ioredis';
import { Redis } from 'ioredis';
import { digest, OAuthGrant, GRANT_TTL, ACCESS_TTL } from './oauth.protocol';

const PREFIX = 'mcp:oauth:';
@Injectable()
export class OAuthStore {
  private readonly redis: Redis;
  constructor(redisService: RedisService) {
    this.redis = redisService.getOrThrow();
  }
  key(kind: string, id: string) {
    return `${PREFIX}${kind}:${id}`;
  }
  async get<T>(kind: string, id: string): Promise<T | null> {
    const value = await this.redis.get(this.key(kind, id));
    return value ? JSON.parse(value) : null;
  }
  async put(kind: string, id: string, data: unknown, ttl: number) {
    await this.redis.set(this.key(kind, id), JSON.stringify(data), 'EX', ttl);
  }
  async remove(kind: string, id: string) {
    await this.redis.del(this.key(kind, id));
  }
  // Compare-and-delete prevents concurrent code redemption or consent replay.
  async consume(kind: string, id: string, expected: unknown): Promise<boolean> {
    return (
      Number(
        await this.redis.eval(
          `
      if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
      redis.call('DEL', KEYS[1]); return 1
    `,
          1,
          this.key(kind, id),
          JSON.stringify(expected),
        ),
      ) === 1
    );
  }
  async limit(ip: string, action: string, max: number) {
    const key = this.key('limit', `${action}:${digest(ip)}`);
    return (
      Number(
        await this.redis.eval(
          `
      local n = redis.call('INCR', KEYS[1])
      if n == 1 then redis.call('EXPIRE', KEYS[1], 60) end
      return n
    `,
          1,
          key,
        ),
      ) <= max
    );
  }
  async issue(grant: OAuthGrant, accessHash: string, refreshHash: string) {
    const ttl = Math.max(1, Math.floor((grant.expiresAt - Date.now()) / 1000));
    await this.redis
      .multi()
      .set(this.key('grant', grant.id), JSON.stringify(grant), 'EX', ttl)
      .set(
        this.key('access', accessHash),
        JSON.stringify(grant.id),
        'EX',
        ACCESS_TTL,
      )
      .set(
        this.key('refresh', refreshHash),
        JSON.stringify(grant.id),
        'EX',
        ttl,
      )
      .zadd(
        this.key('user', `${grant.workspaceId}:${grant.userId}`),
        grant.expiresAt,
        grant.id,
      )
      .expire(
        this.key('user', `${grant.workspaceId}:${grant.userId}`),
        GRANT_TTL,
      )
      .exec()
      .then((results) => {
        if (!results || results.some(([err]) => err))
          throw new Error('OAuth storage unavailable');
      });
  }
  // Old refresh mappings remain as tombstones until family expiry. Reuse revokes
  // the family, including every previously issued access token. Rotation and
  // revocation serialize in Redis; a revoked grant can never be recreated here.
  async rotate(
    grant: OAuthGrant,
    oldHash: string,
    accessHash: string,
    refreshHash: string,
  ) {
    return (
      Number(
        await this.redis.eval(
          `
      local raw = redis.call('GET', KEYS[1])
      if not raw then return 0 end
      local g = cjson.decode(raw)
      if g.refreshHash ~= ARGV[1] then redis.call('DEL', KEYS[1]); return 0 end
      local ttl = redis.call('TTL', KEYS[1])
      if ttl <= 0 then return 0 end
      g.refreshHash = ARGV[2]
      redis.call('SET', KEYS[1], cjson.encode(g), 'EX', ttl)
      redis.call('SET', KEYS[2], ARGV[3], 'EX', ${ACCESS_TTL})
      redis.call('SET', KEYS[3], ARGV[3], 'EX', ttl)
      return 1
    `,
          3,
          this.key('grant', grant.id),
          this.key('access', accessHash),
          this.key('refresh', refreshHash),
          oldHash,
          refreshHash,
          JSON.stringify(grant.id),
        ),
      ) === 1
    );
  }
  async list(userId: string, workspaceId: string) {
    const key = this.key('user', `${workspaceId}:${userId}`);
    await this.redis.zremrangebyscore(key, '-inf', Date.now());
    const ids = await this.redis.zrange(key, 0, -1);
    const grants = await Promise.all(
      ids.map((id) => this.get<OAuthGrant>('grant', id)),
    );
    return grants.filter((g): g is OAuthGrant => !!g);
  }
}
