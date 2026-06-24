import { redirect } from 'next/navigation';
import QRCode from 'qrcode';
import { auth } from '@/auth';
import { getOperatingSede } from '@/lib/auth/session-context';
import { prisma } from '@pv/db';
import { AppShell } from '@/components/app-shell';
import { Alert, Card, StatCard } from '@/components/ui';
import { formatCurrencyCent, formatDate, formatRelative } from '@/lib/format';
import { computeFees } from '@/lib/pricing';
import { CopyLinkButton } from './copy-link-button';
import { getRendimento } from '@/app/wallet/rendimento';
import { RendimentoChart } from '@/app/wallet/rendimento-chart';

// Righe della tabella commissioni affiliazione, una per tipo pratica gestito.
// Gli importi sono DERIVATI da computeFees (lib/pricing) così restano allineati
// ai prezzi reali: costo affiliazione per veicolo, diviso 50/50 se la pratica
// ha due referral (broker + agenzia).
const COMMISSIONI_TABELLA = [
  { label: 'Passaggio di proprietà semplice', tipo: 'SEMPLICE', multiplo: false },
  { label: 'Passaggio di proprietà semplice multiplo', tipo: 'SEMPLICE', multiplo: true },
  { label: 'Minivoltura singola', tipo: 'MINIVOLTURA', multiplo: false },
  { label: 'Minivoltura multipla', tipo: 'MINIVOLTURA', multiplo: true },
] as const;

