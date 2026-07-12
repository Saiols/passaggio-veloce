import { nomeSedeDistintivo } from '@/lib/pratiche/colonna-sede';
import type { CurrentSede, SedeRef } from './scope';

/**
 * Testo della sede per la card utente in sidebar. `null` = non mostrare nulla.
 *
 * Regole (decise in spec):
 * - sede selezionata (ONE) → quella sede;
 * - vista aggregata (ALL, solo il titolare) con più sedi → "Tutte le sedi":
 *   mostrare UNA sede mentre se ne stanno guardando N sarebbe una bugia;
 * - vista aggregata con UNA sola sede → quella sede. Il titolare resta in ALL
 *   finché non ne seleziona una, e con una sede sola non può nemmeno farlo (il
 *   selettore compare solo da 2 sedi in su): la regola letterale lo lascerebbe
 *   senza sede per sempre, ed è il caso più comune (4 aziende su 5 in prod).
 *   Con una sede sola "aggregato" e "quella sede" coincidono: non c'è bugia.
 *
 * Il nome passa da `nomeSedeDistintivo`: alla registrazione la sede eredita il
 * nome dell'azienda, quindi quasi sempre coincidono e ripeterlo nella card lo
 * direbbe due volte. In quel caso resta la città, che è ciò che identifica
 * davvero la filiale (stessa scelta della colonna Sede della lista pratiche).
 */
export function etichettaSede(args: {
  currentSede: CurrentSede | null;
  /** Le sedi a cui l'utente ha accesso. Conteggio e sede unica si derivano da qui:
   *  due parametri separati potevano desincronizzarsi e far sbagliare in silenzio. */
  accessibleSedi: SedeRef[];
  ragioneSociale: string | null | undefined;
}): string | null {
  const { currentSede, accessibleSedi, ragioneSociale } = args;

  if (!currentSede) return null;

  if (currentSede.kind === 'ONE') {
    return labelSede(currentSede.sede, ragioneSociale);
  }

  // kind === 'ALL'
  if (accessibleSedi.length === 1) {
    return labelSede(accessibleSedi[0], ragioneSociale);
  }
  if (accessibleSedi.length === 0) return null;
  return 'Tutte le sedi';
}

function labelSede(sede: SedeRef, ragioneSociale: string | null | undefined): string {
  return nomeSedeDistintivo(sede.nome, ragioneSociale) ?? sede.citta;
}

/**
 * Etichetta di ciascuna sede per il SELETTORE (menu con tutte le sedi
 * accessibili viste insieme), con la STESSA regola della card (`labelSede`
 * sopra): niente il selettore dica "Dimensione Auto Milano Srls" mentre la
 * card, per la stessa sede, dice "Buccinasco".
 *
 * Un selettore con due opzioni identiche è rotto: se due sedi collidessero
 * sulla stessa etichetta (es. due filiali nella stessa città, entrambe col
 * nome uguale alla ragione sociale) l'utente non potrebbe più distinguerle nel
 * menu. Per le sole sedi coinvolte in una collisione si usa una forma
 * disambiguante che riporta anche il nome. (Se anche `nome` e `citta` fossero
 * identici tra due sedi la collisione resterebbe: è un problema di dati a
 * monte, non risolvibile lato etichetta — fuori dallo scope di questa
 * funzione.)
 */
export function etichetteSediUniche(
  sedi: SedeRef[],
  ragioneSociale: string | null | undefined,
): { id: string; label: string }[] {
  const base = sedi.map((sede) => ({ sede, label: labelSede(sede, ragioneSociale) }));

  const occorrenze = new Map<string, number>();
  for (const { label } of base) {
    occorrenze.set(label, (occorrenze.get(label) ?? 0) + 1);
  }

  return base.map(({ sede, label }) => ({
    id: sede.id,
    label: (occorrenze.get(label) ?? 0) > 1 ? `${sede.nome} — ${sede.citta}` : label,
  }));
}
