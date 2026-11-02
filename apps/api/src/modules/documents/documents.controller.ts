import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Patch,
  PayloadTooLargeException,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { SECTION_KINDS } from '@constitution/db';
import type { Response } from 'express';
import { z } from 'zod';
import { parseId } from '../../common/ids';
import { requestMeta, type AppRequest } from '../../common/request-context';
import { parseInput } from '../../common/validation';
import type { AppConfig } from '../../config/config';
import { APP_CONFIG } from '../../config/config.module';
import { RequireOrgPermission, Tenant } from '../access/decorators';
import type { TenantScope } from '../tenancy/tenant-scope';
import { DocumentsService } from './documents.service';

// eslint-disable-next-line no-control-regex -- refusing control characters is the point
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const line = (max: number) =>
  z
    .string()
    .trim()
    .max(max, { error: `must be at most ${max} characters` })
    .refine((value) => !CONTROL.test(value) && !/[\r\n]/.test(value), {
      error: 'must be a single line of plain text',
    });
const optionalLine = (max: number) =>
  line(max)
    .transform((value) => (value === '' ? null : value))
    .nullable()
    .optional();
const bodyText = z
  .string()
  .max(50_000, { error: 'must be at most 50,000 characters' })
  .transform((value) => value.replace(/\r\n?/g, '\n').trim())
  .refine((value) => !CONTROL.test(value), { error: 'must not contain hidden control characters' });
const comment = z
  .string()
  .trim()
  .max(2000)
  .refine((value) => !CONTROL.test(value), { error: 'must be plain text' });

const createConstitutionSchema = z.object({ title: line(300).pipe(z.string().min(3)) });
const sectionChangeSchema = z
  .object({
    kind: z.enum(SECTION_KINDS).optional(),
    number: optionalLine(40),
    heading: optionalLine(500),
    body: bodyText.optional(),
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    error: 'Provide at least one change.',
  });
const addSectionSchema = z.object({
  afterSectionId: z.uuid().nullable(),
  kind: z.enum(SECTION_KINDS),
  number: optionalLine(40),
  heading: optionalLine(500),
  body: bodyText,
});
const submitSchema = z.object({
  confirmed: z.literal(true, {
    error: 'Please confirm that you compared the text with the original document.',
  }),
  comment: comment.optional(),
});
const approveSchema = z.object({ comment: comment.optional() });
const reasonSchema = z.object({
  comment: comment.pipe(z.string().min(5, { error: 'please explain in at least 5 characters' })),
});
const publishSchema = z.object({
  confirmed: z.literal(true, {
    error: 'Please confirm that this version should become the current constitution.',
  }),
});

/** Reads the request body as raw bytes (the uploaded file), refusing anything over `limit`. */
function readRawBody(request: AppRequest, limit: number): Promise<Buffer> {
  const tooLarge = () =>
    new PayloadTooLargeException(
      `The file is too large. The limit is ${Math.floor(limit / (1024 * 1024))} MB.`,
    );
  const declared = Number(request.headers['content-length'] ?? 0);
  if (declared > limit) {
    request.resume(); // discard what is still arriving, without keeping it
    return Promise.reject(tooLarge());
  }
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let exceeded = false;
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        exceeded = true;
        chunks.length = 0;
        if (size > limit * 2) request.destroy(); // someone is sending far more than allowed
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => (exceeded ? reject(tooLarge()) : resolve(Buffer.concat(chunks))));
    request.on('error', reject);
  });
}

/**
 * Constitution documents and versions. Base path: /api/v1/organisations/:organisationId
 *
 * Upload: POST constitutions/:constitutionId/versions with the file itself as the request body,
 * its name in the "X-File-Name" header (URL-encoded) and an optional ?label=.
 */
