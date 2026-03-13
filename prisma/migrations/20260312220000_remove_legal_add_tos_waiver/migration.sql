-- DropForeignKey
ALTER TABLE "DocumentSignature" DROP CONSTRAINT "DocumentSignature_documentId_fkey";

-- DropForeignKey
ALTER TABLE "DocumentSignature" DROP CONSTRAINT "DocumentSignature_memberId_fkey";

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "tosAcceptedAt" TIMESTAMP(3),
ADD COLUMN     "waiverAcceptedAt" TIMESTAMP(3);

-- DropTable
DROP TABLE "DocumentSignature";

-- DropTable
DROP TABLE "LegalDocument";
