import Anthropic from '@anthropic-ai/sdk';
import { Logger } from '@nestjs/common';
import { LlmConfig } from '../../common/config/llm.config';
import { LlmProvider } from './llm-provider.interface';

const SYSTEM_PROMPT =
  "You are a professional personal trainer and fitness coach. Produce realistic, safe, structured training plans based on the member's current fitness data. Return ONLY valid JSON matching the schema given — no prose, no markdown fences.";

export class AnthropicProvider implements LlmProvider {
  private readonly logger = new Logger(AnthropicProvider.name);
  private readonly client: Anthropic;

  constructor(private readonly config: LlmConfig) {
    this.client = new Anthropic({
      apiKey: config.apiKey,
      timeout: config.timeoutMs,
    });
  }

  async generatePlan(userPrompt: string): Promise<unknown> {
    if (!this.config.enabled) {
      throw new Error('LLM is not configured (ANTHROPIC_API_KEY missing)');
    }

    const stream = this.client.messages.stream({
      model: this.config.model,
      max_tokens: this.config.maxTokens,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
    });
    const response = await stream.finalMessage();

    if (response.stop_reason === 'max_tokens') {
      this.logger.error(
        `Anthropic response truncated at max_tokens=${this.config.maxTokens}. Increase LLM_MAX_TOKENS.`,
      );
      throw new Error('LLM response truncated (max_tokens limit hit)');
    }

    const text = response.content.find((block) => block.type === 'text');
    if (!text || text.type !== 'text') {
      throw new Error('LLM returned empty response');
    }

    try {
      const raw = text.text
        .replace(/^\s*```(?:json)?\s*/i, '')
        .replace(/\s*```\s*$/, '')
        .trim();
      return JSON.parse(raw);
    } catch (err) {
      this.logger.error('Anthropic returned invalid JSON', err);
      throw new Error('LLM returned invalid JSON');
    }
  }
}
