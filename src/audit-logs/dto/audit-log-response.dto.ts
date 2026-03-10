import { AuditAction } from '@prisma/client';

class AuditLogUserDto {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
}

export class AuditLogResponseDto {
  id: string;
  userId: string | null;
  action: AuditAction;
  resource: string;
  resourceId: string | null;
  oldData: Record<string, unknown> | null;
  newData: Record<string, unknown> | null;
  ipAddress: string | null;
  userAgent: string | null;
  route: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
  user: AuditLogUserDto | null;
}

class PaginationMetaDto {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export class PaginatedAuditLogResponseDto {
  data: AuditLogResponseDto[];
  meta: PaginationMetaDto;
}
