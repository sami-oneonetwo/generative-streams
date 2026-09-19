import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chatCompletion } from '../src/llm/openrouter';
import { config } from '../src/config';

test('blueprint transport requests JSON, aborts, and rejects truncated results without retry spend', async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = config.OPENROUTER_API_KEY;
  config.OPENROUTER_API_KEY = 'fixture-not-a-real-key';
  let calls = 0;
  try {
    globalThis.fetch = async (_url, init) => {
      calls++;
      const body = JSON.parse(String(init?.body));
      assert.deepEqual(body.response_format, { type: 'json_object' });
      return new Response(JSON.stringify({ choices: [{ finish_reason: 'length', message: { content: '{' } }] }), { status: 200 });
    };
    await assert.rejects(chatCompletion({ model: 'fixture', messages: [], json: true, attempts: 1 }), /output limit/);
    assert.equal(calls, 1);
    const ac = new AbortController(); ac.abort();
    await assert.rejects(chatCompletion({ model: 'fixture', messages: [], signal: ac.signal, attempts: 1 }));
    assert.equal(calls, 1);
    globalThis.fetch = async () => { calls++; return new Response('busy', { status: 429 }); };
    await assert.rejects(chatCompletion({ model: 'fixture', messages: [], attempts: 1 }), /429/);
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
    config.OPENROUTER_API_KEY = originalKey;
  }
});
