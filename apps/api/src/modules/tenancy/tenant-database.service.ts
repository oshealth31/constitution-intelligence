import { Inject, Injectable } from '@nestjs/common';
import type { Database } from '@constitution/db';
import { sql } from 'drizzle-orm';
import { DRIZZLE } from '../../database/database.constants';
import type { TenantScope } from './tenant-scope';

/** Database handle inside a tenant transaction. */
export type TenantTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];

/** PostgreSQL role with Row-Level Security policies (created by migration 0002). */
export const TENANT_DATABASE_ROLE = 'app_tenant';

/**
 * Runs tenant work with database-enforced isolation (defence in depth):
 *   1. opens a transaction;
 *   2. switches to the restricted "app_tenant" role, which has no BYPASSRLS right and can only
 *      read or write rows whose organisation_id equals the transaction's organisation;
 *   3. sets that organisation from the verified TenantScope (never from browser input).
 * Services ALSO filter by organisation_id explicitly in every query, so a mistake in either
 * layer is caught by the other.
 */
@Injectable()
export class TenantDatabase {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  run<T>(scope: TenantScope, work: (tx: TenantTransaction) => Promise<T>): Promise<T> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql.raw(`SET LOCAL ROLE ${TENANT_DATABASE_ROLE}`));
      await tx.execute(
        sql`SELECT set_config('app.current_organisation_id', ${scope.organisationId}, true)`,
      );
      return work(tx);
    });
  }
}
