import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { AppShell } from '@/components/app-shell';
import { Alert, Card } from '@/components/ui';
import { isOwner } from '@/lib/auth/permissions';
import { formatCurrencyCent } from '@/lib/format';
import { getRigaTariffaCorrente } from '@/lib/tariffario';
import { getRiaccettazionePendente } from '@/lib/tariffe/riaccettazione';
import { RiaccettazioneForm } from './client';

export const metadata = { title: 'Nuove condizioni economiche' };

/**
 * Pagina di riaccettazione della clausola 3 (fascia b: variazione oltre il 20%
 * o strutturale). Ci si arriva dal messaggio di errore del gate su invio e
 * accettazione pratiche.
 *
 * Mostra gli importi in vigore e ricorda le due alternative che il contratto
 * garantisce: accettare, oppure recedere senza penali. Non è un vicolo cieco e
 * non è una sospensione — le pratiche già in corso continuano.
 */
export default async function TariffeAggiornatePage() {
  const session = await auth();
  if (!session?.user) redirect('/login');
  const companyId = session.user.companyId;

  const pendente = companyId ? await getRiaccettazionePendente(companyId) : null;
  const riga = await getRigaTariffaCorrente();

  return (
    <AppShell session={session} activePath="/tariffe-aggiornate">
      <div className="mx-auto w-full max-w-3xl px-5 py-8 sm:px-6 sm:py-10">
        <h1 className="text-[28px] font-extrabold tracking-tight text-pv-navy-900 sm:text-[32px]">
          Nuove condizioni economiche
        </h1>

        {!pendente ? (
          <div className="mt-6">
            <Alert variant="success" title="Nessuna conferma in sospeso">
              Le condizioni economiche in vigore sono già accettate. Puoi tornare alle tue{' '}
              <Link href="/pratiche" className="font-semibold text-pv-navy-700 hover:underline">
                pratiche
              </Link>
              .
            </Alert>
          </div>
        ) : (
          <>
            <p className="mt-3 text-[14px] text-pv-slate-600">
              Ti avevamo comunicato via email, con 30 giorni di preavviso, una variazione delle
              tariffe superiore al 20%. È entrata in vigore il{' '}
              <strong>
                {pendente.efficaceDal.toLocaleDateString('it-IT', {
                  day: '2-digit',
                  month: 'long',
                  year: 'numeric',
                  timeZone: 'Europe/Rome',
                })}
              </strong>
              . Come previsto dalla{' '}
              <Link href="/termini" className="font-semibold text-pv-navy-700 hover:underline">
                clausola 3 dei Termini
              </Link>
              , per applicarla serve la tua conferma esplicita.
            </p>

            {riga && (
              <Card className="mt-6">
                <h2 className="text-[15px] font-bold text-pv-navy-800">Condizioni in vigore</h2>
                <table className="mt-3 w-full text-[13px]">
                  <thead className="text-left text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
                    <tr>
                      <th className="py-2">Tipo pratica</th>
                      <th className="text-right">Fee agenzia</th>
                      <th className="text-right">Compenso broker</th>
                      <th className="text-right">Affiliazione</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-pv-slate-100 text-pv-slate-700">
                    <tr>
                      <td className="py-2 font-semibold text-pv-navy-800">Passaggio semplice</td>
                      <td className="text-right">
                        {formatCurrencyCent(riga.sempliceFeeAgenziaCent)}
                      </td>
                      <td className="text-right">
                        {formatCurrencyCent(riga.sempliceCreditoBrokerCent)}
                      </td>
                      <td className="text-right">
                        {formatCurrencyCent(riga.sempliceAffiliazioneCent)}
                      </td>
                    </tr>
                    <tr>
                      <td className="py-2 font-semibold text-pv-navy-800">Minivoltura</td>
                      <td className="text-right">
                        {formatCurrencyCent(riga.minivolturaFeeAgenziaCent)}
                      </td>
                      <td className="text-right">
                        {formatCurrencyCent(riga.minivolturaCreditoBrokerCent)}
                      </td>
                      <td className="text-right">
                        {formatCurrencyCent(riga.minivolturaAffiliazioneCent)}
                      </td>
                    </tr>
                  </tbody>
                </table>
                <p className="mt-3 text-[12px] text-pv-slate-500">
                  Importi per veicolo. Le pratiche già inviate restano alle condizioni di quando
                  sono partite.
                </p>
              </Card>
            )}

            <div className="mt-6">
              <RiaccettazioneForm isTitolare={isOwner(session.user.role)} />
            </div>

            <div className="mt-6 rounded-[12px] bg-pv-slate-50 px-4 py-3 text-[12.5px] text-pv-slate-600">
              <strong>Se non intendi accettare</strong>, la clausola 3 ti riconosce il{' '}
              <strong>recesso senza penali</strong>: scrivi ad{' '}
              <a
                href="mailto:assistenza@passaggioveloce.it"
                className="font-semibold text-pv-navy-700 hover:underline"
              >
                assistenza@passaggioveloce.it
              </a>
              . Nel frattempo continui a lavorare le pratiche già in corso, e il saldo dei tuoi
              wallet resta interamente tuo e prelevabile.
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
