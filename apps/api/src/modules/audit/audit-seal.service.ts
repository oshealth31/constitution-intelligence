import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign,
  verify,
  type KeyObject,
} from 'node:crypto';
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Inject, Injectable } from '@nestjs/common';
import { auditSealRuns, type Database } from '@constitution/db';
import { desc, eq, sql } from 'drizzle-orm';
import { DRIZZLE } from '../../database/database.constants';

/**
 * Tamper-evident audit log (Task D12).
 *
 * SEAL: new audit entries (by running number) are written into numbered batch files. A batch
 * holds, per entry, its number, id, organisation, time and two SHA-256 fingerprints: one of
 * WHAT HAPPENED (time, organisation, actor, action, outcome, target type, request) and one of
 * the PERSONAL DETAILS (IP address, device, target, details). It also holds the fingerprint of
 * the previous batch (a chain) and an Ed25519 signature. No personal data leaves the database.
 *
 * CHECK: the batches (normally the copy downloaded back from the off-site location) are
 * verified (numbering, chain, fingerprints, signatures) and compared with the database. A
 * difference is ALLOWED only when it is one the system makes itself:
 *   - entries of an organisation whose data was deleted (Task D3) are gone;
 *   - platform-level entries removed during an organisation deletion (an organisation.deleted
 *     event exists after them) are gone;
 *   - only the personal details changed, and a person was deleted after the entry (Task D11).
 * Anything else (a changed "what happened", a missing or added entry, a broken chain, a bad
 * signature, or sealing that stopped running) is a PROBLEM.
 */

export const SEAL_FORMAT = 'constitution-audit-seal/1';
const FILE_PATTERN = /^audit-seal-(\d{6,})\.json$/;

/** [seq, id, organisationId, occurredAt, whatHappened, personalDetails] */
type SealEntry = [number, string, string | null, string, string, string];

interface BatchPayload {
  format: string;
  batch: number;
  fromSeq: number;
  toSeq: number;
  count: number;
  createdAt: string;
  previousBatchHash: string;
  keyFingerprint: string;
  entries: SealEntry[];
}

interface BatchFile extends BatchPayload {
  batchHash: string;
  signature: string;
}

export interface SealResult {
  batches: number;
  entries: number;
  lastSeq: number;
  lastBatch: number;
}

export interface CheckResult {
  ok: boolean;
  batches: number;
  entriesSealed: number;
  lastSealedSeq: number;
  lastSealedAt: string | null;
  allowed: { organisationDeleted: number; platformDeleted: number; anonymised: number };
  problems: string[];
  problemCount: number;
}

const DIGESTS = sql.raw(`
  a.seq::bigint AS seq, a.id::text AS id, a.organisation_id::text AS "organisationId",
  to_char(a.occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "occurredAt",
  encode(sha256(convert_to(json_build_array(
    a.id, to_char(a.occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    a.organisation_id, a.actor_user_id, a.action, a.outcome, a.target_type, a.request_id
  )::text, 'UTF8')), 'hex') AS core,
  encode(sha256(convert_to(json_build_array(
    a.ip_address, a.user_agent, a.target_id, a.metadata
  )::text, 'UTF8')), 'hex') AS personal`);

interface DigestRow {
  seq: string | number;
  id: string;
  organisationId: string | null;
  occurredAt: string;
  core: string;
  personal: string;
}

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** Short fingerprint of a public key, printed so a person can compare it by eye. */
export function keyFingerprint(publicKey: KeyObject): string {
  return createHash('sha256')
    .update(publicKey.export({ type: 'spki', format: 'der' }))
    .digest('hex')
    .slice(0, 32);
}

export function publicKeyFrom(pem: string): KeyObject {
  return pem.includes('PRIVATE KEY')
    ? createPublicKey(createPrivateKey(pem))
    : createPublicKey(pem);
}

