import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { files, users, type Database } from '@constitution/db';
import { and, eq, sql } from 'drizzle-orm';
import type { RequestMeta } from '../../common/request-context';
import { DRIZZLE } from '../../database/database.constants';
import { AuditService } from '../audit/audit.service';
import { StorageService } from '../files/storage.service';

export interface StaffFileView {
  id: string;
  originalFilename: string;
  contentType: string;
  purpose: string;
  sizeBytes: number;
  sha256: string;
  uploadedAt: string;
  uploadedBy: string | null;
  usedBy: string | null;
  downloads: number;
  lastDownloadAt: string | null;
  status: 'available' | 'quarantined' | 'removed';
  quarantinedAt: string | null;
  quarantineReason: string | null;
  quarantinedBy: string | null;
  contentRemovedAt: string | null;
}

/**
 * Staff tool: quarantine an uploaded file (suspected virus or other unsafe content).
 * - Quarantine: nobody can download or see it any more (every download path checks), and it
 *   is left out of organisation exports. The text already read from it stays readable.
 * - Release: back to normal (a false alarm).
 * - Remove: the stored content is deleted for good (only from quarantine); the record stays,
 *   because versions point at their original. Every step needs a reason and is audited.
 * Download records (file.downloaded) show who already has a copy.
 */
@Injectable()
export class FileQuarantineService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
  ) {}

  async list(organisationId: string): Promise<StaffFileView[]> {
    const result = await this.db.execute(sql`
      SELECT f.id, f.original_filename AS "originalFilename", f.content_type AS "contentType",
             f.purpose, f.size_bytes::int AS "sizeBytes", f.sha256,
             f.created_at AS "uploadedAt", up.display_name AS "uploadedBy",
             (SELECT string_agg('Version ' || v.version_number || ': ' || v.label, '; ')
                FROM constitution_versions v
                WHERE v.source_file_id = f.id AND v.organisation_id = f.organisation_id) AS "usedBy",
             (SELECT count(*)::int FROM audit_events a
                WHERE a.action = 'file.downloaded' AND a.target_id = f.id::text) AS downloads,
             (SELECT max(a.occurred_at) FROM audit_events a
                WHERE a.action = 'file.downloaded' AND a.target_id = f.id::text) AS "lastDownloadAt",
             f.quarantined_at AS "quarantinedAt", f.quarantine_reason AS "quarantineReason",
             qb.display_name AS "quarantinedBy", f.content_removed_at AS "contentRemovedAt"
      FROM files f
      LEFT JOIN users up ON up.id = f.uploaded_by_user_id
      LEFT JOIN users qb ON qb.id = f.quarantined_by_user_id
      WHERE f.organisation_id = ${organisationId}
      ORDER BY f.created_at DESC
      LIMIT 500`);
    return (result.rows as Record<string, unknown>[]).map((row) => ({
      ...(row as unknown as StaffFileView),
      status: row.contentRemovedAt ? 'removed' : row.quarantinedAt ? 'quarantined' : 'available',
    }));
  }

  /** Who downloaded the file, newest first (from the audit log). */
  async downloads(organisationId: string, fileId: string) {
    await this.find(organisationId, fileId);
    const result = await this.db.execute(sql`
      SELECT a.occurred_at AS "at", u.display_name AS "name", u.email, a.metadata->>'via' AS via
      FROM audit_events a LEFT JOIN users u ON u.id = a.actor_user_id
      WHERE a.action = 'file.downloaded' AND a.target_id = ${fileId}
        AND a.organisation_id = ${organisationId}
      ORDER BY a.occurred_at DESC LIMIT 500`);
    return result.rows;
  }

  async quarantine(
    organisationId: string,
    fileId: string,
    reason: string,
    actorUserId: string,
    meta: RequestMeta,
  ) {
    const file = await this.find(organisationId, fileId);
    if (file.quarantinedAt) throw new ConflictException('This file is already in quarantine.');
    await this.db
      .update(files)
      .set({ quarantinedAt: new Date(), quarantineReason: reason, quarantinedByUserId: actorUserId })
      .where(and(eq(files.id, fileId), eq(files.organisationId, organisationId)));
    await this.record('file.quarantined', organisationId, fileId, actorUserId, meta, {
      reason,
      fileName: file.originalFilename,
      sha256: file.sha256,
    });
    return this.list(organisationId);
  }

  async release(
    organisationId: string,
    fileId: string,
    reason: string,
    actorUserId: string,
    meta: RequestMeta,
  ) {
    const file = await this.find(organisationId, fileId);
    if (!file.quarantinedAt) throw new ConflictException('This file is not in quarantine.');
    if (file.contentRemovedAt) {
      throw new ConflictException('This file was removed and cannot be released.');
    }
    await this.db
      .update(files)
      .set({ quarantinedAt: null, quarantineReason: null, quarantinedByUserId: null })
      .where(and(eq(files.id, fileId), eq(files.organisationId, organisationId)));
    await this.record('file.released', organisationId, fileId, actorUserId, meta, { reason });
    return this.list(organisationId);
  }

  async remove(
    organisationId: string,
    fileId: string,
    reason: string,
    actorUserId: string,
    meta: RequestMeta,
  ) {
    const file = await this.find(organisationId, fileId);
    if (!file.quarantinedAt) {
      throw new ConflictException('Put the file in quarantine before removing it.');
    }
    if (file.contentRemovedAt) throw new ConflictException('This file was already removed.');
    await this.storage.removeObject(organisationId, file.storageKey);
    await this.db
      .update(files)
      .set({ contentRemovedAt: new Date() })
      .where(and(eq(files.id, fileId), eq(files.organisationId, organisationId)));
    await this.record('file.content_removed', organisationId, fileId, actorUserId, meta, {
      reason,
      sha256: file.sha256,
    });
    return this.list(organisationId);
  }

  private async find(organisationId: string, fileId: string) {
    const [file] = await this.db
      .select()
      .from(files)
      .where(and(eq(files.id, fileId), eq(files.organisationId, organisationId)))
      .limit(1);
    if (!file) throw new NotFoundException('File not found.');
    return file;
  }

  private async record(
    action: 'file.quarantined' | 'file.released' | 'file.content_removed',
    organisationId: string,
    fileId: string,
    actorUserId: string,
    meta: RequestMeta,
    metadata: Record<string, unknown>,
  ) {
    const [actor] = await this.db
      .select({ name: users.displayName, email: users.email })
      .from(users)
      .where(eq(users.id, actorUserId));
    await this.audit.record({
      action,
      outcome: 'success',
      actorUserId,
      organisationId,
      targetType: 'file',
      targetId: fileId,
      metadata: { ...metadata, by: actor ? `${actor.name} (${actor.email})` : null },
      meta,
    });
  }
}
