import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { type Database } from '@constitution/db';
import type { PlanLimit } from '@constitution/shared';
import type { AppConfig } from '../../config/config';
import { APP_CONFIG } from '../../config/config.module';
import { DRIZZLE } from '../../database/database.constants';
import type { TenantScope } from '../tenancy/tenant-scope';
import { loadAccess, loadUsage } from './access';

const WHAT: Record<PlanLimit, (limit: number) => string> = {
  members: (limit) => `Your plan allows up to ${limit} members (including invitations not yet accepted).`,
  constitutions: (limit) => `Your plan allows up to ${limit} documents.`,
  aiQuestionsPerMonth: (limit) =>
    limit === 0
      ? 'Your plan does not include AI questions.'
      : `Your organisation has used all ${limit} AI questions included in its plan this month.`,
  storageMb: (limit) => `Your plan includes ${limit} MB of file storage, and this would go over it.`,
};

/** Usage limits from the organisation's plan, checked on the server before the action. */
@Injectable()
export class LimitsService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /**
   * Refuses (403, reason PLAN_LIMIT_REACHED) when adding `amount` would go over the limit.
   * For storage, `amount` is in bytes.
   */
  async assertWithinLimit(scope: TenantScope, limit: PlanLimit, amount = 1): Promise<void> {
    const now = new Date();
    const access = await loadAccess(
      this.db,
      scope.organisationId,
      now,
      this.config.SUBSCRIPTION_DATA_RETENTION_DAYS,
    );
    const allowed = access.limits[limit];
    if (allowed === null) return;
    const usage = await loadUsage(this.db, scope.organisationId, now);
    const after =
      limit === 'storageMb'
        ? (usage.storageMb * 1024 * 1024 + amount) / (1024 * 1024)
        : usage[limit] + amount;
    if (after > allowed) {
      throw new ForbiddenException({
        message: `${WHAT[limit](allowed)} Please contact Constitution Intelligence to change your plan.`,
        reason: 'PLAN_LIMIT_REACHED',
      });
    }
  }

  usage(scope: TenantScope) {
    return loadUsage(this.db, scope.organisationId, new Date());
  }
}
