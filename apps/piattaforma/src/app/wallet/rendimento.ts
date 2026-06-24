import 'server-only';
import { prisma } from '@pv/db';

export type RendimentoPeriod = '7d' | '30d' | '12m' | 'ytd';

export type RendimentoBucket = {
  label: string;
  /** Importo netto della riga (cent), positivo per crediti */
  importoCent: number;
};

export type RendimentoData = {
  period: RendimentoPeriod;
  buckets: RendimentoBucket[];
  /** Totale del periodo (cent) */
  totalCent: number;
  /** Numero transazioni considerate */
  count: number;
};

function startDateForPeriod(period: RendimentoPeriod): Date {
  const now = new Date();
  if (period === '7d') {
    const d = new Date(now);
    d.setDate(d.getDate() - 6);
    d.setHours(0, 0, 0, 0);
    return d;
  }
  if (period === '30d') {
    const d = new Date(now);
    d.setDate(d.getDate() - 29);
    d.setHours(0, 0, 0, 0);
    return d;
  }
  if (period === '12m') {
    const d = new Date(now);
    d.setMonth(d.getMonth() - 11);
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    return d;
  }
  // ytd
  const d = new Date(now.getFullYear(), 0, 1);
  return d;
}

const MONTH_LABELS = [
  'Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu',
  'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic',
];

/**
 * Ritorna i bucket di rendimento per il wallet della company indicata,
 * filtrati su un set di tipi di transazione (es. solo crediti pratica
 * + crediti affiliazione, escludendo payout). Aggrega per giorno
 * (7d/30d) o per mese (12m/ytd).
 */
export async function getRendimento(
  walletId: string | null,
  period: RendimentoPeriod,
  types?: readonly string[],
): Promise<RendimentoData> {
  if (!walletId) {
    return { period, buckets: [], totalCent: 0, count: 0 };
  }

  const since = startDateForPeriod(period);
  const txs = await prisma.transazioneWallet.findMany({
    where: {
      walletId,
      createdAt: { gte: since },
      ...(types && types.length > 0 ? { tipo: { in: types as never } } : {}),
    },
    select: { importoCent: true, createdAt: true },
  });

  const isMonthly = period === '12m' || period === 'ytd';
  const map = new Map<string, number>();

  if (isMonthly) {
    const now = new Date();
    const cursor = new Date(since);
    while (
      cursor.getFullYear() < now.getFullYear() ||
      (cursor.getFullYear() === now.getFullYear() &&
        cursor.getMonth() <= now.getMonth())
    ) {
      const key = `${cursor.getFullYear()}-${cursor.getMonth()}`;
      map.set(key, 0);
      cursor.setMonth(cursor.getMonth() + 1);
    }
    for (const t of txs) {
      const k = `${t.createdAt.getFullYear()}-${t.createdAt.getMonth()}`;
      map.set(k, (map.get(k) ?? 0) + t.importoCent);
    }
  } else {
    const days = period === '7d' ? 7 : 30;
    for (let i = 0; i < days; i++) {
      const d = new Date(since);
      d.setDate(since.getDate() + i);
      const key = d.toISOString().slice(0, 10);
      map.set(key, 0);
    }
    for (const t of txs) {
      const key = t.createdAt.toISOString().slice(0, 10);
      if (map.has(key)) {
        map.set(key, (map.get(key) ?? 0) + t.importoCent);
      }
    }
  }

  const buckets: RendimentoBucket[] = Array.from(map.entries()).map(
    ([key, importo]) => {
      let label: string;
      if (isMonthly) {
        const [, monthStr] = key.split('-');
        label = MONTH_LABELS[Number(monthStr)] ?? key;
      } else {
        // Parsing manuale per evitare hydration mismatch dovuto a timezone:
        // `new Date('YYYY-MM-DD').getDate()` interpreta come UTC ma poi
        // legge il fuso locale, quindi server e client possono divergere.
        const [, monthStr, dayStr] = key.split('-');
        label = `${dayStr}/${monthStr}`;
      }
      return { label, importoCent: importo };
    },
  );

  const totalCent = buckets.reduce((acc, b) => acc + b.importoCent, 0);
  return { period, buckets, totalCent, count: txs.length };
}
