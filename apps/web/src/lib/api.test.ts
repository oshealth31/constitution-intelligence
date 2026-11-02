import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiFetch, describeError } from './api';

function mockFetch(status: number, body: unknown) {
  const fetchMock = vi.fn(async () => new Response(body === undefined ? null : JSON.stringify(body), { status }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('apiFetch', () => {
  it('calls the same-origin API path with the CSRF header and JSON body', async () => {
    const fetchMock = mockFetch(200, { ok: true });
    await apiFetch('/platform/organisations', { method: 'POST', body: { name: 'X' } });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/v1/platform/organisations');
    expect(init.credentials).toBe('same-origin');
    expect((init.headers as Record<string, string>)['X-Requested-With']).toBe('XMLHttpRequest');
    expect(init.body).toBe(JSON.stringify({ name: 'X' }));
  });

  it('turns API errors into ApiError with the message and details', async () => {
    mockFetch(400, {
      error: { statusCode: 400, message: 'The request is invalid.', details: ['slug: must be valid'], requestId: 'r1' },
    });
    const error = await apiFetch('/x').catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(400);
    expect(describeError(error)).toBe('The request is invalid. slug: must be valid');
  });

  it('returns undefined for 204 responses', async () => {
    mockFetch(204, undefined);
    await expect(apiFetch('/x', { method: 'POST' })).resolves.toBeUndefined();
  });

  it('gives a friendly message for network failures', () => {
    expect(describeError(new TypeError('fetch failed'))).toMatch(/check your connection/);
  });
});
