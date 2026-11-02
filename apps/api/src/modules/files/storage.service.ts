import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { findWorkspaceRoot } from '@constitution/shared';
import type { AppConfig } from '../../config/config';
import { APP_CONFIG } from '../../config/config.module';
import type { TenantScope } from '../tenancy/tenant-scope';

/** Every object lives under its organisation's folder: tenants/<organisationId>/... */
export function tenantPrefix(organisationId: string): string {
  return `tenants/${organisationId}/`;
}

const SAFE_KEY = /^tenants\/[0-9a-f-]{36}\/[A-Za-z0-9/_.-]+$/;

/**
 * File storage with tenant isolation enforced on every read and write:
 * - a key must start with the caller's own tenants/<organisationId>/ folder;
 * - keys cannot contain ".." or other path tricks, and the resolved path must stay inside
 *   the storage root.
 * The database adds a second guarantee: a file record's key must match its organisation.
 */
@Injectable()
export class StorageService {
  private readonly root: string;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    const base = path.isAbsolute(config.STORAGE_LOCAL_DIR)
      ? config.STORAGE_LOCAL_DIR
      : path.join(findWorkspaceRoot() ?? process.cwd(), config.STORAGE_LOCAL_DIR);
    this.root = path.resolve(base);
  }

  async put(scope: TenantScope, key: string, content: Buffer): Promise<void> {
    const filePath = this.resolve(scope, key);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, content, { flag: 'wx' }); // never overwrite an existing object
  }

  async get(scope: TenantScope, key: string): Promise<Buffer> {
    return readFile(this.resolve(scope, key));
  }

  private resolve(scope: TenantScope, key: string): string {
    if (
      !key.startsWith(tenantPrefix(scope.organisationId)) ||
      !SAFE_KEY.test(key) ||
      key.includes('..')
    ) {
      throw new ForbiddenException('File is not available to this organisation.');
    }
    const filePath = path.resolve(this.root, key);
    if (!filePath.startsWith(this.root + path.sep)) {
      throw new ForbiddenException('File is not available to this organisation.');
    }
    return filePath;
  }
}
