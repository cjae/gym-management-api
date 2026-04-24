import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { LicensingConfig, getLicensingConfigName } from './licensing.config';
import { LicenseResponseDto } from './dto/license-response.dto';
import { LicensePlanResponseDto } from './dto/license-plan-response.dto';
import axios from 'axios';

const GRACE_PERIOD_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Bucketed member count used when `LICENSE_TELEMETRY_MEMBER_COUNT=false`.
 * The license server can still enforce tier caps against the upper bound
 * of the bucket, but the exact customer-base size is not disclosed.
 */
const memberCountBucket = (count: number): string => {
  if (count < 100) return '<100';
  if (count < 500) return '<500';
  if (count < 1000) return '<1000';
  return '>=1000';
};

@Injectable()
export class LicensingService implements OnModuleInit {
  private readonly logger = new Logger(LicensingService.name);
  private readonly licenseKey: string;
  private readonly licenseServerUrl: string;
  private readonly telemetryMemberCount: boolean;
  private readonly appVersion: string;
  private readonly instanceFingerprint: string;

  private cachedFeatures: string[] | null = null;
  private featuresCachedAt: number = 0;
  private static readonly FEATURES_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {
    const config = this.configService.get<LicensingConfig>(
      getLicensingConfigName(),
    )!;
    this.licenseKey = config.licenseKey;
    this.licenseServerUrl = config.licenseServerUrl;
    this.telemetryMemberCount = config.telemetryMemberCount;
    this.appVersion = config.appVersion;
    // Stable, non-reversible per-instance identifier derived from the
    // license key. Lets the vendor detect duplicate installs without
    // needing the raw key in the body (it's already in the header).
    this.instanceFingerprint = this.licenseKey
      ? createHash('sha256').update(this.licenseKey).digest('hex').slice(0, 16)
      : '';
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
      where: { role: 'MEMBER', deletedAt: null },
    });

    // -----------------------------------------------------------------
    // LICENSE PHONE-HOME PAYLOAD — minimal-disclosure contract.
    //
    // Fields sent to ${LICENSE_SERVER_URL}/api/v1/licenses/validate:
    //   - currentMemberCount : number | string
    //       Either the exact active-member count (default) OR a coarse
    //       bucket string ("<100", "<500", "<1000", ">=1000") when
    //       LICENSE_TELEMETRY_MEMBER_COUNT=false. Used by the server
    //       for tier-cap enforcement only.
    //   - appVersion         : string
    //       Installed API build version. Used so the vendor can warn
    //       customers on known-vulnerable releases.
    //   - instanceFingerprint: string
    //       SHA-256(licenseKey) truncated to 16 hex chars. Non-reversible
    //       per-install identifier; lets the vendor detect duplicate
    //       installations without the raw key appearing in the body.
    //
    // Fields sent in headers:
    //   - X-License-Key : raw license key (over TLS)
    //
    // FIELDS EXPLICITLY NOT SENT (commercial / personal intelligence):
    //   - revenue / MRR / payment totals / per-subscription financials
    //   - check-in counts, attendance stats, streak data
    //   - user emails, names, phone numbers, or any PII
    //   - gym-settings contents, discount codes, pricing
    //   - referral graph, goal data, audit logs
    //
    // Any change to this contract MUST be reviewed — adding revenue or
    // usage telemetry here would exfiltrate customer commercial data.
    // -----------------------------------------------------------------
    const payload: {
      currentMemberCount: number | string;
      appVersion: string;
      instanceFingerprint: string;
    } = {
      currentMemberCount: this.telemetryMemberCount
        ? memberCount
        : memberCountBucket(memberCount),
      appVersion: this.appVersion,
      instanceFingerprint: this.instanceFingerprint,
    };

    try {
      const response = await axios.post<LicenseResponseDto>(
        `${this.licenseServerUrl}/api/v1/licenses/validate`,
        payload,
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
          maxAdmins: data.maxAdmins,
          features: data.features ?? [],
          expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
          lastCheckedAt: now,
          lastSuccessAt: now,
          rawResponse: data as unknown as Prisma.InputJsonValue,
        },
        create: {
          id: 'singleton',
          licenseKey: this.licenseKey,
          status: data.status,
          gymName: data.gymName,
          tierName: data.tierName,
          maxMembers: data.maxMembers,
          maxAdmins: data.maxAdmins,
          features: data.features ?? [],
          expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
          lastCheckedAt: now,
          lastSuccessAt: now,
          rawResponse: data as unknown as Prisma.InputJsonValue,
        },
      });

      this.logger.log(`License validated: ${data.status}`);
      this.cachedFeatures = (data.features as string[]) ?? [];
      this.featuresCachedAt = Date.now();
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
          this.cachedFeatures = null;
          this.featuresCachedAt = 0;
          return;
        }
      }

      const reason = axios.isAxiosError(error)
        ? (error.message ?? 'unknown axios error')
        : String(error);
      this.logger.warn(
        `License validation failed (network/server error), retaining cached status — ${reason}`,
      );
    }
  }

  async getMemberLimit(): Promise<number | null> {
    const cache = await this.prisma.licenseCache.findUnique({
      where: { id: 'singleton' },
    });
    return cache?.maxMembers ?? null;
  }

  async getAdminLimit(): Promise<number | null> {
    const cache = await this.prisma.licenseCache.findUnique({
      where: { id: 'singleton' },
    });
    return cache?.maxAdmins ?? null;
  }

  async getFeatures(): Promise<string[]> {
    const now = Date.now();
    if (
      this.cachedFeatures !== null &&
      now - this.featuresCachedAt < LicensingService.FEATURES_CACHE_TTL_MS
    ) {
      return this.cachedFeatures;
    }

    const cache = await this.prisma.licenseCache.findUnique({
      where: { id: 'singleton' },
    });
    this.cachedFeatures = cache?.features ? (cache.features as string[]) : [];
    this.featuresCachedAt = now;
    return this.cachedFeatures;
  }

  async hasFeature(key: string): Promise<boolean> {
    if (!this.isConfigured()) return true;

    const features = await this.getFeatures();
    return features.includes(key);
  }

  async getLicensePlan(): Promise<LicensePlanResponseDto> {
    if (!this.isConfigured()) {
      return {
        status: 'ACTIVE',
        isDevMode: true,
        gymName: null,
        tierName: null,
        maxMembers: null,
        maxAdmins: null,
        expiresAt: null,
        features: [],
        lastCheckedAt: null,
      };
    }

    const cache = await this.prisma.licenseCache.findUnique({
      where: { id: 'singleton' },
    });

    return {
      status: (cache?.status as 'ACTIVE' | 'SUSPENDED' | 'EXPIRED') ?? 'ACTIVE',
      isDevMode: false,
      gymName: cache?.gymName ?? null,
      tierName: cache?.tierName ?? null,
      maxMembers: cache?.maxMembers ?? null,
      maxAdmins: cache?.maxAdmins ?? null,
      expiresAt: cache?.expiresAt?.toISOString() ?? null,
      features: cache?.features ? (cache.features as string[]) : [],
      lastCheckedAt: cache?.lastCheckedAt?.toISOString() ?? null,
    };
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
