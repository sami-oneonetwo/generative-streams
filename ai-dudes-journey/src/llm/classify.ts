import { z } from 'zod';
import { config } from '../config';
import type { ChatMessage, WorldModule } from '../engine/world';
import { chatCompletion } from './openrouter';

const resultSchema = z.object({
  intent: z.string(),
  confidence: z.number().min(0).max(1),
  params: z.record(z.string(), z.unknown()).optional(),
});

export type ClassifyResult = z.infer<typeof resultSchema>;

// The classifier prompt is assembled from the world's own intent table, so a
// new world gets a working classifier by declaring intents — no prompt edits.
const promptCache = new WeakMap<WorldModule<never>, string>();

function classifierPrompt<S>(world: WorldModule<S>): string {
  const cached = promptCache.get(world as WorldModule<never>);
  if (cached) return cached;

  const lines: string[] = [
    'You classify a single livestream chat message into exactly one intent for a stream overlay game.',
    'Intents:',
  ];
  for (const intent of world.intents) {
    lines.push(`- "${intent.name}": ${intent.description}`);
    if (intent.examples.length) {
      lines.push(`  examples: ${intent.examples.map((e) => JSON.stringify(e)).join(' | ')}`);
    }
    if (intent.paramsSchema) {
      try {
        lines.push(`  params schema: ${JSON.stringify(z.toJSONSchema(intent.paramsSchema as z.ZodType))}`);
      } catch {
        // schema not convertible; classifier can still emit best-effort params
      }
    }
  }
  lines.push(
    `If the message is conversation, a question, or does not clearly match an action intent, use "${world.fallbackIntent}".`,
    'Output ONLY a JSON object: {"intent": "<name>", "confidence": <0..1>, "params": {...}}.',
    'No prose, no code fences, no explanation.',
  );
  const prompt = lines.join('\n');
  promptCache.set(world as WorldModule<never>, prompt);
  return prompt;
}

function tryParse(out: string): ClassifyResult | null {
  const match = out.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = resultSchema.safeParse(JSON.parse(match[0]));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export async function classifyMessage<S>(
  world: WorldModule<S>,
  msg: ChatMessage,
): Promise<ClassifyResult | null> {
  const system = classifierPrompt(world);
  for (let attempt = 0; attempt < 2; attempt++) {
    const out = await chatCompletion({
      model: config.FAST_MODEL,
      system,
      messages: [{ role: 'user', content: `${msg.username}: ${msg.text}` }],
      temperature: 0,
      maxTokens: 200,
      timeoutMs: 10_000,
    });
    const parsed = tryParse(out);
    if (parsed) return parsed;
  }
  return null;
}
