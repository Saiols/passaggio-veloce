-- Documenti d'identità alternativi alla CI.
ALTER TYPE "DocumentoTipo" ADD VALUE IF NOT EXISTS 'PASSAPORTO';
ALTER TYPE "DocumentoTipo" ADD VALUE IF NOT EXISTS 'PATENTE';
