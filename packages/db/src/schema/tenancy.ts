// Table definitions matching migrations/0002_multi_tenancy.sql (and 0003_organisation_portals.sql).
// Every table here carries organisation_id; see docs/security/tenant-isolation.md.
import {
  bigint,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { organisations, users } from './access';

const createdAt = timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();
const organisationId = () =>
  uuid('organisation_id')
    .notNull()
    .references(() => organisations.id, { onDelete: 'cascade' });

export const SUBSCRIPTION_STATUSES = [
  'trialing',
  'active',
  'past_due',
  'suspended',
  'cancelled',
] as const;
export const VERSION_STATUSES = [
  'draft',
  'in_review',
  'approved',
  'published',
  'superseded',
  'archived',
] as const;
export const SECTION_KINDS = ['part', 'chapter', 'section', 'clause', 'subclause'] as const;

export const subscriptions = pgTable('subscriptions', {
  id: uuid('id').primaryKey().defaultRandom(),
  organisationId: organisationId(),
  planCode: text('plan_code').notNull(),
  status: text('status', { enum: SUBSCRIPTION_STATUSES }).notNull(),
  currentPeriodStart: timestamp('current_period_start', { withTimezone: true })
    .notNull()
    .defaultNow(),
  currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
  createdAt,
  updatedAt,
});

export const files = pgTable('files', {
  id: uuid('id').primaryKey().defaultRandom(),
  organisationId: organisationId(),
  storageKey: text('storage_key').notNull(),
  originalFilename: text('original_filename').notNull(),
  contentType: text('content_type').notNull(),
  sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
  sha256: text('sha256').notNull(),
  uploadedByUserId: uuid('uploaded_by_user_id').references(() => users.id, {
    onDelete: 'set null',
  }),
  createdAt,
});

export const organisationBranding = pgTable('organisation_branding', {
  organisationId: uuid('organisation_id')
    .primaryKey()
    .references(() => organisations.id, { onDelete: 'cascade' }),
  displayName: text('display_name'),
  tagline: text('tagline'),
  primaryColour: text('primary_colour').notNull().default('#0B1F3A'),
  accentColour: text('accent_colour').notNull().default('#1BA6A6'),
  secondaryColour: text('secondary_colour').notNull().default('#F5EFE2'),
  welcomeMessage: text('welcome_message'),
  logoFileId: uuid('logo_file_id'),
  updatedAt,
});

export const constitutions = pgTable('constitutions', {
  id: uuid('id').primaryKey().defaultRandom(),
  organisationId: organisationId(),
  title: text('title').notNull(),
  createdAt,
  updatedAt,
});

export const constitutionVersions = pgTable('constitution_versions', {
  id: uuid('id').primaryKey().defaultRandom(),
  organisationId: organisationId(),
  constitutionId: uuid('constitution_id').notNull(),
  versionNumber: integer('version_number').notNull(),
  label: text('label').notNull(),
  status: text('status', { enum: VERSION_STATUSES }).notNull().default('draft'),
  sourceFileId: uuid('source_file_id'),
  createdByUserId: uuid('created_by_user_id').references(() => users.id, {
    onDelete: 'set null',
  }),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  createdAt,
  updatedAt,
});

export const extractedTexts = pgTable('extracted_texts', {
  id: uuid('id').primaryKey().defaultRandom(),
  organisationId: organisationId(),
  versionId: uuid('version_id').notNull(),
  fileId: uuid('file_id'),
  content: text('content').notNull(),
  extractedAt: timestamp('extracted_at', { withTimezone: true }).notNull().defaultNow(),
});

// The generated "search_vector" column is used through SQL only and is not mapped here.
export const sections = pgTable('sections', {
  id: uuid('id').primaryKey().defaultRandom(),
  organisationId: organisationId(),
  versionId: uuid('version_id').notNull(),
  parentSectionId: uuid('parent_section_id').references((): AnyPgColumn => sections.id),
  kind: text('kind', { enum: SECTION_KINDS }).notNull(),
  refKey: text('ref_key').notNull(),
  number: text('number'),
  heading: text('heading'),
  body: text('body').notNull().default(''),
  position: integer('position').notNull(),
  createdAt,
});

// The "embedding" column (pgvector) is used through SQL only and is not mapped here.
export const sectionChunks = pgTable('section_chunks', {
  id: uuid('id').primaryKey().defaultRandom(),
  organisationId: organisationId(),
  versionId: uuid('version_id').notNull(),
  sectionId: uuid('section_id').notNull(),
  content: text('content').notNull(),
  createdAt,
});

export const contentApprovals = pgTable('content_approvals', {
  id: uuid('id').primaryKey().defaultRandom(),
  organisationId: organisationId(),
  versionId: uuid('version_id').notNull(),
  reviewerUserId: uuid('reviewer_user_id').references(() => users.id, { onDelete: 'set null' }),
  decision: text('decision', { enum: ['approved', 'changes_requested'] }).notNull(),
  comment: text('comment'),
  createdAt,
});

export const aiConversations = pgTable('ai_conversations', {
  id: uuid('id').primaryKey().defaultRandom(),
  organisationId: organisationId(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  versionId: uuid('version_id'),
  title: text('title'),
  createdAt,
  updatedAt,
});

export const aiMessages = pgTable('ai_messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  organisationId: organisationId(),
  conversationId: uuid('conversation_id').notNull(),
  role: text('role', { enum: ['user', 'assistant'] }).notNull(),
  content: text('content').notNull(),
  createdAt,
});

export const aiCitations = pgTable('ai_citations', {
  id: uuid('id').primaryKey().defaultRandom(),
  organisationId: organisationId(),
  messageId: uuid('message_id').notNull(),
  sectionId: uuid('section_id').notNull(),
  createdAt,
});

export const usageRecords = pgTable('usage_records', {
  id: uuid('id').primaryKey().defaultRandom(),
  organisationId: organisationId(),
  metric: text('metric').notNull(),
  quantity: integer('quantity').notNull(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Subscription = typeof subscriptions.$inferSelect;
export type StoredFile = typeof files.$inferSelect;
export type Constitution = typeof constitutions.$inferSelect;
export type ConstitutionVersion = typeof constitutionVersions.$inferSelect;
export type Section = typeof sections.$inferSelect;
