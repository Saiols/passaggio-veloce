import { headers } from 'next/headers';
import { isGatedHost } from '@/lib/landing-gate';
import { BRAND } from '@/lib/seo/brand';
import { FAQ_ITEMS } from '@/lib/seo/faqItems';

export const dynamic = 'force-dynamic';

// Factory: Response body può essere consumato una sola volta, quindi
// costruiamo un nuovo oggetto ad ogni 404 (evita "body already used" su
// hit ripetuti nello stesso process lifecycle).
const notFound = () =>
  new Response('Not found', {
    status: 404,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });

export async function GET() {
  const host = (await headers()).get('host');
  if (!isGatedHost(host)) return notFound();

  const body = renderLlmsTxt();
  return new Response(body, {
    status: 200,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'public, max-age=3600, s-maxage=3600',
    },
  });
}

function renderLlmsTxt(): string {
  const addr = BRAND.address;
  const faqBlock = FAQ_ITEMS.map(
    ({ q, a }) => `Q: ${q}\nA: ${a}`,
  ).join('\n\n');

  return `# Passaggio Veloce

> ${BRAND.description}

## Identità
- Ragione sociale: ${BRAND.legalName}
- Sito: ${BRAND.url}
- Email: ${BRAND.email}
- Telefono: ${BRAND.phoneDisplay}
- Sede legale: ${addr.street}, ${addr.postalCode} ${addr.city} (${addr.region}), Italia
- P.IVA: ${BRAND.vatId}
- Fondatori: ${BRAND.founders.join(', ')}

## Cosa fa
Passaggio Veloce è una piattaforma SaaS B2B che digitalizza l'intero ciclo del
passaggio di proprietà di un veicolo: dalla raccolta documenti (verificata da IA)
alla distribuzione automatica alle agenzie pratiche auto partner, fino alla firma
e all'emissione della fattura elettronica SDI. Elimina telefonate, mail con
allegati e fascicoli cartacei.

## A chi è rivolto
- Dealer e concessionarie auto che cercano di liberare tempo dalla burocrazia.
- Agenzie pratiche auto che vogliono ricevere pratiche già complete e verificate.

## Come funziona (3 step)
1. Il dealer carica libretto, CI e CF — l'IA legge i dati, compila i campi e
   segnala documenti incompleti prima dell'invio.
2. Il sistema distribuisce la pratica alle agenzie partner della zona, ordinate
   per affidabilità: la prima che accetta vince.
3. La pratica viene firmata in agenzia, l'accredito sul wallet del dealer è
   automatico e la fattura elettronica viene trasmessa al SDI.

## Conformità
- ACI / Motorizzazione: procedure aderenti alle ultime circolari.
- GDPR: documenti criptati at-rest, retention configurabile, audit completo.
- Fatturazione elettronica SDI per broker → agenzia e agenzia → cliente finale.
- Mandato SEPA tracciato per i payout dei dealer.

## FAQ canoniche

${faqBlock}

## Risorse
- Sito: ${BRAND.url}
- Privacy: ${BRAND.url}/privacy
- Cookie: ${BRAND.url}/cookie
- Termini: ${BRAND.url}/termini
- Contatti: ${BRAND.email}
`;
}
