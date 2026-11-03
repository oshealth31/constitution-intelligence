import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { parseId } from '../../common/ids';
import { RequireOrgPermission, Tenant } from '../access/decorators';
import type { TenantScope } from '../tenancy/tenant-scope';
import { ReaderSearchService } from './reader-search.service';

/** Base path: /api/v1/organisations/:organisationId/search */
@Controller('organisations/:organisationId/search')
export class SearchController {
  constructor(private readonly readerSearch: ReaderSearchService) {}

  /**
   * Searches the organisation's current (published) constitution text by clause number
   * ("7", "clause 7(a)", "Part 3"), by section title, or by keyword.
   * Optional: constitutionId to search one document only.
   */
  @Get()
  @RequireOrgPermission('constitution.read')
  search(
    @Tenant() tenant: TenantScope,
    @Query('q') q?: string,
    @Query('constitutionId') constitutionId?: string,
  ) {
    const query = typeof q === 'string' ? q.trim().replace(/\s+/g, ' ') : '';
    // A single character is only useful as a clause number ("7").
    if (query.length === 0 || query.length > 200 || (query.length === 1 && !/^\d$/.test(query))) {
      throw new BadRequestException(
        'Type at least 2 letters (or a clause number), and at most 200 characters.',
      );
    }
    return this.readerSearch.find(
      tenant,
      query,
      constitutionId ? parseId(constitutionId, 'Constitution') : undefined,
    );
  }
}
