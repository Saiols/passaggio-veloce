/**
 * Script one-off da eseguire SOLO contro Neon prod prima di applicare la
 * migration `pricing_model_v2` (2026-05-01).
 *
 * Su prod ci sono pratiche con i vecchi enum (TRAPASSO_NETTO / MINIVOLTURA /
 * LOTTO_MASSIVO). La migration v2 fa CREATE TYPE PraticaTipo_new + cast
 * (tipo::text::PraticaTipo_new), che fallisce perché i valori vecchi non sono
 * presenti nel nuovo set. Soluzione: aggiungiamo i valori nuovi all'enum
 * esistente e rinominiamo le righe in autocommit, così il cast successivo
 * funziona.
 *
 * ALTER TYPE ... ADD VALUE non può girare in transaction: usiamo
 * $executeRawUnsafe che gira in autocommit.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function addEnumValueIfMissing(value: string): Promise<void> {
  const present = await prisma.$queryRawUnsafe<{ exists: boolean }[]>(
    `SELECT EXISTS (
       SELECT 1 FROM pg_enum
       WHERE enumlabel = $1
         AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'PraticaTipo')
     ) AS exists;`,
    value,
  );
  if (present[0]?.exists) {
    console.log(`  · valore '${value}' già presente nell'enum, skip`);
    return;
  }
  await prisma.$executeRawUnsafe(
    `ALTER TYPE "PraticaTipo" ADD VALUE '${value}';`,
  );
  console.log(`  · aggiunto valore '${value}' all'enum PraticaTipo`);
}

async function main(): Promise<void> {
  console.log('Pre-migration prod: porta enum PraticaTipo verso v2');

  // Step 1: estendi l'enum esistente con i valori nuovi (autocommit).
  await addEnumValueIfMissing('PASSAGGIO_PRIVATO');
  await addEnumValueIfMissing('MINIVOLTURE_MULTIPLE');

  // Step 2: rimappa le righe esistenti.
  const remap: Record<string, string> = {
    TRAPASSO_NETTO: 'PASSAGGIO_PRIVATO',
    MINIVOLTURA: 'MINIVOLTURE_MULTIPLE',
    LOTTO_MASSIVO: 'MINIVOLTURE_MULTIPLE',
  };
  for (const [oldVal, newVal] of Object.entries(remap)) {
    const updated = await prisma.$executeRawUnsafe(
      `UPDATE pratiche SET tipo = '${newVal}'::"PraticaTipo" WHERE tipo::text = '${oldVal}';`,
    );
    console.log(`  · ${oldVal} → ${newVal}: ${updated} righe aggiornate`);
  }

  // Step 3: verifica che non rimangano valori vecchi.
  const residual = await prisma.$queryRawUnsafe<{ tipo: string; n: bigint }[]>(
    `SELECT tipo::text AS tipo, COUNT(*) AS n FROM pratiche GROUP BY tipo;`,
  );
  console.log('Distribuzione finale pratiche per tipo:');
  for (const r of residual) console.log(`  ${r.tipo}: ${r.n}`);

  console.log('Pre-migration completata. Ora puoi lanciare prisma migrate deploy.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
