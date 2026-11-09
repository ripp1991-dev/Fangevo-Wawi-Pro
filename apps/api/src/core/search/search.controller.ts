import { Controller, Get, Inject, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { RateLimit, Tenant, type TenantContext } from '../http/context';
import { zodPipe } from '../http/zod';
import { SearchService } from './search.service';

const schema = z.object({
  q: z.string().trim().min(1).max(100),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

@ApiTags('Suche')
@Controller('search')
export class SearchController {
  constructor(@Inject(SearchService) private readonly search: SearchService) {}

  @Get()
  @RateLimit({ key: 'search', limit: 120, windowSec: 60 })
  async find(@Tenant() t: TenantContext, @Query(zodPipe(schema)) q: z.infer<typeof schema>) {
    return { items: await this.search.search(t, q.q, q.limit) };
  }
}
