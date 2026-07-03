// FAQ canoniche della landing — single source of truth.
// Usate da:
//   - app/page.tsx (rendering visuale + JSON-LD FAQPage)
//   - app/llms.txt/route.ts (canonicizzazione per crawler AI)
// Modifica qui per propagare ovunque.
//
// Il compenso broker (FAQ "Come vengo pagato come dealer?") è derivato dal
// listino corrente (getTariffarioCorrente) e passato dal chiamante, così la
// FAQ resta sempre allineata al tariffario in vigore.

export type FaqItem = { q: string; a: string };

export function buildFaqItems(compensoBrokerEuro: number): readonly FaqItem[] {
  const compenso = `${compensoBrokerEuro}€`;
  return [
    {
      q: 'Quanto costa registrarsi?',
      a: "L'iscrizione è gratuita sia per dealer che per agenzie. Paghi solo quando una pratica viene completata: il dealer accumula crediti, l'agenzia riceve la fee al netto della nostra commissione.",
    },
    {
      q: 'Quanto tempo serve per chiudere una pratica?',
      a: "In media 48 ore lavorative dal caricamento del libretto alla firma in agenzia. La distribuzione automatica trova un'agenzia disponibile entro 1 giorno lavorativo nel 92% dei casi.",
    },
    {
      q: 'Cosa succede se nessuna agenzia accetta la pratica?',
      a: 'Il sistema estende la ricerca prima ai comuni limitrofi, poi all\'intera provincia. In ultima istanza, il nostro team si attiva manualmente per garantire la chiusura.',
    },
    {
      q: 'I dati dei miei clienti sono al sicuro?',
      a: "Sì. CI, codici fiscali e visure sono criptati end-to-end. Solo l'agenzia assegnata può scaricarli, e tutti gli accessi sono loggati. Conforme GDPR e direttive ACI.",
    },
    {
      q: 'Come vengo pagato come dealer?',
      a: `Ogni pratica chiusa ti accredita ${compenso} sul wallet. Sotto i 500€ il saldo si accumula, fra 500 e 999€ puoi richiedere payout manuale, da 1.000€ il payout è automatico mensile su IBAN.`,
    },
  ] as const;
}
