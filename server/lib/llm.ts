import { env } from './config.js';

const MISTRAL_URL = 'https://api.mistral.ai/v1/chat/completions';

export async function complete(prompt: string, maxTokens = 400): Promise<string> {
  if (!env.mistralApiKey) throw new Error('MISTRAL_API_KEY not set');
  const res = await fetch(MISTRAL_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.mistralApiKey}`,
    },
    body: JSON.stringify({
      model: env.mistralModel,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Mistral API ${res.status}: ${body}`);
  }
  const data: any = await res.json();
  const text = data?.choices?.[0]?.message?.content;
  return typeof text === 'string' ? text.trim() : '';
}
