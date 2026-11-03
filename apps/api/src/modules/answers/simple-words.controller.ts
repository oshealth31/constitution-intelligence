import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { z } from 'zod';
import { parseId } from '../../common/ids';
import { requestMeta, type AppRequest } from '../../common/request-context';
import { parseInput } from '../../common/validation';
import { RequireOrgPermission, Tenant } from '../access/decorators';
import type { TenantScope } from '../tenancy/tenant-scope';
import { SIMPLE_WORDS_DISCLAIMER, SimpleWordsService } from './simple-words.service';

// eslint-disable-next-line no-control-regex -- refusing control characters is the point
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const simpleText = z
  .string()
  .transform((value) => value.replace(/\r\n?/g, '\n').trim())
  .pipe(
    z
      .string()
      .min(10, { error: 'The simple words must be at least 10 characters' })
      .max(3000, { error: 'The simple words must be at most 3,000 characters' })
      .refine((value) => !CONTROL.test(value), { error: 'must be plain text' }),
  );
const saveSchema = z.object({ text: simpleText });
const approveSchema = z.object({ confirmed: z.boolean() });
const importSchema = z.object({
  items: z
    .array(
      z.object({
        clause: z.string().trim().min(1).max(40),
        text: simpleText,
        draftedBy: z.enum(['ai', 'person']).optional(),
      }),
    )
    .min(1, { error: 'The file has no items' })
    .max(500, { error: 'Import at most 500 clauses at a time' }),
});
const versionSchema = z.object({ versionId: z.string() });

/** Members: approved simple words for a published version. */
@Controller('organisations/:organisationId/simple-words')
export class SimpleWordsController {
  constructor(private readonly simple: SimpleWordsService) {}

  @Get()
  @RequireOrgPermission('constitution.read')
  async forVersion(@Tenant() tenant: TenantScope, @Query() query: unknown) {
    const { versionId } = parseInput(versionSchema, query);
    return {
      disclaimer: SIMPLE_WORDS_DISCLAIMER,
      items: await this.simple.forVersion(tenant, parseId(versionId, 'Version')),
    };
  }
}

/**
 * Writing, importing and approving simple words. Content reviewers, administrators and owners
 * write; only administrators and owners approve or withdraw.
 */
@Controller('organisations/:organisationId/manage/simple-words')
export class ManageSimpleWordsController {
  constructor(private readonly simple: SimpleWordsService) {}

  @Get()
  @RequireOrgPermission('content.edit')
  overview(@Tenant() tenant: TenantScope) {
    return this.simple.overview(tenant);
  }

  @Post('import')
  @RequireOrgPermission('content.edit')
  @HttpCode(HttpStatus.OK)
  import(@Tenant() tenant: TenantScope, @Body() body: unknown, @Req() request: AppRequest) {
    const { items } = parseInput(importSchema, body);
    return this.simple.import(tenant, items, requestMeta(request));
  }

  @Put('sections/:sectionId')
  @RequireOrgPermission('content.edit')
  save(
    @Tenant() tenant: TenantScope,
    @Param('sectionId') sectionId: string,
    @Body() body: unknown,
    @Req() request: AppRequest,
  ) {
    const { text } = parseInput(saveSchema, body);
    return this.simple.save(tenant, parseId(sectionId, 'Clause'), text, requestMeta(request));
  }

  @Delete('sections/:sectionId')
  @RequireOrgPermission('content.edit')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Tenant() tenant: TenantScope,
    @Param('sectionId') sectionId: string,
    @Req() request: AppRequest,
  ): Promise<void> {
    await this.simple.remove(tenant, parseId(sectionId, 'Clause'), requestMeta(request));
  }

  @Post('sections/:sectionId/approve')
  @RequireOrgPermission('content.approve')
  @HttpCode(HttpStatus.OK)
  approve(
    @Tenant() tenant: TenantScope,
    @Param('sectionId') sectionId: string,
    @Body() body: unknown,
    @Req() request: AppRequest,
  ) {
    const { confirmed } = parseInput(approveSchema, body);
    return this.simple.approve(
      tenant,
      parseId(sectionId, 'Clause'),
      confirmed,
      requestMeta(request),
    );
  }

  @Post('sections/:sectionId/withdraw')
  @RequireOrgPermission('content.approve')
  @HttpCode(HttpStatus.OK)
  withdraw(
    @Tenant() tenant: TenantScope,
    @Param('sectionId') sectionId: string,
    @Req() request: AppRequest,
  ) {
    return this.simple.withdraw(tenant, parseId(sectionId, 'Clause'), requestMeta(request));
  }
}
