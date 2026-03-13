/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Test, TestingModule } from '@nestjs/testing';
import { DeepMockProxy, mockDeep } from 'jest-mock-extended';
import { PrismaClient } from '@prisma/client';
import { BannersService } from './banners.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { BannerCtaType } from '@prisma/client';

describe('BannersService', () => {
  let service: BannersService;
  let prisma: DeepMockProxy<PrismaClient>;

  const mockBanner = {
    id: 'banner-1',
    title: 'Summer Promo',
    body: 'Get 20% off!',
    imageUrl: 'https://example.com/image.jpg',
    ctaType: BannerCtaType.DEEP_LINK,
    ctaTarget: '/subscription-plans',
    ctaLabel: 'View Plans',
    discountCode: 'SUMMER20',
    displayOrder: 0,
    isPublished: true,
    startDate: new Date('2026-03-01'),
    endDate: new Date('2026-04-01'),
    deletedAt: null,
    createdBy: 'admin-1',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BannersService,
        { provide: PrismaService, useValue: mockDeep<PrismaClient>() },
      ],
    }).compile();
    service = module.get<BannersService>(BannersService);
    prisma = module.get(PrismaService);

    // Set default mock return values
    prisma.banner.create.mockResolvedValue(mockBanner as any);
    prisma.banner.findMany.mockResolvedValue([mockBanner] as any);
    prisma.banner.findFirst.mockResolvedValue(mockBanner as any);
    prisma.banner.update.mockResolvedValue(mockBanner as any);
    prisma.banner.count.mockResolvedValue(1);
    prisma.bannerInteraction.create.mockResolvedValue({
      id: 'interaction-1',
    } as any);
    prisma.bannerInteraction.count.mockResolvedValue(10);
    prisma.bannerInteraction.groupBy.mockResolvedValue([] as any);
    prisma.$queryRaw.mockResolvedValue([{ count: BigInt(5) }] as any);
  });

  describe('create', () => {
    it('should create a banner', async () => {
      const dto = {
        title: 'Summer Promo',
        body: 'Get 20% off!',
        imageUrl: 'https://example.com/image.jpg',
        ctaType: BannerCtaType.DEEP_LINK,
        ctaTarget: '/subscription-plans',
        ctaLabel: 'View Plans',
        discountCode: 'SUMMER20',
        startDate: '2026-03-01T00:00:00.000Z',
        endDate: '2026-04-01T00:00:00.000Z',
      };
      const result = await service.create(dto, 'admin-1');
      expect(prisma.banner.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          title: dto.title,
          createdBy: 'admin-1',
        }),
      });
      expect(result).toEqual(mockBanner);
    });

    it('should throw if endDate is before startDate', async () => {
      const dto = {
        title: 'Bad Banner',
        imageUrl: 'https://example.com/image.jpg',
        ctaType: BannerCtaType.NONE,
        startDate: '2026-04-01T00:00:00.000Z',
        endDate: '2026-03-01T00:00:00.000Z',
      };
      await expect(service.create(dto, 'admin-1')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('findAll', () => {
    it('should return paginated banners with analytics', async () => {
      prisma.bannerInteraction.count
        .mockResolvedValueOnce(100)
        .mockResolvedValueOnce(25);

      const result = await service.findAll(1, 20);
      expect(prisma.banner.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { deletedAt: null },
          orderBy: { createdAt: 'desc' },
          skip: 0,
          take: 20,
        }),
      );
      expect(result).toHaveProperty('data');
      expect(result).toHaveProperty('total');
      expect(result).toHaveProperty('page');
      expect(result).toHaveProperty('limit');
    });
  });

  describe('findOne', () => {
    it('should return a banner by id', async () => {
      const result = await service.findOne('banner-1');
      expect(prisma.banner.findFirst).toHaveBeenCalledWith({
        where: { id: 'banner-1', deletedAt: null },
      });
      expect(result).toEqual(mockBanner);
    });

    it('should throw NotFoundException if banner not found', async () => {
      prisma.banner.findFirst.mockResolvedValueOnce(null);
      await expect(service.findOne('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('update', () => {
    it('should update a banner', async () => {
      const dto = { title: 'Updated Promo' };
      const result = await service.update('banner-1', dto);
      expect(prisma.banner.findFirst).toHaveBeenCalled();
      expect(prisma.banner.update).toHaveBeenCalledWith({
        where: { id: 'banner-1' },
        data: expect.objectContaining({ title: 'Updated Promo' }),
      });
      expect(result).toEqual(mockBanner);
    });

    it('should throw BadRequestException if endDate is before startDate on update', async () => {
      await expect(
        service.update('banner-1', { startDate: '2026-05-01T00:00:00.000Z' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException if banner not found', async () => {
      prisma.banner.findFirst.mockResolvedValueOnce(null);
      await expect(
        service.update('nonexistent', { title: 'x' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('softDelete', () => {
    it('should set deletedAt on the banner', async () => {
      await service.softDelete('banner-1');
      expect(prisma.banner.findFirst).toHaveBeenCalled();
      expect(prisma.banner.update).toHaveBeenCalledWith({
        where: { id: 'banner-1' },
        data: { deletedAt: expect.any(Date) },
      });
    });

    it('should throw NotFoundException if banner not found', async () => {
      prisma.banner.findFirst.mockResolvedValueOnce(null);
      await expect(service.softDelete('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('findActive', () => {
    it('should return active banners ordered by displayOrder', async () => {
      const result = await service.findActive();
      expect(prisma.banner.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            isPublished: true,
            deletedAt: null,
          }),
          orderBy: { displayOrder: 'asc' },
          take: 10,
        }),
      );
      expect(result).toEqual([mockBanner]);
    });
  });

  describe('logInteraction', () => {
    it('should create a banner interaction', async () => {
      await service.logInteraction('banner-1', 'user-1', 'IMPRESSION');
      expect(prisma.banner.findFirst).toHaveBeenCalled();
      expect(prisma.bannerInteraction.create).toHaveBeenCalledWith({
        data: {
          bannerId: 'banner-1',
          userId: 'user-1',
          type: 'IMPRESSION',
        },
      });
    });

    it('should throw NotFoundException if banner not found', async () => {
      prisma.banner.findFirst.mockResolvedValueOnce(null);
      await expect(
        service.logInteraction('nonexistent', 'user-1', 'TAP'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('getAnalytics', () => {
    it('should return analytics for a banner', async () => {
      prisma.bannerInteraction.count
        .mockResolvedValueOnce(1250)
        .mockResolvedValueOnce(87);
      prisma.$queryRaw
        .mockResolvedValueOnce([{ count: BigInt(340) }] as any)
        .mockResolvedValueOnce([{ count: BigInt(62) }] as any);

      const result = await service.getAnalytics('banner-1');
      expect(result).toHaveProperty('bannerId', 'banner-1');
      expect(result).toHaveProperty('impressions');
      expect(result).toHaveProperty('taps');
      expect(result).toHaveProperty('tapThroughRate');
    });

    it('should throw NotFoundException if banner not found', async () => {
      prisma.banner.findFirst.mockResolvedValueOnce(null);
      await expect(service.getAnalytics('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
