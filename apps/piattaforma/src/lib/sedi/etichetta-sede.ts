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
    return labelSedeCorrente(currentSede.sede, accessibleSedi, ragioneSociale);
  }

  // kind === 'ALL'
  if (accessibleSedi.length === 1) {
    return labelSedeCorrente(accessibleSedi[0], accessibleSedi, ragioneSociale);
  }
  if (accessibleSedi.length === 0) return null;
  return 'Tutte le sedi';
}

function labelSede(sede: SedeRef, ragioneSociale: string | null | undefined): string {
  return nomeSedeDistintivo(sede.nome, ragioneSociale) ?? sede.citta;
}

/**
 * Etichetta della sede corrente per la card, calcolata attraverso
 * `etichetteSediUniche` sull'INTERO elenco `accessibleSedi` — mai da sola con
 * `labelSede`. Se calcolasse da sola, nel caso limite di una collisione (es.
 * due sedi "Filiale" in due città diverse) il selettore mostrerebbe
 * "Filiale — Milano" / "Filiale — Roma" (disambiguate) mentre la card, per
 * la sede corrente, mostrerebbe ancora "Filiale" (ambiguo): l'utente sceglie
 * un'etichetta nel menu e ne vede comparire un'altra nella card. Passando
 * dalla stessa funzione, card e selettore non possono divergere per
 * costruzione.
 */
function labelSedeCorrente(
  sede: SedeRef,
  accessibleSedi: SedeRef[],
  ragioneSociale: string | null | undefined,
): string {
  const trovata = etichetteSediUniche(accessibleSedi, ragioneSociale).find((e) => e.id === sede.id);
  // Fallback difensivo, non dovrebbe accadere: `sede` arriva sempre da un
  // sottoinsieme di `accessibleSedi` (kind ONE la risolve dalle stesse sedi
  // accessibili; il caso ALL-con-una-sede usa accessibleSedi[0] stessa sede).
  return trovata?.label ?? labelSede(sede, ragioneSociale);
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
 * disambiguante che riporta anche il nome.
 *
 * Invariante garantita per costruzione, qualunque siano i dati: le label
 * restituite sono SEMPRE tutte distinte. La forma "nome — città" da sola non
 * basta se la collisione nasce proprio da nome+città uguali (due sedi
 * "Filiale"/Milano, oppure due sedi entrambe omonime della ragione sociale
 * nella stessa città: in entrambi i casi "nome — città" produce la STESSA
 * stringa per le due sedi). Alle sole etichette ancora colliduenti dopo quel
 * passaggio si aggiunge un suffisso ordinale progressivo.
 */
export function etichetteSediUniche(
  sedi: SedeRef[],
  ragioneSociale: string | null | undefined,
): { id: string; label: string }[] {
  const base = sedi.map((sede) => ({ sede, label: labelSede(sede, ragioneSociale) }));
  const occorrenzeBase = conta(base.map((b) => b.label));

  const disambiguate = base.map(({ sede, label }) => ({
    id: sede.id,
    label: occorrenzeBase.get(label)! > 1 ? `${sede.nome} — ${sede.citta}` : label,
  }));

  const occorrenzeFinali = conta(disambiguate.map((d) => d.label));
  const progressivo = new Map<string, number>();
  return disambiguate.map(({ id, label }) => {
    if (occorrenzeFinali.get(label)! <= 1) return { id, label };
    const n = (progressivo.get(label) ?? 0) + 1;
    progressivo.set(label, n);
    return { id, label: `${label} (${n})` };
  });
}

function conta(valori: string[]): Map<string, number> {
  const occorrenze = new Map<string, number>();
  for (const v of valori) occorrenze.set(v, (occorrenze.get(v) ?? 0) + 1);
  return occorrenze;
}
