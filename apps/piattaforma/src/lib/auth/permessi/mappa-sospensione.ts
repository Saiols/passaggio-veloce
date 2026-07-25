/**
 * Comportamento sotto sospensione delle sole server action che NON sono
 * protette da una chiave del catalogo (permesso `null` in ./mappa-enforcement).
 *
 * Le action gated NON vanno elencate qui: il loro comportamento è già derivato
 * dalla partizione in ./sola-lettura (chiave di scrittura ⇒ bloccata). Il test
 * verifica l'uguaglianza esatta degli insiemi, quindi aggiungerne una fa
 * fallire la suite.
 *
 * Spec: docs/superpowers/specs/2026-07-25-sospensione-sola-lettura-design.md
 */
export const MAPPA_SOSPENSIONE: Record<string, Record<string, 'BLOCCA' | 'CONSENTI'>> = {
  'src/app/wallet/mandato-actions.ts': {
    // Il mandato serve al payout, che sotto sospensione è comunque bloccato.
    inviaOtpMandatoAction: 'BLOCCA',
    firmaMandatoAction: 'BLOCCA',
  },
  'src/app/fatturazione/actions.ts': {
    segnaTrasmessoSdiAction: 'CONSENTI', // gated ADMIN_PIATTAFORMA: staff, fuori scope
  },
  'src/app/blocco-pagamento/actions.ts': {
    // Le due sorelle sono classificate DIVERSAMENTE, e la differenza non è il
    // rimedio (lo sono entrambe) ma cosa scrivono.
    //
    // `ritentaAddebitoAction` non tocca né IBAN né importi: rilancia un
    // addebito già dovuto col mandato esistente. È il rimedio al caso più
    // frequente (banca sistemata, IBAN invariato) e resta aperta, così la
    // sospensione non impedisce di rientrare in regola e presentarsi al riesame.
    ritentaAddebitoAction: 'CONSENTI',
    // `aggiornaIbanERitentaAction` riscrive `Company.iban`, cioè il conto su
    // cui `settlePayout` eroga i payout, ed è l'ULTIMA via aperta a quel campo
    // (le altre due sono chiuse: updateCompanyProfileAction qui sotto,
    // updateSedeAction gated `sede.edit`). Combinata con l'esenzione
    // `ignoraSoglia` della liquidazione di cessazione — che per progetto ignora
    // la sospensione, clausola 12.4 — permetteva a un sospeso di dirottare il
    // residuo su un conto scritto DOPO la misura.
    aggiornaIbanERitentaAction: 'BLOCCA',
  },
  'src/app/visura/actions.ts': {
    verificaVisuraAction: 'CONSENTI', // rimedio
    // Rimedio, ma con una conseguenza che va detta perché `BLOCCA // atto
    // societario` qui sotto fa credere il contrario: `aggiornaVisura` riscrive
    // ragione sociale e sede legale della Company (visura/actions.ts:137-139),
    // quindi l'identità fiscale NON è del tutto congelata da una sospensione.
    // La classificazione resta giusta: il dato non è digitato dall'utente, è
    // ri-estratto lato server dal camerale caricato — e l'IBAN non è toccato.
    aggiornaVisuraAction: 'CONSENTI',
  },
  'src/app/sedi/actions.ts': {
    // Creare o riorganizzare sedi da sospesi è espansione, cioè operatività.
    createSedeAction: 'BLOCCA',
    suspendSedeAction: 'BLOCCA',
    reactivateSedeAction: 'BLOCCA',
  },
  'src/app/team/actions.ts': {
    // Flusso pubblico: l'invitato non ha sessione, quindi non c'è nulla da
    // gatare. Conseguenza da registrare: è l'unica via per cui un'azienda
    // sospesa può ancora ACQUISIRE un utente, tramite un invito pendente
    // emesso prima della misura. Nessuna fuga di privilegi — `Company.suspendedAt`
    // rende sospesi tutti i suoi utenti, quindi il nuovo nasce in sola lettura —
    // ma se un domani la sospensione dovesse impedire anche questo, il punto in
    // cui intervenire è la validità dell'invito, non questa action.
    acceptInvitationAction: 'CONSENTI',
  },
  'src/app/profilo/personale/actions.ts': {
    // Proprio account: bloccare il cambio password a un utente le cui
    // credenziali potrebbero essere compromesse fa danno senza portare nulla.
    updateOwnProfileAction: 'CONSENTI',
    changeOwnPasswordAction: 'CONSENTI',
  },
  'src/app/profilo/azienda/actions.ts': {
    updateCompanyProfileAction: 'BLOCCA', // atto societario: identità fiscale
  },
  'src/app/profilo/sicurezza/actions.ts': {
    start2faSetupAction: 'CONSENTI', // proprio account
    confirm2faSetupAction: 'CONSENTI',
    disable2faAction: 'CONSENTI',
  },
  'src/app/profilo/notifiche/actions.ts': {
    updateNotifPrefsAction: 'CONSENTI', // proprio account
  },
  'src/app/profilo/listino/actions.ts': {
    // Feature parcheggiata: route 404 (vedi project_listini_parcheggiati).
    saveListinoFormAction: 'CONSENTI',
    uploadListinoFileAction: 'CONSENTI',
    deleteListinoAction: 'CONSENTI',
  },
  'src/lib/sedi/actions.ts': {
    setCurrentSedeAction: 'CONSENTI', // navigazione, non scrittura di dominio
  },
  'src/lib/penali/segnalazione.ts': {
    confermaAnnullamentoConPenaleAction: 'CONSENTI', // gated ADMIN_PIATTAFORMA
    respingiSegnalazioneAction: 'CONSENTI', // gated ADMIN_PIATTAFORMA
  },
  'src/lib/segnalazioni/creazione.ts': {
    gestisciSegnalazioneCreazioneAction: 'CONSENTI', // gated ADMIN_PIATTAFORMA
  },
};
