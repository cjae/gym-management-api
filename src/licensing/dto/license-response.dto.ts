export class LicenseResponseDto {
  status: 'ACTIVE' | 'SUSPENDED' | 'EXPIRED';
  gymName?: string;
  tierName?: string;
  maxMembers?: number;
  maxAdmins?: number;
  expiresAt?: string;
  features?: string[];
}
