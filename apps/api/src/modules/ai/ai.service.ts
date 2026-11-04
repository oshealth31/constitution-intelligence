import { randomBytes } from 'node:crypto';
import { HttpException, HttpStatus, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  aiCitations,
  aiConversations,
  aiFeedback,
  aiMessages,
  sections,
  usageRecords,
} from '@constitution/db';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import type { RequestMeta } from '../../common/request-context';
import type { AppConfig } from '../../config/config';
import { APP_CONFIG } from '../../config/config.module';
import { AuditService } from '../audit/audit.service';
import { RateLimitService } from '../auth/rate-limit.service';
import { SearchService, type SectionMatch } from '../constitutions/search.service';
import { TenantDatabase } from '../tenancy/tenant-database.service';
import type { TenantScope } from '../tenancy/tenant-scope';
import { buildPrompt, DISCLAIMER, UNSUPPORTED_MESSAGE, type Passage } from './ai-prompt';
import { AI_PROVIDER, AiUnavailableError, type AiProvider } from './ai-provider';
import { AiRetrievalService, questionTerms } from './ai-retrieval.service';
import { validateAnswer, type RejectionReason, type ValidCitation } from './answer-validation';

export const UNAVAILABLE_MESSAGE =
  'The question service is not available right now. Please try again later, or use Search to find the rule yourself.';

export const NO_CLAUSES_MESSAGE =
  'No matching clauses were found in the approved constitution. Try different words, or search for a word or clause number.';

export const CLAUSE_FINDER_NOTICE =
  'These are the clauses from your organisation’s approved constitution that best match your words, shown exactly as written. No AI is used. They may not fully answer your question, so please read them carefully and ask your committee if you are unsure.';

/** Clause-finder searches allowed per person per hour (it is cheap, but still protects the database). */
export const CLAUSE_FINDER_LIMIT_PER_HOUR = 120;

/** One clause found by the clause finder: the original wording, exactly as stored. */
export interface ClauseMatch {
  sectionId: string;
  refKey: string;
  kind: string;
  number: string | null;
  heading: string | null;
  reference: string | null;
  referenceLabel: string | null;
  location: string;
  text: string;
  sourcePage: number | null;
  constitutionId: string;
  constitutionTitle: string;
  versionId: string;
  versionNumber: number;
  versionLabel: string;
  publishedAt: string | null;
}

export interface ClauseFinderResponse {
  question: string;
  /** The words used to look for clauses (for highlighting). */
  terms: string[];
  results: ClauseMatch[];
  /** Fixed wording when nothing matched. */
  message: string | null;
  notice: string;
}

export type AnswerStatus = 'answered' | 'insufficient' | 'unavailable';

export interface AnswerCitation {
  sectionId: string;
  refKey: string;
  kind: string;
  number: string | null;
  heading: string | null;
  reference: string | null;
  referenceLabel: string | null;
  location: string;
  /** Exact words from the original text that support the explanation. */
  quote: string;
  /** The whole original text of the section, exactly as stored. */
  sourceText: string;
  sourcePage: number | null;
  constitutionId: string;
  constitutionTitle: string;
  versionId: string;
  versionNumber: number;
  versionLabel: string;
  publishedAt: string | null;
}

export interface AnswerResponse {
  messageId: string;
  conversationId: string;
  question: string;
  status: AnswerStatus;
  /** AI-written plain-language explanation. Only when status is "answered". */
  explanation: string | null;
  /** Fixed wording for "insufficient" and "unavailable". */
  message: string | null;
  citations: AnswerCitation[];
  disclaimer: string;
  mode: string;
}

/**
 * Question answering from the organisation's approved constitution (retrieval-augmented):
 *   1. find relevant passages (published versions of this organisation only);
 *   2. if none, answer "could not find sufficient information" without asking the AI;
 *   3. ask the AI with the passages as data (see ai-prompt.ts);
 *   4. check the reply on the server (see answer-validation.ts) before anyone sees it.
 * Logs, audit events and usage records contain counts and outcomes, never the question or answer.
 */
