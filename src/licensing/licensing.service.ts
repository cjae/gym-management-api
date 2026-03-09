import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import {
  LicensingConfig,
  getLicensingConfigName,
} from './licensing.config';
import { LicenseResponseDto } from './dto/license-response.dto';
import axios from 'axios';

const GRACE_PERIOD_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

@Injectable()
export class LicensingService implements OnModuleInit {
  private readonly logger = new Logger(LicensingService.name);
  private readonly licenseKey: string;
  private readonly licenseServerUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {
    const config =
      this.configService.get<LicensingConfig>(getLicensingConfigName())!;
    this.licenseKey = config.licenseKey;
    this.licenseServerUrl = config.licenseServerUrl;
  }

  private isConfigured(): boolean {
    return !!(this.licenseKey && this.licenseServerUrl);
  }

  async isActive(): Promise<boolean> {
    if (!this.isConfigured()) return true;

    const cache = await this.prisma.licenseCache.findUnique({
      where: { id: 'singleton' },
    });

    if (!cache) return true;

    if (cache.status === 'ACTIVE') return true;

    if (cache.lastSuccessAt) {
      const elapsed = Date.now() - cache.lastSuccessAt.getTime();
      return elapsed <= GRACE_PERIOD_MS;
    }

    return false;
  }

  async validateLicense(): Promise<void> {
    if (!this.isConfigured()) {
      this.logger.debug('No LICENSE_KEY configured, skipping validation');
      return;
    }

    const now = new Date();
    const memberCount = await this.prisma.user.count({
      where: { role: 'MEMBER' },
    });

    try {
      const response = await axios.post<LicenseResponseDto>(
        `${this.licenseServerUrl}/api/v1/licenses/validate`,
        {
          currentMemberCount: memberCount,
          appVersion: '1.0.0',
        },
        {
          headers: { 'X-License-Key': this.licenseKey },
          timeout: 10000,
        },
      );

      const data = response.data;

      await this.prisma.licenseCache.upsert({
        where: { id: 'singleton' },
        update: {
          licenseKey: this.licenseKey,
          status: data.status,
          gymName: data.gymName,
          tierName: data.tierName,
          maxMembers: data.maxMembers,
          expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
          lastCheckedAt: now,
          lastSuccessAt: now,
          rawResponse: data as any,
        },
        create: {
          id: 'singleton',
          licenseKey: this.licenseKey,
          status: data.status,
          gymName: data.gymName,
          tierName: data.tierName,
          maxMembers: data.maxMembers,
          expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
          lastCheckedAt: now,
          lastSuccessAt: now,
          rawResponse: data as any,
        },
      });

      this.logger.log(`License validated: ${data.status}`);
    } catch (error) {
      if (axios.isAxiosError(error) && error.response) {
        const status = error.response.status;
        if (status === 401 || status === 403) {
          this.logger.warn(`License rejected: HTTP ${status}`);
          await this.prisma.licenseCache.upsert({
            where: { id: 'singleton' },
            update: {
              licenseKey: this.licenseKey,
              status: 'SUSPENDED',
              lastCheckedAt: now,
            },
            create: {
              id: 'singleton',
              licenseKey: this.licenseKey,
              status: 'SUSPENDED',
              lastCheckedAt: now,
            },
          });
          return;
        }
      }

      this.logger.warn(
        'License validation failed (network/server error), retaining cached status',
      );
    }
  }

  async getMemberLimit(): Promise<number | null> {
    const cache = await this.prisma.licenseCache.findUnique({
      where: { id: 'singleton' },
    });
    return cache?.maxMembers ?? null;
  }

  async onModuleInit(): Promise<void> {
    if (this.isConfigured()) {
      this.logger.log('Validating license on startup...');
      await this.validateLicense();
    } else {
      this.logger.warn(
        'No LICENSE_KEY configured — running in unlicensed dev mode',
      );
    }
  }
}
