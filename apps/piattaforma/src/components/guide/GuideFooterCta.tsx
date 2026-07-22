import { headers } from 'next/headers';
import Link from 'next/link';
import { Button } from '@/components/ui';
import { isLandingOnlyHost } from '@/lib/landing-gate';

const CONTATTACI_HREF =
  'mailto:info@passaggioveloce.it?subject=' +
  encodeURIComponent('Richiesta accesso Passaggio Veloce - da guide');

export async function GuideFooterCta() {
  const host = (await headers()).get('host');
  const landingOnly = isLandingOnlyHost(host);

  return (
    <section className="mx-auto my-14 w-full max-w-3xl px-5 sm:px-6">
      {/* Box principale B2B */}
      <div className="rounded-[16px] bg-pv-navy-800 p-7 text-white sm:p-8">
        <span className="text-[11px] font-bold uppercase tracking-wider text-pv-orange-400">
          Per dealer e agenzie
        </span>
        <h2 className="mt-2 text-[22px] font-extrabold tracking-tight sm:text-[26px]">
          Smetti di rincorrere fascicoli e firme
        </h2>
        <p className="mt-3 text-[14.5px] leading-relaxed text-[#b8cdea]">
          Passaggio Veloce automatizza tutta la filiera: dal caricamento documenti alla
          fattura SDI. Iscrizione gratuita, paghi solo a pratica completata.
        </p>
        <div className="mt-5">
          {landingOnly ? (
            <a href={CONTATTACI_HREF}>
              <Button size="md">Richiedi accesso anticipato</Button>
            </a>
          ) : (
            <Link href="/register">
              <Button size="md">Registra la tua azienda</Button>
            </Link>
          )}
        </div>
      </div>

      {/* Box secondario B2C educational — no CTA cliccabile */}
      <div className="mt-4 rounded-[14px] border border-pv-slate-200 bg-pv-slate-50 p-5">
        <p className="text-[13.5px] leading-relaxed text-pv-slate-700">
          <span className="font-bold text-pv-navy-800">Sei un privato?</span>{' '}
          Chiedi al tuo concessionario o all&apos;agenzia pratiche se usa Passaggio Veloce:
          dimezza i tempi del passaggio e garantisce documenti criptati end-to-end.
        </p>
      </div>
    </section>
  );
}
