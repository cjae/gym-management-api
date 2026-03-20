import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { FeatureGuard } from './feature.guard';
import { LicensingService } from './licensing.service';

describe('FeatureGuard', () => {
  let guard: FeatureGuard;
  let reflector: Partial<Reflector>;
  let licensingService: Partial<LicensingService>;

  beforeEach(() => {
    reflector = {
      getAllAndOverride: jest.fn(),
    };
    licensingService = {
      hasFeature: jest.fn(),
    };
    guard = new FeatureGuard(
      reflector as Reflector,
      licensingService as LicensingService,
    );
  });

  const createMockContext = (): ExecutionContext =>
    ({
      getHandler: () => jest.fn(),
      getClass: () => jest.fn(),
    }) as unknown as ExecutionContext;

  it('should allow request when no feature is required', async () => {
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue(undefined);
    const result = await guard.canActivate(createMockContext());
    expect(result).toBe(true);
    expect(licensingService.hasFeature).not.toHaveBeenCalled();
  });

  it('should allow request when feature is enabled', async () => {
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue('referrals');
    (licensingService.hasFeature as jest.Mock).mockResolvedValue(true);
    const result = await guard.canActivate(createMockContext());
    expect(result).toBe(true);
    expect(licensingService.hasFeature).toHaveBeenCalledWith('referrals');
  });

  it('should throw ForbiddenException when feature is not enabled', async () => {
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue('salary');
    (licensingService.hasFeature as jest.Mock).mockResolvedValue(false);
    await expect(guard.canActivate(createMockContext())).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('should check both handler and class for metadata', async () => {
    const mockHandler = jest.fn();
    const mockClass = jest.fn();
    const context = {
      getHandler: () => mockHandler,
      getClass: () => mockClass,
    } as unknown as ExecutionContext;

    (reflector.getAllAndOverride as jest.Mock).mockReturnValue('analytics');
    (licensingService.hasFeature as jest.Mock).mockResolvedValue(true);

    await guard.canActivate(context);

    expect(reflector.getAllAndOverride).toHaveBeenCalledWith(
      'requiredFeature',
      [mockHandler, mockClass],
    );
  });
});
