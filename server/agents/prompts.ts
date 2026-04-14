export type Capability = 'summarize' | 'classify' | 'translate' | 'sentiment' | 'extract';

export const PROMPTS: Record<Capability, (input: string) => string> = {
  summarize: (input) =>
    `Summarize the following text in 2-3 concise sentences. Respond with only the summary, no preamble.\n\nTEXT:\n${input}`,

  classify: (input) =>
    `Classify this text into exactly one of: tech, business, science, politics, entertainment.
Respond with a JSON object only, no markdown, no prose:
{"category": "<one of the five>", "confidence": <0.0 to 1.0>}

TEXT:
${input}`,

  translate: (input) =>
    `Translate the following text to Spanish. If already Spanish, translate to English. Respond with only the translation, no preamble.\n\nTEXT:\n${input}`,

  sentiment: (input) =>
    `Analyze sentiment. Respond with a JSON object only, no markdown, no prose:
{"score": <-1.0 to 1.0>, "label": "<positive|neutral|negative>"}

TEXT:
${input}`,

  extract: (input) =>
    `Extract the key entities and facts from the text below. Respond with a JSON object only, no markdown:
{"entities": ["..."], "facts": ["..."]}

TEXT:
${input}`,
};

export const CAPABILITIES: Capability[] = ['summarize', 'classify', 'translate', 'sentiment', 'extract'];
