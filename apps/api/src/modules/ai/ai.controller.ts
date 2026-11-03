import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Req } from '@nestjs/common';
import { z } from 'zod';
import { parseId } from '../../common/ids';
import { requestMeta, type AppRequest } from '../../common/request-context';
import { parseInput } from '../../common/validation';
import { RequireOrgPermission, Tenant } from '../access/decorators';
import type { TenantScope } from '../tenancy/tenant-scope';
import { AiService } from './ai.service';

// eslint-disable-next-line no-control-regex -- refusing control characters is the point
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

const questionSchema = z.object({
  question: z
    .string()
    .trim()
    .min(3, { error: 'please type a question' })
    .max(500, { error: 'please keep the question under 500 characters' })
    .refine((value) => !CONTROL.test(value), { error: 'must be plain text' }),
});
const previewSchema = z.object({ question: z.string().trim().min(2).max(1000) });
const feedbackSchema = z.object({
  helpful: z.boolean(),
  comment: z
    .string()
    .trim()
    .max(1000)
    .refine((value) => !CONTROL.test(value), { error: 'must be plain text' })
    .transform((value) => (value === '' ? null : value))
    .nullable()
    .optional(),
});

/** Base path: /api/v1/organisations/:organisationId/ai */
@Controller('organisations/:organisationId/ai')
export class AiController {
  constructor(private readonly ai: AiService) {}

  /** Whether answers are available, and the wording shown with every answer. */
  @Get('status')
  @RequireOrgPermission('constitution.read')
  status() {
    return this.ai.status();
  }

  /** Ask a question about the organisation's approved constitution. */
  @Post('ask')
  @RequireOrgPermission('constitution.read')
  @HttpCode(HttpStatus.OK)
  ask(@Tenant() tenant: TenantScope, @Body() body: unknown, @Req() request: AppRequest) {
    const { question } = parseInput(questionSchema, body);
    return this.ai.ask(tenant, question.replace(/\s+/g, ' '), requestMeta(request));
  }

  @Get('suggested-questions')
  @RequireOrgPermission('constitution.read')
  suggestedQuestions(@Tenant() tenant: TenantScope) {
    return this.ai.suggestedQuestions(tenant);
  }

  @Post('messages/:messageId/feedback')
  @RequireOrgPermission('constitution.read')
  @HttpCode(HttpStatus.NO_CONTENT)
  async feedback(
    @Tenant() tenant: TenantScope,
    @Param('messageId') messageId: string,
    @Body() body: unknown,
    @Req() request: AppRequest,
  ): Promise<void> {
    const { helpful, comment } = parseInput(feedbackSchema, body);
    await this.ai.giveFeedback(tenant, parseId(messageId, 'Answer'), helpful, comment ?? null, requestMeta(request));
  }

  /**
   * Shows which passages of THIS organisation's published constitution match a question
   * (keyword retrieval, for checking isolation).
   */
  @Post('retrieval-preview')
  @RequireOrgPermission('constitution.read')
  @HttpCode(HttpStatus.OK)
  retrievalPreview(@Tenant() tenant: TenantScope, @Body() body: unknown) {
    const { question } = parseInput(previewSchema, body);
    return this.ai.retrieveContext(tenant, question);
  }

  @Get('conversations')
  @RequireOrgPermission('constitution.read')
  conversations(@Tenant() tenant: TenantScope) {
    return this.ai.listConversations(tenant);
  }

  @Get('conversations/:conversationId')
  @RequireOrgPermission('constitution.read')
  conversation(@Tenant() tenant: TenantScope, @Param('conversationId') conversationId: string) {
    return this.ai.getConversation(tenant, parseId(conversationId, 'Conversation'));
  }
}
