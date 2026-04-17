import { registerAs } from '@nestjs/config';

export type LlmConfig = {
  apiKey: string;
  model: string;
  maxTokens: number;
  timeoutMs: number;
  enabled: boolean;
};

export const getLlmConfigName = () => 'llm';

export const getLlmConfig = (): LlmConfig => {
  const apiKey = process.env.ANTHROPIC_API_KEY ?? '';
  const model = process.env.LLM_MODEL || 'claude-sonnet-4-6';
  const maxTokens = Number(process.env.LLM_MAX_TOKENS ?? 4096);
  const timeoutMs = Number(process.env.LLM_TIMEOUT_MS ?? 60000);
  return { apiKey, model, maxTokens, timeoutMs, enabled: !!apiKey };
};

export default registerAs(getLlmConfigName(), getLlmConfig);
