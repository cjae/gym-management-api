import { SetMetadata } from '@nestjs/common';

/**
 * Marks a route as callable while the authenticated user's `mustChangePassword`
 * flag is true. All other routes are 403'd by the global
 * `MustChangePasswordGuard` until the user changes their temporary password.
 *
 * Decorate only the minimum set of routes needed to complete the password
 * change (change-password, logout, me).
 */
export const ALLOW_WHILE_MUST_CHANGE_PASSWORD_KEY =
  'allowWhileMustChangePassword';
export const AllowWhileMustChangePassword = () =>
  SetMetadata(ALLOW_WHILE_MUST_CHANGE_PASSWORD_KEY, true);
