import { registerAs } from '@nestjs/config';

export type LlmConfig = {
  apiKey: string;
  model: string;
  maxTokens: number;
  timeoutMs: number;
  enabled: boolean;
};

export const getLlmConfigName = () => 'llm';

const parsePositiveInt = (
  raw: string | undefined,
  fallback: number,
): number => {
  const n = Number(raw);
  return raw && Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
};

export const getLlmConfig = (): LlmConfig => {
  const apiKey = process.env.ANTHROPIC_API_KEY ?? '';
  const model = process.env.LLM_MODEL || 'claude-sonnet-4-6';
  const maxTokens = parsePositiveInt(process.env.LLM_MAX_TOKENS, 16000);
  const timeoutMs = parsePositiveInt(process.env.LLM_TIMEOUT_MS, 60000);
  return { apiKey, model, maxTokens, timeoutMs, enabled: !!apiKey };
};

export default registerAs(getLlmConfigName(), getLlmConfig);
