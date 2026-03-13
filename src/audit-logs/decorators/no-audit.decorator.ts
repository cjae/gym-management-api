import { SetMetadata } from '@nestjs/common';

export const NO_AUDIT_KEY = 'no-audit';
export const NoAudit = () => SetMetadata(NO_AUDIT_KEY, true);
