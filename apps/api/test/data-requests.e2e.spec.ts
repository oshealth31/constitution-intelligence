// Task D11: one person's requests about their own data. Fictional people in fictional
// organisations: a copy contains everything and no secrets; a correction changes only what was
// asked; a deletion removes only that person, keeps the organisation's records without the name,
// and anonymises their audit entries (decision A1). Everyone else is unchanged.
import { auditEvents, invitations, memberships, sections, sessions, users } from '@constitution/db';
import { randomBytes } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSampleTenantContent } from '../src/dev/sample-tenant';
import { FilesService } from '../src/modules/files/files.service';
import { createTenantScope } from '../src/modules/tenancy/tenant-scope';
import {
  addMember,
  auditEventsFor,
  createOrganisation,
  createUser,
  signIn,
  signedInMember,
  startTestApp,
  TEST_PASSWORD,
  uniqueEmail,
  type TestAgent,
  type TestContext,
} from './support/test-app';
import { testDatabaseUrl } from './support/test-database';

const IDENTITY = 'Called back on the number held by the organisation (fictional test)';
const REASON = 'The person asked in writing (fictional test)';
const today = new Date().toISOString().slice(0, 10);
const later = new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10);

describe.runIf(Boolean(testDatabaseUrl))('personal data requests', () => {
  let context: TestContext;
  let staff: TestAgent;
  let staffUser: { id: string; email: string };
  let organisation: { id: string; name: string };
  let owner: Awaited<ReturnType<typeof signedInMember>>;
  let subject: { id: string; email: string; displayName: string };
  let bystander: Awaited<ReturnType<typeof signedInMember>>;
  let ids: Awaited<ReturnType<typeof createSampleTenantContent>>;

  beforeAll(async () => {
    context = await startTestApp();
    staffUser = await createUser(context.db, {
      email: uniqueEmail('dr-staff'),
      superAdmin: true,
    });
    staff = await signIn(context, staffUser.email);
    const created = await createOrganisation(context.db);
    organisation = { id: created.id, name: created.name };
    owner = await signedInMember(context, organisation.id, 'owner');
    bystander = await signedInMember(context, organisation.id, 'member');
    subject = await createUser(context.db, {
      email: uniqueEmail('dr-subject'),
      displayName: 'Thato Fictional',
    });
    await addMember(context.db, organisation.id, subject.id, 'content_reviewer');
    // The sample content is created as the subject: they upload the file, ask the AI question,
    // approve the version, and (below) edit a clause of the version that is then published.
    ids = await createSampleTenantContent(
      context.db,
      context.app.get(FilesService),
      createTenantScope(organisation.id, subject.id, 'owner'),
      {
        name: 'Data Request Choir (fictional)',
        uniqueWord: 'hornbill',
        beforePublish: async (versionId) => {
          await context.db
            .update(sections)
            .set({ editedByUserId: subject.id, editedAt: new Date() })
            .where(eq(sections.versionId, versionId));
        },
      },
    );
    // A real sign-in, so there is a session and an audit entry with an IP address and device.
    await signIn(context, subject.email);
    // An invitation sent to the subject's address by the owner.
    await context.db.insert(invitations).values({
      organisationId: organisation.id,
      email: subject.email,
      role: 'admin',
      tokenHash: randomBytes(32).toString('hex'),
      invitedByUserId: owner.user.id,
      expiresAt: new Date(Date.now() + 86_400_000),
    });
  });
  afterAll(async () => {
    await context?.close();
  });

  const api = (rest = '') => `/api/v1/platform/data-requests${rest}`;
  async function newRequest(kind: string, email: string) {
    const response = await staff
      .post(api())
      .send({
        kind,
        email,
        receivedOn: today,
        respondBy: later,
        receivedVia: 'Email from the person',
        identityCheck: IDENTITY,
      })
      .expect(201);
    return response.body.request.id as string;
  }

  it('is for Super Admins only', async () => {
    await owner.agent.get(api()).expect(403);
    await owner.agent
      .post(api())
      .send({
        kind: 'copy',
        email: subject.email,
        receivedOn: today,
        respondBy: later,
        receivedVia: 'Email',
        identityCheck: IDENTITY,
      })
      .expect(403);
  });

  it('needs the identity check and sensible dates', async () => {
    const base = {
      kind: 'copy',
      email: subject.email,
      receivedOn: today,
      respondBy: later,
      receivedVia: 'Email',
    };
    await staff
      .post(api())
      .send({ ...base, identityCheck: 'trust me' })
      .expect(400);
    await staff
      .post(api())
      .send({ ...base, respondBy: '2020-01-01', identityCheck: IDENTITY })
      .expect(400);
  });

  it('produces a copy with everything about the person and no secrets', async () => {
    const id = await newRequest('copy', subject.email);
    const created = (await auditEventsFor(context.db, 'data_request.created')).find(
      (event) => event.targetId === id,
    );
    expect(JSON.stringify(created)).not.toContain(subject.email);

    const response = await staff.get(api(`/${id}/copy`)).buffer(true).expect(200);
    expect(response.headers['content-disposition']).toMatch(/^attachment; filename="personal-data-/);
    const text = Buffer.isBuffer(response.body) ? response.body.toString() : response.text;
    const copy = JSON.parse(text);
    expect(copy.account).toMatchObject({ email: subject.email, name: 'Thato Fictional' });
    expect(copy.organisations).toEqual([
      expect.objectContaining({ organisation: organisation.name, role: 'content_reviewer' }),
    ]);
    expect(copy.signIns.length).toBeGreaterThan(0);
    expect(copy.aiConversations.length).toBeGreaterThan(0);
    expect(copy.aiConversations[0].messages.length).toBeGreaterThan(0);
    expect(copy.invitationsReceived.length).toBeGreaterThan(0);
    expect(copy.recordsNamingYou.filesUploaded.length).toBeGreaterThan(0);
    expect(copy.recordsNamingYou.clausesEditedOrChecked[0].clauses).toBeGreaterThan(0);
    expect(copy.activityLog.some((entry: { byYou: boolean }) => entry.byYou)).toBe(true);

    // No password, secret or token, in any form.
    const [row] = await context.db.select().from(users).where(eq(users.id, subject.id));
    expect(text).not.toContain(row!.passwordHash!);
    expect(text).not.toMatch(
      /"(passwordHash|password_hash|tokenHash|token_hash|secretCiphertext|secret_ciphertext|codeHash|code_hash)"/,
    );
    const tokenHashes = await context.db
      .select({ hash: sessions.tokenHash })
      .from(sessions)
      .where(eq(sessions.userId, subject.id));
    for (const { hash } of tokenHashes) expect(text).not.toContain(hash);
    // Other people's addresses are not in the copy.
    expect(text).not.toContain(owner.user.email);
    expect(text).not.toContain(staffUser.email);

    const downloads = await auditEventsFor(context.db, 'data_request.copy_downloaded');
    expect(downloads.some((event) => event.targetId === id)).toBe(true);

    await staff.post(api(`/${id}/complete`)).send({ note: 'Sent by encrypted email' }).expect(200);
    const done = await staff.get(api(`/${id}`)).expect(200);
    expect(done.body.request).toMatchObject({ status: 'completed' });
    await staff.post(api(`/${id}/complete`)).send({ note: 'Again' }).expect(409);
  });

  it('corrects the name only on a correction request', async () => {
    const copyId = await newRequest('copy', subject.email);
    await staff
      .post(api(`/${copyId}/correct`))
      .send({ displayName: 'Not Allowed', reason: REASON })
      .expect(409);
    const id = await newRequest('correction', subject.email);
    await staff
      .post(api(`/${id}/correct`))
      .send({ displayName: 'Thato M. Fictional', reason: REASON })
      .expect(200);
    const [row] = await context.db.select().from(users).where(eq(users.id, subject.id));
    expect(row).toMatchObject({ displayName: 'Thato M. Fictional', email: subject.email });
    subject.displayName = 'Thato M. Fictional';
    await staff.post(api(`/${copyId}/cancel`)).send({ reason: REASON }).expect(200);
  });

  it('refuses to delete a Super Admin or the only Owner of an active organisation', async () => {
    const adminRequest = await newRequest('deletion', staffUser.email);
    const admin = await staff.get(api(`/${adminRequest}`)).expect(200);
    expect(admin.body.subject.deletionBlockers.join(' ')).toMatch(/Super Admin/);
    await staff
      .post(api(`/${adminRequest}/delete-person`))
      .send({ confirmEmail: staffUser.email, reason: REASON })
      .expect(409);

    const ownerRequest = await newRequest('deletion', owner.user.email);
    const preview = await staff.get(api(`/${ownerRequest}`)).expect(200);
    expect(preview.body.subject.deletionBlockers.join(' ')).toMatch(/only Owner/);
    await staff
      .post(api(`/${ownerRequest}/delete-person`))
      .send({ confirmEmail: owner.user.email, reason: REASON })
      .expect(409);
    for (const id of [adminRequest, ownerRequest]) {
      await staff.post(api(`/${id}/cancel`)).send({ reason: REASON }).expect(200);
    }
  });

  it('deletes only that person, keeps the organisation’s records and anonymises the audit log', async () => {
    const bystanderBefore = {
      memberships: await context.db
        .select()
        .from(memberships)
        .where(eq(memberships.userId, bystander.user.id)),
      sessions: await context.db
        .select()
        .from(sessions)
        .where(eq(sessions.userId, bystander.user.id)),
    };
    const sectionCount = async () =>
      (
        (
          await context.db.execute(
            sql`SELECT count(*)::int AS n FROM sections WHERE version_id = ${ids.publishedVersionId}`,
          )
        ).rows[0] as { n: number }
      ).n;
    const sectionsBefore = await sectionCount();
    const actorEventsBefore = (
      (
        await context.db.execute(
          sql`SELECT count(*)::int AS n FROM audit_events WHERE actor_user_id = ${subject.id}`,
        )
      ).rows[0] as { n: number }
    ).n;
    expect(actorEventsBefore).toBeGreaterThan(0);

    const id = await newRequest('deletion', subject.email);
    await staff
      .post(api(`/${id}/delete-person`))
      .send({ confirmEmail: 'someone.else@sample.test', reason: REASON })
      .expect(400);
    const done = await staff
      .post(api(`/${id}/delete-person`))
      .send({ confirmEmail: subject.email.toUpperCase(), reason: REASON })
      .expect(200);
    expect(done.body.request).toMatchObject({ status: 'completed', subjectEmail: '[removed]' });
    expect(done.body.request.outcome).toMatchObject({ memberships: 1 });

    // The account and what was only theirs are gone.
    expect(await context.db.select().from(users).where(eq(users.id, subject.id))).toHaveLength(0);
    for (const table of ['memberships', 'sessions', 'ai_conversations', 'ai_feedback']) {
      const result = await context.db.execute(
        sql`SELECT count(*)::int AS n FROM ${sql.identifier(table)} WHERE user_id = ${subject.id}`,
      );
      expect((result.rows[0] as { n: number }).n, table).toBe(0);
    }
    const invitations = await context.db.execute(
      sql`SELECT count(*)::int AS n FROM invitations WHERE email = ${subject.email}`,
    );
    expect((invitations.rows[0] as { n: number }).n).toBe(0);

    // The published version keeps every clause, now without the name.
    expect(await sectionCount()).toBe(sectionsBefore);
    const named = await context.db.execute(
      sql`SELECT count(*)::int AS n FROM sections WHERE edited_by_user_id IS NOT NULL
            AND version_id = ${ids.publishedVersionId}`,
    );
    expect((named.rows[0] as { n: number }).n).toBe(0);

    // Audit entries stay, but nothing in them identifies the person.
    const kept = await context.db.execute(
      sql`SELECT ip_address, user_agent FROM audit_events WHERE actor_user_id = ${subject.id}`,
    );
    expect(kept.rows.length).toBe(actorEventsBefore);
    for (const row of kept.rows as { ip_address: string | null; user_agent: string | null }[]) {
      expect(row.ip_address).toBeNull();
      expect(row.user_agent).toBeNull();
    }
    const mentions = await context.db.execute(sql`
      SELECT count(*)::int AS n FROM audit_events
      WHERE lower(coalesce(target_id, '')) = ${subject.email}
         OR position(${subject.email} IN lower(metadata::text)) > 0
         OR position(${subject.displayName} IN metadata::text) > 0`);
    expect((mentions.rows[0] as { n: number }).n).toBe(0);
    const deleted = await auditEventsFor(context.db, 'data_request.person_deleted');
    expect(deleted.some((event) => event.targetId === id)).toBe(true);

    // Everyone else is unchanged.
    expect(
      await context.db.select().from(memberships).where(eq(memberships.userId, bystander.user.id)),
    ).toEqual(bystanderBefore.memberships);
    expect(
      await context.db.select().from(sessions).where(eq(sessions.userId, bystander.user.id)),
    ).toHaveLength(bystanderBefore.sessions.length);

    // They can no longer sign in.
    await request(context.app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ email: subject.email, password: TEST_PASSWORD })
      .expect(401);
  });

  it('still refuses any other change to the audit log', async () => {
    const message = await context.db
      .execute(sql`UPDATE audit_events SET ip_address = NULL WHERE ip_address IS NOT NULL`)
      .then(
        () => 'no error',
        (error: unknown) => String((error as { cause?: unknown }).cause ?? error),
      );
    expect(message).toMatch(/append-only/);
    const [event] = await context.db.select().from(auditEvents).limit(1);
    expect(event).toBeDefined();
  });
});
