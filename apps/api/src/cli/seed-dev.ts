// Fills a LOCAL development database with TWO fictional organisations, each with its own portal
// branding (colours, logo, welcome message), sample constitution content, and accounts per role.
//
//   pnpm seed:dev
//
// Refuses to run unless APP_ENV=local. Every run gives each account a NEW random password,
// printed once to this terminal. There is no shared or default password.
//
// Two-step sign-in: the Sample Super Admin gets a NEW authenticator key each run (printed once;
// add it to an authenticator app by hand). The Sample New Staff Member is a second Super Admin
// with two-step sign-in NOT set up, to try the setup steps; each run removes it again.
import {
  constitutions,
  memberships,
  organisationBranding,
  organisations,
  sessions,
  twoStepChallenges,
  twoStepRecoveryCodes,
  userTwoStep,
  users,
  type Database,
} from '@constitution/db';
import { ROLE_LABELS, type OrganisationRole } from '@constitution/shared';
import { eq } from 'drizzle-orm';
import { DRIZZLE } from '../database/database.constants';
import {
  SAMPLE_BRANDING,
  applySampleBranding,
  enrichSampleConstitution,
  makeSampleLogoPng,
} from '../dev/sample-branding';
import { createSampleTenantContent } from '../dev/sample-tenant';
import { OrganisationProfileService } from '../modules/organisations/organisation-profile.service';
import { PasswordService } from '../modules/auth/password.service';
import { generateRandomPassword } from '../modules/auth/tokens';
import { generateTotpSecret } from '../modules/auth/totp';
import { TwoStepCrypto, twoStepMasterKey } from '../modules/auth/two-step-crypto';
import { FilesService } from '../modules/files/files.service';
import { createTenantScope } from '../modules/tenancy/tenant-scope';
import { createCliContext } from './cli-app';

const SAMPLE_ORGANISATIONS = [
  {
    slug: 'sample-community-choir',
    name: 'Sample Community Choir (fictional)',
    uniqueWord: 'nightingale',
    variant: 'choir',
  },
  {
    slug: 'sample-netball-club',
    name: 'Sample Netball Club (fictional)',
    uniqueWord: 'kingfisher',
    variant: 'netball',
  },
] as const;

type SampleSlug = (typeof SAMPLE_ORGANISATIONS)[number]['slug'];

const ACCOUNTS: {
  email: string;
  name: string;
  role: OrganisationRole | 'platform_super_admin';
  organisation?: SampleSlug;
}[] = [
  { email: 'superadmin@sample.test', name: 'Sample Super Admin', role: 'platform_super_admin' },
  {
    email: 'newstaff@sample.test',
    name: 'Sample New Staff Member',
    role: 'platform_super_admin',
  },
  {
    email: 'owner@sample.test',
    name: 'Choir Owner',
    role: 'owner',
    organisation: 'sample-community-choir',
  },
  {
    email: 'admin@sample.test',
    name: 'Choir Administrator',
    role: 'admin',
    organisation: 'sample-community-choir',
  },
  {
    email: 'reviewer@sample.test',
    name: 'Choir Content Reviewer',
    role: 'content_reviewer',
    organisation: 'sample-community-choir',
  },
  {
    email: 'member@sample.test',
    name: 'Choir Member',
    role: 'member',
    organisation: 'sample-community-choir',
  },
  {
    email: 'auditor@sample.test',
    name: 'Choir Auditor',
    role: 'auditor',
    organisation: 'sample-community-choir',
  },
  {
    email: 'netball.owner@sample.test',
    name: 'Netball Owner',
    role: 'owner',
    organisation: 'sample-netball-club',
  },
  {
    email: 'netball.member@sample.test',
    name: 'Netball Member',
    role: 'member',
    organisation: 'sample-netball-club',
  },
];

