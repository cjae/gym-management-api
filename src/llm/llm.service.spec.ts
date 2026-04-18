import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { LlmService } from './llm.service';

const baseConfig = {
  provider: 'anthropic' as const,
  apiKey: 'test-key',
  model: 'claude-sonnet-4-6',
  openAiApiKey: '',
  openAiModel: 'gpt-4o',
  maxTokens: 1024,
  timeoutMs: 30000,
  enabled: true,
};

const makeService = async (configOverrides = {}) => {
  const moduleRef = await Test.createTestingModule({
    providers: [
      LlmService,
      {
        provide: ConfigService,
        useValue: {
          get: jest.fn().mockReturnValue({ ...baseConfig, ...configOverrides }),
        },
      },
    ],
  }).compile();
  return moduleRef.get(LlmService);
};

describe('LlmService (Anthropic)', () => {
  let service: LlmService;
  const mockFinalMessage = jest.fn();

  beforeEach(async () => {
    jest.clearAllMocks();
    service = await makeService();
    (
      service as unknown as {
        provider: { client: { messages: { stream: jest.Mock } } };
      }
    ).provider.client = {
      messages: {
        stream: jest.fn().mockReturnValue({ finalMessage: mockFinalMessage }),
      },
    };
  });

  it('returns parsed JSON from the assistant message', async () => {
    mockFinalMessage.mockResolvedValue({
      stop_reason: 'end_turn',
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            recommendedGymFrequency: 4,
            estimatedWeeks: 12,
            reasoning: 'ok',
            milestones: [],
            plan: [],
          }),
        },
      ],
    });
    const result = await service.generatePlan('prompt');
    expect(result).toMatchObject({ recommendedGymFrequency: 4 });
  });

  it('throws when response has no text content', async () => {
    mockFinalMessage.mockResolvedValue({
      stop_reason: 'end_turn',
      content: [],
    });
    await expect(service.generatePlan('prompt')).rejects.toThrow(
      /empty response/i,
    );
  });

  it('throws when response text is not valid JSON', async () => {
    mockFinalMessage.mockResolvedValue({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'not json' }],
    });
    await expect(service.generatePlan('prompt')).rejects.toThrow(
      /invalid JSON/i,
    );
  });

  it('throws when truncated (stop_reason max_tokens)', async () => {
    mockFinalMessage.mockResolvedValue({
      stop_reason: 'max_tokens',
      content: [{ type: 'text', text: '{"incomplete":' }],
    });
    await expect(service.generatePlan('prompt')).rejects.toThrow(/truncated/i);
  });

  it('throws when config is not enabled (no API key)', async () => {
    const disabled = await makeService({ apiKey: '', enabled: false });
    await expect(disabled.generatePlan('prompt')).rejects.toThrow(
      /not configured/i,
    );
  });
});

describe('LlmService (OpenAI)', () => {
  let service: LlmService;
  const mockStream = jest.fn();

  beforeEach(async () => {
    jest.clearAllMocks();
    service = await makeService({
      provider: 'openai',
      openAiApiKey: 'openai-key',
      enabled: true,
    });
    (
      service as unknown as {
        provider: { client: { chat: { completions: { create: jest.Mock } } } };
      }
    ).provider.client = {
      chat: { completions: { create: mockStream } },
    };
  });

  const makeChunks = (text: string, finishReason = 'stop') =>
    (async function* () {
      yield {
        choices: [{ delta: { content: text }, finish_reason: null }],
      };
      yield {
        choices: [{ delta: { content: '' }, finish_reason: finishReason }],
      };
    })();

  it('returns parsed JSON from streamed chunks', async () => {
    const payload = JSON.stringify({
      recommendedGymFrequency: 3,
      estimatedWeeks: 8,
      reasoning: 'ok',
      milestones: [],
      plan: [],
    });
    mockStream.mockResolvedValue(makeChunks(payload));
    const result = await service.generatePlan('prompt');
    expect(result).toMatchObject({ recommendedGymFrequency: 3 });
  });

  it('throws when truncated (finish_reason length)', async () => {
    mockStream.mockResolvedValue(makeChunks('{"incomplete":', 'length'));
    await expect(service.generatePlan('prompt')).rejects.toThrow(/truncated/i);
  });

  it('throws when response text is not valid JSON', async () => {
    mockStream.mockResolvedValue(makeChunks('not json'));
    await expect(service.generatePlan('prompt')).rejects.toThrow(
      /invalid JSON/i,
    );
  });
});
