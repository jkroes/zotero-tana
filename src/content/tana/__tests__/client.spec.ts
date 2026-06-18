import { describe, expect, it, vi } from 'vite-plus/test';

import { TanaClient } from '../client';

function clientWithCapturedFetch() {
  const urls: string[] = [];
  const fetchFn = vi.fn(async (url: string | URL) => {
    urls.push(String(url));
    return {
      ok: true,
      status: 200,
      json: async () => [],
    } as Response;
  });
  const client = new TanaClient({
    token: 'tok',
    fetch: fetchFn as unknown as typeof fetch,
  });
  return { client, urls };
}

describe('TanaClient.search', () => {
  it('serializes the query as deepObject params (literal brackets, not JSON)', async () => {
    const { client, urls } = clientWithCapturedFetch();

    await client.search(
      { and: [{ hasType: 'P1' }, { textContains: 'Smith' }] },
      { limit: 5 },
    );

    const url = urls[0] ?? '';
    expect(url).toContain('/nodes/search?');
    expect(url).toContain('query[and][0][hasType]=P1');
    expect(url).toContain('query[and][1][textContains]=Smith');
    expect(url).toContain('limit=5');
    // not the old JSON-string form
    expect(url).not.toContain('query=');
    expect(url).not.toContain('%7B'); // no encoded "{"
  });

  it('url-encodes values while leaving brackets literal', async () => {
    const { client, urls } = clientWithCapturedFetch();

    await client.search({ and: [{ textContains: 'a b & c' }] });

    expect(urls[0]).toContain('query[and][0][textContains]=a%20b%20%26%20c');
  });
});
