-- CreateTable
CREATE TABLE "eventi_pratica" (
    "id" UUID NOT NULL,
    "praticaId" UUID,
    "targetCompanyId" UUID NOT NULL,
    "tipo" TEXT NOT NULL,
    "titolo" TEXT NOT NULL,
    "testo" TEXT NOT NULL,
    "ctaLabel" TEXT,
    "ctaHref" TEXT,
    "seenAt" TIMESTAMP(3),
    "seenByUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "eventi_pratica_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "eventi_pratica_targetCompanyId_seenAt_idx" ON "eventi_pratica"("targetCompanyId", "seenAt");

-- CreateIndex
CREATE INDEX "eventi_pratica_praticaId_idx" ON "eventi_pratica"("praticaId");