@Controller('organisations/:organisationId')
export class DocumentsController {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly documents: DocumentsService,
  ) {}

  @Post('constitutions')
  @RequireOrgPermission('content.edit')
  @HttpCode(HttpStatus.CREATED)
  createConstitution(@Tenant() tenant: TenantScope, @Body() body: unknown, @Req() request: AppRequest) {
    const { title } = parseInput(createConstitutionSchema, body);
    return this.documents.createConstitution(tenant, title, requestMeta(request));
  }

  @Post('constitutions/:constitutionId/versions')
  @RequireOrgPermission('content.edit')
  @HttpCode(HttpStatus.CREATED)
  async upload(
    @Tenant() tenant: TenantScope,
    @Param('constitutionId') constitutionId: string,
    @Query('label') label: string | undefined,
    @Req() request: AppRequest,
  ) {
    const id = parseId(constitutionId, 'Constitution');
    const contentType = String(request.headers['content-type'] ?? '').toLowerCase();
    if (contentType.includes('json') || contentType.includes('form')) {
      throw new BadRequestException('Send the document itself as the request body.');
    }
    const parsedLabel = parseInput(optionalLine(200), label);
    let fileName = '';
    try {
      fileName = decodeURIComponent(String(request.headers['x-file-name'] ?? ''));
    } catch {
      throw new BadRequestException('The file name could not be read.');
    }
    if (!fileName) {
      throw new BadRequestException('The file name is missing (X-File-Name header).');
    }
    const content = await readRawBody(request, this.config.DOCUMENT_MAX_BYTES);
    return this.documents.uploadVersion(
      tenant,
      id,
      { fileName, label: parsedLabel ?? null, content },
      requestMeta(request),
    );
  }

  @Get('constitutions/:constitutionId/history')
  @RequireOrgPermission('content.review')
  history(@Tenant() tenant: TenantScope, @Param('constitutionId') constitutionId: string) {
    return this.documents.constitutionHistory(tenant, parseId(constitutionId, 'Constitution'));
  }

  @Get('versions/:versionId/review')
  @RequireOrgPermission('content.review')
  review(@Tenant() tenant: TenantScope, @Param('versionId') versionId: string) {
    return this.documents.getVersion(tenant, parseId(versionId, 'Version'));
  }

  @Patch('versions/:versionId/sections/:sectionId')
  @RequireOrgPermission('content.edit')
  updateSection(
    @Tenant() tenant: TenantScope,
    @Param('versionId') versionId: string,
    @Param('sectionId') sectionId: string,
    @Body() body: unknown,
    @Req() request: AppRequest,
  ) {
    const change = parseInput(sectionChangeSchema, body);
    return this.documents.updateSection(
      tenant,
      parseId(versionId, 'Version'),
      parseId(sectionId, 'Section'),
      change,
      requestMeta(request),
    );
  }

  @Post('versions/:versionId/sections/:sectionId/resolve')
  @RequireOrgPermission('content.edit')
  @HttpCode(HttpStatus.OK)
  resolveSection(
    @Tenant() tenant: TenantScope,
    @Param('versionId') versionId: string,
    @Param('sectionId') sectionId: string,
    @Req() request: AppRequest,
  ) {
    return this.documents.resolveSection(
      tenant,
      parseId(versionId, 'Version'),
      parseId(sectionId, 'Section'),
      requestMeta(request),
    );
  }

  @Post('versions/:versionId/sections')
  @RequireOrgPermission('content.edit')
  @HttpCode(HttpStatus.CREATED)
  addSection(
    @Tenant() tenant: TenantScope,
    @Param('versionId') versionId: string,
    @Body() body: unknown,
    @Req() request: AppRequest,
  ) {
    const input = parseInput(addSectionSchema, body);
    return this.documents.addSection(tenant, parseId(versionId, 'Version'), input, requestMeta(request));
  }

  @Delete('versions/:versionId/sections/:sectionId')
  @RequireOrgPermission('content.edit')
  removeSection(
    @Tenant() tenant: TenantScope,
    @Param('versionId') versionId: string,
    @Param('sectionId') sectionId: string,
    @Req() request: AppRequest,
  ) {
    return this.documents.removeSection(
      tenant,
      parseId(versionId, 'Version'),
      parseId(sectionId, 'Section'),
      requestMeta(request),
    );
  }

  @Post('versions/:versionId/submit')
  @RequireOrgPermission('content.edit')
  @HttpCode(HttpStatus.OK)
  submit(@Tenant() tenant: TenantScope, @Param('versionId') versionId: string, @Body() body: unknown, @Req() request: AppRequest) {
    const input = parseInput(submitSchema, body);
    return this.documents.submit(tenant, parseId(versionId, 'Version'), input.comment || null, requestMeta(request));
  }

  @Post('versions/:versionId/approve')
  @RequireOrgPermission('content.approve')
  @HttpCode(HttpStatus.OK)
  approve(@Tenant() tenant: TenantScope, @Param('versionId') versionId: string, @Body() body: unknown, @Req() request: AppRequest) {
    const input = parseInput(approveSchema, body ?? {});
    return this.documents.approve(tenant, parseId(versionId, 'Version'), input.comment || null, requestMeta(request));
  }

  @Post('versions/:versionId/request-changes')
  @RequireOrgPermission('content.approve')
  @HttpCode(HttpStatus.OK)
  requestChanges(@Tenant() tenant: TenantScope, @Param('versionId') versionId: string, @Body() body: unknown, @Req() request: AppRequest) {
    const input = parseInput(reasonSchema, body);
    return this.documents.requestChanges(tenant, parseId(versionId, 'Version'), input.comment, requestMeta(request));
  }

  @Post('versions/:versionId/publish')
  @RequireOrgPermission('content.approve')
  @HttpCode(HttpStatus.OK)
  publish(@Tenant() tenant: TenantScope, @Param('versionId') versionId: string, @Body() body: unknown, @Req() request: AppRequest) {
    parseInput(publishSchema, body);
    return this.documents.publish(tenant, parseId(versionId, 'Version'), requestMeta(request));
  }

  @Post('versions/:versionId/archive')
  @RequireOrgPermission('content.approve')
  @HttpCode(HttpStatus.OK)
  archive(@Tenant() tenant: TenantScope, @Param('versionId') versionId: string, @Body() body: unknown, @Req() request: AppRequest) {
    const input = parseInput(reasonSchema, body);
    return this.documents.archive(tenant, parseId(versionId, 'Version'), input.comment, requestMeta(request));
  }

  /** The original uploaded document, always as a download (never shown inside our pages). */
  @Get('versions/:versionId/source')
  @RequireOrgPermission('constitution.read')
  async source(@Tenant() tenant: TenantScope, @Param('versionId') versionId: string, @Res() response: Response): Promise<void> {
    const { fileName, contentType, content } = await this.documents.readSource(tenant, parseId(versionId, 'Version'));
    const asciiName = fileName.replace(/[^A-Za-z0-9._ -]/g, '_');
    response
      .status(200)
      .set({
        'Content-Type': contentType,
        'Content-Length': String(content.length),
        'Content-Disposition': `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; sandbox",
      })
      .send(content);
  }
}
