import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getLlmConfigName, LlmConfig } from '../common/config/llm.config';
import { LlmProvider } from './providers/llm-provider.interface';
import { AnthropicProvider } from './providers/anthropic.provider';
import { OpenAiProvider } from './providers/openai.provider';

@Injectable()
export class LlmService {
  private readonly provider: LlmProvider;

  constructor(configService: ConfigService) {
    const config = configService.get<LlmConfig>(getLlmConfigName())!;
    switch (config.provider) {
      case 'openai':
        this.provider = new OpenAiProvider(config);
        break;
      case 'anthropic':
        this.provider = new AnthropicProvider(config);
        break;
      default:
        throw new Error(
          `Unsupported LLM provider: ${String((config as { provider: unknown }).provider)}`,
        );
    }
  }

  async generatePlan(userPrompt: string): Promise<unknown> {
    return this.provider.generatePlan(userPrompt);
  }
}
