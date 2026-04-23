import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('root', () => {
    it('should return "Hello World!"', () => {
      expect(appController.getHello()).toBe('Hello World!');
    });
  });

  describe('health', () => {
    it('returns a minimal body with only a status field', () => {
      const response = appController.getHealth();

      // The health endpoint intentionally returns nothing more than
      // { status: 'ok' }. Version strings, uptime, DB state, or module
      // lists would leak environment info to unauthenticated callers
      // (the endpoint bypasses LicenseGuard and all auth by design).
      expect(response).toEqual({ status: 'ok' });
      expect(Object.keys(response)).toEqual(['status']);
    });
  });
});
