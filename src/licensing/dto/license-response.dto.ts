export class LicenseResponseDto {
  status: 'ACTIVE' | 'SUSPENDED' | 'EXPIRED';
  gymName?: string;
  tierName?: string;
  maxMembers?: number;
  expiresAt?: string;
}