@Injectable()
export class AiService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(AI_PROVIDER) private readonly provider: AiProvider,
    @InjectPinoLogger(AiService.name) private readonly logger: PinoLogger,
    private readonly tenantDb: TenantDatabase,
    private readonly search: SearchService,
    private readonly retrieval: AiRetrievalService,
    private readonly audit: AuditService,
    private readonly rateLimits: RateLimitService,
  ) {}

  status(includedInPlan = true) {
    return {
      available: this.provider.available && includedInPlan,
      includedInPlan,
      mode: this.provider.name,
      disclaimer: DISCLAIMER,
      unsupportedMessage: UNSUPPORTED_MESSAGE,
      /** The no-AI "find relevant clauses" mode works whatever the AI setting. */
      clauseFinder: true,
    };
  }

  /**
   * "Find relevant clauses": the same retrieval the AI uses (published versions of this
   * organisation only), returned word for word. No AI provider is called, whatever the setting,
   * and the question is not stored: only a count goes into the usage records.
   */
  async findClauses(scope: TenantScope, question: string): Promise<ClauseFinderResponse> {
    const attempts = await this.rateLimits.hit(`clauses:user:${scope.userId}`, 3600);
    if (attempts > CLAUSE_FINDER_LIMIT_PER_HOUR) {
      throw new HttpException(
        'You have searched a lot in the last hour. Please wait a while and try again.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const passages = await this.retrieval.retrieve(scope, question);
    await this.tenantDb.run(scope, (tx) =>
      tx.insert(usageRecords).values({
        organisationId: scope.organisationId,
        metric: 'clauses.searches',
        quantity: 1,
        userId: scope.userId,
      }),
    );
    return {
      question,
      terms: questionTerms(question),
      results: passages.map(toClauseMatch),
      message: passages.length === 0 ? NO_CLAUSES_MESSAGE : null,
      notice: CLAUSE_FINDER_NOTICE,
    };
  }

  /** The constitution passages that would be given to the AI for this question. */
  async retrieveContext(scope: TenantScope, question: string): Promise<SectionMatch[]> {
    // Shares the "Find relevant clauses" budget, so it cannot be used to search without limit.
    const attempts = await this.rateLimits.hit(`clauses:user:${scope.userId}`, 3600);
    if (attempts > CLAUSE_FINDER_LIMIT_PER_HOUR) {
      throw new HttpException(
        'You have searched a lot in the last hour. Please wait a while and try again.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return this.search.search(scope, question, 8);
  }

  async ask(scope: TenantScope, question: string, meta: RequestMeta): Promise<AnswerResponse> {
    const attempts = await this.rateLimits.hit(`ai:user:${scope.userId}`, 3600);
    if (attempts > this.config.AI_MAX_QUESTIONS_PER_USER_PER_HOUR) {
      throw new HttpException(
        'You have asked a lot of questions in the last hour. Please wait a while and try again.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const started = Date.now();
    let status: AnswerStatus;
    let explanation: string | null = null;
    let citations: ValidCitation[] = [];
    let reasons: (RejectionReason | 'no_relevant_passages' | 'provider_error')[] = [];
    let tokens = { input: 0, output: 0 };
    let passages: Passage[] = [];

    if (!this.provider.available) {
      status = 'unavailable';
    } else {
      passages = await this.retrieval.retrieve(scope, question);
      if (passages.length === 0) {
        status = 'insufficient';
        reasons = ['no_relevant_passages'];
      } else {
        const boundary = randomBytes(9).toString('hex');
        const canary = `CANARY-${randomBytes(6).toString('hex')}`;
        const prompt = buildPrompt(question, passages, boundary, canary);
        try {
          const completion = await this.provider.complete({ ...prompt, maxTokens: 1200 });
          tokens = { input: completion.inputTokens, output: completion.outputTokens };
          const validated = validateAnswer(completion.text, passages, { canary, boundary });
          status = validated.status;
          explanation = validated.explanation;
          citations = validated.citations;
          reasons = validated.reasons;
        } catch (error) {
          status = 'unavailable';
          reasons = ['provider_error'];
          this.logger.warn(
            {
              provider: this.provider.name,
              reason: error instanceof AiUnavailableError ? error.reason : 'unexpected',
            },
            'AI provider call failed',
          );
        }
      }
    }

    const message =
      status === 'insufficient'
        ? UNSUPPORTED_MESSAGE
        : status === 'unavailable'
          ? UNAVAILABLE_MESSAGE
          : null;
    const stored = await this.tenantDb.run(scope, async (tx) => {
      const [conversation] = await tx
        .insert(aiConversations)
        .values({
          organisationId: scope.organisationId,
          userId: scope.userId,
          versionId: citations[0]?.passage.versionId ?? null,
          title: question.slice(0, 200),
        })
        .returning({ id: aiConversations.id });
      await tx.insert(aiMessages).values({
        organisationId: scope.organisationId,
        conversationId: conversation!.id,
        role: 'user',
        content: question,
      });
      const [answer] = await tx
        .insert(aiMessages)
        .values({
          organisationId: scope.organisationId,
          conversationId: conversation!.id,
          role: 'assistant',
          content: explanation ?? message ?? '',
          status,
        })
        .returning({ id: aiMessages.id });
      if (citations.length > 0) {
        await tx
          .insert(aiCitations)
          .values(
            citations.map((citation, position) => ({
              organisationId: scope.organisationId,
              messageId: answer!.id,
              sectionId: citation.passage.sectionId,
              quote: citation.quote.slice(0, 2000),
              position,
            })),
          )
          .onConflictDoNothing();
      }
      await tx.insert(usageRecords).values([
        {
          organisationId: scope.organisationId,
          metric: 'ai.questions',
          quantity: 1,
          userId: scope.userId,
        },
        ...(tokens.input + tokens.output > 0
          ? [
              {
                organisationId: scope.organisationId,
                metric: 'ai.tokens_in',
                quantity: tokens.input,
                userId: scope.userId,
              },
              {
                organisationId: scope.organisationId,
                metric: 'ai.tokens_out',
                quantity: tokens.output,
                userId: scope.userId,
              },
            ]
          : []),
      ]);
      return { conversationId: conversation!.id, messageId: answer!.id };
    });

    // Outcome and counts only: never the question, the answer or the passages.
    await this.audit.record({
      action: 'ai.question_answered',
      outcome: status === 'unavailable' ? 'failure' : 'success',
      actorUserId: scope.userId,
      organisationId: scope.organisationId,
      targetType: 'ai_message',
      targetId: stored.messageId,
      metadata: {
        status,
        passages: passages.length,
        citations: citations.length,
        checks: reasons.length > 0 ? [...new Set(reasons)] : null,
        provider: this.provider.name,
        latencyMs: Date.now() - started,
      },
      meta,
    });

    return {
      ...stored,
      question,
      status,
      explanation: status === 'answered' ? explanation : null,
      message,
      citations: status === 'answered' ? citations.map(toCitation) : [],
      disclaimer: DISCLAIMER,
      mode: this.provider.name,
    };
  }

  /**
   * Example questions built from the titles of the organisation's current constitution
   * (no AI involved, so they only mention topics that really are in the document).
   */
  suggestedQuestions(scope: TenantScope): Promise<string[]> {
    return this.tenantDb.run(scope, async (tx) => {
      const rows = (
        await tx.execute(sql`
          SELECT s.heading
          FROM sections s
          JOIN constitution_versions v ON v.id = s.version_id AND v.organisation_id = s.organisation_id
          WHERE s.organisation_id = ${scope.organisationId} AND v.status = 'published'
            AND s.heading IS NOT NULL AND s.kind IN ('clause', 'section')
            AND char_length(s.heading) BETWEEN 3 AND 60
          ORDER BY v.published_at DESC, s.position ASC
          LIMIT 200`)
      ).rows as { heading: string }[];
      const preferred =
        /quorum|member|meeting|vot|fee|elect|amend|financ|committee|officer|dissol|disciplin|term/i;
      const headings = [...new Set(rows.map((row) => row.heading.trim()))].filter(
        (heading) => !/^(name|definitions?|interpretation|preamble)$/i.test(heading),
      );
      const ordered = [
        ...headings.filter((heading) => preferred.test(heading)),
        ...headings.filter((heading) => !preferred.test(heading)),
      ];
      return ordered
        .slice(0, 6)
        .map((heading) => `What does the constitution say about ${heading.toLowerCase()}?`);
    });
  }

  /** "Was this helpful?" on one of the caller's own answers. The comment is optional plain text. */
  async giveFeedback(
    scope: TenantScope,
    messageId: string,
    helpful: boolean,
    comment: string | null,
    meta: RequestMeta,
  ): Promise<void> {
    await this.tenantDb.run(scope, async (tx) => {
      const [own] = await tx
        .select({ id: aiMessages.id })
        .from(aiMessages)
        .innerJoin(
          aiConversations,
          and(
            eq(aiConversations.id, aiMessages.conversationId),
            eq(aiConversations.organisationId, aiMessages.organisationId),
          ),
        )
        .where(
          and(
            eq(aiMessages.id, messageId),
            eq(aiMessages.organisationId, scope.organisationId),
            eq(aiMessages.role, 'assistant'),
            eq(aiConversations.userId, scope.userId),
          ),
        )
        .limit(1);
      if (!own) throw new NotFoundException('Answer not found.');
      await tx
        .insert(aiFeedback)
        .values({
          organisationId: scope.organisationId,
          messageId,
          userId: scope.userId,
          helpful,
          comment,
        })
        .onConflictDoUpdate({
          target: [aiFeedback.messageId, aiFeedback.userId],
          set: { helpful, comment, createdAt: new Date() },
        });
    });
    await this.audit.record({
      action: 'ai.feedback_given',
      outcome: 'success',
      actorUserId: scope.userId,
      organisationId: scope.organisationId,
      targetType: 'ai_message',
      targetId: messageId,
      metadata: { helpful, withComment: comment !== null },
      meta,
    });
  }

  /** The caller's own conversations in this organisation. */
  listConversations(scope: TenantScope) {
    return this.tenantDb.run(scope, (tx) =>
      tx
        .select({
          id: aiConversations.id,
          title: aiConversations.title,
          createdAt: aiConversations.createdAt,
        })
        .from(aiConversations)
        .where(
          and(
            eq(aiConversations.organisationId, scope.organisationId),
            eq(aiConversations.userId, scope.userId),
          ),
        )
        .orderBy(desc(aiConversations.createdAt))
        .limit(100),
    );
  }

  /** One of the caller's conversations, with messages and the sections each answer cited. */
  getConversation(scope: TenantScope, conversationId: string) {
    return this.tenantDb.run(scope, async (tx) => {
      const [conversation] = await tx
        .select()
        .from(aiConversations)
        .where(
          and(
            eq(aiConversations.id, conversationId),
            eq(aiConversations.organisationId, scope.organisationId),
            eq(aiConversations.userId, scope.userId),
          ),
        )
        .limit(1);
      if (!conversation) {
        throw new NotFoundException('Conversation not found.');
      }
      const messages = await tx
        .select({
          id: aiMessages.id,
          role: aiMessages.role,
          content: aiMessages.content,
          status: aiMessages.status,
          createdAt: aiMessages.createdAt,
        })
        .from(aiMessages)
        .where(
          and(
            eq(aiMessages.conversationId, conversation.id),
            eq(aiMessages.organisationId, scope.organisationId),
          ),
        )
        .orderBy(asc(aiMessages.createdAt));
      const messageIds = messages.map((message) => message.id);
      const citations =
        messageIds.length === 0
          ? []
          : await tx
              .select({
                messageId: aiCitations.messageId,
                sectionId: sections.id,
                refKey: sections.refKey,
                number: sections.number,
                heading: sections.heading,
                quote: aiCitations.quote,
              })
              .from(aiCitations)
              .innerJoin(
                sections,
                and(
                  eq(aiCitations.sectionId, sections.id),
                  eq(aiCitations.organisationId, sections.organisationId),
                ),
              )
              .where(
                and(
                  inArray(aiCitations.messageId, messageIds),
                  eq(aiCitations.organisationId, scope.organisationId),
                ),
              )
              .orderBy(asc(aiCitations.position));
      return {
        id: conversation.id,
        title: conversation.title,
        createdAt: conversation.createdAt,
        messages: messages.map((message) => ({
          ...message,
          citations: citations
            .filter((citation) => citation.messageId === message.id)
            .map(({ messageId: _messageId, ...citation }) => citation),
        })),
      };
    });
  }
}

function toCitation({ passage, quote }: ValidCitation): AnswerCitation {
  return {
    sectionId: passage.sectionId,
    refKey: passage.refKey,
    kind: passage.kind,
    number: passage.number,
    heading: passage.heading,
    reference: passage.reference,
    referenceLabel: passage.referenceLabel,
    location: passage.location,
    quote,
    sourceText: passage.body,
    sourcePage: passage.sourcePage,
    constitutionId: passage.constitutionId,
    constitutionTitle: passage.constitutionTitle,
    versionId: passage.versionId,
    versionNumber: passage.versionNumber,
    versionLabel: passage.versionLabel,
    publishedAt: passage.publishedAt,
  };
}

function toClauseMatch(passage: Passage): ClauseMatch {
  return {
    sectionId: passage.sectionId,
    refKey: passage.refKey,
    kind: passage.kind,
    number: passage.number,
    heading: passage.heading,
    reference: passage.reference,
    referenceLabel: passage.referenceLabel,
    location: passage.location,
    text: passage.body,
    sourcePage: passage.sourcePage,
    constitutionId: passage.constitutionId,
    constitutionTitle: passage.constitutionTitle,
    versionId: passage.versionId,
    versionNumber: passage.versionNumber,
    versionLabel: passage.versionLabel,
    publishedAt: passage.publishedAt,
  };
}