export default async function AffiliazionePage() {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (
    session.user.companyType !== 'DEALER' &&
    session.user.companyType !== 'AGENZIA'
  ) {
    return (
      <AppShell session={session} activePath="/affiliazione">
        <div className="mx-auto max-w-3xl px-5 py-10 sm:px-6">
          <Alert variant="info">
            Il programma affiliazione è dedicato a broker e agenzie.
          </Alert>
        </div>
      </AppShell>
    );
  }

  const companyId = session.user.companyId!;

  // Multi-sede: il link di affiliazione è quello della sede operativa; le
  // commissioni e i referral restano a livello madre (companyId). Il rendimento
  // affiliazione viene dal wallet affiliazione della madre.
  const operatingSede = await getOperatingSede();

  const [company, affWallet, sedeRow, referrals, commissioni, clickCount] = await Promise.all([
    prisma.company.findUnique({
      where: { id: companyId },
      select: {
        id: true,
        ragioneSociale: true,
        referralCode: true,
      },
    }),
    prisma.wallet.findUnique({ where: { companyId }, select: { id: true } }),
    operatingSede
      ? prisma.sede.findUnique({ where: { id: operatingSede.id }, select: { referralCode: true } })
      : Promise.resolve(null),
    prisma.company.findMany({
      where: { referenteId: companyId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        ragioneSociale: true,
        type: true,
        citta: true,
        provincia: true,
        suspendedAt: true,
        createdAt: true,
        _count: {
          select: { commissioniGenerate: true },
        },
      },
    }),
    prisma.commissioneAffiliazione.aggregate({
      where: { referenteId: companyId, stato: 'ACCREDITATA' },
      _sum: { importoNettoCent: true },
      _count: { _all: true },
    }),
    prisma.referralClick.count({ where: { companyId } }),
  ]);

  if (!company) redirect('/profilo');

  const totaleAccreditatoCent = commissioni._sum.importoNettoCent ?? 0;
  const numCommissioni = commissioni._count._all;

  const earningsRendimento = await getRendimento(affWallet?.id ?? null, '12m', [
    'CREDITO_AFFILIAZIONE',
  ]);

  // Base URL per il link di affiliazione: priorità env, fallback host attuale.
  // Punta a /r/<code> (non /register?ref=) per fare pixel tracking del click
  // prima del redirect al wizard.
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
  // Codice referral della sede operativa (fallback: legacy Company.referralCode).
  const referralCode = sedeRow?.referralCode ?? company.referralCode ?? null;
  const link = referralCode ? `${appUrl}/r/${referralCode}` : null;

  // QR code generato server-side come data URL (no dipendenza da servizi esterni).
  const qrDataUrl = link
    ? await QRCode.toDataURL(link, {
        margin: 1,
        width: 240,
        color: { dark: '#0a2540', light: '#ffffff' },
      })
    : null;

  return (
    <AppShell session={session} activePath="/affiliazione">
      <div className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-6 sm:py-10">
        <header className="mb-7">
          <p className="text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
            Programma affiliazione
          </p>
          <h1 className="mt-1 text-[28px] font-extrabold tracking-tight text-pv-navy-900 sm:text-[32px]">
            Guadagna invitando colleghi
          </h1>
          <p className="mt-1 text-[14px] text-pv-slate-500">
            Per ogni pratica completata da chi hai portato in piattaforma
            ricevi una commissione automatica. Per sempre, finché il referral
            resta attivo.
          </p>
        </header>

        <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <StatCard label="Click sul link" value={clickCount} accent="slate" />
          <StatCard label="Referral attivi" value={referrals.filter((r) => !r.suspendedAt).length} accent="navy" />
          <StatCard label="Commissioni accreditate" value={numCommissioni} accent="green" />
          <Card>
            <p className="text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
              Totale guadagnato
            </p>
            <p className="mt-2 text-[24px] font-extrabold text-pv-navy-900">
              {formatCurrencyCent(totaleAccreditatoCent)}
            </p>
            <p className="mt-1 text-[11px] text-pv-slate-500">
              dalle pratiche completate dei tuoi referral
            </p>
          </Card>
        </div>

        <Card className="mb-6">
          <h2 className="text-[15px] font-bold text-pv-navy-800">
            Il tuo link affiliazione
          </h2>
          <p className="mt-1 text-[12.5px] text-pv-slate-500">
            Condividi questo link con colleghi che vogliono iscriversi a
            Passaggio Veloce. Quando completano la registrazione vengono
            associati a te in modo permanente.
          </p>
          {link ? (
            <>
              <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
                <code className="flex-1 truncate rounded-[10px] border border-pv-slate-200 bg-pv-slate-50 px-3 py-2 text-[12.5px] text-pv-navy-800">
                  {link}
                </code>
                <CopyLinkButton link={link} />
              </div>
              {qrDataUrl && (
                <div className="mt-5 flex flex-col items-start gap-3 sm:flex-row sm:items-center">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={qrDataUrl}
                    alt="QR code link affiliazione"
                    width={120}
                    height={120}
                    className="rounded-[10px] border border-pv-slate-200 bg-white p-2"
                  />
                  <div className="text-[12.5px] text-pv-slate-500">
                    <p className="font-semibold text-pv-navy-800">Codice QR pronto da condividere</p>
                    <p className="mt-1">
                      Stampa il QR su biglietti da visita, brochure o
                      mostralo dal telefono. Chi lo scansiona arriva
                      direttamente al form di registrazione associato a te.
                    </p>
                    <p className="mt-2">
                      <a
                        href={qrDataUrl}
                        download={`pv-affiliazione-${referralCode}.png`}
                        className="font-semibold text-pv-navy-700 hover:underline"
                      >
                        Scarica PNG
                      </a>
                    </p>
                  </div>
                </div>
              )}
            </>
          ) : (
            <p className="mt-3 text-[13px] text-pv-red-500">
              Codice referral non disponibile. Contatta il supporto.
            </p>
          )}
        </Card>

        {earningsRendimento.count > 0 && (
          <Card className="mb-6">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div>
                <h2 className="text-[15px] font-bold text-pv-navy-800">
                  Earnings affiliazione · ultimi 12 mesi
                </h2>
                <p className="mt-1 text-[12.5px] text-pv-slate-500">
                  Solo commissioni accreditate dai tuoi referral.
                </p>
              </div>
              <p className="text-[20px] font-extrabold text-pv-navy-900">
                {formatCurrencyCent(earningsRendimento.totalCent)}
              </p>
            </div>
            <RendimentoChart
              buckets={earningsRendimento.buckets}
              accent="orange"
            />
          </Card>
        )}

        <Card>
          <h2 className="text-[15px] font-bold text-pv-navy-800">
            Tabella commissioni
          </h2>
          <table className="mt-3 w-full text-[13px]">
            <thead className="text-left text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
              <tr>
                <th className="py-2">Tipo pratica</th>
                <th className="py-2">Solo tuo referral</th>
                <th className="py-2">Tuo referral + altro</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-pv-slate-100 text-pv-slate-700">
              {COMMISSIONI_TABELLA.map((r) => {
                const base = computeFees({
                  tipo: r.tipo,
                  numeroVeicoli: 1,
                }).costoAffiliazioneTotaleCent;
                const suffix = r.multiplo ? ' × N veicoli' : '';
                return (
                  <tr key={r.label}>
                    <td className="py-2 font-semibold text-pv-navy-800">
                      {r.label}
                    </td>
                    <td className="py-2">
                      {formatCurrencyCent(base)}
                      {suffix}
                    </td>
                    <td className="py-2">
                      {formatCurrencyCent(Math.floor(base / 2))}
                      {suffix}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="mt-3 text-[11.5px] text-pv-slate-500">
            La commissione è per veicolo. Il bonus di una pratica è fisso (max
            10€ per il passaggio semplice, 5€ per la minivoltura): lo prendi
            intero se sei l&apos;unico affiliante coinvolto, oppure diviso 50/50
            con un altro affiliante se il broker e l&apos;agenzia della pratica
            sono stati portati da due affilianti diversi.
          </p>
        </Card>

        <Card className="mt-6">
          <h2 className="text-[15px] font-bold text-pv-navy-800">
            Tuoi referral ({referrals.length})
          </h2>
          {referrals.length === 0 ? (
            <p className="mt-3 text-[13px] text-pv-slate-500">
              Non hai ancora portato nessuno. Condividi il tuo link per iniziare.
            </p>
          ) : (
            <ul className="mt-3 divide-y divide-pv-slate-100 text-[13px]">
              {referrals.map((r) => (
                <li
                  key={r.id}
                  className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="font-semibold text-pv-navy-900">
                      {r.ragioneSociale}
                      {r.suspendedAt && (
                        <span className="ml-2 inline-flex items-center rounded-full bg-pv-red-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-pv-red-500">
                          Sospeso
                        </span>
                      )}
                    </p>
                    <p className="text-[11px] text-pv-slate-500">
                      {r.type === 'DEALER' ? 'Broker' : 'Agenzia'} · {r.citta} ({r.provincia})
                      · iscritto {formatDate(r.createdAt)}
                    </p>
                  </div>
                  <p className="text-[12px] text-pv-slate-500 sm:text-right">
                    {r._count.commissioniGenerate} commission
                    {r._count.commissioniGenerate === 1 ? 'e' : 'i'} maturat
                    {r._count.commissioniGenerate === 1 ? 'a' : 'e'}
                    {r.suspendedAt
                      ? ` · sospeso ${formatRelative(r.suspendedAt)}`
                      : ''}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </AppShell>
  );
}
