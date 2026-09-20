import { config } from '../config';

export class LlmError extends Error {}

export interface ChatOpts {
  model: string;
  system?: string;
  messages: { role: 'user' | 'assistant'; content: string }[];
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  json?: boolean;
  attempts?: number;
}

const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function chatCompletion(opts: ChatOpts): Promise<string> {
  const key = config.OPENROUTER_API_KEY;
  if (!key) throw new LlmError('OPENROUTER_API_KEY not set');

  const body = JSON.stringify({
    model: opts.model,
    messages: [
      ...(opts.system ? [{ role: 'system', content: opts.system }] : []),
      ...opts.messages,
    ],
    temperature: opts.temperature ?? 0.7,
    max_tokens: opts.maxTokens ?? 300,
    ...(opts.json ? { response_format: { type: 'json_object' } } : {}),
  });

  let lastError: Error = new LlmError('no attempts made');
  const attempts = Math.max(1, Math.min(2, opts.attempts ?? 2));
  for (let attempt = 0; attempt < attempts; attempt++) {
    opts.signal?.throwIfAborted();
    if (attempt > 0) await sleep(1500);
    opts.signal?.throwIfAborted();
    const ac = new AbortController();
    // A non-finite (or non-positive) timeout means no client-side limit; Node's own
    // five-minute wait for response headers is then the only ceiling.
    const ms = opts.timeoutMs ?? 15_000;
    const timer = Number.isFinite(ms) && ms > 0 ? setTimeout(() => ac.abort(), ms) : undefined;
    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
          'X-Title': 'worldstream',
        },
        body,
        signal: opts.signal ? AbortSignal.any([ac.signal, opts.signal]) : ac.signal,
      });
      if (res.status === 429 || res.status >= 500) {
        lastError = new LlmError(`openrouter ${res.status}`);
        continue; // retryable
      }
      if (!res.ok) {
        const detail = (await res.text().catch(() => '')).slice(0, 200);
        throw new LlmError(`openrouter ${res.status}: ${detail}`);
      }
      const data = (await res.json()) as {
        choices?: { finish_reason?: string; message?: { content?: unknown } }[];
      };
      if (opts.json && data.choices?.[0]?.finish_reason === 'length') throw new LlmError('design exceeded the output limit');
      const text = data.choices?.[0]?.message?.content;
      if (typeof text !== 'string' || !text.trim()) throw new LlmError('empty completion');
      return text;
    } catch (e) {
      opts.signal?.throwIfAborted();
      if (e instanceof LlmError && !`${e.message}`.startsWith('openrouter 429')) throw e;
      lastError = e as Error; // network error / timeout — retryable once
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError instanceof LlmError ? lastError : new LlmError(lastError.message);
}
