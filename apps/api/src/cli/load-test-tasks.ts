// The live load test's fictional data: create, finish (suspend + request deletion), delete.
// Used by the command line (cli/load-test-data.ts) and its test. Only organisations whose web
// address is "load-test-<12 digits>" are ever touched.
import { createTenantScope } from '../modules/tenancy/tenant-scope';
import { TenantDatabase } from '../modules/tenancy/tenant-database.service';
import { PlatformService } from '../modules/platform/platform.service';
import { PlatformDashboardService } from '../modules/platform/platform-dashboard.service';
import { OrganisationDeletionService } from '../modules/platform/organisation-deletion.service';
import { PasswordService } from '../modules/auth/password.service';
import { DRIZZLE } from '../database/database.constants';
import type { Database } from '@constitution/db';
import { sql } from 'drizzle-orm';
import type { INestApplicationContext } from '@nestjs/common';
import { fictionalSentence, isLoadTestSlug, LOAD_TEST_PREFIX } from './load-test-names';

const META = { ipAddress: null, userAgent: 'cli load-test-data', requestId: null };

async function superAdminId(db: Database): Promise<string> {
  const result = await db.execute(
    sql`SELECT id::text AS id FROM users WHERE is_platform_super_admin AND status = 'active' ORDER BY created_at LIMIT 1`,
  );
  const id = (result.rows[0] as { id?: string } | undefined)?.id;
  if (!id) throw new Error('No active Platform Super Admin to record as the actor.');
  return id;
}

/** The load-test organisations that are not deleted, newest first. */
async function loadTestOrganisations(db: Database) {
  const result = await db.execute(
    sql`SELECT id::text AS id, slug, status FROM organisations
        WHERE slug LIKE ${LOAD_TEST_PREFIX + '%'} AND deleted_at IS NULL
        ORDER BY created_at DESC`,
  );
  return (result.rows as { id: string; slug: string; status: string }[]).filter((row) =>
    isLoadTestSlug(row.slug),
  );
}

