import { describe, expect, it } from 'vitest';
import { isFormOrJson } from './upload-body';

describe('isFormOrJson', () => {
  it('refuses JSON and HTML-form bodies', () => {
    for (const type of [
      'application/json',
      'application/json; charset=utf-8',
      'application/problem+json',
      'multipart/form-data; boundary=abc',
      'application/x-www-form-urlencoded',
      'Multipart/Form-Data',
    ]) {
      expect(isFormOrJson(type), type).toBe(true);
    }
  });

  it('accepts the document types people upload', () => {
    for (const type of [
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/pdf',
      'application/octet-stream',
      'application/msword',
      '',
      undefined,
    ]) {
      expect(isFormOrJson(type), String(type)).toBe(false);
    }
  });
});
