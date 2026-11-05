import { describe, expect, it, vi } from 'vitest';
import { ApiError, apiRequest, setStoredBaseOverride, userMessageFor } from '../src/lib/api-client.js';

function mockFetch({ status = 200, body = '', headers = {} } = {}) {
  return vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k) => headers[k.toLowerCase()] || null },
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  }));
}

function envelope(data, requestId = 'req-1') {
  return { success: true, data, meta: { requestId } };
}

function errorEnvelope(code, message, requestId = 'req-9') {
  return { success: false, error: { code, message, requestId } };
}

describe('apiRequest', () => {
  it('returns data + request id on success', async () => {
    vi.stubGlobal('fetch', mockFetch({ body: envelope({ hello: 1 }), headers: { 'x-request-id': 'req-1' } }));
    const out = await apiRequest('/api/v1/health');
    expect(out.data).toEqual({ hello: 1 });
    expect(out.requestId).toBe('req-1');
  });

  it('normalizes backend error envelopes', async () => {
    vi.stubGlobal('fetch', mockFetch({ status: 404, body: errorEnvelope('EVENT_NOT_FOUND', 'nope') }));
    const err = await apiRequest('/api/v1/events/x').catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe('EVENT_NOT_FOUND');
    expect(err.status).toBe(404);
    expect(err.requestId).toBe('req-9');
  });

  it.each([400, 401, 403, 404, 409, 422, 429, 500, 502, 503, 504])('maps HTTP %i without throwing raw', async (status) => {
    vi.stubGlobal('fetch', mockFetch({ status, body: errorEnvelope('X', 'y') }));
    const err = await apiRequest('/x').catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(status);
  });

  it('rejects malformed JSON and empty success bodies', async () => {
    vi.stubGlobal('fetch', mockFetch({ body: '{oops' }));
    await expect(apiRequest('/x')).rejects.toMatchObject({ code: 'BAD_RESPONSE' });

    vi.stubGlobal('fetch', mockFetch({ body: '' }));
    await expect(apiRequest('/x')).rejects.toMatchObject({ code: 'UNKNOWN_ERROR' });
  });

  it('maps network failure and timeout distinctly', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('failed'); }));
    await expect(apiRequest('/x')).rejects.toMatchObject({ code: 'NETWORK_ERROR' });

    vi.stubGlobal('fetch', (url, opts) => new Promise((_, reject) => {
      opts.signal.addEventListener('abort', () => reject(new DOMException('x', 'TimeoutError')));
    }));
    await expect(apiRequest('/x', { timeoutMs: 20 })).rejects.toMatchObject({ code: 'REQUEST_TIMEOUT' });
  });

  it('propagates caller aborts', async () => {
    const controller = new AbortController();
    vi.stubGlobal('fetch', vi.fn(async () => {
      controller.abort();
      throw new DOMException('x', 'AbortError');
    }));
    const err = await apiRequest('/x', { signal: controller.signal }).catch((e) => e);
    expect(err.name).toBe('AbortError');
  });

  it('serializes query params and JSON bodies', async () => {
    const fetchMock = mockFetch({ body: envelope({}) });
    vi.stubGlobal('fetch', fetchMock);
    await apiRequest('/api/v1/events', { query: { q: 'a b', limit: 5, skip: undefined } });
    const url = fetchMock.mock.calls[0][0];
    expect(url).toContain('q=a+b');
    expect(url).toContain('limit=5');
    expect(url).not.toContain('skip=');
  });

  it('honors a stored base-URL override', async () => {
    setStoredBaseOverride('http://127.0.0.1:3001');
    const fetchMock = mockFetch({ body: envelope({}) });
    vi.stubGlobal('fetch', fetchMock);
    await apiRequest('/api/v1/health');
    expect(fetchMock.mock.calls[0][0]).toBe('http://127.0.0.1:3001/api/v1/health');
  });
});

describe('userMessageFor', () => {
  it('maps known codes to friendly text, keeps unknown safe', () => {
    expect(userMessageFor(new ApiError({ code: 'EVENT_NOT_FOUND', message: 'x' }))).toMatch(/could not be found/);
    expect(userMessageFor(new ApiError({ code: 'WHATEVER_NEW', message: 'Server says hi.' }))).toBe('Server says hi.');
    expect(userMessageFor(new TypeError('boom'))).toMatch(/Could not reach/);
  });
});
