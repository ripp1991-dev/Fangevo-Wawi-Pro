import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { type FastifyRequest } from 'fastify';
import { createHash } from 'node:crypto';
import { APP_CONFIG, type AppConfig } from '../../config';
import { RedisService } from '../database/redis.service';
import { AppError } from '../http/errors';
import { META, type RateLimitRule, clientIp } from '../http/context';

/**
 * Feste Zeitfenster in Redis, z. B. gegen Passwort-Raten.
 * Ergänzt das globale Rate-Limit (@fastify/rate-limit) um strengere Regeln je Route.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const rules = this.reflector.get<RateLimitRule[] | undefined>(META.rateLimit, ctx.getHandler());
    if (!rules?.length || this.config.RATE_LIMIT_DISABLED) return true;
    const req = ctx.switchToHttp().getRequest<FastifyRequest>();
    for (const r of rules) {
      let id = clientIp(req) ?? 'unknown';
      if (r.byBodyField) {
        const v = (req.body as Record<string, unknown> | undefined)?.[r.byBodyField];
        id += ':' + createHash('sha256').update(String(v ?? '').toLowerCase().trim()).digest('hex').slice(0, 16);
      }
      const key = `rl:${r.key}:${id}:${Math.floor(Date.now() / 1000 / r.windowSec)}`;
      const n = await this.redis.client.incr(key);
      if (n === 1) await this.redis.client.expire(key, r.windowSec);
      if (n > r.limit) throw new AppError(429, 'RATE_LIMITED', 'Zu viele Versuche. Bitte später erneut versuchen.');
    }
    return true;
  }
}
