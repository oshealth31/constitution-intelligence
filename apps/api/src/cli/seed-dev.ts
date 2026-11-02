// Fills a LOCAL development database with a fictional organisation and one account per role.
//
//   pnpm seed:dev
//
// Refuses to run unless APP_ENV=local. Every run gives each account a NEW random password,
// printed once to this terminal. There is no shared or default password.
import { memberships, organisations, users, type Database } from '@constitution/db';
import { ROLE_LABELS, type OrganisationRole } from '@constitution/shared';
import { eq } from 'drizzle-orm';
import { DRIZZLE } from '../database/database.constants';
import { PasswordService } from '../modules/auth/password.service';
import { generateRandomPassword } from '../modules/auth/tokens';
import { createCliContext } from './cli-app';

const SAMPLE_ORGANISATION = { slug: 'sample-community-choir', name: 'Sample Community Choir (fictional)' };

const ACCOUNTS: { email: string; name: string; role: OrganisationRole | 'platform_super_admin' }[] = [
  { email: 'superadmin@sample.test', name: 'Sample Super Admin', role: 'platform_super_admin' },
  { email: 'owner@sample.test', name: 'Sample Owner', role: 'owner' },
  { email: 'admin@sample.test', name: 'Sample Administrator', role: 'admin' },
  { email: 'reviewer@sample.test', name: 'Sample Content Reviewer', role: 'content_reviewer' },
  { email: 'member@sample.test', name: 'Sample Member', role: 'member' },
  { email: 'auditor@sample.test', name: 'Sample Auditor', role: 'auditor' },
];

async function main(): Promise<void> {
  const { app, config } = await createCliContext();
  try {
    if (config.APP_ENV !== 'local') {
      console.error(`Refusing to seed: APP_ENV is "${config.APP_ENV}". Seeding is only allowed when APP_ENV=local.`);
      process.exitCode = 1;
      return;
    }
    const db = app.get<Database>(DRIZZLE);
    const passwords = app.get(PasswordService);

    await db
      .insert(organisations)
      .values(SAMPLE_ORGANISATION)
      .onConflictDoNothing({ target: organisations.slug });
    const [organisation] = await db
      .select()
      .from(organisations)
      .where(eq(organisations.slug, SAMPLE_ORGANISATION.slug));

    const printed: string[] = [];
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
          set: { passwordHash, passwordChangedAt: new Date(), status: 'active', isPlatformSuperAdmin: isSuperAdmin },
        })
        .returning();
      if (!isSuperAdmin) {
        await db
          .insert(memberships)
          .values({ organisationId: organisation!.id, userId: user!.id, role: account.role as OrganisationRole })
          .onConflictDoUpdate({
            target: [memberships.organisationId, memberships.userId],
            set: { role: account.role as OrganisationRole, status: 'active' },
          });
      }
      printed.push(`  ${ROLE_LABELS[account.role].padEnd(32)} ${account.email.padEnd(24)} ${password}`);
    }

    console.log(
      [
        '',
        `Fictional development data ready. Organisation: ${organisation!.name} (id ${organisation!.id})`,
        '',
        '  Role                             Email                    Password (this run only)',
        ...printed,
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
