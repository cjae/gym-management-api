import { registerAs } from '@nestjs/config';

export type LlmProvider = 'anthropic' | 'openai';

export type LlmConfig = {
  provider: LlmProvider;
  apiKey: string;
  model: string;
  openAiApiKey: string;
  openAiModel: string;
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
  const provider = (process.env.LLM_PROVIDER || 'anthropic') as LlmProvider;
  const apiKey = process.env.ANTHROPIC_API_KEY ?? '';
  const model = process.env.LLM_MODEL || 'claude-sonnet-4-6';
  const openAiApiKey = process.env.OPENAI_API_KEY ?? '';
  const openAiModel = process.env.LLM_OPENAI_MODEL || 'gpt-4o';
  const maxTokens = parsePositiveInt(process.env.LLM_MAX_TOKENS, 32000);
  const timeoutMs = parsePositiveInt(process.env.LLM_TIMEOUT_MS, 60000);
  const enabled = provider === 'openai' ? !!openAiApiKey : !!apiKey;
  return {
    provider,
    apiKey,
    model,
    openAiApiKey,
    openAiModel,
    maxTokens,
    timeoutMs,
    enabled,
  };
};

export default registerAs(getLlmConfigName(), getLlmConfig);
