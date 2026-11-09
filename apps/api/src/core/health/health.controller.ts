import { Controller, Get, Inject } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Database } from '../database/database.service';
import { RedisService } from '../database/redis.service';
import { AppError } from '../http/errors';
import { Public } from '../http/context';

@ApiTags('System')
@Controller('health')
export class HealthController {
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(RedisService) private readonly redis: RedisService,
  ) {}

  @Get()
  @Public()
  async health() {
    const checks = { database: false, redis: false };
    try {
      await this.db.global.$queryRaw`SELECT 1`;
      checks.database = true;
    } catch {
      /* gemeldet unten */
    }
    try {
      checks.redis = (await this.redis.client.ping()) === 'PONG';
    } catch {
      /* gemeldet unten */
    }
    if (!checks.database || !checks.redis)
      throw new AppError(503, 'INTERNAL_ERROR', JSON.stringify(checks));
    return { status: 'ok', checks };
  }
}
