// Task D12: the audit log is sealed into signed batches (fingerprints only) and checked against
// them. Changes the system makes itself (organisation deletion, anonymising a deleted person)
// are allowed; anything else is reported. Tampering is simulated as a database superuser with
// the append-only trigger switched off, as an attacker with full database access could.
import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { auditSealRuns } from '@constitution/db';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditSealService } from '../src/modules/audit/audit-seal.service';
import { AuditService } from '../src/modules/audit/audit.service';
import { DataRequestsService } from '../src/modules/platform/data-requests.service';
import {
  createOrganisation,
  createUser,
  startTestApp,
  uniqueEmail,
  type TestContext,
} from './support/test-app';
import { testDatabaseUrl } from './support/test-database';

const META = { ipAddress: '192.0.2.10', userAgent: 'seal-test', requestId: null };
const key = () =>
  generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

describe.runIf(Boolean(testDatabaseUrl))('tamper-evident audit log', () => {
  let context: TestContext;
  let seal: AuditSealService;
  let audit: AuditService;
  let dir: string;
  const privateKeyPem = key();

  beforeAll(async () => {
    context = await startTestApp();
    seal = context.app.get(AuditSealService);
    audit = context.app.get(AuditService);
    dir = await mkdtemp(path.join(tmpdir(), 'audit-seal-'));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
    await context?.close();
  });

  const record = (action: string, organisationId: string | null = null, actorUserId?: string) =>
    audit.record({
      action: action as never,
      outcome: 'success',
      organisationId,
      actorUserId: actorUserId ?? null,
      metadata: { test: action },
      meta: META,
    });
  const sealNow = () => seal.seal({ dir, privateKeyPem, settleSeconds: 0 });
  const checkNow = (keyPem = privateKeyPem) => seal.check({ dir, keyPem });
  /** As a superuser with triggers off: what an attacker with full database access could do. */
  const tamper = (statement: ReturnType<typeof sql>) =>
    context.db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL session_replication_role = replica`);
      await tx.execute(statement);
    });

  it('numbers every entry and refuses to let the application choose the number', async () => {
    await record('test.first');
    const rows = await context.db.execute(sql`SELECT seq FROM audit_events ORDER BY seq`);
    expect(rows.rows.length).toBeGreaterThan(0);
    await expect(
      context.db.execute(
        sql`INSERT INTO audit_events (action, outcome, seq) VALUES ('test.forged', 'success', 999999)`,
      ),
    ).rejects.toThrow();
  });

  it('seals new entries into signed batches with no personal data, and checks clean', async () => {
    await record('test.second');
    const first = await sealNow();
    expect(first.batches).toBe(1);
    expect(first.entries).toBeGreaterThan(0);
    const files = (await readdir(dir)).filter((name) => name.endsWith('.json'));
    expect(files).toEqual(['audit-seal-000001.json']);
    const text = await readFile(path.join(dir, files[0]!), 'utf8');
    expect(text).not.toContain(META.ipAddress!);
    expect(text).not.toContain(META.userAgent!);
    expect(text).not.toContain('test.second');

    expect(await sealNow()).toMatchObject({ batches: 0, entries: 0 });
    await record('test.third');
    expect(await sealNow()).toMatchObject({ batches: 1, lastBatch: 2 });

    const result = await checkNow();
    expect(result.problems).toEqual([]);
    expect(result).toMatchObject({ ok: true, batches: 2 });
    const status = await seal.status();
    expect(status.status).toBe('ok');
  });

  it('leaves very recent entries for the next run', async () => {
    await record('test.recent');
    expect(await seal.seal({ dir, privateKeyPem, settleSeconds: 3600 })).toMatchObject({
      entries: 0,
    });
    expect((await sealNow()).entries).toBeGreaterThan(0);
  });

  it('detects a changed entry, and is clean again once it is put back', async () => {
    const [row] = (
      await context.db.execute(
        sql`SELECT seq, action FROM audit_events WHERE action = 'test.second'`,
      )
    ).rows as { seq: string; action: string }[];
    await tamper(sql`UPDATE audit_events SET action = 'test.changed' WHERE seq = ${row!.seq}`);
    const changed = await checkNow();
    expect(changed.ok).toBe(false);
    expect(changed.problems).toContain(
      `Entry ${row!.seq} was changed (what happened, when or by whom).`,
    );
    await tamper(sql`UPDATE audit_events SET metadata = '{"test":"other"}'::jsonb, action = 'test.second'
                     WHERE seq = ${row!.seq}`);
    expect((await checkNow()).problems).toContain(`Entry ${row!.seq} was changed (its details).`);
    await tamper(sql`UPDATE audit_events SET metadata = '{"test":"test.second"}'::jsonb
                     WHERE seq = ${row!.seq}`);
    expect((await checkNow()).ok).toBe(true);
    const runs = await context.db.select().from(auditSealRuns);
    expect(runs.some((run) => run.kind === 'check' && !run.ok)).toBe(true);
  });

  it('detects a forged or edited batch, and a check with the wrong key', async () => {
    const file = path.join(dir, 'audit-seal-000001.json');
    const original = await readFile(file, 'utf8');
    const batch = JSON.parse(original) as { entries: unknown[][] };
    batch.entries[0]![4] = '0'.repeat(64);
    await writeFile(file, JSON.stringify(batch));
    const edited = await checkNow();
    expect(edited.problems.join(' ')).toMatch(/Batch 1: its contents were changed/);
    await writeFile(file, original);
    expect((await checkNow()).ok).toBe(true);

    const wrong = await checkNow(key());
    expect(wrong.problems.join(' ')).toMatch(/sealed with a different key/);
  });

  it('allows what an organisation deletion removes', async () => {
    const organisation = await createOrganisation(context.db);
    await record('test.org.one', organisation.id);
    await record('test.org.two', organisation.id);
    await sealNow();
    // As the deletion procedure does (Task D3): mark deleted, then remove its entries.
    await context.db.transaction(async (tx) => {
      await tx.execute(
        sql`UPDATE organisations SET deleted_at = now(), status = 'archived' WHERE id = ${organisation.id}`,
      );
      await tx.execute(
        sql`SELECT set_config('app.deleting_organisation_id', ${organisation.id}, true)`,
      );
      await tx.execute(sql`DELETE FROM audit_events WHERE organisation_id = ${organisation.id}`);
    });
    const result = await checkNow();
    expect(result.problems).toEqual([]);
    expect(result.allowed.organisationDeleted).toBeGreaterThanOrEqual(2);
  });

  it('allows anonymising a person deleted by a data request (decision A1)', async () => {
    const staff = await createUser(context.db, {
      email: uniqueEmail('seal-staff'),
      superAdmin: true,
    });
    const person = await createUser(context.db, { email: uniqueEmail('seal-person') });
    await record('test.person.action', null, person.id);
    await sealNow();
    const requests = context.app.get(DataRequestsService);
    const created = await requests.create(
      {
        kind: 'deletion',
        email: person.email,
        receivedOn: '2026-11-05',
        respondBy: '2026-11-30',
        receivedVia: 'Email (fictional)',
        identityCheck: 'Called back on the number on file (fictional)',
      },
      staff.id,
      META,
    );
    await requests.deletePerson(
      created.request.id,
      person.email,
      'Asked in writing (fictional)',
      staff.id,
      META,
    );
    const result = await checkNow();
    expect(result.problems).toEqual([]);
    expect(result.allowed.anonymised).toBeGreaterThanOrEqual(1);
  });

  it('reports sealing that stopped running', async () => {
    const result = await seal.check({ dir, keyPem: privateKeyPem, maxSealAgeHours: 0 });
    expect(result.problems.join(' ')).toMatch(/sealing has stopped running/);
  });

  it('detects a deleted entry', async () => {
    const [row] = (
      await context.db.execute(sql`SELECT seq FROM audit_events WHERE action = 'test.third'`)
    ).rows as { seq: string }[];
    await tamper(sql`DELETE FROM audit_events WHERE seq = ${row!.seq}`);
    const result = await checkNow();
    expect(result.ok).toBe(false);
    expect(result.problems).toContain(`Entry ${row!.seq} is missing from the database.`);
    expect((await seal.status()).status).toBe('problem');
  });
});
