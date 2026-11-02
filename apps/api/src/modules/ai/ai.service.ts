import { Injectable, NotFoundException } from '@nestjs/common';
import { aiCitations, aiConversations, aiMessages, sections } from '@constitution/db';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { SearchService, type SectionMatch } from '../constitutions/search.service';
import { TenantDatabase } from '../tenancy/tenant-database.service';
import type { TenantScope } from '../tenancy/tenant-scope';

/**
 * AI foundations. Answer generation arrives in the AI stage; the parts that decide WHICH
 * organisation's text the AI may see are built and tested now:
 * - retrieval only ever searches the caller's organisation's published sections;
 * - conversations, answers and citations are stored per organisation and per user.
 */
@Injectable()
export class AiService {
  constructor(
    private readonly tenantDb: TenantDatabase,
    private readonly search: SearchService,
  ) {}

  /** The constitution passages that would be given to the AI for this question. */
  retrieveContext(scope: TenantScope, question: string): Promise<SectionMatch[]> {
    return this.search.search(scope, question, 8);
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
              );
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
