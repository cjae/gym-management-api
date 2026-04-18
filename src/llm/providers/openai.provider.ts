import OpenAI from 'openai';
import { Logger } from '@nestjs/common';
import { LlmConfig } from '../../common/config/llm.config';
import { LlmProvider } from './llm-provider.interface';

const SYSTEM_PROMPT =
  "You are a professional personal trainer and fitness coach. Produce realistic, safe, structured training plans based on the member's current fitness data. Return ONLY valid JSON matching the schema given.";

export class OpenAiProvider implements LlmProvider {
  private readonly logger = new Logger(OpenAiProvider.name);
  private readonly client: OpenAI;

  constructor(private readonly config: LlmConfig) {
    this.client = new OpenAI({
      apiKey: config.openAiApiKey,
      timeout: config.timeoutMs,
    });
  }

  async generatePlan(userPrompt: string): Promise<unknown> {
    if (!this.config.enabled) {
      throw new Error('LLM is not configured (OPENAI_API_KEY missing)');
    }

    const maxTokens = Math.min(this.config.maxTokens, 16384);

    const stream = await this.client.chat.completions.create({
      model: this.config.openAiModel,
      max_tokens: maxTokens,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      stream: true,
    });

    let fullText = '';
    let finishReason: string | null = null;
    for await (const chunk of stream) {
      fullText += chunk.choices[0]?.delta?.content ?? '';
      if (chunk.choices[0]?.finish_reason) {
        finishReason = chunk.choices[0].finish_reason;
      }
    }

    if (finishReason === 'length') {
      this.logger.error(
        `OpenAI response truncated at max_tokens=${maxTokens}. Increase LLM_MAX_TOKENS.`,
      );
      throw new Error('LLM response truncated (max_tokens limit hit)');
    }

    try {
      return JSON.parse(fullText);
    } catch (err) {
      this.logger.error('OpenAI returned invalid JSON', err);
      throw new Error('LLM returned invalid JSON');
    }
  }
}
