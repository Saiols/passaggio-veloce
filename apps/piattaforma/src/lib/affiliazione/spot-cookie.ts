/**
 * Cookie di sessione della modale affiliazione post-login.
 *
 * Vale "già mostrata in questa sessione di browser". NON è il "non mostrare
 * più" (quello è `User.affiliazioneSpotDismissedAt`, permanente e cross-device).
 *
 * Serve perché la chrome autenticata rimonta a ogni cambio rotta (vedi il
 * commento in `components/sidebar-shell.tsx`): senza questo cookie la modale
 * riapparirebbe a ogni click, e il client rifarebbe la fetch a ogni pagina.
 *
 * Proprietà volute:
 * - senza `Max-Age`/`Expires` ⇒ muore alla chiusura del browser;
 * - `httpOnly: false` ⇒ il client lo legge e salta del tutto la fetch;
 * - cancellato da `loginAction` prima di `signIn()` ⇒ ogni login ripropone
 *   la modale a chi non ha spuntato "non mostrare più".
 *
 * Questo modulo NON è `server-only`: la costante è condivisa tra il route
 * handler, la server action di login e il componente client.
 */
export const AFF_SPOT_COOKIE = 'pv_aff_spot';
