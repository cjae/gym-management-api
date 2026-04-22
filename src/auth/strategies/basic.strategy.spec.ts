import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';
import * as crypto from 'crypto';
import { BasicStrategy } from './basic.strategy';
import { getAuthConfigName } from '../../common/config/auth.config';

// We want to assert that `crypto.timingSafeEqual` is actually invoked for
// BOTH the username and password comparisons — i.e. no `&&` short-circuit
// between them. `crypto.timingSafeEqual` is non-configurable on the real
// `crypto` module, so `jest.spyOn` fails. Wrap it via `jest.mock` instead,
// preserving all other exports by delegating to the real implementation.
jest.mock('crypto', () => {
  const actual = jest.requireActual<typeof import('crypto')>('crypto');
  return {
    ...actual,
    timingSafeEqual: jest.fn(actual.timingSafeEqual),
  };
});

const timingSafeEqualMock = crypto.timingSafeEqual as unknown as jest.Mock;

describe('BasicStrategy', () => {
  const buildStrategy = (
    basicAuthUser: string,
    basicAuthPassword: string,
  ): BasicStrategy => {
    const configService = {
      get: (key: string) => {
        if (key === getAuthConfigName()) {
          return {
            jwtSecret: 'irrelevant',
            jwtRefreshSecret: 'irrelevant',
            basicAuthUser,
            basicAuthPassword,
          };
        }
        return undefined;
      },
    } as unknown as ConfigService;

    return new BasicStrategy(configService);
  };

  describe('validate', () => {
    it('returns true for correct username and password', () => {
      const strategy = buildStrategy('admin', 'secret');
      expect(strategy.validate('admin', 'secret')).toBe(true);
    });

    it('throws UnauthorizedException when username is wrong', () => {
      const strategy = buildStrategy('admin', 'secret');
      expect(() => strategy.validate('attacker', 'secret')).toThrow(
        UnauthorizedException,
      );
      expect(() => strategy.validate('attacker', 'secret')).toThrow(
        'Invalid credentials',
      );
    });

    it('throws UnauthorizedException when password is wrong', () => {
      const strategy = buildStrategy('admin', 'secret');
      expect(() => strategy.validate('admin', 'wrong')).toThrow(
        UnauthorizedException,
      );
      expect(() => strategy.validate('admin', 'wrong')).toThrow(
        'Invalid credentials',
      );
    });

    it('throws UnauthorizedException when both are wrong', () => {
      const strategy = buildStrategy('admin', 'secret');
      expect(() => strategy.validate('bad', 'bad')).toThrow(
        UnauthorizedException,
      );
    });

    it('fails closed when username is configured blank (password set)', () => {
      const strategy = buildStrategy('', 'secret');
      expect(() => strategy.validate('', 'secret')).toThrow(
        UnauthorizedException,
      );
      expect(() => strategy.validate('', 'secret')).toThrow(
        'Basic auth not configured',
      );
    });

    it('fails closed when password is configured blank (username set)', () => {
      const strategy = buildStrategy('admin', '');
      expect(() => strategy.validate('admin', '')).toThrow(
        UnauthorizedException,
      );
      expect(() => strategy.validate('admin', '')).toThrow(
        'Basic auth not configured',
      );
    });

    it('fails closed when both credentials are blank', () => {
      const strategy = buildStrategy('', '');
      expect(() => strategy.validate('anything', 'anything')).toThrow(
        'Basic auth not configured',
      );
    });

    it('still rejects a caller supplying the blank username/password when only one env is blank', () => {
      // Attacker might try to send literal empty credentials hoping the
      // blank-expected side === blank-candidate short-circuit lets them in.
      const strategy = buildStrategy('admin', '');
      expect(() => strategy.validate('', '')).toThrow(
        'Basic auth not configured',
      );
    });

    it('routes both username and password comparisons through crypto.timingSafeEqual', () => {
      timingSafeEqualMock.mockClear();
      const strategy = buildStrategy('admin', 'secret');
      strategy.validate('admin', 'secret');
      // Expect exactly two timingSafeEqual calls — one per field — with
      // no short-circuit evaluation based on the first result.
      expect(timingSafeEqualMock).toHaveBeenCalledTimes(2);
    });

    it('still calls timingSafeEqual for both fields on wrong username', () => {
      timingSafeEqualMock.mockClear();
      const strategy = buildStrategy('admin', 'secret');
      expect(() => strategy.validate('attacker', 'secret')).toThrow(
        UnauthorizedException,
      );
      // Both comparisons must happen — we deliberately avoid `&&` short
      // circuit between userOk and passOk so timing doesn't leak which
      // of the two was wrong.
      expect(timingSafeEqualMock).toHaveBeenCalledTimes(2);
    });
  });

  describe('constructor', () => {
    it('can be instantiated via Nest DI container', async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          BasicStrategy,
          {
            provide: ConfigService,
            useValue: {
              get: () => ({
                jwtSecret: 'x',
                jwtRefreshSecret: 'x',
                basicAuthUser: 'u',
                basicAuthPassword: 'p',
              }),
            },
          },
        ],
      }).compile();

      const strategy = module.get(BasicStrategy);
      expect(strategy).toBeDefined();
      expect(strategy.validate('u', 'p')).toBe(true);
    });
  });
});
