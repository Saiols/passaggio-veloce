# Email di registrazione + allineamento email auth — Design

**Data:** 2026-06-03
**Stato:** approvato (brainstorming)
**Contesto:** Resend è live in prod e il layout email istituzionale (`lib/notifiche/layout.ts`: `emailLayout`, `ctaButton`) è in produzione. La registrazione genera un `verificationToken` ma NON invia email (TODO in `app/(auth)/actions.ts` ~riga 404). Le email auth esistenti (reset password, invito team) usano HTML grezzo, non il layout istituzionale.

## Obiettivo

1. Inviare una **email di conferma registrazione** alla fine di `registerAction`, con link di verifica + contenuto di **benvenuto differenziato per tipologia** (DEALER/AGENZIA).
2. Allineare al layout istituzionale anche le email **reset password** e **invito team** (oggi HTML grezzo).

## Architettura

- Nuovo modulo `apps/piattaforma/src/lib/auth/email-templates.ts` — funzioni pure `(payload) => { subject, html, text }`, costruite con `emailLayout`/`ctaButton` importati da `@/lib/notifiche/layout` (il layout resta dov'è; è un util condiviso):
  - `tplRegistrazioneConferma(p)` — nuova
  - `tplResetPassword(p)` — sostituisce l'HTML inline in `requestPasswordResetAction`
  - `tplInvitoTeam(p)` — sostituisce l'HTML inline in `team/actions.ts`
- I tre call-site chiamano queste funzioni al posto dell'HTML inline. Niente HTML email sparso nelle action.

## Email di registrazione

**Trigger:** in fondo a `registerAction` (sostituisce il blocco TODO ~404). Invio **best-effort non bloccante**: avvolto in modo che un errore di invio NON faccia fallire la registrazione né cambi il valore di ritorno (`{ ok: true, emailVerificationToken }`). Pattern: `try { await getEmail().send(...) } catch (e) { console.warn(...) }` oppure `void ...catch`.

**Natura:** email transazionale di account → **nessun footer di disiscrizione** (non passa dal gating notifiche `send.ts`; usa `getEmail().send()` diretto, quindi il token `<!--PV_UNSUB-->` viene comunque rimosso/assente perché send.ts non è coinvolto — il template lascia il token, ma per le email auth lo si rimuove a monte: vedi sotto).

> Nota token: `emailLayout` inserisce sempre `<!--PV_UNSUB-->` nel footer. Le email auth NON hanno disiscrizione → le funzioni in `email-templates.ts` rimuovono il token con `.replace('<!--PV_UNSUB-->', '')` prima di ritornare l'html. (Commento HTML invisibile, ma lo togliamo per pulizia.)

**Payload `RegistrazioneConfermaPayload`:**
```ts
{ nome: string; ragioneSociale: string; tipo: 'DEALER' | 'AGENZIA'; verifyUrl: string; needsVerification: boolean }
```
- `verifyUrl` = `${NEXT_PUBLIC_APP_URL}/verify-email?token=${token}`
- `needsVerification` = `!env.DEMO_MODE` (in demo l'account è già auto-verificato).

**Subject:** `Benvenuto in Passaggio Veloce, ${ragioneSociale}`.

**Contenuto comune:** `Ciao ${nome}`, riga di benvenuto, contatto assistenza (da footer).

**Blocco differenziato (dentro la card):**
- DEALER: "Da ora puoi creare pratiche di passaggio di proprietà e affidarle alle agenzie della tua zona: carichi il libretto, l'IA prepara il dossier e ricevi gli aggiornamenti fino alla firma."
- AGENZIA: "Da ora ricevi le pratiche dei dealer nella tua zona: accetti quelle che ti interessano, le lavori e confermi la firma per incassare la fee."

**CTA condizionale:**
- `needsVerification === true` → `ctaButton(verifyUrl, 'Conferma il tuo indirizzo email →')` + testo "Il link è valido 24 ore."
- `needsVerification === false` (demo/già attivo) → `ctaButton(loginUrl, 'Vai al login →')` + nota "Il tuo account è già attivo." (`loginUrl` = `${NEXT_PUBLIC_APP_URL}/login`).

**Versione text:** equivalente testuale con l'URL.

## Reset password + invito team

- `tplResetPassword({ resetUrl })`: stesso copy attuale ("hai richiesto di reimpostare la password… valido 2 ore") ma dentro `emailLayout`, CTA `ctaButton(resetUrl, 'Reimposta la password →')`. Token unsub rimosso. `requestPasswordResetAction` usa questa funzione.
- `tplInvitoTeam(p)`: leggere l'HTML/parametri attuali in `team/actions.ts` e replicarli dentro `emailLayout`, CTA `ctaButton(inviteUrl, 'Attiva il tuo account →')`. Token unsub rimosso. Il call-site usa questa funzione.

## Testing

- Unit puri (`email-templates.test.ts`):
  - `tplRegistrazioneConferma`: contiene logo/footer legale (layout), il nome, la ragione sociale; con `tipo='DEALER'` contiene il copy dealer e NON quello agenzia (e viceversa); con `needsVerification=true` CTA→verifyUrl con label "Conferma"; con `false` CTA→login con "già attivo"; nessun `<!--PV_UNSUB-->`; escaping dei dati.
  - `tplResetPassword`/`tplInvitoTeam`: contengono layout + CTA verso il link corretto; nessun token unsub.
- Test su `registerAction` (estende il mock esistente in `actions.test.ts`): l'invio email è invocato (mock `getEmail().send`) con `to` = email registrata; **se `send` lancia, `registerAction` ritorna comunque `{ ok: true }`** (best-effort).
- Preview HTML reale dei 3 template + invio di prova via Resend a `assistenza@` prima del deploy.

## Fuori scope

- Seconda email "benvenuto" post-verifica.
- Modifiche al sistema notifiche / `send.ts`.
- Reinvio email di verifica (resend verification) — eventuale follow-up.

## Deploy

- Nessuna migrazione DB. Rilascio: branch dedicato → merge `main` → push (deploy Vercel), come da [[project-prod-release-process]]. Vedi [[project-email-system]].
