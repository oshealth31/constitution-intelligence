import { randomUUID } from 'node:crypto';
import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
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
    const filePath = this.resolve(scope.organisationId, key);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, content, { flag: 'wx' }); // never overwrite an existing object
  }

  async get(scope: TenantScope, key: string): Promise<Buffer> {
    return readFile(this.resolve(scope.organisationId, key));
  }

  /**
   * Reads one organisation's PUBLIC branding asset (its logo) for the portal sign-in page,
   * where nobody is signed in yet. The same folder rules apply: the key must sit inside that
   * organisation's own folder. Callers must take the key from the organisation's branding record.
   */
  async getPublicAsset(organisationId: string, key: string): Promise<Buffer> {
    if (!key.startsWith(`${tenantPrefix(organisationId)}branding/`)) {
      throw new ForbiddenException('File is not available to this organisation.');
    }
    return readFile(this.resolve(organisationId, key));
  }

  /**
   * Removes one organisation's whole folder (tenants/<organisationId>/). Used only by the
   * organisation deletion procedure, after its database transaction has committed. Safe to run
   * again: a folder that is already gone is not an error.
   */
  async removeOrganisationFolder(organisationId: string): Promise<void> {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(organisationId)) {
      throw new ForbiddenException('Not an organisation id.');
    }
    const folder = path.resolve(this.root, tenantPrefix(organisationId));
    if (!folder.startsWith(this.root + path.sep)) {
      throw new ForbiddenException('Not an organisation folder.');
    }
    await rm(folder, { recursive: true, force: true });
  }

  /** Removes one stored object for good (file quarantine: "remove"). Gone already is not an error. */
  async removeObject(organisationId: string, key: string): Promise<void> {
    await rm(this.resolve(organisationId, key), { force: true });
  }

  /** Whether one stored object exists (tests). */
  async objectExists(organisationId: string, key: string): Promise<boolean> {
    try {
      await access(this.resolve(organisationId, key));
      return true;
    } catch {
      return false;
    }
  }

  /** Whether the organisation's folder still exists (tests and the deletion report). */
  async organisationFolderExists(organisationId: string): Promise<boolean> {
    try {
      await access(path.resolve(this.root, tenantPrefix(organisationId)));
      return true;
    } catch {
      return false;
    }
  }

  /** Health check: can the storage location be written to? Writes and removes a small file. */
  async checkWritable(): Promise<boolean> {
    const probe = path.join(this.root, '.health', randomUUID());
    try {
      await mkdir(path.dirname(probe), { recursive: true });
      await writeFile(probe, 'ok');
      await rm(probe, { force: true });
      return true;
    } catch {
      return false;
    }
  }

  private resolve(organisationId: string, key: string): string {
    if (
      !key.startsWith(tenantPrefix(organisationId)) ||
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
