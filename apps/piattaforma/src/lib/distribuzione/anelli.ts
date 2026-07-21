import type { DistribuzioneConfigDTO } from './config';

/** Una sede candidata con la sua distanza stradale (m) dal punto della pratica. */
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
 * `sediInMaxRaggio` è già filtrata a monte (distanza stradale ≤ raggioMaxM,
 * sedi non ancora contattate): qui si applica solo il filtro incrementale
 * per anello, che garantisce l'espansione a step (mai un salto diretto al
 * raggio della sede più vicina).
 *
 * Pura: nessun accesso a DB, nessun `Date` — solo calcolo su input espliciti.
 */
export function prossimoAnello(
  sediInMaxRaggio: SedeConDistanza[],
  raggioCorrenteM: number,
  cfg: DistribuzioneConfigDTO,
): ProssimoAnello {
  let raggio = raggioCorrenteM;
  while (raggio < cfg.raggioMaxM) {
    raggio = Math.min(raggio + cfg.stepM, cfg.raggioMaxM);
    const inRing = sediInMaxRaggio.filter((s) => s.distanzaM <= raggio);
    if (inRing.length > 0) return { tipo: 'notifica', raggioRaggiuntoM: raggio, sedi: inRing };
  }
  return { tipo: 'zona-non-coperta', raggioRaggiuntoM: cfg.raggioMaxM };
}
