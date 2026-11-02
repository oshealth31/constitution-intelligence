import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { RequireOrgPermission, Tenant } from '../access/decorators';
import type { TenantScope } from '../tenancy/tenant-scope';
import { SearchService } from './search.service';

/** Base path: /api/v1/organisations/:organisationId/search */
@Controller('organisations/:organisationId/search')
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  /** Searches the organisation's published constitution. Highlights are marked [[like this]]. */
  @Get()
  @RequireOrgPermission('constitution.read')
  search(@Tenant() tenant: TenantScope, @Query('q') q?: string) {
    const query = typeof q === 'string' ? q.trim() : '';
    if (query.length < 2 || query.length > 200) {
      throw new BadRequestException('Search text must be between 2 and 200 characters.');
    }
    return this.searchService.search(tenant, query);
  }
}
