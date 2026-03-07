import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { EmailService } from './email.service';

describe('EmailService', () => {
  let service: EmailService;

  const mockConfigService = {
    get: jest.fn((key: string) => {
      if (key === 'mail')
        return {
          apiKey: '',
          domain: '',
          from: 'test@test.com',
          enabled: false,
        };
      if (key === 'app')
        return { port: 3000, adminUrl: 'http://localhost:3001' };
      return null;
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmailService,
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<EmailService>(EmailService);
  });

  describe('sendEmail', () => {
    it('should log email in dev mode when Mailgun is not configured', async () => {
      const logSpy = jest.spyOn(service['logger'], 'log').mockImplementation();
      jest.spyOn(service['logger'], 'debug').mockImplementation();

      await service.sendEmail(
        'test@test.com',
        'Test Subject',
        'password-reset',
        {
          firstName: 'John',
          resetUrl: 'http://localhost:3001/reset-password?token=abc',
        },
      );

      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('test@test.com'),
      );
    });
  });

  describe('sendPasswordResetEmail', () => {
    it('should call sendEmail with correct template and context', async () => {
      const sendEmailSpy = jest.spyOn(service, 'sendEmail').mockResolvedValue();

      await service.sendPasswordResetEmail('test@test.com', 'John', 'abc123');

      expect(sendEmailSpy).toHaveBeenCalledWith(
        'test@test.com',
        'Reset Your Password',
        'password-reset',
        expect.objectContaining({
          firstName: 'John',
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          resetUrl: expect.stringContaining('abc123'),
        }),
      );
    });
  });
});
