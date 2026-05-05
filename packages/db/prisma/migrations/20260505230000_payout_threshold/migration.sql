-- AlterTable: soglia payout automatico per company (item 12 release 2026-05)
ALTER TABLE "companies"
  ADD COLUMN "payoutThresholdCent" INTEGER NOT NULL DEFAULT 100000;
