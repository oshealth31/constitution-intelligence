import { NotFoundException } from '@nestjs/common';
import { uuidSchema } from './validation';

/** Route IDs that are not valid UUIDs simply do not exist: answer 404, not 400. */
export function parseId(value: string, what: string): string {
  if (!uuidSchema.safeParse(value).success) {
    throw new NotFoundException(`${what} not found.`);
  }
  return value;
}
