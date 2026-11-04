import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { z } from 'zod';
import { parseId } from '../../common/ids';
import { requestMeta, type AppRequest } from '../../common/request-context';
import { parseInput } from '../../common/validation';
import { RequireFeature, RequireOrgPermission, Tenant } from '../access/decorators';
import type { TenantScope } from '../tenancy/tenant-scope';
import { APPROVED_ANSWER_DISCLAIMER, ApprovedAnswersService } from './approved-answers.service';
import { RateLimitService } from '../auth/rate-limit.service';
import { ABUSE_LIMITS, HOUR_SECONDS } from '../auth/abuse-limits';

// eslint-disable-next-line no-control-regex -- refusing control characters is the point
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const plain = (min: number, max: number, what: string) =>
  z
    .string()
    .transform((value) => value.replace(/\r\n?/g, '\n').trim())
    .pipe(
      z
        .string()
        .min(min, { error: `${what} must be at least ${min} characters` })
        .max(max, { error: `${what} must be at most ${max} characters` })
        .refine((value) => !CONTROL.test(value), { error: 'must be plain text' }),
    );
const question = plain(3, 300, 'The question').refine((value) => !value.includes('\n'), {
  error: 'The question must be a single line',
});
const answer = plain(10, 4000, 'The answer');
const clauses = z
  .array(z.string().trim().min(1).max(40))
  .min(1, { error: 'Link at least one clause' })
  .max(10, { error: 'Link at most 10 clauses' });

const createSchema = z.object({ question, answer, clauses });
const updateSchema = z
  .object({ question: question.optional(), answer: answer.optional(), clauses: clauses.optional() })
  .refine((value) => Object.values(value).some((item) => item !== undefined), {
    error: 'Nothing to change',
  });
const importSchema = z.object({
  answers: z
    .array(
      z.object({
        question,
        answer,
        clauses,
        draftedBy: z.enum(['ai', 'person']).optional(),
      }),
    )
    .min(1, { error: 'The file has no answers' })
    .max(200, { error: 'Import at most 200 answers at a time' }),
});
const approveSchema = z.object({ confirmed: z.boolean() });
const matchSchema = z.object({ question: z.string().trim().min(3).max(500) });

/** Members: approved answers. Base path: /api/v1/organisations/:organisationId/answers */
@Controller('organisations/:organisationId/answers')
@RequireFeature('approved_answers')
export class ApprovedAnswersController {
  constructor(private readonly answers: ApprovedAnswersService) {}

  @Get()
  @RequireOrgPermission('constitution.read')
  async list(@Tenant() tenant: TenantScope) {
    return {
      disclaimer: APPROVED_ANSWER_DISCLAIMER,
      answers: await this.answers.listApproved(tenant),
    };
  }

  @Get('match')
  @RequireOrgPermission('constitution.read')
  async match(@Tenant() tenant: TenantScope, @Query() query: unknown) {
    const { question: text } = parseInput(matchSchema, query);
    return {
      disclaimer: APPROVED_ANSWER_DISCLAIMER,
      answers: await this.answers.matchApproved(tenant, text.replace(/\s+/g, ' ')),
    };
  }
}

/**
 * Writing, importing and approving answers. Content reviewers, administrators and owners can
 * write and import drafts; only administrators and owners can approve or retire them.
 * Base path: /api/v1/organisations/:organisationId/manage/answers
 */
@Controller('organisations/:organisationId/manage/answers')
@RequireFeature('approved_answers')
export class ManageAnswersController {
  constructor(
    private readonly answers: ApprovedAnswersService,
    private readonly rateLimits: RateLimitService,
  ) {}

  @Get()
  @RequireOrgPermission('content.edit')
  list(@Tenant() tenant: TenantScope) {
    return this.answers.list(tenant);
  }

  @Post()
  @RequireOrgPermission('content.edit')
  create(@Tenant() tenant: TenantScope, @Body() body: unknown, @Req() request: AppRequest) {
    return this.answers.create(tenant, parseInput(createSchema, body), requestMeta(request));
  }

  @Post('import')
  @RequireOrgPermission('content.edit')
  @HttpCode(HttpStatus.OK)
  async import(@Tenant() tenant: TenantScope, @Body() body: unknown, @Req() request: AppRequest) {
    await this.rateLimits.assertWithin(
      `import:org:${tenant.organisationId}`,
      HOUR_SECONDS,
      ABUSE_LIMITS.importsPerOrganisationPerHour,
    );
    const { answers } = parseInput(importSchema, body);
    return this.answers.import(tenant, answers, requestMeta(request));
  }

  @Get(':answerId')
  @RequireOrgPermission('content.edit')
  get(@Tenant() tenant: TenantScope, @Param('answerId') answerId: string) {
    return this.answers.get(tenant, parseId(answerId, 'Answer'));
  }

  @Patch(':answerId')
  @RequireOrgPermission('content.edit')
  update(
    @Tenant() tenant: TenantScope,
    @Param('answerId') answerId: string,
    @Body() body: unknown,
    @Req() request: AppRequest,
  ) {
    return this.answers.update(
      tenant,
      parseId(answerId, 'Answer'),
      parseInput(updateSchema, body),
      requestMeta(request),
    );
  }

  @Delete(':answerId')
  @RequireOrgPermission('content.edit')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Tenant() tenant: TenantScope,
    @Param('answerId') answerId: string,
    @Req() request: AppRequest,
  ): Promise<void> {
    await this.answers.remove(tenant, parseId(answerId, 'Answer'), requestMeta(request));
  }

  @Post(':answerId/approve')
  @RequireOrgPermission('content.approve')
  @HttpCode(HttpStatus.OK)
  approve(
    @Tenant() tenant: TenantScope,
    @Param('answerId') answerId: string,
    @Body() body: unknown,
    @Req() request: AppRequest,
  ) {
    const { confirmed } = parseInput(approveSchema, body);
    return this.answers.approve(
      tenant,
      parseId(answerId, 'Answer'),
      confirmed,
      requestMeta(request),
    );
  }

  @Post(':answerId/retire')
  @RequireOrgPermission('content.approve')
  @HttpCode(HttpStatus.OK)
  retire(
    @Tenant() tenant: TenantScope,
    @Param('answerId') answerId: string,
    @Req() request: AppRequest,
  ) {
    return this.answers.retire(tenant, parseId(answerId, 'Answer'), requestMeta(request));
  }

  @Post(':answerId/restore')
  @RequireOrgPermission('content.edit')
  @HttpCode(HttpStatus.OK)
  restore(
    @Tenant() tenant: TenantScope,
    @Param('answerId') answerId: string,
    @Req() request: AppRequest,
  ) {
    return this.answers.restore(tenant, parseId(answerId, 'Answer'), requestMeta(request));
  }
}
