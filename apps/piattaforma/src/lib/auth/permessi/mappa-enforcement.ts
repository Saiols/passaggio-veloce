/**
 * Ogni server action delle aree azienda, col permesso che la protegge.
 * `null` = volutamente senza permesso, con la ragione accanto.
 *
 * Aggiungendo una server action a uno di questi file, il test
 * `mappa-enforcement.test.ts` fallisce finché non la classifichi qui.
 * Non è burocrazia: è l'unico modo di accorgersi di un gate mancante.
 *
 * Tipizzato `Permesso | null` (non `string | null`): un refuso nel nome del
 * permesso non compila, perché `Permesso` è l'union letterale delle 31 chiavi
 * di ./catalogo. Per questo il test non lo riverifica a runtime — lo fa già
 * il compilatore.
 */
import type { Permesso } from './catalogo';

export const MAPPA_ENFORCEMENT: Record<string, Record<string, Permesso | null>> = {
  'src/app/pratiche/actions.ts': {
    processaPraticaFromListaAction: 'pratiche.processa',
    markPraticaProcessataAction: 'pratiche.processa',
    markFirmaAvvenutaAction: 'pratiche.firma',
    firmaFromListaAction: 'pratiche.firma',
    annullaPraticaAction: 'pratiche.annulla',
    submitValutazioneAction: 'pratiche.valuta',
  },
  'src/app/pratiche/nuova/actions.ts': {
    submitNuovaPraticaAction: 'pratiche.create',
    extractLibrettoAction: 'pratiche.create',
    extractFoglioComplementareAction: 'pratiche.create',
    extractIdentitaAction: 'pratiche.create',
    extractVisuraAction: 'pratiche.create',
    extractPermessoAction: 'pratiche.create',
    extractCodiceFiscaleAction: 'pratiche.create',
  },
  'src/app/inbox/actions.ts': {
    acceptPratica: 'inbox.gestisci',
    rejectPratica: 'inbox.gestisci',
    acceptAndRedirect: 'inbox.gestisci',
    rejectAndRedirect: 'inbox.gestisci',
  },
  'src/app/wallet/actions.ts': {
    richiediPayoutAction: 'wallet.payout',
    updatePayoutThresholdAction: 'wallet.soglia',
  },
  'src/app/wallet/mandato-actions.ts': {
    inviaOtpMandatoAction: null, // owner-only (isOwner): firma contrattuale del titolare
    firmaMandatoAction: null, // owner-only (isOwner): firma contrattuale del titolare
  },
  'src/app/fatturazione/actions.ts': {
    segnaTrasmessoSdiAction: null, // gated ADMIN_PIATTAFORMA, non è un'azione azienda
  },
  'src/app/blocco-pagamento/actions.ts': {
    // Catalogo: niente `pagamenti.iban`/`pagamenti.ritenta` (ritirate, vedi
    // catalogo.ts categoria 'pagamenti') — nessuna delle due è una capability
    // delegabile, quindi non compaiono come chiave spuntabile.
    ritentaAddebitoAction: null, // D4: aperta a tutta l'agenzia, non tocca IBAN né importi
    aggiornaIbanERitentaAction: null, // D1: owner-only (isOwner), l'IBAN è del solo titolare
  },
  'src/app/visura/actions.ts': {
    // Owner-only via `isOwner`, ri-verificato in entrambe le action: la visura
    // camerale è un atto anagrafico dell'azienda, stessa linea dell'IBAN — non
    // una capability delegabile, quindi niente chiave spuntabile nel catalogo.
    verificaVisuraAction: null, // passo 1: OCR + controlli, non scrive nulla
    aggiornaVisuraAction: null, // passo 2: scrive data/ragione sociale/sede legale
  },
  'src/app/tariffe-aggiornate/actions.ts': {
    // Owner-only via `isOwner`, come l'IBAN e la visura: accettare nuove
    // condizioni economiche impegna l'azienda su un prezzo, non è una
    // capability che il titolare possa delegare a un collaboratore.
    riaccettaTariffaAction: null,
  },
  'src/app/orari/actions.ts': {
    updateOrariAction: 'orari.edit',
  },
  'src/app/sedi/actions.ts': {
    createSedeAction: null, // owner-only (ADMIN_AZIENDA): struttura dell'azienda
    updateSedeAction: 'sede.edit', // iban e payoutThresholdCent OMESSI dai data se non owner (D1/D2)
    suspendSedeAction: null, // owner-only (ADMIN_AZIENDA)
    reactivateSedeAction: null, // owner-only (ADMIN_AZIENDA)
  },
  'src/app/team/actions.ts': {
    createInvitationAction: 'team.invita', // gate via gateCapability(), non requirePermesso() diretto
    acceptInvitationAction: null, // flusso pubblico: l'invitato non ha sessione
    createUserDirectAction: 'team.crea', // gate via gateCapability()
    updateTeamUserAction: 'team.modifica', // gate via gateCapability()
    resetTeamUserPasswordAction: 'team.reset_password', // gate via gateCapability()
    disableTeamUserAction: 'team.disabilita', // gate via gateCapability()
    revokeInvitationAction: 'team.disabilita', // gate via can() diretto (stesso permesso di disableTeamUserAction)
  },
  'src/app/profilo/personale/actions.ts': {
    updateOwnProfileAction: null, // proprio account: nessun permesso delegabile in gioco
    changeOwnPasswordAction: null, // proprio account: agisce su session.user.id e richiede la password attuale
  },
  'src/app/profilo/azienda/actions.ts': {
    updateCompanyProfileAction: null, // owner-only (ADMIN_AZIENDA): identità fiscale
  },
  'src/app/profilo/sicurezza/actions.ts': {
    start2faSetupAction: null, // proprio account
    confirm2faSetupAction: null, // proprio account
    disable2faAction: null, // proprio account
  },
  'src/app/profilo/notifiche/actions.ts': {
    updateNotifPrefsAction: null, // proprio account
  },
  'src/app/profilo/listino/actions.ts': {
    saveListinoFormAction: null, // feature parcheggiata: route 404 (vedi project_listini_parcheggiati)
    uploadListinoFileAction: null, // feature parcheggiata
    deleteListinoAction: null, // feature parcheggiata
  },
  'src/lib/sedi/actions.ts': {
    setCurrentSedeAction: null, // cambio sede corrente: gated da canSelectSede, non da un permesso
  },
  'src/lib/penali/segnalazione.ts': {
    segnalaPraticaAction: 'pratiche.segnala',
    // Le due azioni sotto sono gated ADMIN_PIATTAFORMA (isAdminPiattaforma):
    // gestione della segnalazione lato platform, non un'azione azienda.
    confermaAnnullamentoConPenaleAction: null, // gated ADMIN_PIATTAFORMA, non è un'azione azienda — assente dal brief originale, aggiunta qui perché il codice reale la esporta
    respingiSegnalazioneAction: null, // gated ADMIN_PIATTAFORMA, non è un'azione azienda
  },
  'src/lib/segnalazioni/creazione.ts': {
    inviaSegnalazioneCreazioneAction: 'pratiche.create',
    gestisciSegnalazioneCreazioneAction: null, // gated ADMIN_PIATTAFORMA
  },
};
