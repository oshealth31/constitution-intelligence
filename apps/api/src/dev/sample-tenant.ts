// Fictional organisation content for local development and automated tests.
// Never used in production code paths.
import {
  aiCitations,
  aiConversations,
  aiMessages,
  constitutionVersions,
  constitutions,
  contentApprovals,
  extractedTexts,
  organisationBranding,
  organisations,
  sectionChunks,
  sections,
  subscriptions,
  usageRecords,
  type Database,
} from '@constitution/db';
import { eq } from 'drizzle-orm';
import type { FilesService } from '../modules/files/files.service';
import type { TenantScope } from '../modules/tenancy/tenant-scope';

export interface SampleTenantIds {
  organisationId: string;
  constitutionId: string;
  publishedVersionId: string;
  draftVersionId: string;
  quorumSectionId: string;
  draftSectionId: string;
  fileId: string;
  extractedTextId: string;
  conversationId: string;
  answerMessageId: string;
  subscriptionId: string;
}

export interface SampleTenantOptions {
  /** Organisation display name, e.g. "Riverside Netball Club (fictional)". */
  name: string;
  /** A word that appears only in this organisation's constitution (to test search isolation). */
  uniqueWord: string;
  /** Runs while the first version is still a draft, before it is approved and published. */
  beforePublish?: (versionId: string) => Promise<void>;
}

/**
 * Creates a complete, fictional set of tenant records for one organisation: branding, trial
 * subscription, a constitution with a published and a draft version, an uploaded file, extracted
 * text, sections, AI chunks, an AI conversation with a cited answer, an approval and usage.
 * Every organisation's text mentions "quorum", so search isolation can be tested.
 */
export async function createSampleTenantContent(
  db: Database,
  filesService: FilesService,
  scope: TenantScope,
  options: SampleTenantOptions,
): Promise<SampleTenantIds> {
  const organisationId = scope.organisationId;

  const [subscription] = await db
    .insert(subscriptions)
    .values({ organisationId, planCode: 'trial', status: 'trialing', billingInterval: 'none' })
    .returning({ id: subscriptions.id });
  await db
    .update(organisations)
    .set({ currentSubscriptionId: subscription!.id })
    .where(eq(organisations.id, organisationId));
  await db
    .insert(organisationBranding)
    .values({ organisationId, displayName: options.name, tagline: 'A fictional organisation' })
    .onConflictDoNothing();

  const constitutionText =
    `CONSTITUTION OF ${options.name.toUpperCase()}\n` +
    `1. Name. The organisation is called ${options.name}.\n` +
    `2. Quorum. The quorum for a general meeting is one third of members (${options.uniqueWord}).\n` +
    '3. Membership. Membership is open to anyone who supports the objectives.';

  const file = await filesService.store(
    scope,
    'constitution.txt',
    'text/plain',
    Buffer.from(constitutionText, 'utf8'),
  );

  const [constitution] = await db
    .insert(constitutions)
    .values({ organisationId, title: `Constitution of ${options.name}` })
    .returning({ id: constitutions.id });
  const [published] = await db
    .insert(constitutionVersions)
    .values({
      organisationId,
      constitutionId: constitution!.id,
      versionNumber: 1,
      label: 'Registered constitution',
      // Versions always start as drafts; this one is approved and published further down.
      status: 'draft',
      sourceFileId: file.id,
    })
    .returning({ id: constitutionVersions.id });
  const [draft] = await db
    .insert(constitutionVersions)
    .values({
      organisationId,
      constitutionId: constitution!.id,
      versionNumber: 2,
      label: 'Proposed amendment (draft)',
      status: 'draft',
    })
    .returning({ id: constitutionVersions.id });

  const [extracted] = await db
    .insert(extractedTexts)
    .values({
      organisationId,
      versionId: published!.id,
      fileId: file.id,
      content: constitutionText,
    })
    .returning({ id: extractedTexts.id });

  const inserted = await db
    .insert(sections)
    .values([
      {
        organisationId,
        versionId: published!.id,
        kind: 'clause',
        refKey: 's1',
        number: '1',
        heading: 'Name',
        body: `The organisation is called ${options.name}.`,
        position: 0,
      },
      {
        organisationId,
        versionId: published!.id,
        kind: 'clause',
        refKey: 's2',
        number: '2',
        heading: 'Quorum',
        body: `The quorum for a general meeting is one third of members (${options.uniqueWord}).`,
        position: 1,
      },
      {
        organisationId,
        versionId: published!.id,
        kind: 'clause',
        refKey: 's3',
        number: '3',
        heading: 'Membership',
        body: 'Membership is open to anyone who supports the objectives.',
        position: 2,
      },
      {
        organisationId,
        versionId: draft!.id,
        kind: 'clause',
        refKey: 's2',
        number: '2',
        heading: 'Quorum (draft)',
        body: `Draft wording: the quorum is half of members (${options.uniqueWord}draft).`,
        position: 0,
      },
    ])
    .returning({ id: sections.id, refKey: sections.refKey, versionId: sections.versionId });
  const quorum = inserted.find((s) => s.refKey === 's2' && s.versionId === published!.id)!;

  await options.beforePublish?.(published!.id);
  // The controlled workflow: draft -> in review -> approved -> published.
  for (const status of ['in_review', 'approved', 'published'] as const) {
    await db
      .update(constitutionVersions)
      .set({
        status,
        ...(status === 'published' ? { publishedAt: new Date() } : {}),
        updatedAt: new Date(),
      })
      .where(eq(constitutionVersions.id, published!.id));
  }
  const draftSection = inserted.find((s) => s.versionId === draft!.id)!;

  await db.insert(sectionChunks).values(
    inserted
      .filter((s) => s.versionId === published!.id)
      .map((s) => ({
        organisationId,
        versionId: published!.id,
        sectionId: s.id,
        content: `chunk for ${s.refKey}`,
      })),
  );

  await db.insert(contentApprovals).values({
    organisationId,
    versionId: published!.id,
    reviewerUserId: scope.userId,
    decision: 'approved',
    comment: 'Matches the registered copy.',
  });

  const [conversation] = await db
    .insert(aiConversations)
    .values({ organisationId, userId: scope.userId, versionId: published!.id, title: 'Quorum' })
    .returning({ id: aiConversations.id });
  await db.insert(aiMessages).values({
    organisationId,
    conversationId: conversation!.id,
    role: 'user',
    content: 'What is the quorum?',
  });
  const [answer] = await db
    .insert(aiMessages)
    .values({
      organisationId,
      conversationId: conversation!.id,
      role: 'assistant',
      content: 'The quorum is one third of members [s2].',
    })
    .returning({ id: aiMessages.id });
  await db
    .insert(aiCitations)
    .values({ organisationId, messageId: answer!.id, sectionId: quorum.id });

  await db.insert(usageRecords).values([
    { organisationId, metric: 'ai.questions', quantity: 3, userId: scope.userId },
    { organisationId, metric: 'storage.bytes', quantity: file.sizeBytes },
  ]);

  return {
    organisationId,
    constitutionId: constitution!.id,
    publishedVersionId: published!.id,
    draftVersionId: draft!.id,
    quorumSectionId: quorum.id,
    draftSectionId: draftSection.id,
    fileId: file.id,
    extractedTextId: extracted!.id,
    conversationId: conversation!.id,
    answerMessageId: answer!.id,
    subscriptionId: subscription!.id,
  };
}
