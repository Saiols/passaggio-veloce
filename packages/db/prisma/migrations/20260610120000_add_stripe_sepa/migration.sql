-- CreateEnum
CREATE TYPE "SepaMandateStatus" AS ENUM ('PENDING', 'ACTIVE', 'FAILED');

-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "sepaMandateId" TEXT,
ADD COLUMN     "sepaMandateStatus" "SepaMandateStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "stripeCustomerId" TEXT,
ADD COLUMN     "stripePaymentMethodId" TEXT;