function payloadOf(file: BatchPayload): BatchPayload {
  // Fixed key order: the hash is taken over exactly this JSON text.
  return {
    format: file.format,
    batch: file.batch,
    fromSeq: file.fromSeq,
    toSeq: file.toSeq,
    count: file.count,
    createdAt: file.createdAt,
    previousBatchHash: file.previousBatchHash,
    keyFingerprint: file.keyFingerprint,
    entries: file.entries,
  };
}

function batchFileName(batch: number): string {
  return `audit-seal-${String(batch).padStart(6, '0')}.json`;
}

@Injectable()
export class AuditSealService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async seal(options: {
    dir: string;
    privateKeyPem: string;
    /** Entries younger than this are left for the next run (default 10 minutes). */
    settleSeconds?: number;
    maxEntriesPerBatch?: number;
  }): Promise<SealResult> {
    const privateKey = createPrivateKey(options.privateKeyPem);
    const publicKey = createPublicKey(privateKey);
    const fingerprint = keyFingerprint(publicKey);
    const settle = options.settleSeconds ?? 600;
    const limit = options.maxEntriesPerBatch ?? 50_000;
    await mkdir(options.dir, { recursive: true });

    // Continue the chain from the newest batch, after checking it was not altered.
    const existing = await this.readBatches(options.dir);
    const last = existing.at(-1) ?? null;
    if (last) {
      const problem = this.verifyBatch(last, publicKey);
      if (problem) {
        await this.recordRun('seal', false, { problem });
        throw new Error(`The newest sealed batch is not valid: ${problem}`);
      }
    }
    let afterSeq = last?.toSeq ?? 0;
    let previousHash = last?.batchHash ?? 'genesis';
    let batch = last?.batch ?? 0;
    let batches = 0;
    let entries = 0;

    for (;;) {
      // Stop at the first entry that is too recent, so no number is ever skipped.
      const result = await this.db.execute(sql`
        SELECT ${DIGESTS} FROM audit_events a
        WHERE a.seq > ${afterSeq}
          AND a.seq < coalesce((
            SELECT min(b.seq) FROM audit_events b
            WHERE b.seq > ${afterSeq}
              AND b.occurred_at >= now() - make_interval(secs => ${settle}::double precision)
          ), 9223372036854775807)
        ORDER BY a.seq LIMIT ${limit}`);
      const rows = result.rows as unknown as DigestRow[];
      if (rows.length === 0) break;
      batch += 1;
      const sealEntries: SealEntry[] = rows.map((row) => [
        Number(row.seq),
        row.id,
        row.organisationId,
        row.occurredAt,
        row.core,
        row.personal,
      ]);
      const payload: BatchPayload = {
        format: SEAL_FORMAT,
        batch,
        fromSeq: sealEntries[0]![0],
        toSeq: sealEntries.at(-1)![0],
        count: sealEntries.length,
        createdAt: new Date().toISOString(),
        previousBatchHash: previousHash,
        keyFingerprint: fingerprint,
        entries: sealEntries,
      };
      const batchHash = sha256(JSON.stringify(payload));
      const signature = sign(null, Buffer.from(batchHash, 'utf8'), privateKey).toString('base64');
      const file: BatchFile = { ...payload, batchHash, signature };
      const target = path.join(options.dir, batchFileName(batch));
      const temporary = `${target}.tmp`;
      await writeFile(temporary, JSON.stringify(file) + '\n', { flag: 'wx', mode: 0o644 });
      await rename(temporary, target);
      afterSeq = payload.toSeq;
      previousHash = batchHash;
      batches += 1;
      entries += sealEntries.length;
    }

    const summary: SealResult = { batches, entries, lastSeq: afterSeq, lastBatch: batch };
    await this.recordRun('seal', true, { ...summary });
    return summary;
  }

  async check(options: {
    dir: string;
    /** Public or private key (PEM); only the public part is used. */
    keyPem: string;
    /** A problem if the newest batch is older than this (default 36 hours). */
    maxSealAgeHours?: number;
  }): Promise<CheckResult> {
    const publicKey = publicKeyFrom(options.keyPem);
    const problems: string[] = [];
    const allowed = { organisationDeleted: 0, platformDeleted: 0, anonymised: 0 };
    let batches: BatchFile[] = [];
    try {
      batches = await this.readBatches(options.dir);
    } catch (error) {
      problems.push(
        `A sealed batch file could not be read: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    // 1. The batches themselves: numbering, chain, fingerprints and signatures.
    let previousHash = 'genesis';
    let previousTo = 0;
    const sealed = new Map<number, SealEntry>();
    for (const [index, file] of batches.entries()) {
      const label = `Batch ${file.batch}`;
      if (file.batch !== index + 1) {
        problems.push(`${label}: expected batch ${index + 1} (a batch is missing or extra).`);
      }
      if (file.previousBatchHash !== previousHash) {
        problems.push(`${label}: does not follow the batch before it (chain broken).`);
      }
      const problem = this.verifyBatch(file, publicKey);
      if (problem) problems.push(`${label}: ${problem}`);
      if (file.fromSeq <= previousTo) {
        problems.push(`${label}: overlaps the batch before it.`);
      }
      for (const entry of file.entries) sealed.set(entry[0], entry);
      previousHash = file.batchHash;
      previousTo = file.toSeq;
    }
    const lastBatch = batches.at(-1) ?? null;
    if (!lastBatch) {
      problems.push('No sealed batches were found.');
    } else {
      const ageHours = (Date.now() - Date.parse(lastBatch.createdAt)) / 3_600_000;
      if (ageHours > (options.maxSealAgeHours ?? 36)) {
        problems.push(
          `The newest sealed batch is ${Math.floor(ageHours)} hours old: sealing has stopped running.`,
        );
      }
    }

    // 2. Compare with the database, page by page.
    if (lastBatch) {
      const deletedOrganisations = new Set(
        (
          (
            await this.db.execute(
              sql`SELECT id::text AS id FROM organisations WHERE deleted_at IS NOT NULL`,
            )
          ).rows as { id: string }[]
        ).map((row) => row.id),
      );
      const latest = async (action: string) =>
        (
          (
            await this.db.execute(sql`
              SELECT to_char(max(occurred_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS at
              FROM audit_events WHERE action = ${action}`)
          ).rows[0] as { at: string | null }
        ).at;
      const lastOrganisationDeletion = await latest('organisation.deleted');
      const lastPersonDeletion = await latest('data_request.person_deleted');

      const pageSize = 20_000;
      for (let from = 0; from < lastBatch.toSeq; from += pageSize) {
        const to = Math.min(from + pageSize, lastBatch.toSeq);
        const rows = (
          await this.db.execute(sql`
            SELECT ${DIGESTS} FROM audit_events a
            WHERE a.seq > ${from} AND a.seq <= ${to} ORDER BY a.seq`)
        ).rows as unknown as DigestRow[];
        const inDatabase = new Map(rows.map((row) => [Number(row.seq), row]));
        for (const row of rows) {
          if (!sealed.has(Number(row.seq))) {
            problems.push(
              `Entry ${row.seq} is in the database but in no sealed batch (added later).`,
            );
          }
        }
        for (let seq = from + 1; seq <= to; seq += 1) {
          const entry = sealed.get(seq);
          if (!entry) continue;
          const [, id, organisationId, occurredAt, core, personal] = entry;
          const row = inDatabase.get(seq);
          if (!row) {
            if (organisationId && deletedOrganisations.has(organisationId)) {
              allowed.organisationDeleted += 1;
            } else if (
              !organisationId &&
              lastOrganisationDeletion !== null &&
              lastOrganisationDeletion > occurredAt
            ) {
              allowed.platformDeleted += 1;
            } else {
              problems.push(`Entry ${seq} is missing from the database.`);
            }
            continue;
          }
          if (row.id !== id || row.core !== core) {
            problems.push(`Entry ${seq} was changed (what happened, when or by whom).`);
          } else if (row.personal !== personal) {
            if (lastPersonDeletion !== null && lastPersonDeletion > occurredAt) {
              allowed.anonymised += 1;
            } else {
              problems.push(`Entry ${seq} was changed (its details).`);
            }
          }
        }
      }
    }

    const result: CheckResult = {
      ok: problems.length === 0,
      batches: batches.length,
      entriesSealed: sealed.size,
      lastSealedSeq: lastBatch?.toSeq ?? 0,
      lastSealedAt: lastBatch?.createdAt ?? null,
      allowed,
      problems: problems.slice(0, 50),
      problemCount: problems.length,
    };
    await this.recordRun('check', result.ok, {
      batches: result.batches,
      entriesSealed: result.entriesSealed,
      lastSealedSeq: result.lastSealedSeq,
      lastSealedAt: result.lastSealedAt,
      allowed,
      problemCount: result.problemCount,
      problems: result.problems.slice(0, 20),
    });
    return result;
  }

  /** The latest seal and check, for System health. */
  async status() {
    const latest = async (kind: 'seal' | 'check') => {
      const [row] = await this.db
        .select()
        .from(auditSealRuns)
        .where(eq(auditSealRuns.kind, kind))
        .orderBy(desc(auditSealRuns.ranAt))
        .limit(1);
      return row ? { ranAt: row.ranAt.toISOString(), ok: row.ok, summary: row.summary } : null;
    };
    const seal = await latest('seal');
    const check = await latest('check');
    const stale = (run: { ranAt: string } | null) =>
      !run || Date.now() - Date.parse(run.ranAt) > 36 * 3_600_000;
    let status: 'ok' | 'problem' | 'stale' | 'not_configured';
    if (!seal && !check) status = 'not_configured';
    else if ((seal && !seal.ok) || (check && !check.ok)) status = 'problem';
    else if (stale(seal) || stale(check)) status = 'stale';
    else status = 'ok';
    return { status, lastSeal: seal, lastCheck: check };
  }

  private verifyBatch(file: BatchFile, publicKey: KeyObject): string | null {
    if (file.format !== SEAL_FORMAT) return 'unknown format.';
    if (file.keyFingerprint !== keyFingerprint(publicKey)) {
      return 'sealed with a different key.';
    }
    if (!Array.isArray(file.entries) || file.entries.length !== file.count) {
      return 'the number of entries does not match.';
    }
    let previous = file.fromSeq - 1;
    for (const entry of file.entries) {
      if (!(entry[0] > previous) || entry[0] > file.toSeq) return 'entries out of order.';
      previous = entry[0];
    }
    if (file.entries[0]?.[0] !== file.fromSeq || previous !== file.toSeq) {
      return 'the range does not match its entries.';
    }
    if (sha256(JSON.stringify(payloadOf(file))) !== file.batchHash) {
      return 'its contents were changed (fingerprint does not match).';
    }
    let signed = false;
    try {
      signed = verify(
        null,
        Buffer.from(file.batchHash, 'utf8'),
        publicKey,
        Buffer.from(file.signature, 'base64'),
      );
    } catch {
      signed = false;
    }
    return signed ? null : 'the signature is not valid.';
  }

  private async readBatches(dir: string): Promise<BatchFile[]> {
    let names: string[];
    try {
      names = await readdir(dir);
    } catch {
      return [];
    }
    const files = names
      .map((name) => ({ name, match: FILE_PATTERN.exec(name) }))
      .filter((item) => item.match)
      .sort((a, b) => Number(a.match![1]) - Number(b.match![1]));
    const batches: BatchFile[] = [];
    for (const { name } of files) {
      const parsed = JSON.parse(await readFile(path.join(dir, name), 'utf8')) as BatchFile;
      batches.push(parsed);
    }
    return batches;
  }

  private async recordRun(kind: 'seal' | 'check', ok: boolean, summary: Record<string, unknown>) {
    await this.db.insert(auditSealRuns).values({ kind, ok, summary });
  }
}
