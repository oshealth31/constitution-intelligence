// Tenant isolation tests: organisation A deliberately tries to reach organisation B's records
// through the API, files, search, AI retrieval, audit logs and directly in the database.
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSampleTenantContent, type SampleTenantIds } from '../src/dev/sample-tenant';
import { FilesService } from '../src/modules/files/files.service';
import { StorageService } from '../src/modules/files/storage.service';
import { TenantDatabase } from '../src/modules/tenancy/tenant-database.service';
import { createTenantScope, type TenantScope } from '../src/modules/tenancy/tenant-scope';
import {
  createOrganisation,
  signedInMember,
  startTestApp,
  type TestAgent,
  type TestContext,
} from './support/test-app';
import { testDatabaseUrl } from './support/test-database';

/** The database's own message, which the driver carries in the error's "cause". */
async function databaseError(statement: Promise<unknown>): Promise<string> {
  try {
    await statement;
  } catch (error) {
    const cause = (error as { cause?: { message?: string } }).cause;
    return cause?.message ?? (error as Error).message;
  }
  return 'no error';
}

interface Tenant {
  ids: SampleTenantIds;
  owner: TestAgent;
  ownerUserId: string;
  scope: TenantScope;
  uniqueWord: string;
  name: string;
}

describe.runIf(Boolean(testDatabaseUrl))('tenant isolation', () => {
  let context: TestContext;
  let a: Tenant;
  let b: Tenant;
  let memberA: TestAgent;
  let reviewerA: TestAgent;

  async function createTenant(name: string, uniqueWord: string): Promise<Tenant> {
    const organisation = await createOrganisation(context.db);
    const owner = await signedInMember(context, organisation.id, 'owner');
    const scope = createTenantScope(organisation.id, owner.user.id, 'owner');
    const ids = await createSampleTenantContent(context.db, context.app.get(FilesService), scope, {
      name,
      uniqueWord,
    });
    return { ids, owner: owner.agent, ownerUserId: owner.user.id, scope, uniqueWord, name };
  }

  beforeAll(async () => {
    context = await startTestApp();
    a = await createTenant('Riverside Netball Club (fictional)', 'kingfisher');
    b = await createTenant('Hilltop Fellowship (fictional)', 'baobab');
    memberA = (await signedInMember(context, a.ids.organisationId, 'member')).agent;
    reviewerA = (await signedInMember(context, a.ids.organisationId, 'content_reviewer')).agent;
  });

  afterAll(async () => {
    await context?.close();
  });

  /** Requests for organisation B's records, phrased through a given organisation's URL. */
  function recordUrls(organisationId: string, target: SampleTenantIds): string[] {
    const base = `/api/v1/organisations/${organisationId}`;
    return [
      `${base}/constitutions/${target.constitutionId}/versions`,
      `${base}/versions/${target.publishedVersionId}/sections`,
      `${base}/versions/${target.publishedVersionId}/extracted-text`,
      `${base}/versions/${target.publishedVersionId}/approvals`,
      `${base}/files/${target.fileId}/content`,
      `${base}/ai/conversations/${target.conversationId}`,
    ];
  }

  function listUrls(organisationId: string): string[] {
    const base = `/api/v1/organisations/${organisationId}`;
    return [
      base,
      `${base}/constitutions`,
      `${base}/files`,
      `${base}/members`,
      `${base}/invitations`,
      `${base}/branding`,
      `${base}/subscription`,
      `${base}/usage`,
      `${base}/audit-events`,
      `${base}/ai/conversations`,
      `${base}/search?q=quorum`,
    ];
  }

  describe('direct API requests', () => {
    it('sanity check: organisation B can read all of its own records', async () => {
      for (const url of [
        ...recordUrls(b.ids.organisationId, b.ids),
        ...listUrls(b.ids.organisationId),
      ]) {
        const response = await b.owner.get(url);
        expect(response.status, url).toBe(200);
      }
    });

    it("refuses organisation B's record IDs requested through organisation A's URLs", async () => {
      for (const url of recordUrls(a.ids.organisationId, b.ids)) {
        const response = await a.owner.get(url);
        expect(response.status, url).toBe(404);
        expect(JSON.stringify(response.body), url).not.toContain(b.uniqueWord);
      }
    });

    it("refuses every organisation B URL to organisation A's owner, revealing nothing", async () => {
      for (const url of [
        ...recordUrls(b.ids.organisationId, b.ids),
        ...listUrls(b.ids.organisationId),
      ]) {
        const response = await a.owner.get(url);
        expect(response.status, url).toBe(404);
        expect(response.body.error.message, url).toBe('Organisation not found.');
        expect(JSON.stringify(response.body), url).not.toContain(b.uniqueWord);
      }
    });

    it('refuses writes into organisation B', async () => {
      const base = `/api/v1/organisations/${b.ids.organisationId}`;
      await a.owner.patch(`${base}/branding`).send({ displayName: 'Taken over' }).expect(404);
      await a.owner
        .post(`${base}/invitations`)
        .send({ email: 'intruder@example.test', role: 'owner' })
        .expect(404);
      await a.owner.post(`${base}/ai/retrieval-preview`).send({ question: 'quorum' }).expect(404);
    });

    it('lists contain only the caller organisation’s records', async () => {
      const base = `/api/v1/organisations/${a.ids.organisationId}`;
      const constitutionsList = await a.owner.get(`${base}/constitutions`).expect(200);
      expect(constitutionsList.body.map((c: { id: string }) => c.id)).toEqual([
        a.ids.constitutionId,
      ]);

      const filesList = await a.owner.get(`${base}/files`).expect(200);
      expect(filesList.body.map((f: { id: string }) => f.id)).toEqual([a.ids.fileId]);

      const conversations = await a.owner.get(`${base}/ai/conversations`).expect(200);
      expect(conversations.body.map((c: { id: string }) => c.id)).toEqual([a.ids.conversationId]);

      const subscription = await a.owner.get(`${base}/subscription`).expect(200);
      expect(subscription.body.id).toBe(a.ids.subscriptionId);

      const members = await a.owner.get(`${base}/members`).expect(200);
      expect(members.body.every((m: { userId: string }) => m.userId !== b.ownerUserId)).toBe(true);
    });
  });

  describe('tenant context comes only from the verified membership', () => {
    it('ignores an organisation ID supplied in the body, query string or headers', async () => {
      const base = `/api/v1/organisations/${a.ids.organisationId}`;
      await a.owner
        .patch(`${base}/branding`)
        .set('X-Organisation-Id', b.ids.organisationId)
        .send({ organisationId: b.ids.organisationId, displayName: 'Riverside (renamed)' })
        .expect(200);

      const theirs = await b.owner
        .get(`/api/v1/organisations/${b.ids.organisationId}/branding`)
        .expect(200);
      expect(theirs.body.displayName).toBe(b.name);
      const mine = await a.owner.get(`${base}/branding`).expect(200);
      expect(mine.body.displayName).toBe('Riverside (renamed)');

      const viaQuery = await a.owner
        .get(`${base}/constitutions?organisationId=${b.ids.organisationId}`)
        .set('X-Organisation-Id', b.ids.organisationId)
        .expect(200);
      expect(viaQuery.body.map((c: { id: string }) => c.id)).toEqual([a.ids.constitutionId]);
    });
  });

  describe('search and AI retrieval', () => {
    it('returns only the caller organisation’s published sections', async () => {
      const base = `/api/v1/organisations/${a.ids.organisationId}`;
      const shared = await memberA.get(`${base}/search?q=quorum`).expect(200);
      expect(shared.body.length).toBeGreaterThan(0);
      expect(
        shared.body.every(
          (match: { versionId: string }) => match.versionId === a.ids.publishedVersionId,
        ),
      ).toBe(true);

      const theirWord = await memberA.get(`${base}/search?q=${b.uniqueWord}`).expect(200);
      expect(theirWord.body).toEqual([]);

      const ownWord = await memberA.get(`${base}/search?q=${a.uniqueWord}`).expect(200);
      expect(ownWord.body.map((match: { sectionId: string }) => match.sectionId)).toEqual([
        a.ids.quorumSectionId,
      ]);

      const draftWording = await reviewerA.get(`${base}/search?q=${a.uniqueWord}draft`).expect(200);
      expect(draftWording.body).toEqual([]);
    });

    it('never gives the AI another organisation’s text', async () => {
      const url = `/api/v1/organisations/${a.ids.organisationId}/ai/retrieval-preview`;
      const theirs = await memberA
        .post(url)
        .send({ question: `What does the ${b.uniqueWord} clause say?` })
        .expect(200);
      expect(theirs.body).toEqual([]);

      const quorum = await memberA.post(url).send({ question: 'quorum' }).expect(200);
      expect(quorum.body.length).toBeGreaterThan(0);
      expect(
        quorum.body.every(
          (match: { versionId: string }) => match.versionId === a.ids.publishedVersionId,
        ),
      ).toBe(true);
      expect(JSON.stringify(quorum.body)).not.toContain(b.uniqueWord);
    });

    it('keeps AI conversations private to their user, even inside the organisation', async () => {
      await memberA
        .get(
          `/api/v1/organisations/${a.ids.organisationId}/ai/conversations/${a.ids.conversationId}`,
        )
        .expect(404);
      const own = await a.owner
        .get(
          `/api/v1/organisations/${a.ids.organisationId}/ai/conversations/${a.ids.conversationId}`,
        )
        .expect(200);
      const answer = own.body.messages.find((m: { role: string }) => m.role === 'assistant');
      expect(answer.citations).toEqual([
        expect.objectContaining({ sectionId: a.ids.quorumSectionId }),
      ]);
    });

    it('shows members the published constitution only', async () => {
      const base = `/api/v1/organisations/${a.ids.organisationId}`;
      const versions = await memberA
        .get(`${base}/constitutions/${a.ids.constitutionId}/versions`)
        .expect(200);
      expect(versions.body.map((v: { status: string }) => v.status)).toEqual(['published']);
      await memberA.get(`${base}/versions/${a.ids.draftVersionId}/sections`).expect(404);
      await reviewerA.get(`${base}/versions/${a.ids.draftVersionId}/sections`).expect(200);
    });
  });

  describe('files', () => {
    it('serves a file only to its own organisation', async () => {
      const own = await a.owner
        .get(`/api/v1/organisations/${a.ids.organisationId}/files/${a.ids.fileId}/content`)
        .expect(200);
      expect(own.text).toContain(a.name.toUpperCase());
      expect(own.headers['content-disposition']).toMatch(/^attachment;/);
    });

    it('refuses storage keys outside the caller organisation’s folder', async () => {
      const storage = context.app.get(StorageService);
      const otherKey = `tenants/${b.ids.organisationId}/files/${b.ids.fileId}`;
      await expect(storage.get(a.scope, otherKey)).rejects.toThrow(/not available/);
      await expect(
        storage.get(a.scope, `tenants/${a.ids.organisationId}/../${b.ids.organisationId}/files/x`),
      ).rejects.toThrow(/not available/);
      // The real owner can read it.
      await expect(storage.get(b.scope, otherKey)).resolves.toBeInstanceOf(Buffer);
    });
  });

  describe('audit log', () => {
    it('shows each organisation only its own events', async () => {
      const events = await a.owner
        .get(`/api/v1/organisations/${a.ids.organisationId}/audit-events?limit=500`)
        .expect(200);
      expect(events.body.length).toBeGreaterThan(0);
      expect(
        events.body.every(
          (event: { organisationId: string }) => event.organisationId === a.ids.organisationId,
        ),
      ).toBe(true);
    });
  });

  describe('database-level protection (Row-Level Security and constraints)', () => {
    const TENANT_TABLES = [
      'memberships',
      'invitations',
      'subscriptions',
      'files',
      'organisation_branding',
      'constitutions',
      'constitution_versions',
      'extracted_texts',
      'sections',
      'section_chunks',
      'content_approvals',
      'ai_conversations',
      'ai_messages',
      'ai_citations',
      'usage_records',
      'audit_events',
    ];

    it('lets a tenant transaction see only its own rows in every tenant table', async () => {
      const tenantDb = context.app.get(TenantDatabase);
      for (const table of TENANT_TABLES) {
        const rows = await tenantDb.run(a.scope, (tx) =>
          tx.execute(sql.raw(`SELECT DISTINCT organisation_id::text AS id FROM ${table}`)),
        );
        const ids = (rows.rows as { id: string }[]).map((row) => row.id);
        expect(
          ids.every((id) => id === a.ids.organisationId),
          table,
        ).toBe(true);
      }
      const orgs = await tenantDb.run(a.scope, (tx) =>
        tx.execute(sql`SELECT id::text AS id FROM organisations`),
      );
      expect((orgs.rows as { id: string }[]).map((row) => row.id)).toEqual([a.ids.organisationId]);
    });

    it('returns no rows at all when no organisation is set', async () => {
      const result = await context.db.transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL ROLE app_tenant`);
        return tx.execute(sql`SELECT count(*)::int AS n FROM sections`);
      });
      expect((result.rows[0] as { n: number }).n).toBe(0);
    });

    it('refuses to write another organisation’s rows from a tenant transaction', async () => {
      const tenantDb = context.app.get(TenantDatabase);
      const message = await databaseError(
        tenantDb.run(a.scope, (tx) =>
          tx.execute(
            sql`INSERT INTO constitutions (organisation_id, title) VALUES (${b.ids.organisationId}, 'Planted')`,
          ),
        ),
      );
      expect(message).toMatch(/row-level security/);

      const updated = await tenantDb.run(a.scope, (tx) =>
        tx.execute(
          sql`UPDATE constitutions SET title = 'Defaced' WHERE organisation_id = ${b.ids.organisationId}`,
        ),
      );
      expect(updated.rowCount).toBe(0);
    });

    it('stops tenant transactions reading password hashes or rewriting history', async () => {
      const tenantDb = context.app.get(TenantDatabase);
      expect(
        await databaseError(
          tenantDb.run(a.scope, (tx) => tx.execute(sql`SELECT password_hash FROM users`)),
        ),
      ).toMatch(/permission denied/);
      expect(
        await databaseError(
          tenantDb.run(a.scope, (tx) => tx.execute(sql`DELETE FROM audit_events`)),
        ),
      ).toMatch(/permission denied/);
    });

    it('rejects records that link to another organisation’s records', async () => {
      expect(
        await databaseError(
          context.db.execute(sql`
            INSERT INTO sections (organisation_id, version_id, kind, ref_key, body, position)
            VALUES (${a.ids.organisationId}, ${b.ids.publishedVersionId}, 'clause', 'x1', 'planted', 9)`),
        ),
      ).toMatch(/foreign key/);
      expect(
        await databaseError(
          context.db.execute(sql`
            INSERT INTO ai_citations (organisation_id, message_id, section_id)
            VALUES (${a.ids.organisationId}, ${a.ids.answerMessageId}, ${b.ids.quorumSectionId})`),
        ),
      ).toMatch(/foreign key/);
      expect(
        await databaseError(
          context.db.execute(sql`
            UPDATE organisations SET current_subscription_id = ${b.ids.subscriptionId}
            WHERE id = ${a.ids.organisationId}`),
        ),
      ).toMatch(/foreign key/);
      expect(
        await databaseError(
          context.db.execute(sql`
            INSERT INTO files (organisation_id, storage_key, original_filename, content_type, size_bytes, sha256)
            VALUES (${a.ids.organisationId}, ${`tenants/${b.ids.organisationId}/files/stolen`},
                    'x.pdf', 'application/pdf', 1, ${'a'.repeat(64)})`),
        ),
      ).toMatch(/files_storage_key_in_tenant_folder/);
    });

    it('guardrail: every organisation-specific table has a tenant column and Row-Level Security', async () => {
      // Tables that are deliberately global. Adding a new table without organisation_id fails this test
      // until someone decides, and documents, why it is global.
      const GLOBAL_TABLES = [
        'organisations',
        'users',
        'sessions',
        'password_reset_tokens',
        'auth_rate_limits',
      ];
      const result = await context.db.execute(sql`
        SELECT c.relname AS name,
               c.relrowsecurity AS rls,
               EXISTS (
                 SELECT 1 FROM information_schema.columns col
                 WHERE col.table_schema = 'public' AND col.table_name = c.relname
                   AND col.column_name = 'organisation_id'
               ) AS has_tenant_column,
               EXISTS (
                 SELECT 1 FROM information_schema.columns col
                 WHERE col.table_schema = 'public' AND col.table_name = c.relname
                   AND col.column_name = 'organisation_id' AND col.is_nullable = 'NO'
               ) AS tenant_not_null,
               EXISTS (
                 SELECT 1 FROM pg_policies p
                 WHERE p.schemaname = 'public' AND p.tablename = c.relname
                   AND 'app_tenant' = ANY (p.roles)
               ) AS has_policy
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r'
        ORDER BY c.relname`);
      const tables = result.rows as {
        name: string;
        rls: boolean;
        has_tenant_column: boolean;
        tenant_not_null: boolean;
        has_policy: boolean;
      }[];
      expect(tables.length).toBeGreaterThan(15);
      for (const table of tables.filter((t) => !GLOBAL_TABLES.includes(t.name))) {
        expect(table.has_tenant_column, `${table.name} has organisation_id`).toBe(true);
        if (table.name !== 'audit_events') {
          // Platform-level audit events have no organisation; all other tenant rows must.
          expect(table.tenant_not_null, `${table.name}.organisation_id is NOT NULL`).toBe(true);
        }
        expect(table.rls, `${table.name} has Row-Level Security enabled`).toBe(true);
        expect(table.has_policy, `${table.name} has a tenant policy`).toBe(true);
      }
    });
  });
});
