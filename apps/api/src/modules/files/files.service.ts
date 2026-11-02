import { createHash, randomUUID } from 'node:crypto';
import { Injectable, NotFoundException } from '@nestjs/common';
import { files, type StoredFile } from '@constitution/db';
import { and, desc, eq } from 'drizzle-orm';
import { TenantDatabase } from '../tenancy/tenant-database.service';
import type { TenantScope } from '../tenancy/tenant-scope';
import { StorageService, tenantPrefix } from './storage.service';

export interface FileSummary {
  id: string;
  originalFilename: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
  createdAt: Date;
}

const summarise = (file: StoredFile): FileSummary => ({
  id: file.id,
  originalFilename: file.originalFilename,
  contentType: file.contentType,
  sizeBytes: file.sizeBytes,
  sha256: file.sha256,
  createdAt: file.createdAt,
});

/**
 * File records and contents, always within the caller's organisation.
 * Uploading through the API (with malware scanning) is added in the secure-upload stage;
 * `store` is used by trusted server code (seed data, tests, and later the upload pipeline).
 */
@Injectable()
export class FilesService {
  constructor(
    private readonly tenantDb: TenantDatabase,
    private readonly storage: StorageService,
  ) {}

  async store(
    scope: TenantScope,
    originalFilename: string,
    contentType: string,
    content: Buffer,
  ): Promise<FileSummary> {
    const id = randomUUID();
    const storageKey = `${tenantPrefix(scope.organisationId)}files/${id}`;
    await this.storage.put(scope, storageKey, content);
    const row = await this.tenantDb.run(scope, async (tx) => {
      const [created] = await tx
        .insert(files)
        .values({
          id,
          organisationId: scope.organisationId,
          storageKey,
          originalFilename,
          contentType,
          sizeBytes: content.length,
          sha256: createHash('sha256').update(content).digest('hex'),
          uploadedByUserId: scope.userId,
        })
        .returning();
      return created!;
    });
    return summarise(row);
  }

  list(scope: TenantScope): Promise<FileSummary[]> {
    return this.tenantDb.run(scope, async (tx) => {
      const rows = await tx
        .select()
        .from(files)
        .where(eq(files.organisationId, scope.organisationId))
        .orderBy(desc(files.createdAt))
        .limit(500);
      return rows.map(summarise);
    });
  }

  /** Returns the file's metadata and contents, or 404 if it is not in the caller's organisation. */
  async read(scope: TenantScope, fileId: string): Promise<{ file: FileSummary; content: Buffer }> {
    const row = await this.tenantDb.run(scope, async (tx) => {
      const [found] = await tx
        .select()
        .from(files)
        .where(and(eq(files.id, fileId), eq(files.organisationId, scope.organisationId)))
        .limit(1);
      return found;
    });
    if (!row) {
      throw new NotFoundException('File not found.');
    }
    const content = await this.storage.get(scope, row.storageKey);
    return { file: summarise(row), content };
  }
}
