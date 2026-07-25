import type { DistribuzioneConfigDTO } from './config';

/** Una sede candidata con la sua distanza in linea d'aria (m) dalla pratica. */
export type SedeConDistanza = { sedeId: string; companyId: string; distanzaM: number };

/**
 * Esito della selezione del prossimo anello di distribuzione:
 * - `notifica`: l'anello raggiunto (`raggioRaggiuntoM`) contiene ≥1 sede da notificare.
 * - `zona-non-coperta`: nessuna sede entro `raggioMaxM` (o già al massimo senza copertura).
 */
export type ProssimoAnello =
  | { tipo: 'notifica'; raggioRaggiuntoM: number; sedi: SedeConDistanza[] }
  | { tipo: 'zona-non-coperta'; raggioRaggiuntoM: number };

/**
 * Espande il raggio di distribuzione a step (`cfg.stepM`) partendo da
 * `raggioCorrenteM`, fino al primo anello che contiene almeno una sede non
 * contattata, oppure fino a `cfg.raggioMaxM` se nessun anello ne contiene.
 *
 * `sediInMaxRaggio` è già filtrata a monte (distanza in linea d'aria ≤
 * raggioMaxM, sedi non ancora contattate): qui si applica solo il filtro
 * incrementale per anello, che garantisce l'espansione a step (mai un salto
 * diretto al raggio della sede più vicina).
 *
 * Gli anelli vuoti sono attraversati in un colpo solo, dentro la stessa
 * chiamata: un round senza nemmeno un'agenzia non fa attendere.
 *
 * Pura: nessun accesso a DB, nessun `Date` — solo calcolo su input espliciti.
 */
export function prossimoAnello(
  sediInMaxRaggio: SedeConDistanza[],
  raggioCorrenteM: number,
  cfg: DistribuzioneConfigDTO,
): ProssimoAnello {
  // Guardia anti-hang: una config malformata con `stepM <= 0` (o non finito)
  // manderebbe il `while` in loop infinito (il raggio non avanzerebbe mai).
  // Clamp a ≥1 m: peggior caso l'espansione è lenta, ma il ciclo TERMINA sempre.
  const step = Number.isFinite(cfg.stepM) && cfg.stepM >= 1 ? cfg.stepM : 1;
  let raggio = raggioCorrenteM;
  while (raggio < cfg.raggioMaxM) {
    raggio = Math.min(raggio + step, cfg.raggioMaxM);
    const inRing = sediInMaxRaggio.filter((s) => s.distanzaM <= raggio);
    if (inRing.length > 0) return { tipo: 'notifica', raggioRaggiuntoM: raggio, sedi: inRing };
  }
  return { tipo: 'zona-non-coperta', raggioRaggiuntoM: cfg.raggioMaxM };
}

/**
 * Primo anello di un ciclo (submit o ricircolo dopo revoca): l'anello iniziale
 * è `cfg.raggioStartM`, non `cfg.stepM`, quindi non è esprimibile con
 * `prossimoAnello` partendo da 0 — i due parametri sono indipendenti.
 *
 * Se il raggio iniziale è vuoto si prosegue subito con l'espansione a step:
 * la prima notifica parte comunque al submit, al primo anello non vuoto,
 * senza aspettare il tick successivo del cron.
 *
 * Pura, come `prossimoAnello`.
 */
export function primoAnello(
  sediInMaxRaggio: SedeConDistanza[],
  cfg: DistribuzioneConfigDTO,
): ProssimoAnello {
  const inStart = sediInMaxRaggio.filter((s) => s.distanzaM <= cfg.raggioStartM);
  if (inStart.length > 0) {
    return { tipo: 'notifica', raggioRaggiuntoM: cfg.raggioStartM, sedi: inStart };
  }
  return prossimoAnello(sediInMaxRaggio, cfg.raggioStartM, cfg);
}
