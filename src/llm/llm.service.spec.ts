import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { LlmService } from './llm.service';

describe('LlmService', () => {
  let service: LlmService;
  const mockFinalMessage = jest.fn();

  const makeClient = () => ({
    messages: {
      stream: jest.fn().mockReturnValue({ finalMessage: mockFinalMessage }),
    },
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        LlmService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue({
              apiKey: 'test-key',
              model: 'claude-sonnet-4-6',
              maxTokens: 1024,
              timeoutMs: 30000,
              enabled: true,
            }),
          },
        },
      ],
    }).compile();
    service = moduleRef.get(LlmService);
    (service as unknown as { client: ReturnType<typeof makeClient> }).client =
      makeClient();
  });

  it('returns parsed JSON from the assistant message', async () => {
    mockFinalMessage.mockResolvedValue({
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
    mockFinalMessage.mockResolvedValue({ content: [] });
    await expect(service.generatePlan('prompt')).rejects.toThrow(
      /empty response/i,
    );
  });

  it('throws when response text is not valid JSON', async () => {
    mockFinalMessage.mockResolvedValue({
      content: [{ type: 'text', text: 'not json' }],
    });
    await expect(service.generatePlan('prompt')).rejects.toThrow(
      /invalid JSON/i,
    );
  });

  it('throws when config is not enabled (no API key)', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        LlmService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue({
              apiKey: '',
              model: 'claude-sonnet-4-6',
              maxTokens: 1024,
              timeoutMs: 30000,
              enabled: false,
            }),
          },
        },
      ],
    }).compile();
    const disabled = moduleRef.get(LlmService);
    await expect(disabled.generatePlan('prompt')).rejects.toThrow(
      /not configured/i,
    );
  });
});
