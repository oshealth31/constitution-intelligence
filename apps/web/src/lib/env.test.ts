import { describe, expect, it } from 'vitest';
import { parsePublicEnv } from './env';

describe('parsePublicEnv', () => {
  it('uses the local API address by default', () => {
    expect(parsePublicEnv({}).NEXT_PUBLIC_API_BASE_URL).toBe('http://localhost:4000/api/v1');
  });

  it('accepts a full URL', () => {
    const env = parsePublicEnv({ NEXT_PUBLIC_API_BASE_URL: 'https://api.example.com/api/v1' });
    expect(env.NEXT_PUBLIC_API_BASE_URL).toBe('https://api.example.com/api/v1');
  });

  it('rejects a value that is not a URL', () => {
    expect(() => parsePublicEnv({ NEXT_PUBLIC_API_BASE_URL: 'not a url' })).toThrow(
      /NEXT_PUBLIC_API_BASE_URL must be a full URL/,
    );
  });
});
