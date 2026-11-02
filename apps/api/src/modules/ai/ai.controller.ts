import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import { parseId } from '../../common/ids';
import { parseInput } from '../../common/validation';
import { RequireOrgPermission, Tenant } from '../access/decorators';
import type { TenantScope } from '../tenancy/tenant-scope';
import { AiService } from './ai.service';

const questionSchema = z.object({
  question: z.string().trim().min(2).max(1000),
});

/** Base path: /api/v1/organisations/:organisationId/ai */
@Controller('organisations/:organisationId/ai')
export class AiController {
  constructor(private readonly ai: AiService) {}

  /**
   * Shows which passages of THIS organisation's published constitution would be given to the AI
   * for a question. Answer generation is added in the AI stage.
   */
  @Post('retrieval-preview')
  @RequireOrgPermission('constitution.read')
  @HttpCode(HttpStatus.OK)
  retrievalPreview(@Tenant() tenant: TenantScope, @Body() body: unknown) {
    const { question } = parseInput(questionSchema, body);
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
