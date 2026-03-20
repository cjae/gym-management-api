import { SetMetadata } from '@nestjs/common';

export const FEATURE_KEY = 'requiredFeature';
export const RequiresFeature = (feature: string) =>
  SetMetadata(FEATURE_KEY, feature);
