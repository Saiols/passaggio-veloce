-- CreateTable
CREATE TABLE "opposizioni_catalogo" (
    "id" UUID NOT NULL,
    "chiave" TEXT NOT NULL,
    "nominativo" TEXT,
    "note" TEXT,
    "registrataDaId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revocataAt" TIMESTAMP(3),
    "revocataDaId" UUID,
    CONSTRAINT "opposizioni_catalogo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "opposizioni_catalogo_chiave_key" ON "opposizioni_catalogo"("chiave");

-- CreateIndex
CREATE INDEX "opposizioni_catalogo_revocataAt_idx" ON "opposizioni_catalogo"("revocataAt");

-- AddForeignKey
ALTER TABLE "opposizioni_catalogo" ADD CONSTRAINT "opposizioni_catalogo_registrataDaId_fkey" FOREIGN KEY ("registrataDaId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opposizioni_catalogo" ADD CONSTRAINT "opposizioni_catalogo_revocataDaId_fkey" FOREIGN KEY ("revocataDaId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
