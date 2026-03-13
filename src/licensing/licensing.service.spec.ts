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

  const mockConfigService: MockConfig = {
    get: jest.fn().mockReturnValue({
      licenseKey: 'test-license-key',
      licenseServerUrl: 'https://license.example.com',
    }),
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
    mockConfigService.get.mockReturnValue({
      licenseKey: 'test-license-key',
      licenseServerUrl: 'https://license.example.com',
    });
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
          update: expect.objectContaining({ status: 'ACTIVE' }),
          create: expect.objectContaining({ status: 'ACTIVE' }),
        }),
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
});