export async function createLoadTestData(
  app: INestApplicationContext,
  members: number,
  password: string,
) {
  const db = app.get<Database>(DRIZZLE);
  if (password.length < 16) throw new Error('Give a password of at least 16 characters on stdin.');
  if ((await loadTestOrganisations(db)).length > 0) {
    throw new Error('A load-test organisation already exists. Run --finish (and --delete) first.');
  }
  const actor = await superAdminId(db);
  const stamp = new Date()
    .toISOString()
    .replace(/[^0-9]/g, '')
    .slice(0, 12);
  const slug = `${LOAD_TEST_PREFIX}${stamp}`;
  const organisation = await app
    .get(PlatformService)
    .createOrganisation('Load Test (fictional)', slug, actor, META);
  const passwordHash = await app.get(PasswordService).hash(password);

  // Accounts are global (not organisation rows); memberships and documents are written inside
  // the organisation's own row-level-security scope, like the application does.
  await db.execute(sql`
    INSERT INTO users (email, display_name, password_hash)
    SELECT ${slug} || '-' || n || '@example.com', 'Load Test Member ' || n, ${passwordHash}
    FROM generate_series(1, ${members}::int) n`);
  const userIds = (
    await db.execute(
      sql`SELECT id::text AS id FROM users WHERE email LIKE ${slug + '-%@example.com'}`,
    )
  ).rows as { id: string }[];

  const scope = createTenantScope(organisation.id, actor, 'owner');
  const result = await app.get(TenantDatabase).run(scope, async (tx) => {
    await tx.execute(sql`
      INSERT INTO memberships (organisation_id, user_id, role)
      SELECT ${organisation.id}::uuid, id::uuid, 'member'
      FROM unnest(string_to_array(${userIds.map((row) => row.id).join(',')}, ',')) AS id`);
    const constitution = (
      await tx.execute(
        sql`INSERT INTO constitutions (organisation_id, title)
            VALUES (${organisation.id}, 'Large Constitution (fictional, load test)') RETURNING id::text AS id`,
      )
    ).rows[0] as { id: string };
    const version = (
      await tx.execute(
        sql`INSERT INTO constitution_versions
              (organisation_id, constitution_id, version_number, label, status, extraction_status)
            VALUES (${organisation.id}, ${constitution.id}, 1, 'Load test version', 'draft', 'succeeded')
            RETURNING id::text AS id`,
      )
    ).rows[0] as { id: string };

    // 20 parts × 25 clauses × 2 sub-clauses: far bigger than a real constitution.
    let position = 0;
    for (let part = 1; part <= 20; part += 1) {
      const partRow = (
        await tx.execute(
          sql`INSERT INTO sections (organisation_id, version_id, kind, ref_key, number, heading, body, position)
              VALUES (${organisation.id}, ${version.id}, 'part', ${`p${part}`}, ${`Part ${part}`},
                      ${`Part ${part} heading`}, '', ${position++}) RETURNING id::text AS id`,
        )
      ).rows[0] as { id: string };
      for (let c = 1; c <= 25; c += 1) {
        const clause = (part - 1) * 25 + c;
        const body = Array.from({ length: 12 }, (_, s) => fictionalSentence(clause * 31 + s)).join(
          ' ',
        );
        const clauseRow = (
          await tx.execute(
            sql`INSERT INTO sections (organisation_id, version_id, parent_section_id, kind, ref_key, number, heading, body, position)
                VALUES (${organisation.id}, ${version.id}, ${partRow.id}, 'clause', ${`c${clause}`},
                        ${String(clause)}, ${`Clause ${clause} heading`}, ${body}, ${position++})
                RETURNING id::text AS id`,
          )
        ).rows[0] as { id: string };
        for (const letter of ['a', 'b']) {
          const subBody = Array.from({ length: 4 }, (_, s) =>
            fictionalSentence(clause * 17 + s + letter.charCodeAt(0)),
          ).join(' ');
          await tx.execute(
            sql`INSERT INTO sections (organisation_id, version_id, parent_section_id, kind, ref_key, number, heading, body, position)
                VALUES (${organisation.id}, ${version.id}, ${clauseRow.id}, 'subclause',
                        ${`c${clause}${letter}`}, ${`(${letter})`}, NULL, ${subBody}, ${position++})`,
          );
        }
      }
    }
    for (const status of ['in_review', 'approved', 'published']) {
      await tx.execute(
        sql`UPDATE constitution_versions
            SET status = ${status}, published_at = CASE WHEN ${status} = 'published' THEN now() END
            WHERE id = ${version.id}`,
      );
    }
    return { constitutionId: constitution.id, versionId: version.id, sections: position };
  });

  return { organisationId: organisation.id, slug, members: userIds.length, ...result };
}

export async function finishLoadTestData(app: INestApplicationContext) {
  const db = app.get<Database>(DRIZZLE);
  const actor = await superAdminId(db);
  const found = await loadTestOrganisations(db);
  if (found.length === 0) return { finished: 0, deleteFrom: null };
  const deletion = app.get(OrganisationDeletionService);
  for (const organisation of found) {
    if (organisation.status !== 'suspended') {
      await app
        .get(PlatformDashboardService)
        .setOrganisationStatus(
          organisation.id,
          'suspended',
          'Fictional load-test data: test finished.',
          actor,
          META,
        );
    }
    const preview = await deletion.preview(organisation.id);
    if (!preview.request) {
      await deletion.request(
        organisation.id,
        {
          confirmSlug: organisation.slug,
          reason: 'Fictional load-test data, no longer needed.',
          exportConfirmed: true,
        },
        actor,
        META,
      );
    }
  }
  return {
    finished: found.length,
    deleteFrom: new Date(Date.now() + 24 * 3_600_000).toISOString(),
  };
}

export async function deleteLoadTestData(app: INestApplicationContext) {
  const db = app.get<Database>(DRIZZLE);
  const actor = await superAdminId(db);
  const deletion = app.get(OrganisationDeletionService);
  let deleted = 0;
  for (const organisation of await loadTestOrganisations(db)) {
    const preview = await deletion.preview(organisation.id);
    if (!preview.request) {
      throw new Error(`${organisation.slug}: no deletion request; run --finish first.`);
    }
    await deletion.approve(organisation.id, preview.request.id, organisation.slug, actor, META);
    deleted += 1;
  }
  return { deleted };
}
