import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateBannerDto } from './dto/create-banner.dto';
import { UpdateBannerDto } from './dto/update-banner.dto';
import { BannerInteractionType, Prisma } from '@prisma/client';

@Injectable()
export class BannersService {
  private readonly logger = new Logger(BannersService.name);

  constructor(private prisma: PrismaService) {}

  async create(dto: CreateBannerDto, createdBy: string) {
    const startDate = new Date(dto.startDate);
    const endDate = new Date(dto.endDate);

    if (endDate <= startDate) {
      throw new BadRequestException('endDate must be after startDate');
    }

    return this.prisma.banner.create({
      data: {
        title: dto.title,
        body: dto.body,
        imageUrl: dto.imageUrl,
        ctaType: dto.ctaType,
        ctaTarget: dto.ctaTarget,
        ctaLabel: dto.ctaLabel,
        discountCode: dto.discountCode,
        displayOrder: dto.displayOrder ?? 0,
        startDate,
        endDate,
        createdBy,
      },
    });
  }

  async findAll(page = 1, limit = 20) {
    const where: Prisma.BannerWhereInput = { deletedAt: null };

    const [banners, total] = await Promise.all([
      this.prisma.banner.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.banner.count({ where }),
    ]);

    const data = await Promise.all(
      banners.map(async (banner) => {
        const [totalImpressions, totalTaps] = await Promise.all([
          this.prisma.bannerInteraction.count({
            where: { bannerId: banner.id, type: 'IMPRESSION' },
          }),
          this.prisma.bannerInteraction.count({
            where: { bannerId: banner.id, type: 'TAP' },
          }),
        ]);
        return { ...banner, totalImpressions, totalTaps };
      }),
    );

    return { data, total, page, limit };
  }

  async findOne(id: string) {
    const banner = await this.prisma.banner.findFirst({
      where: { id, deletedAt: null },
    });
    if (!banner) {
      throw new NotFoundException('Banner not found');
    }
    return banner;
  }

  async update(id: string, dto: UpdateBannerDto) {
    const banner = await this.findOne(id);

    const data: Prisma.BannerUpdateInput = { ...dto };

    if (dto.startDate) {
      data.startDate = new Date(dto.startDate);
    }
    if (dto.endDate) {
      data.endDate = new Date(dto.endDate);
    }

    const effectiveStart = dto.startDate
      ? new Date(dto.startDate)
      : banner.startDate;
    const effectiveEnd = dto.endDate ? new Date(dto.endDate) : banner.endDate;
    if (effectiveEnd <= effectiveStart) {
      throw new BadRequestException('endDate must be after startDate');
    }

    return this.prisma.banner.update({
      where: { id },
      data,
    });
  }

  async softDelete(id: string) {
    await this.findOne(id);
    return this.prisma.banner.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  async findActive() {
    const now = new Date();
    return this.prisma.banner.findMany({
      where: {
        isPublished: true,
        deletedAt: null,
        startDate: { lte: now },
        endDate: { gt: now },
      },
      orderBy: { displayOrder: 'asc' },
      take: 10,
      select: {
        id: true,
        title: true,
        body: true,
        imageUrl: true,
        ctaType: true,
        ctaTarget: true,
        ctaLabel: true,
        discountCode: true,
        displayOrder: true,
      },
    });
  }

  async logInteraction(
    bannerId: string,
    userId: string,
    type: BannerInteractionType,
  ) {
    await this.findOne(bannerId);
    return this.prisma.bannerInteraction.create({
      data: { bannerId, userId, type },
    });
  }

  async getAnalytics(id: string) {
    const banner = await this.findOne(id);

    const [totalImpressions, totalTaps, uniqueImpressions, uniqueTaps] =
      await Promise.all([
        this.prisma.bannerInteraction.count({
          where: { bannerId: id, type: 'IMPRESSION' },
        }),
        this.prisma.bannerInteraction.count({
          where: { bannerId: id, type: 'TAP' },
        }),
        this.prisma.$queryRaw<
          { count: bigint }[]
        >`SELECT COUNT(DISTINCT "userId") as count FROM "BannerInteraction" WHERE "bannerId" = ${id} AND "type" = 'IMPRESSION'`,
        this.prisma.$queryRaw<
          { count: bigint }[]
        >`SELECT COUNT(DISTINCT "userId") as count FROM "BannerInteraction" WHERE "bannerId" = ${id} AND "type" = 'TAP'`,
      ]);

    const uniqueImpressionsCount = Number(uniqueImpressions[0]?.count ?? 0);
    const uniqueTapsCount = Number(uniqueTaps[0]?.count ?? 0);
    const tapThroughRate =
      uniqueImpressionsCount > 0
        ? Math.round((uniqueTapsCount / uniqueImpressionsCount) * 10000) / 100
        : 0;

    return {
      bannerId: id,
      title: banner.title,
      period: { startDate: banner.startDate, endDate: banner.endDate },
      impressions: { total: totalImpressions, unique: uniqueImpressionsCount },
      taps: { total: totalTaps, unique: uniqueTapsCount },
      tapThroughRate,
    };
  }
}
