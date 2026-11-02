import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { type Database } from '@constitution/db';
import {
  ROLE_LABELS,
  ROLE_PERMISSIONS,
  SLUG_PATTERN,
  type OrganisationPermission,
} from '@constitution/shared';
import { sql } from 'drizzle-orm';
import { DRIZZLE } from '../../database/database.constants';
import { ConstitutionsService } from '../constitutions/constitutions.service';
import { StorageService } from '../files/storage.service';
import { detectImageType, LOGO_TYPES } from '../organisations/branding-input';
import { OrganisationProfileService } from '../organisations/organisation-profile.service';
import type { TenantScope } from '../tenancy/tenant-scope';

export const PORTAL_NOT_FOUND = 'Portal not found.';

/** Branding colours. Always validated 6-digit hex codes (enforced by the database too). */
export interface PortalColours {
  primary: string;
  secondary: string;
  accent: string;
}

/** What anyone may see about a portal before signing in: enough to show a branded sign-in page. */
export interface PublicPortal {
  slug: string;
  name: string;
  tagline: string | null;
  colours: PortalColours;
  logoUrl: string | null;
  /** False while the organisation is suspended. */
  available: boolean;
}

export function logoUrl(slug: string, logoFileId: string | null): string | null {
  return logoFileId ? `/api/v1/portal/${slug}/logo?v=${logoFileId}` : null;
}

/**
 * Organisation portals. The public part reveals only branding (no IDs, members, content or
 * welcome message). Everything else requires a verified membership via PermissionGuard.
 */
@Injectable()
export class PortalService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly storage: StorageService,
    private readonly profile: OrganisationProfileService,
    private readonly constitutions: ConstitutionsService,
  ) {}

  async publicPortal(slug: string): Promise<PublicPortal> {
    const row = await this.findBySlug(slug);
    return {
      slug: row.slug,
      name: row.displayName ?? row.name,
      tagline: row.tagline,
      colours: { primary: row.primaryColour, secondary: row.secondaryColour, accent: row.accentColour },
      logoUrl: logoUrl(row.slug, row.logoFileId),
      available: row.status === 'active',
    };
  }

  /**
   * The logo image for a portal. Re-checks the stored bytes before serving them, so even a
   * file record that was altered by other means cannot be served as anything but an image.
   */
  async publicLogo(slug: string): Promise<{ content: Buffer; contentType: string }> {
    const row = await this.findBySlug(slug);
    if (!row.logoFileId) {
      throw new NotFoundException('This portal has no logo.');
    }
    const result = await this.db.execute(sql`
      SELECT storage_key AS "storageKey", content_type AS "contentType"
      FROM files WHERE id = ${row.logoFileId} AND organisation_id = ${row.id}
    `);
    const file = result.rows[0] as { storageKey: string; contentType: string } | undefined;
    if (!file || !(LOGO_TYPES as readonly string[]).includes(file.contentType)) {
      throw new NotFoundException('This portal has no logo.');
    }
    const content = await this.storage.getPublicAsset(row.id, file.storageKey);
    if (detectImageType(content) !== file.contentType) {
      throw new NotFoundException('This portal has no logo.');
    }
    return { content, contentType: file.contentType };
  }

  /** The signed-in portal: branding (including the welcome message), the caller's role and permissions. */
  async home(scope: TenantScope) {
    const branding = await this.profile.getBranding(scope);
    if (!branding) {
      throw new NotFoundException(PORTAL_NOT_FOUND);
    }
    const library = await this.constitutions.library(scope);
    const permissions: readonly OrganisationPermission[] = ROLE_PERMISSIONS[scope.role];
    return {
      organisation: {
        id: scope.organisationId,
        slug: branding.slug,
        name: branding.displayName ?? branding.organisationName,
        legalName: branding.organisationName,
        tagline: branding.tagline,
        welcomeMessage: branding.welcomeMessage,
        colours: {
          primary: branding.primaryColour ?? '#0B1F3A',
          secondary: branding.secondaryColour ?? '#F5EFE2',
          accent: branding.accentColour ?? '#1BA6A6',
        },
        logoUrl: logoUrl(branding.slug, branding.logoFileId),
      },
      you: { role: scope.role, roleLabel: ROLE_LABELS[scope.role], permissions },
      library: {
        constitutions: library.length,
        published: library.filter((item) => item.published !== null).length,
        firstPublished: library.find((item) => item.published !== null) ?? null,
      },
    };
  }

  private async findBySlug(slug: string) {
    const normalised = slug.toLowerCase();
    if (!SLUG_PATTERN.test(normalised)) {
      throw new NotFoundException(PORTAL_NOT_FOUND);
    }
    const result = await this.db.execute(sql`
      SELECT o.id, o.slug, o.name, o.status,
             b.display_name AS "displayName", b.tagline,
             coalesce(b.primary_colour, '#0B1F3A') AS "primaryColour",
             coalesce(b.secondary_colour, '#F5EFE2') AS "secondaryColour",
             coalesce(b.accent_colour, '#1BA6A6') AS "accentColour",
             b.logo_file_id AS "logoFileId"
      FROM organisations o
      LEFT JOIN organisation_branding b ON b.organisation_id = o.id
      WHERE o.slug = ${normalised}
    `);
    const row = result.rows[0] as
      | {
          id: string;
          slug: string;
          name: string;
          status: string;
          displayName: string | null;
          tagline: string | null;
          primaryColour: string;
          secondaryColour: string;
          accentColour: string;
          logoFileId: string | null;
        }
      | undefined;
    // Archived organisations no longer have a portal.
    if (!row || row.status === 'archived') {
      throw new NotFoundException(PORTAL_NOT_FOUND);
    }
    return row;
  }
}
