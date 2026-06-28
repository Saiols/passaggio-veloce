/**
 * Helper PURI (no DB, no server-only) per costruire la lista dei destinatari
 * "cliente" (acquirente + venditori) delle email di avanzamento pratica.
 * Testabili in isolamento; l'orchestratore (cliente.ts) fa il caricamento DB.
 */
import type { ClienteAvanzamentoRuolo } from './templates';

export type ClienteRecipient = {
  email: string;
  ruolo: ClienteAvanzamentoRuolo;
  nomeDestinatario: string;
};

type ParteBase = {
  isPersonaGiuridica: boolean;
  ragioneSociale: string | null;
  nome: string | null;
  cognome: string | null;
};

export type ClientiInput = {
  acquirenteEmail: string | null;
  acquirenteNome: string | null;
  acquirenteCognome: string | null;
  acquirenteIsPersonaGiuridica: boolean;
  acquirenteRagioneSociale: string | null;
  venditori: {
    email: string | null;
    nome: string | null;
    cognome: string | null;
    isPersonaGiuridica: boolean;
    ragioneSociale: string | null;
  }[];
};

/** Nome visualizzato della parte: ragione sociale (PG) o nome+cognome, con fallback. */
export function nomeParte(p: ParteBase): string {
  if (p.isPersonaGiuridica) return p.ragioneSociale?.trim() || 'Cliente';
  const full = [p.nome, p.cognome].map((s) => s?.trim()).filter(Boolean).join(' ');
  return full || 'Cliente';
}

/** Targa del primo veicolo; se piu di uno, "<targa> +<n-1>"; null se nessuna targa. */
export function veicoloDescrizione(veicoli: { targa: string | null }[]): string | null {
  const prima = veicoli[0]?.targa?.trim();
  if (!prima) return null;
  return veicoli.length > 1 ? `${prima} +${veicoli.length - 1}` : prima;
}

/** Lista destinatari deduplicata per email (lowercased+trim); acquirente prima dei venditori. */
export function buildClienteRecipients(input: ClientiInput): ClienteRecipient[] {
  const out: ClienteRecipient[] = [];
  const seen = new Set<string>();
  const push = (email: string | null, ruolo: ClienteAvanzamentoRuolo, nome: string) => {
    const norm = email?.trim().toLowerCase();
    if (!norm) return;
    if (seen.has(norm)) return;
    seen.add(norm);
    out.push({ email: email!.trim(), ruolo, nomeDestinatario: nome });
  };
  push(
    input.acquirenteEmail,
    'ACQUIRENTE',
    nomeParte({
      isPersonaGiuridica: input.acquirenteIsPersonaGiuridica,
      ragioneSociale: input.acquirenteRagioneSociale,
      nome: input.acquirenteNome,
      cognome: input.acquirenteCognome,
    }),
  );
  for (const v of input.venditori) {
    push(v.email, 'VENDITORE', nomeParte(v));
  }
  return out;
}
