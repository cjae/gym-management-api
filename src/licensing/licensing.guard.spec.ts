import { ExecutionContext, ServiceUnavailableException } from '@nestjs/common';
import { LicenseGuard } from './licensing.guard';
import { LicensingService } from './licensing.service';

describe('LicenseGuard', () => {
  let guard: LicenseGuard;
  let licensingService: Partial<LicensingService>;

  beforeEach(() => {
    licensingService = {
      isActive: jest.fn(),
    };
    guard = new LicenseGuard(licensingService as LicensingService);
  });

  const createMockContext = (url: string): ExecutionContext =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({ url }),
      }),
    }) as unknown as ExecutionContext;

  it('should allow request when license is active', async () => {
    (licensingService.isActive as jest.Mock).mockResolvedValue(true);
    const result = await guard.canActivate(createMockContext('/api/v1/users'));
    expect(result).toBe(true);
  });

  it('should throw ServiceUnavailableException when license is inactive', async () => {
    (licensingService.isActive as jest.Mock).mockResolvedValue(false);
    await expect(
      guard.canActivate(createMockContext('/api/v1/users')),
    ).rejects.toThrow(ServiceUnavailableException);
  });

  it('should skip check for /api/health', async () => {
    (licensingService.isActive as jest.Mock).mockResolvedValue(false);
    const result = await guard.canActivate(createMockContext('/api/health'));
    expect(result).toBe(true);
    expect(licensingService.isActive).not.toHaveBeenCalled();
  });
});
