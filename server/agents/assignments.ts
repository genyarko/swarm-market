import type { Capability } from './prompts.js';

// Per IMPLEMENTATION.md § Phase 3: 8 agents covering 5 capabilities.
// specialist-N (1-indexed) maps to this capability set:
export const SPECIALIST_ASSIGNMENTS: Capability[][] = [
  ['summarize'],              // specialist-1
  ['summarize'],              // specialist-2
  ['classify'],               // specialist-3
  ['classify'],               // specialist-4
  ['translate'],              // specialist-5
  ['translate'],              // specialist-6
  ['sentiment'],              // specialist-7
  ['extract'],                // specialist-8
];
