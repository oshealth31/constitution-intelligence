// Table definitions matching migrations/0002_multi_tenancy.sql (with 0003 and 0004 additions).
// Every table here carries organisation_id; see docs/security/tenant-isolation.md.
import {
  bigint,
  boolean,
  date,
  integer,
  jsonb,
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
export const AI_ANSWER_STATUSES = ['answered', 'insufficient', 'unavailable'] as const;
export const FILE_PURPOSES = ['constitution_source', 'branding_logo', 'other'] as const;
export const EXTRACTION_STATUSES = ['not_started', 'succeeded', 'needs_review', 'failed'] as const;
export const VERSION_EVENTS = [
  'submitted',
  'approved',
  'changes_requested',
  'published',
  'superseded',
  'archived',
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

export const SUBSCRIPTION_BILLING_INTERVALS = ['monthly', 'annual', 'none'] as const;
export const INVOICE_STATUSES = ['open', 'paid', 'void'] as const;
export const PAYMENT_RECORD_STATUSES = ['pending_verification', 'verified', 'rejected'] as const;
export const PAYMENT_RECORD_METHODS = [
  'bank_transfer',
  'mobile_money',
  'cash',
  'cheque',
  'other',
] as const;

/** Global (not organisation data): the product's plans, configured by Platform Super Admins. */
export const plans = pgTable('plans', {
  code: text('code').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  isPilot: boolean('is_pilot').notNull().default(false),
  active: boolean('active').notNull().default(true),
  currency: text('currency').notNull().default('BWP'),
  monthlyPriceMinor: integer('monthly_price_minor'),
  annualPriceMinor: integer('annual_price_minor'),
  graceDays: integer('grace_days').notNull().default(14),
  features: text('features').array().notNull().default([]),
  maxMembers: integer('max_members'),
  maxConstitutions: integer('max_constitutions'),
  maxAiQuestionsPerMonth: integer('max_ai_questions_per_month'),
  maxStorageMb: integer('max_storage_mb'),
  createdAt,
  updatedAt,
});

export const subscriptions = pgTable('subscriptions', {
  id: uuid('id').primaryKey().defaultRandom(),
  organisationId: organisationId(),
  planCode: text('plan_code').notNull(),
  status: text('status', { enum: SUBSCRIPTION_STATUSES }).notNull(),
  currentPeriodStart: timestamp('current_period_start', { withTimezone: true })
    .notNull()
    .defaultNow(),
  currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
  billingInterval: text('billing_interval', { enum: SUBSCRIPTION_BILLING_INTERVALS })
    .notNull()
    .default('monthly'),
  autoRenew: boolean('auto_renew').notNull().default(true),
  suspendedAt: timestamp('suspended_at', { withTimezone: true }),
  suspensionReason: text('suspension_reason'),
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  cancellationReason: text('cancellation_reason'),
  createdAt,
  updatedAt,
});

export const invoices = pgTable('invoices', {
  id: uuid('id').primaryKey().defaultRandom(),
  organisationId: organisationId(),
  subscriptionId: uuid('subscription_id').notNull(),
  number: text('number').notNull(),
  description: text('description').notNull(),
  periodStart: timestamp('period_start', { withTimezone: true }),
  periodEnd: timestamp('period_end', { withTimezone: true }),
  amountMinor: integer('amount_minor').notNull(),
  currency: text('currency').notNull(),
  status: text('status', { enum: INVOICE_STATUSES }).notNull().default('open'),
  issuedAt: timestamp('issued_at', { withTimezone: true }).notNull().defaultNow(),
  dueAt: timestamp('due_at', { withTimezone: true }).notNull(),
  paidAt: timestamp('paid_at', { withTimezone: true }),
  voidedAt: timestamp('voided_at', { withTimezone: true }),
  voidReason: text('void_reason'),
  createdByUserId: uuid('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
});

/** A record that someone says money was paid. Counts only once verified. No card fields. */
export const payments = pgTable('payments', {
  id: uuid('id').primaryKey().defaultRandom(),
  organisationId: organisationId(),
  invoiceId: uuid('invoice_id').notNull(),
  amountMinor: integer('amount_minor').notNull(),
  currency: text('currency').notNull(),
  method: text('method', { enum: PAYMENT_RECORD_METHODS }).notNull(),
  reference: text('reference').notNull(),
  paidOn: date('paid_on', { mode: 'string' }).notNull(),
  notes: text('notes'),
  status: text('status', { enum: PAYMENT_RECORD_STATUSES })
    .notNull()
    .default('pending_verification'),
  reportedByUserId: uuid('reported_by_user_id').references(() => users.id, {
    onDelete: 'set null',
  }),
  reportedAt: timestamp('reported_at', { withTimezone: true }).notNull().defaultNow(),
  verifiedByUserId: uuid('verified_by_user_id').references(() => users.id, {
    onDelete: 'set null',
  }),
  verifiedAt: timestamp('verified_at', { withTimezone: true }),
  verificationNote: text('verification_note'),
  rejectionReason: text('rejection_reason'),
  receiptNumber: text('receipt_number'),
});

export const subscriptionEvents = pgTable('subscription_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  organisationId: organisationId(),
  subscriptionId: uuid('subscription_id'),
  kind: text('kind').notNull(),
  summary: text('summary').notNull(),
  detail: jsonb('detail').$type<Record<string, unknown>>().notNull().default({}),
  actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
  createdAt,
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
  purpose: text('purpose', { enum: FILE_PURPOSES }).notNull().default('other'),
  // Quarantine (migration 0012): no download while set; content removed for good when set.
  quarantinedAt: timestamp('quarantined_at', { withTimezone: true }),
  quarantineReason: text('quarantine_reason'),
  quarantinedByUserId: uuid('quarantined_by_user_id'),
  contentRemovedAt: timestamp('content_removed_at', { withTimezone: true }),
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
  extractionStatus: text('extraction_status', { enum: EXTRACTION_STATUSES })
    .notNull()
    .default('not_started'),
  extractionIssues: jsonb('extraction_issues').$type<unknown[]>().notNull().default([]),
  extractionMeta: jsonb('extraction_meta').$type<Record<string, unknown>>().notNull().default({}),
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
  needsReview: boolean('needs_review').notNull().default(false),
  reviewReason: text('review_reason'),
  sourcePage: integer('source_page'),
  editedAt: timestamp('edited_at', { withTimezone: true }),
  editedByUserId: uuid('edited_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  reviewedByUserId: uuid('reviewed_by_user_id').references(() => users.id, {
    onDelete: 'set null',
  }),
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
  decision: text('decision', { enum: VERSION_EVENTS }).notNull(),
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
  status: text('status', { enum: AI_ANSWER_STATUSES }),
  createdAt,
});

export const aiCitations = pgTable('ai_citations', {
  id: uuid('id').primaryKey().defaultRandom(),
  organisationId: organisationId(),
  messageId: uuid('message_id').notNull(),
  sectionId: uuid('section_id').notNull(),
  quote: text('quote'),
  position: integer('position').notNull().default(0),
  createdAt,
});

export const aiFeedback = pgTable('ai_feedback', {
  id: uuid('id').primaryKey().defaultRandom(),
  organisationId: organisationId(),
  messageId: uuid('message_id').notNull(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  helpful: boolean('helpful').notNull(),
  comment: text('comment'),
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

export const APPROVED_ANSWER_STATUSES = ['draft', 'approved', 'needs_review', 'retired'] as const;
export const APPROVED_ANSWER_SOURCES = ['manual', 'import', 'ai'] as const;

// The generated "search_vector" column is used through SQL only and is not mapped here.
export const approvedAnswers = pgTable('approved_answers', {
  id: uuid('id').primaryKey().defaultRandom(),
  organisationId: organisationId(),
  question: text('question').notNull(),
  answer: text('answer').notNull(),
  status: text('status', { enum: APPROVED_ANSWER_STATUSES }).notNull().default('draft'),
  source: text('source', { enum: APPROVED_ANSWER_SOURCES }).notNull().default('manual'),
  reviewReason: text('review_reason'),
  createdByUserId: uuid('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  updatedByUserId: uuid('updated_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  approvedByUserId: uuid('approved_by_user_id').references(() => users.id, {
    onDelete: 'set null',
  }),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  createdAt,
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const approvedAnswerSections = pgTable('approved_answer_sections', {
  id: uuid('id').primaryKey().defaultRandom(),
  organisationId: organisationId(),
  answerId: uuid('answer_id').notNull(),
  sectionId: uuid('section_id').notNull(),
  position: integer('position').notNull().default(0),
});

export const SIMPLIFIED_STATUSES = ['draft', 'approved', 'needs_review'] as const;

export const simplifiedSections = pgTable('simplified_sections', {
  id: uuid('id').primaryKey().defaultRandom(),
  organisationId: organisationId(),
  sectionId: uuid('section_id').notNull(),
  text: text('text').notNull(),
  status: text('status', { enum: SIMPLIFIED_STATUSES }).notNull().default('draft'),
  source: text('source', { enum: APPROVED_ANSWER_SOURCES }).notNull().default('manual'),
  reviewReason: text('review_reason'),
  createdByUserId: uuid('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  updatedByUserId: uuid('updated_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  approvedByUserId: uuid('approved_by_user_id').references(() => users.id, {
    onDelete: 'set null',
  }),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  createdAt,
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Subscription = typeof subscriptions.$inferSelect;
export type StoredFile = typeof files.$inferSelect;
export type Constitution = typeof constitutions.$inferSelect;
export type ConstitutionVersion = typeof constitutionVersions.$inferSelect;
export type Section = typeof sections.$inferSelect;
