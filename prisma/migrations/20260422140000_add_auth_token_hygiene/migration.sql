-- M3/M4 — auth token hygiene.
--
-- (1) sessionsInvalidatedAt on User: bumped on logout and on refresh-token
--     reuse detection. JwtStrategy / JwtRefreshStrategy reject any token
--     whose embedded `sessionsInvalidatedAt` is older than the current
--     value on the user row. Closes the race between logout and a parallel
--     /auth/refresh minting a new JTI before the InvalidatedToken write
--     lands.
--
-- (2) RefreshToken table: persistent refresh-token records keyed by a SHA-256
--     hash of the opaque token. Enables reuse detection (presenting a token
--     whose `usedAt` is already set) and family revocation (every sibling in
--     the same `familyId` is marked revoked when reuse is detected).
--
-- (3) AUTH_REFRESH_REUSE AuditAction so reuse events are surfaced in the
--     SUPER_ADMIN audit log.

ALTER TABLE "User"
    ADD COLUMN "sessionsInvalidatedAt" TIMESTAMP(3);

ALTER TYPE "AuditAction" ADD VALUE 'AUTH_REFRESH_REUSE';

CREATE TABLE "RefreshToken" (
    "id"           TEXT          NOT NULL,
    "userId"       TEXT          NOT NULL,
    "familyId"     TEXT          NOT NULL,
    "tokenHash"    TEXT          NOT NULL,
    "jti"          TEXT          NOT NULL,
    "usedAt"       TIMESTAMP(3),
    "revokedAt"    TIMESTAMP(3),
    "replacedById" TEXT,
    "createdAt"    TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt"    TIMESTAMP(3)  NOT NULL,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RefreshToken_tokenHash_key"     ON "RefreshToken"("tokenHash");
CREATE UNIQUE INDEX "RefreshToken_jti_key"           ON "RefreshToken"("jti");
CREATE UNIQUE INDEX "RefreshToken_replacedById_key"  ON "RefreshToken"("replacedById");
CREATE        INDEX "RefreshToken_userId_idx"        ON "RefreshToken"("userId");
CREATE        INDEX "RefreshToken_familyId_idx"      ON "RefreshToken"("familyId");
CREATE        INDEX "RefreshToken_expiresAt_idx"     ON "RefreshToken"("expiresAt");

ALTER TABLE "RefreshToken"
    ADD CONSTRAINT "RefreshToken_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "RefreshToken"
    ADD CONSTRAINT "RefreshToken_replacedById_fkey"
    FOREIGN KEY ("replacedById") REFERENCES "RefreshToken"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
