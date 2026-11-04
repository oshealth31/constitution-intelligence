// Staff file quarantine: a suspect file is blocked on every download path, downloads are
// recorded so staff can see who has a copy, and staff can release it or remove it for good.
import { files } from '@constitution/db';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSampleTenantContent } from '../src/dev/sample-tenant';
import { FilesService } from '../src/modules/files/files.service';
import { StorageService } from '../src/modules/files/storage.service';
import { createTenantScope } from '../src/modules/tenancy/tenant-scope';
import { TenantDatabase } from '../src/modules/tenancy/tenant-database.service';
import { makeSampleLogoPng } from '../src/dev/sample-branding';
import {
  auditEventsFor,
  createOrganisation,
  createUser,
  signIn,
  signedInMember,
  startTestApp,
  uniqueEmail,
  type TestAgent,
  type TestContext,
} from './support/test-app';
import { testDatabaseUrl } from './support/test-database';

const REASON = 'Suspected virus reported by the owner (fictional test)';

describe.runIf(Boolean(testDatabaseUrl))('file quarantine', () => {
  let context: TestContext;
  let staff: TestAgent;
  let organisationId: string;
  let slug: string;
  let owner: Awaited<ReturnType<typeof signedInMember>>;
  let member: Awaited<ReturnType<typeof signedInMember>>;
  let ids: Awaited<ReturnType<typeof createSampleTenantContent>>;

  beforeAll(async () => {
    context = await startTestApp();
    const admin = await createUser(context.db, {
      email: uniqueEmail('quarantine-staff'),
      superAdmin: true,
    });
    staff = await signIn(context, admin.email);
    const organisation = await createOrganisation(context.db);
    organisationId = organisation.id;
    slug = organisation.slug;
    owner = await signedInMember(context, organisationId, 'owner');
    member = await signedInMember(context, organisationId, 'member');
    ids = await createSampleTenantContent(
      context.db,
      context.app.get(FilesService),
      createTenantScope(organisationId, owner.user.id, 'owner'),
      { name: 'Quarantine Choir (fictional)', uniqueWord: 'kestrel' },
    );
  });
  afterAll(async () => {
    await context?.close();
  });

  const staffUrl = (rest = '') => `/api/v1/platform/organisations/${organisationId}/files${rest}`;
  const fileUrl = () => `/api/v1/organisations/${organisationId}/files/${ids.fileId}/content`;
  const sourceUrl = () =>
    `/api/v1/organisations/${organisationId}/versions/${ids.publishedVersionId}/source`;
  const listedFile = async () => {
    const response = await staff.get(staffUrl()).expect(200);
    return (response.body as { id: string; [key: string]: unknown }[]).find(
      (file) => file.id === ids.fileId,
    )!;
  };

  it('records each download, and staff see the count and who downloaded', async () => {
    await member.agent.get(sourceUrl()).buffer(true).expect(200);
    await owner.agent.get(fileUrl()).buffer(true).expect(200);
    const file = await listedFile();
    expect(file).toMatchObject({ status: 'available', downloads: 2 });
    const who = await staff.get(staffUrl(`/${ids.fileId}/downloads`)).expect(200);
    expect((who.body as { email: string }[]).map((row) => row.email).sort()).toEqual(
      [member.user.email, owner.user.email].sort(),
    );
    const events = await auditEventsFor(context.db, 'file.downloaded');
    expect(events.filter((event) => event.targetId === ids.fileId)).toHaveLength(2);
  });

  it('lets only Super Admins use the staff tool, and needs a reason', async () => {
    await owner.agent.get(staffUrl()).expect(403);
    await owner.agent
      .post(staffUrl(`/${ids.fileId}/quarantine`))
      .send({ reason: REASON })
      .expect(403);
    await staff.post(staffUrl(`/${ids.fileId}/quarantine`)).send({ reason: 'short' }).expect(400);
    await staff.post(staffUrl(`/${ids.fileId}/frobnicate`)).send({ reason: REASON }).expect(404);
  });

  it('refuses remove and release before quarantine', async () => {
    await staff.post(staffUrl(`/${ids.fileId}/remove`)).send({ reason: REASON }).expect(409);
    await staff.post(staffUrl(`/${ids.fileId}/release`)).send({ reason: REASON }).expect(409);
  });

  it('blocks every download path once quarantined, and hides the original', async () => {
    await staff.post(staffUrl(`/${ids.fileId}/quarantine`)).send({ reason: REASON }).expect(200);
    const byFile = await owner.agent.get(fileUrl()).expect(403);
    expect(byFile.body.reason).toBe('FILE_QUARANTINED');
    const bySource = await member.agent.get(sourceUrl()).expect(403);
    expect(bySource.body.reason).toBe('FILE_QUARANTINED');
    expect(await listedFile()).toMatchObject({
      status: 'quarantined',
      quarantineReason: REASON,
      downloads: 2,
    });
    const [event] = (await auditEventsFor(context.db, 'file.quarantined')).filter(
      (row) => row.targetId === ids.fileId,
    );
    expect(event?.metadata).toMatchObject({ reason: REASON });
  });

  it('never lets organisation work (the tenant role) change a quarantine', async () => {
    const tenantDb = context.app.get(TenantDatabase);
    const scope = createTenantScope(organisationId, owner.user.id, 'owner');
    await expect(
      tenantDb.run(scope, (tx) =>
        tx.execute(sql`UPDATE files SET quarantined_at = NULL, quarantine_reason = NULL
                       WHERE id = ${ids.fileId}`),
      ),
    ).rejects.toThrow();
    const [row] = await context.db.select().from(files).where(eq(files.id, ids.fileId));
    expect(row?.quarantinedAt).not.toBeNull();
  });

  it('release restores downloads', async () => {
    await staff.post(staffUrl(`/${ids.fileId}/release`)).send({ reason: REASON }).expect(200);
    await owner.agent.get(fileUrl()).buffer(true).expect(200);
    expect(await listedFile()).toMatchObject({ status: 'available', downloads: 3 });
  });

  it('remove deletes the stored content for good; it cannot be released afterwards', async () => {
    await staff.post(staffUrl(`/${ids.fileId}/quarantine`)).send({ reason: REASON }).expect(200);
    await staff.post(staffUrl(`/${ids.fileId}/remove`)).send({ reason: REASON }).expect(200);
    const [row] = await context.db.select().from(files).where(eq(files.id, ids.fileId));
    expect(row?.contentRemovedAt).not.toBeNull();
    const storage = context.app.get(StorageService);
    expect(await storage.objectExists(organisationId, row!.storageKey)).toBe(false);
    const gone = await owner.agent.get(fileUrl()).expect(410);
    expect(gone.body.reason).toBe('FILE_REMOVED');
    await member.agent.get(sourceUrl()).expect(410);
    await staff.post(staffUrl(`/${ids.fileId}/release`)).send({ reason: REASON }).expect(409);
    expect(await listedFile()).toMatchObject({ status: 'removed' });
    // The text already read from the document stays readable.
    const reader = await member.agent
      .get(`/api/v1/organisations/${organisationId}/constitutions/${ids.constitutionId}`)
      .expect(200);
    expect(JSON.stringify(reader.body)).toContain('"hasOriginal":false');
    expect(JSON.stringify(reader.body)).not.toContain('"hasOriginal":true');
  });

  it('stops serving a quarantined logo', async () => {
    const png = makeSampleLogoPng('#4A2B6B', '#D9A21B');
    const upload = await owner.agent
      .put(`/api/v1/organisations/${organisationId}/branding/logo`)
      .send({ fileName: 'logo.png', dataBase64: png.toString('base64') })
      .expect(200);
    const logoId = upload.body.logoFileId as string;
    await member.agent.get(`/api/v1/portal/${slug}/logo`).buffer(true).expect(200);
    await staff.post(staffUrl(`/${logoId}/quarantine`)).send({ reason: REASON }).expect(200);
    await member.agent.get(`/api/v1/portal/${slug}/logo`).expect(404);
  });
});
