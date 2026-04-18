import Anthropic from '@anthropic-ai/sdk';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getLlmConfigName, LlmConfig } from '../common/config/llm.config';

@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);
  private readonly config: LlmConfig;
  private readonly client: Anthropic;

  constructor(configService: ConfigService) {
    this.config = configService.get<LlmConfig>(getLlmConfigName())!;
    this.client = new Anthropic({
      apiKey: this.config.apiKey || 'unset',
      timeout: this.config.timeoutMs,
    });
  }

  async generatePlan(userPrompt: string): Promise<unknown> {
    if (!this.config.enabled) {
      throw new Error('LLM is not configured (ANTHROPIC_API_KEY missing)');
    }

    const response = await this.client.messages.create({
      model: this.config.model,
      max_tokens: this.config.maxTokens,
      system:
        "You are a professional personal trainer and fitness coach. Produce realistic, safe, structured training plans based on the member's current fitness data. Return ONLY valid JSON matching the schema given — no prose, no markdown fences.",
      messages: [{ role: 'user', content: userPrompt }],
    });

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
      this.logger.error('LLM returned invalid JSON', err);
      throw new Error('LLM returned invalid JSON');
    }
  }
}
