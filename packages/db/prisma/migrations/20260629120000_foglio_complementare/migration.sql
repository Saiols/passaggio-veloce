-- AlterEnum
ALTER TYPE "DocumentoTipo" ADD VALUE 'FOGLIO_COMPLEMENTARE';

-- CreateEnum
CREATE TYPE "TipoDocumentoVeicolo" AS ENUM ('LIBRETTO', 'FOGLIO_COMPLEMENTARE');

-- AlterTable
ALTER TABLE "veicoli" ADD COLUMN "tipoDocumento" "TipoDocumentoVeicolo" NOT NULL DEFAULT 'LIBRETTO';
