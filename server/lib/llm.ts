import Anthropic from '@anthropic-ai/sdk';

const PROVIDER = (process.env.LLM_PROVIDER ?? 'mistral').toLowerCase();
const CLAUDE_MODEL = process.env.ANTHROPIC_MODEL ?? 'claude-haiku-4-5-20251001';
const MISTRAL_MODEL = process.env.MISTRAL_MODEL ?? 'mistral-small-latest';
const MISTRAL_URL = 'https://api.mistral.ai/v1/chat/completions';

let _anthropic: Anthropic | null = null;
function anthropicClient(): Anthropic {
  if (!_anthropic) {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) throw new Error('ANTHROPIC_API_KEY not set');
    _anthropic = new Anthropic({ apiKey: key });
  }
  return _anthropic;
}

async function completeClaude(prompt: string, maxTokens: number): Promise<string> {
  const msg = await anthropicClient().messages.create({
    model: CLAUDE_MODEL,
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: prompt }],
  });
  for (const block of msg.content) {
    if (block.type === 'text') return block.text.trim();
  }
  return '';
}

async function completeMistral(prompt: string, maxTokens: number): Promise<string> {
  const key = process.env.MISTRAL_API_KEY;
  if (!key) throw new Error('MISTRAL_API_KEY not set');
  const res = await fetch(MISTRAL_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: MISTRAL_MODEL,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`Mistral API ${res.status}: ${await res.text()}`);
  const data: any = await res.json();
  const text = data?.choices?.[0]?.message?.content;
  return typeof text === 'string' ? text.trim() : '';
}

export async function complete(prompt: string, maxTokens = 400): Promise<string> {
  return PROVIDER === 'claude'
    ? completeClaude(prompt, maxTokens)
    : completeMistral(prompt, maxTokens);
}