async function main(): Promise<void> {
  const { app, config } = await createCliContext();
  try {
    if (config.APP_ENV !== 'local') {
      console.error(
        `Refusing to seed: APP_ENV is "${config.APP_ENV}". Seeding is only allowed when APP_ENV=local.`,
      );
      process.exitCode = 1;
      return;
    }
    const db = app.get<Database>(DRIZZLE);
    const passwords = app.get(PasswordService);
    const filesService = app.get(FilesService);
    const profile = app.get(OrganisationProfileService);

    const organisationIds = new Map<SampleSlug, string>();
    for (const sample of SAMPLE_ORGANISATIONS) {
      await db
        .insert(organisations)
        .values({ slug: sample.slug, name: sample.name })
        .onConflictDoNothing({ target: organisations.slug });
      const [organisation] = await db
        .select({ id: organisations.id })
        .from(organisations)
        .where(eq(organisations.slug, sample.slug));
      organisationIds.set(sample.slug, organisation!.id);
    }

    const printed: string[] = [];
    const twoStepPrinted: string[] = [];
    const twoStepCrypto = new TwoStepCrypto(twoStepMasterKey(config));
    const ownerIds = new Map<SampleSlug, string>();
    for (const account of ACCOUNTS) {
      const password = generateRandomPassword();
      const passwordHash = await passwords.hash(password);
      const isSuperAdmin = account.role === 'platform_super_admin';
      const [user] = await db
        .insert(users)
        .values({
          email: account.email,
          displayName: account.name,
          passwordHash,
          passwordChangedAt: new Date(),
          isPlatformSuperAdmin: isSuperAdmin,
        })
        .onConflictDoUpdate({
          target: users.email,
          set: {
            passwordHash,
            passwordChangedAt: new Date(),
            status: 'active',
            isPlatformSuperAdmin: isSuperAdmin,
          },
        })
        .returning();
      if (isSuperAdmin) {
        // Start from a clean two-step state every run.
        await db.delete(twoStepRecoveryCodes).where(eq(twoStepRecoveryCodes.userId, user!.id));
        await db.delete(twoStepChallenges).where(eq(twoStepChallenges.userId, user!.id));
        await db.delete(userTwoStep).where(eq(userTwoStep.userId, user!.id));
        await db.delete(sessions).where(eq(sessions.userId, user!.id));
        if (account.email === 'superadmin@sample.test') {
          const secret = generateTotpSecret();
          await db.insert(userTwoStep).values({
            userId: user!.id,
            secretCiphertext: twoStepCrypto.encryptSecret(secret, user!.id),
            enabledAt: new Date(),
          });
          twoStepPrinted.push(`  ${account.email} two-step key: ${secret}`);
        }
      }
      if (account.organisation && !isSuperAdmin) {
        const role = account.role as OrganisationRole;
        await db
          .insert(memberships)
          .values({
            organisationId: organisationIds.get(account.organisation)!,
            userId: user!.id,
            role,
          })
          .onConflictDoUpdate({
            target: [memberships.organisationId, memberships.userId],
            set: { role, status: 'active' },
          });
        if (role === 'owner') {
          ownerIds.set(account.organisation, user!.id);
        }
      }
      printed.push(
        `  ${ROLE_LABELS[account.role].padEnd(32)} ${account.email.padEnd(28)} ${password}`,
      );
    }

    // Sample constitution content, created once per organisation.
    for (const sample of SAMPLE_ORGANISATIONS) {
      const organisationId = organisationIds.get(sample.slug)!;
      const existing = await db
        .select({ id: constitutions.id })
        .from(constitutions)
        .where(eq(constitutions.organisationId, organisationId))
        .limit(1);
      if (existing.length === 0) {
        await createSampleTenantContent(
          db,
          filesService,
          createTenantScope(organisationId, ownerIds.get(sample.slug)!, 'owner'),
          {
            name: sample.name,
            uniqueWord: sample.uniqueWord,
            // Arrange the sample constitution in parts while it is still a draft.
            beforePublish: (versionId) =>
              enrichSampleConstitution(
                db,
                organisationId,
                versionId,
                sample.variant,
                sample.uniqueWord,
              ),
          },
        );
      }

      // Portal branding: different colours, logo and welcome message for each organisation.
      const branding = SAMPLE_BRANDING[sample.variant];
      await applySampleBranding(db, organisationId, branding);
      const [current] = await db
        .select({ logoFileId: organisationBranding.logoFileId })
        .from(organisationBranding)
        .where(eq(organisationBranding.organisationId, organisationId));
      if (!current?.logoFileId) {
        await profile.setLogo(
          createTenantScope(organisationId, ownerIds.get(sample.slug)!, 'owner'),
          'logo.png',
          makeSampleLogoPng(branding.primaryColour, branding.accentColour),
          { ipAddress: null, userAgent: 'seed-dev', requestId: null },
        );
      }
    }

    console.log(
      [
        '',
        'Fictional development data ready:',
        ...SAMPLE_ORGANISATIONS.map(
          (sample) =>
            `  ${sample.name.padEnd(40)} portal: /o/${sample.slug}  (id ${organisationIds.get(sample.slug)})`,
        ),
        '',
        '  Role                             Email                        Password (this run only)',
        ...printed,
        '',
        'Two-step sign-in key (add it to an authenticator app as a "setup key"; this run only):',
        ...twoStepPrinted,
        '  newstaff@sample.test has no two-step sign-in yet: sign in to try setting it up.',
        '',
        'These accounts are fictional and for local development only. Run again to get new passwords.',
        '',
      ].join('\n'),
    );
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error('Seeding failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
