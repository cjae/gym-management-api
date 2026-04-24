/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { DeepMockProxy, mockDeep } from 'jest-mock-extended';
import { PrismaClient } from '@prisma/client';
import { LicensingService } from './licensing.service';
import { PrismaService } from '../prisma/prisma.service';
import axios from 'axios';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

type MockConfig = {
  get: jest.Mock;
};

describe('LicensingService', () => {
  let service: LicensingService;
  let prisma: DeepMockProxy<PrismaClient>;

  const defaultConfig = {
    licenseKey: 'test-license-key',
    licenseServerUrl: 'https://license.example.com',
    telemetryMemberCount: true,
    appVersion: '9.9.9-test',
  };

  const mockConfigService: MockConfig = {
    get: jest.fn().mockReturnValue(defaultConfig),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LicensingService,
        { provide: PrismaService, useValue: mockDeep<PrismaClient>() },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<LicensingService>(LicensingService);
    prisma = module.get(PrismaService);
    jest.clearAllMocks();
    // Re-set the default mock after clearAllMocks
    mockConfigService.get.mockReturnValue(defaultConfig);
  });

  describe('isActive', () => {
    it('should return true when no LICENSE_KEY is configured (dev mode)', async () => {
      mockConfigService.get.mockReturnValue({
        licenseKey: '',
        licenseServerUrl: '',
      });
      const devService = new LicensingService(
        prisma as unknown as PrismaService,
        mockConfigService as unknown as ConfigService,
      );
      const result = await devService.isActive();
      expect(result).toBe(true);
    });

    it('should return true when cached status is ACTIVE', async () => {
      prisma.licenseCache.findUnique.mockResolvedValue({
        status: 'ACTIVE',
        lastSuccessAt: new Date(),
      } as any);
      const result = await service.isActive();
      expect(result).toBe(true);
    });

    it('should return true when SUSPENDED but within grace period', async () => {
      const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
      prisma.licenseCache.findUnique.mockResolvedValue({
        status: 'SUSPENDED',
        lastSuccessAt: threeDaysAgo,
      } as any);
      const result = await service.isActive();
      expect(result).toBe(true);
    });

    it('should return false when SUSPENDED and grace period exceeded', async () => {
      const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
      prisma.licenseCache.findUnique.mockResolvedValue({
        status: 'SUSPENDED',
        lastSuccessAt: tenDaysAgo,
      } as any);
      const result = await service.isActive();
      expect(result).toBe(false);
    });

    it('should return true when no cache exists (first run)', async () => {
      prisma.licenseCache.findUnique.mockResolvedValue(null);
      const result = await service.isActive();
      expect(result).toBe(true);
    });

    it('should return true when EXPIRED but within grace period', async () => {
      const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
      prisma.licenseCache.findUnique.mockResolvedValue({
        status: 'EXPIRED',
        lastSuccessAt: threeDaysAgo,
      } as any);
      const result = await service.isActive();
      expect(result).toBe(true);
    });

    it('should return false when EXPIRED and grace period exceeded', async () => {
      const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
      prisma.licenseCache.findUnique.mockResolvedValue({
        status: 'EXPIRED',
        lastSuccessAt: tenDaysAgo,
      } as any);
      const result = await service.isActive();
      expect(result).toBe(false);
    });
  });

  describe('validateLicense', () => {
    it('should update cache with ACTIVE on successful response', async () => {
      prisma.user.count.mockResolvedValue(25);
      mockedAxios.post.mockResolvedValue({
        status: 200,
        data: {
          status: 'ACTIVE',
          gymName: 'Test Gym',
          tierName: 'Growth',
          maxMembers: 100,
          expiresAt: '2026-04-10T00:00:00Z',
          features: ['referrals', 'analytics'],
        },
      });
      prisma.licenseCache.upsert.mockResolvedValue({} as any);

      await service.validateLicense();

      expect(mockedAxios.post).toHaveBeenCalledWith(
        'https://license.example.com/api/v1/licenses/validate',
        expect.objectContaining({ currentMemberCount: 25 }),
        expect.objectContaining({
          headers: { 'X-License-Key': 'test-license-key' },
        }),
      );
      expect(prisma.licenseCache.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'singleton' },
          update: expect.objectContaining({
            status: 'ACTIVE',
            features: ['referrals', 'analytics'],
          }),
          create: expect.objectContaining({
            status: 'ACTIVE',
            features: ['referrals', 'analytics'],
          }),
        }),
      );
    });

    describe('phone-home payload', () => {
      const configuredMemberCount = async (count: number) => {
        prisma.user.count.mockResolvedValue(count);
        mockedAxios.post.mockResolvedValue({
          status: 200,
          data: {
            status: 'ACTIVE',
            gymName: 'Test Gym',
            tierName: 'Growth',
            maxMembers: 100,
            features: [],
          },
        });
        prisma.licenseCache.upsert.mockResolvedValue({} as any);
      };

      it('sends only the documented allowlist of fields', async () => {
        await configuredMemberCount(25);

        await service.validateLicense();

        const body = mockedAxios.post.mock.calls[0][1] as Record<
          string,
          unknown
        >;
        expect(Object.keys(body).sort()).toEqual(
          ['appVersion', 'currentMemberCount', 'instanceFingerprint'].sort(),
        );
      });

      it('includes configured appVersion and a stable instanceFingerprint', async () => {
        await configuredMemberCount(25);

        await service.validateLicense();

        expect(mockedAxios.post).toHaveBeenCalledWith(
          'https://license.example.com/api/v1/licenses/validate',
          expect.objectContaining({
            appVersion: '9.9.9-test',
            instanceFingerprint: expect.stringMatching(/^[a-f0-9]{16}$/),
          }),
          expect.anything(),
        );

        // Fingerprint is deterministic for the same license key.
        const first = (
          mockedAxios.post.mock.calls[0][1] as { instanceFingerprint: string }
        ).instanceFingerprint;
        mockedAxios.post.mockClear();
        await service.validateLicense();
        const second = (
          mockedAxios.post.mock.calls[0][1] as { instanceFingerprint: string }
        ).instanceFingerprint;
        expect(second).toBe(first);
      });

      it('does NOT send revenue, attendance, PII, or other commercial fields', async () => {
        await configuredMemberCount(25);

        await service.validateLicense();

        expect(mockedAxios.post).toHaveBeenCalledWith(
          expect.any(String),
          expect.not.objectContaining({
            revenue: expect.anything(),
            totalRevenue: expect.anything(),
            mrr: expect.anything(),
            monthlyRecurringRevenue: expect.anything(),
            subscriptionStats: expect.anything(),
            payments: expect.anything(),
            paymentsTotal: expect.anything(),
            checkIns: expect.anything(),
            checkInCount: expect.anything(),
            attendance: expect.anything(),
            emails: expect.anything(),
            memberEmails: expect.anything(),
            users: expect.anything(),
            licenseKey: expect.anything(),
            gymSettings: expect.anything(),
            discountCodes: expect.anything(),
          }),
          expect.anything(),
        );
      });

      it('sends the raw license key only in the X-License-Key header, not the body', async () => {
        await configuredMemberCount(25);

        await service.validateLicense();

        const [, body, options] = mockedAxios.post.mock.calls[0];
        expect(JSON.stringify(body)).not.toContain('test-license-key');
        expect(
          (options as { headers: Record<string, string> }).headers[
            'X-License-Key'
          ],
        ).toBe('test-license-key');
      });

      it('sends a bucket string instead of the exact count when telemetryMemberCount is false', async () => {
        mockConfigService.get.mockReturnValue({
          ...defaultConfig,
          telemetryMemberCount: false,
        });
        const bucketedService = new LicensingService(
          prisma as unknown as PrismaService,
          mockConfigService as unknown as ConfigService,
        );
        await configuredMemberCount(342);

        await bucketedService.validateLicense();

        expect(mockedAxios.post).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({ currentMemberCount: '<500' }),
          expect.anything(),
        );
      });

      it.each([
        [0, '<100'],
        [99, '<100'],
        [100, '<500'],
        [499, '<500'],
        [500, '<1000'],
        [999, '<1000'],
        [1000, '>=1000'],
        [50000, '>=1000'],
      ])(
        'buckets %d into %s when telemetryMemberCount=false',
        async (count, bucket) => {
          mockConfigService.get.mockReturnValue({
            ...defaultConfig,
            telemetryMemberCount: false,
          });
          const bucketedService = new LicensingService(
            prisma as unknown as PrismaService,
            mockConfigService as unknown as ConfigService,
          );
          await configuredMemberCount(count);

          await bucketedService.validateLicense();

          expect(mockedAxios.post).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({ currentMemberCount: bucket }),
            expect.anything(),
          );
        },
      );
    });

    it('should set SUSPENDED on 401 response', async () => {
      prisma.user.count.mockResolvedValue(25);
      const error = {
        isAxiosError: true,
        response: { status: 401 },
      };
      mockedAxios.post.mockRejectedValue(error);
      (mockedAxios.isAxiosError as unknown) = jest.fn().mockReturnValue(true);
      prisma.licenseCache.upsert.mockResolvedValue({} as any);

      await service.validateLicense();

      expect(prisma.licenseCache.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({ status: 'SUSPENDED' }),
        }),
      );
    });

    it('should set SUSPENDED on 403 response', async () => {
      prisma.user.count.mockResolvedValue(25);
      const error = {
        isAxiosError: true,
        response: { status: 403 },
      };
      mockedAxios.post.mockRejectedValue(error);
      (mockedAxios.isAxiosError as unknown) = jest.fn().mockReturnValue(true);
      prisma.licenseCache.upsert.mockResolvedValue({} as any);

      await service.validateLicense();

      expect(prisma.licenseCache.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({ status: 'SUSPENDED' }),
        }),
      );
    });

    it('should not change status on network error', async () => {
      prisma.user.count.mockResolvedValue(25);
      const error = {
        isAxiosError: true,
        response: undefined,
      };
      mockedAxios.post.mockRejectedValue(error);
      (mockedAxios.isAxiosError as unknown) = jest.fn().mockReturnValue(true);

      await service.validateLicense();

      expect(prisma.licenseCache.upsert).not.toHaveBeenCalled();
    });

    it('should skip validation when LICENSE_KEY is not set', async () => {
      mockConfigService.get.mockReturnValue({
        licenseKey: '',
        licenseServerUrl: '',
      });
      const devService = new LicensingService(
        prisma as unknown as PrismaService,
        mockConfigService as unknown as ConfigService,
      );

      await devService.validateLicense();

      expect(mockedAxios.post).not.toHaveBeenCalled();
    });
  });

  describe('onModuleInit', () => {
    it('should call validateLicense when configured', async () => {
      mockConfigService.get.mockReturnValue({
        licenseKey: 'test-license-key',
        licenseServerUrl: 'https://license.example.com',
      });
      const configuredService = new LicensingService(
        prisma as unknown as PrismaService,
        mockConfigService as unknown as ConfigService,
      );
      const spy = jest
        .spyOn(configuredService, 'validateLicense')
        .mockResolvedValue(undefined);

      await configuredService.onModuleInit();

      expect(spy).toHaveBeenCalled();
      spy.mockRestore();
    });

    it('should not call validateLicense when not configured', async () => {
      mockConfigService.get.mockReturnValue({
        licenseKey: '',
        licenseServerUrl: '',
      });
      const devService = new LicensingService(
        prisma as unknown as PrismaService,
        mockConfigService as unknown as ConfigService,
      );
      const spy = jest
        .spyOn(devService, 'validateLicense')
        .mockResolvedValue(undefined);

      await devService.onModuleInit();

      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });
  });

  describe('getMemberLimit', () => {
    it('should return maxMembers from cached license', async () => {
      prisma.licenseCache.findUnique.mockResolvedValue({
        maxMembers: 100,
      } as any);
      const result = await service.getMemberLimit();
      expect(result).toBe(100);
    });

    it('should return null when no cache exists', async () => {
      prisma.licenseCache.findUnique.mockResolvedValue(null);
      const result = await service.getMemberLimit();
      expect(result).toBeNull();
    });
  });

  describe('getFeatures', () => {
    it('should return features from cached license', async () => {
      prisma.licenseCache.findUnique.mockResolvedValue({
        features: ['referrals', 'analytics'],
      } as any);
      const result = await service.getFeatures();
      expect(result).toEqual(['referrals', 'analytics']);
    });

    it('should return empty array when no cache exists', async () => {
      prisma.licenseCache.findUnique.mockResolvedValue(null);
      const result = await service.getFeatures();
      expect(result).toEqual([]);
    });

    it('should return empty array when features is null', async () => {
      prisma.licenseCache.findUnique.mockResolvedValue({
        features: null,
      } as any);
      const result = await service.getFeatures();
      expect(result).toEqual([]);
    });
  });

  describe('hasFeature', () => {
    it('should return true when feature is in cached list', async () => {
      prisma.licenseCache.findUnique.mockResolvedValue({
        features: ['referrals', 'analytics'],
      } as any);
      const result = await service.hasFeature('referrals');
      expect(result).toBe(true);
    });

    it('should return false when feature is not in cached list', async () => {
      prisma.licenseCache.findUnique.mockResolvedValue({
        features: ['referrals'],
      } as any);
      const result = await service.hasFeature('salary');
      expect(result).toBe(false);
    });

    it('should return true for any feature in dev mode (unconfigured)', async () => {
      mockConfigService.get.mockReturnValue({
        licenseKey: '',
        licenseServerUrl: '',
      });
      const devService = new LicensingService(
        prisma as unknown as PrismaService,
        mockConfigService as unknown as ConfigService,
      );
      const result = await devService.hasFeature('anything');
      expect(result).toBe(true);
    });

    it('should clear in-memory feature cache after 401/403 rejection', async () => {
      // Create a fresh service with known config to avoid test ordering issues
      mockConfigService.get.mockReturnValue({
        licenseKey: 'test-license-key',
        licenseServerUrl: 'https://license.example.com',
      });
      const svc = new LicensingService(
        prisma as unknown as PrismaService,
        mockConfigService as unknown as ConfigService,
      );

      // 1. Pre-populate the in-memory cache via getFeatures()
      prisma.licenseCache.findUnique.mockResolvedValueOnce({
        features: ['referrals', 'analytics'],
      } as any);
      const features = await svc.getFeatures();
      expect(features).toEqual(['referrals', 'analytics']);

      // Verify hasFeature uses the in-memory cache (no additional DB call)
      const hasReferrals = await svc.hasFeature('referrals');
      expect(hasReferrals).toBe(true);
      expect(prisma.licenseCache.findUnique).toHaveBeenCalledTimes(1);

      // 2. Trigger a 401 rejection via validateLicense()
      prisma.user.count.mockResolvedValue(25);
      const error = {
        isAxiosError: true,
        response: { status: 401 },
      };
      mockedAxios.post.mockRejectedValue(error);
      (mockedAxios.isAxiosError as unknown) = jest.fn().mockReturnValue(true);
      prisma.licenseCache.upsert.mockResolvedValue({} as any);

      await svc.validateLicense();

      // Verify the DB was updated to SUSPENDED
      expect(prisma.licenseCache.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({ status: 'SUSPENDED' }),
        }),
      );

      // 3. Verify that subsequent hasFeature() hits the DB again (cache was cleared)
      prisma.licenseCache.findUnique.mockResolvedValueOnce({
        features: [],
      } as any);

      const hasReferralsAfter = await svc.hasFeature('referrals');
      expect(hasReferralsAfter).toBe(false);
      // findUnique should have been called again (cache was invalidated)
      expect(prisma.licenseCache.findUnique).toHaveBeenCalledTimes(2);
    });

    it('should return false when no cache and license is configured', async () => {
      mockConfigService.get.mockReturnValue({
        licenseKey: 'test-license-key',
        licenseServerUrl: 'https://license.example.com',
      });
      const configuredService = new LicensingService(
        prisma as unknown as PrismaService,
        mockConfigService as unknown as ConfigService,
      );
      prisma.licenseCache.findUnique.mockResolvedValue(null);
      const result = await configuredService.hasFeature('referrals');
      expect(result).toBe(false);
    });
  });

  describe('getLicensePlan', () => {
    it('should return isDevMode=true with null fields when LICENSE_KEY is not set', async () => {
      mockConfigService.get.mockReturnValue({
        licenseKey: '',
        licenseServerUrl: '',
      });
      const devService = new LicensingService(
        prisma as unknown as PrismaService,
        mockConfigService as unknown as ConfigService,
      );
      const result = await devService.getLicensePlan();
      expect(result).toEqual({
        status: 'ACTIVE',
        isDevMode: true,
        gymName: null,
        tierName: null,
        maxMembers: null,
        maxAdmins: null,
        expiresAt: null,
        features: [],
        lastCheckedAt: null,
      });
      // Restore default config so the next beforeEach compiles the module correctly
      mockConfigService.get.mockReturnValue(defaultConfig);
    });

    it('should return mapped cache fields when configured and cache exists', async () => {
      const expiresAt = new Date('2026-12-31T00:00:00.000Z');
      const lastCheckedAt = new Date('2026-04-24T03:00:00.000Z');
      prisma.licenseCache.findUnique.mockResolvedValue({
        status: 'ACTIVE',
        gymName: 'PowerBarn Fitness',
        tierName: 'Pro',
        maxMembers: 500,
        maxAdmins: 5,
        features: ['analytics', 'referrals'],
        expiresAt,
        lastCheckedAt,
      } as any);

      const result = await service.getLicensePlan();

      expect(result).toEqual({
        status: 'ACTIVE',
        isDevMode: false,
        gymName: 'PowerBarn Fitness',
        tierName: 'Pro',
        maxMembers: 500,
        maxAdmins: 5,
        expiresAt: '2026-12-31T00:00:00.000Z',
        features: ['analytics', 'referrals'],
        lastCheckedAt: '2026-04-24T03:00:00.000Z',
      });
    });

    it('should return ACTIVE status with null fields when no cache record exists', async () => {
      prisma.licenseCache.findUnique.mockResolvedValue(null);
      const result = await service.getLicensePlan();
      expect(result).toEqual({
        status: 'ACTIVE',
        isDevMode: false,
        gymName: null,
        tierName: null,
        maxMembers: null,
        maxAdmins: null,
        expiresAt: null,
        features: [],
        lastCheckedAt: null,
      });
      expect(prisma.licenseCache.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'singleton' } }),
      );
    });

    it('should reflect SUSPENDED status from cache', async () => {
      prisma.licenseCache.findUnique.mockResolvedValue({
        status: 'SUSPENDED',
        gymName: 'PowerBarn Fitness',
        tierName: 'Pro',
        maxMembers: 500,
        maxAdmins: 5,
        features: [],
        expiresAt: null,
        lastCheckedAt: new Date('2026-04-24T03:00:00.000Z'),
      } as any);
      const result = await service.getLicensePlan();
      expect(result).toEqual({
        status: 'SUSPENDED',
        isDevMode: false,
        gymName: 'PowerBarn Fitness',
        tierName: 'Pro',
        maxMembers: 500,
        maxAdmins: 5,
        features: [],
        expiresAt: null,
        lastCheckedAt: '2026-04-24T03:00:00.000Z',
      });
    });

    it('should reflect EXPIRED status from cache', async () => {
      prisma.licenseCache.findUnique.mockResolvedValue({
        status: 'EXPIRED',
        gymName: 'PowerBarn Fitness',
        tierName: 'Pro',
        maxMembers: 500,
        maxAdmins: 5,
        features: [],
        expiresAt: new Date('2026-01-01T00:00:00.000Z'),
        lastCheckedAt: new Date('2026-04-24T03:00:00.000Z'),
      } as any);
      const result = await service.getLicensePlan();
      expect(result).toEqual({
        status: 'EXPIRED',
        isDevMode: false,
        gymName: 'PowerBarn Fitness',
        tierName: 'Pro',
        maxMembers: 500,
        maxAdmins: 5,
        features: [],
        expiresAt: '2026-01-01T00:00:00.000Z',
        lastCheckedAt: '2026-04-24T03:00:00.000Z',
      });
    });
  });
});
