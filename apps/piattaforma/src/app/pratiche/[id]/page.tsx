import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { auth } from '@/auth';
import { getSessionContext } from '@/lib/auth/session-context';
import { assertPermesso, hasPermesso } from '@/lib/auth/permessi/guard';
import { isAdminPiattaforma } from '@/lib/auth/permissions';
import { prisma, type Prisma } from '@pv/db';
import { AppShell } from '@/components/app-shell';
import {
  Alert,
  Card,
  StatusChip,
  SubmitButton,
  TipoPraticaChip,
  type PraticaStato,
} from '@/components/ui';
import { formatCurrencyCent, formatDate, formatDateTime } from '@/lib/format';
import { margineLordoCent } from '@/lib/pricing';
import { importoMaiIncassato } from '@/lib/pratiche/stati';
import {
  markFirmaAvvenutaAction,
  markPraticaProcessataAction,
} from '../actions';
import { SegnalaProblemaButton } from './segnala-button';
import { StatoExtraInfo } from '../stato-extra-info';
import { statoExtra } from '@/lib/pratiche/stato-extra';
import { AnnullaPraticaButton } from './annulla-button';
import { AttestaFirmaButton } from './attesta-firma-button';
import { ValutazioneForm } from './valutazione-form';
import { guidaStep, type GuidaRuolo } from '@/lib/pratiche/guida-step';
import { GuidaStepCard } from './guida-step-card';
import { formatKm } from '@/lib/distribuzione/format';
import { getDistribuzioneConfig } from '@/lib/distribuzione/config';
import { getCoperturaPratica } from '@/lib/distribuzione/copertura';
import { CoperturaCard } from './copertura-card';
import { AttestazioneCard } from './attestazione-card';
import { labelTipoDocumento } from '@/lib/fatturazione/format';
import { canViewDocumentoFiscale } from '@/lib/fatturazione/access';
import { toSedeScope, NO_SEDE_SCOPE } from '@/lib/sedi/scope-filters';
import { PraticaToasts } from './pratica-toasts';
import { DownloadDocumentiButton } from '../download-documenti-button';
import { BackButton } from '@/components/back-button';
import { OverrideGatingButton } from '@/app/admin/documenti/override-gating-button';

export default async function PraticaDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user) redirect('/login');

  const companyType = session.user.companyType;
  const companyId = session.user.companyId;
  // Lo staff di piattaforma (admin/assistente) vede qualsiasi pratica per id.
  // Broker/agenzia vedono solo le proprie (per company). Niente sentinella
  // '__none__' nei filtri: brokerId/agenziaAssegnataId sono colonne uuid e
  // castare '__none__' farebbe lanciare Postgres ("invalid input syntax for
  // type uuid") → 500 sul dettaglio per gli admin (companyId null).
  const isStaff =
    session.user.role === 'ADMIN_PIATTAFORMA' || session.user.role === 'ASSISTENTE';

  // Autenticazione → permesso → scope. Lo staff piattaforma non ha un contesto
  // sede/permessi azienda (companyId null): questa pagina resta condivisa
  // (linkata da /admin/pratiche), quindi il gate vale solo per gli utenti azienda.
  if (!isStaff) {
    await assertPermesso('pratiche.view');
  }

  // Multi-sede: l'accesso non-staff è scoped alle sedi (broker o agenzia).
  const ctx = await getSessionContext();
  const scopeIds = ctx?.scopeIds ?? [];
  // Accesso al dettaglio (permalink): consentito per QUALSIASI sede a cui l'utente
  // ha diritto (`accessibleSedi`), non solo la sede attualmente selezionata
  // (`scopeIds`). Altrimenti chi crea una pratica per una sede diversa da quella
  // corrente riceve un 404 sul redirect (la pratica esiste ma è fuori vista).
  // `scopeIds` resta il filtro di liste/badge e il gate delle azioni-workflow
  // (`inScope`, "sto operando in questa sede?").
  const accessibleSedeIds = ctx?.accessibleSedi.map((s) => s.id) ?? [];
  const inScope = (sedeId: string | null): boolean => sedeId != null && scopeIds.includes(sedeId);

  // Difesa in profondità: ogni ramo dell'OR vincola ANCHE la company del lato
  // corrispondente. La sede da sola non è una chiave di accesso: un `where` che
  // filtrasse solo per `brokerSedeId`/`agenziaSedeId` si appoggerebbe
  // all'invariante "`brokerSedeId` è sempre una sede di `brokerId`", invariante
  // su cui `canAccessPratica` (lib/pratiche/access.ts) di proposito non si fida.
  // Fail-closed: `accessibleSedeIds` vuoto ⇒ `{ in: [] }` ⇒ nessuna riga.
  let whereProprieta: Prisma.PraticaWhereInput = {};
  if (!isStaff) {
    if (!companyId) notFound();
    whereProprieta = {
      OR: [
        { brokerId: companyId, brokerSedeId: { in: accessibleSedeIds } },
        { agenziaAssegnataId: companyId, agenziaSedeId: { in: accessibleSedeIds } },
      ],
    };
  }

  const pratica = await prisma.pratica.findFirst({
    where: {
      id,
      deletedAt: null,
      ...whereProprieta,
    },
    include: {
      broker: { select: { ragioneSociale: true, citta: true, provincia: true, telefono: true } },
      agenziaAssegnata: { select: { ragioneSociale: true, citta: true, telefono: true } },
      agenziaSede: {
        select: {
          nome: true,
          indirizzo: true,
          civico: true,
          citta: true,
          cap: true,
          provincia: true,
          // Telefono della SEDE, non della madre: chi deve andare lì chiama
          // quel punto. Nullable → fallback sul telefono aziendale.
          telefono: true,
        },
      },
      assegnazioni: {
        include: { agenzia: { select: { ragioneSociale: true, citta: true } } },
        orderBy: [{ round: 'asc' }, { invioAt: 'asc' }],
      },
      documenti: {
        where: { deletedAt: null },
        orderBy: { createdAt: 'asc' },
      },
      valutazione: true,
      documentiFiscali: {
        select: {
          id: true,
          tipo: true,
          numeroProgressivo: true,
          anno: true,
          numeroDocumentoStr: true,
          importoLordoCent: true,
          emittenteCompanyId: true,
          destinatarioCompanyId: true,
        },
        orderBy: { emessoAt: 'desc' },
      },
      veicoli: { orderBy: { ordine: 'asc' } },
      venditori: { orderBy: { ordine: 'asc' } },
      coAcquirenti: { orderBy: { ordine: 'asc' } },
    },
  });

  if (!pratica) notFound();

  // Copertura (diagnostica admin-only): quali agenzie sono in zona e perché
  // la pratica le ha (o non le ha) raggiunte. È una query su TUTTE le sedi
  // agenzia — calcolarla per broker/agenzia sarebbe lavoro sprecato, oltre al
  // fatto che quei ruoli non devono vederne il contenuto.
  const copertura = isStaff ? await getCoperturaPratica(pratica.id) : null;

  // Attestazione firma (Termini art. 11): l'autore è scritto (`firmaForzataDaId`)
  // ma — a differenza di `creatoDaUserId`/`accettataDaUserId` (relazioni
  // `creatoDa`/`accettataDa`) — non ha una relazione Prisma che lo risolva a
  // utente. Query minimale, solo per lo staff: in una contestazione un admin
  // deve poter vedere CHI ha attestato senza aprire il database.
  const firmaForzataDaUser =
    isStaff && pratica.firmaForzataDaId
      ? await prisma.user.findUnique({
          where: { id: pratica.firmaForzataDaId },
          select: { nome: true, cognome: true, email: true },
        })
      : null;

  // Prova dell'attestazione pre-invio (Termini 23.2). Query separata e
  // admin-only: contiene l'IP del broker, e non serve a broker e agenzia.
  // Una pratica ha una sola dichiarazione, ma la relazione e' una lista:
  // si prende la piu' recente.
  const attestazione = isAdminPiattaforma(session.user.role)
    ? await prisma.brokerDichiarazione.findFirst({
        where: { praticaId: pratica.id },
        orderBy: { createdAt: 'desc' },
        select: {
          createdAt: true,
          ip: true,
          userAgent: true,
          popupVersion: true,
          testoAttestazioni: true,
          clausolaTerzi: true,
          user: { select: { nome: true, cognome: true, email: true } },
        },
      })
    : null;

  // Mostra solo le fatture che il viewer può effettivamente aprire (admin / sua
  // emittente / sua destinataria / sua sede): un broker non deve vedere/cliccare
  // la FATTURA_PV PV→agenzia della pratica (darebbe 404 sul dettaglio).
  //
  // `pratica.documentiFiscali` è selezionato SENZA le relazioni `pratica`/
  // `payout` (righe della pratica stessa, non del documento): passarle al
  // predicato così com'è darebbe campi sede `undefined` e farebbe sparire le
  // fatture per ogni non-owner. Il predicato è autoportante: riceve la sede della
  // pratica stessa e la confronta con lo scope della VISTA corrente (`scopeIds`).
  // NB: l'accesso alla pratica ora è per `accessibleSedeIds` (permalink), più
  // ampio della vista corrente; una fattura di una pratica di un'altra sede resta
  // quindi nascosta finché non si opera come quella sede (confine finanziario).
  const fattureVisibili = pratica.documentiFiscali.filter((d) =>
    canViewDocumentoFiscale(
      {
        emittenteCompanyId: d.emittenteCompanyId,
        destinatarioCompanyId: d.destinatarioCompanyId,
        praticaAgenziaSedeId: pratica.agenziaSedeId,
        praticaBrokerSedeId: pratica.brokerSedeId,
        payoutWalletSedeId: null,
      },
      {
        companyId,
        isAdminPiattaforma: session.user.role === 'ADMIN_PIATTAFORMA',
        scope: ctx ? toSedeScope(ctx) : NO_SEDE_SCOPE,
      },
    ),
  );

  // Indirizzo fisico dell'agenzia assegnata (sede operativa). Non è una riga
  // come le altre: è il "dove andare" della pratica, quindi apre la card
  // "Parti commerciali" in un blocco a sé (vedi DoveAndareBox).
  //
  // Tenuto in due righe (via / CAP città (prov)) perché si legge come un
  // indirizzo su una busta, non come un campo. La versione su una riga serve
  // solo alla query per le mappe.
  const as = pratica.agenziaSede;
  const agenziaVia = as ? [as.indirizzo, as.civico].filter(Boolean).join(' ') : '';
  const agenziaLocalita = as
    ? [[as.cap, as.citta].filter(Boolean).join(' '), as.provincia ? `(${as.provincia})` : '']
        .filter(Boolean)
        .join(' ')
    : '';
  // Query per le mappe: stesso indirizzo ma con la provincia senza parentesi,
  // che è la forma in cui la scriverebbe una persona nella barra di ricerca.
  const agenziaQueryMappe = as
    ? [agenziaVia, [as.cap, as.citta].filter(Boolean).join(' '), as.provincia]
        .filter(Boolean)
        .join(', ')
    : '';
  // Intestazione del blocco: ragione sociale della madre + nome della sede,
  // ma solo se dicono cose diverse. Alla registrazione la prima sede eredita
  // il nome dell'azienda, quindi molto spesso coincidono e ripeterli due volte
  // sembrerebbe che siano due posti.
  const agenziaRagioneSociale = pratica.agenziaAssegnata?.ragioneSociale ?? null;
  const sedeNomeDistinto =
    as && as.nome.trim().toLowerCase() !== (agenziaRagioneSociale ?? '').trim().toLowerCase()
      ? as.nome
      : null;
  // Telefono di quella sede; se non c'è, quello della madre.
  const agenziaTelefono = as?.telefono || pratica.agenziaAssegnata?.telefono || null;

  // Nessuna agenzia ancora: al posto del "dove andare" si mostra DOVE STIAMO
  // CERCANDO.
  //
  // Il gate è `IN_DISTRIBUZIONE` e NON `STATI_IN_ATTESA`, che pure sarebbe la
  // fonte unica del gruppo "in attesa": quel set include anche i round legacy
  // pre-v2 e l'escalation, stati che il tick non guida più (`tickPratica` esce
  // subito con "stato non gestito"). Raccontare lì un raggio che si allarga
  // sarebbe una promessa che nessun motore mantiene. Restano com'è oggi:
  // nessun blocco, con la guida in cima alla pagina a dire "in attesa che
  // un'agenzia accetti".
  //
  // Qui vive SOLO ciò che riguarda la pratica del broker: centro e ampiezza
  // della ricerca. Quali agenzie siano state contattate, e perché una sia stata
  // saltata, resta `getCoperturaPratica` — diagnostica admin-only.
  const cfgDistribuzione =
    !as && pratica.stato === 'IN_DISTRIBUZIONE' ? await getDistribuzioneConfig() : null;

  const backHref = companyType === 'AGENZIA' ? '/pratiche' : '/pratiche';

  // Numerazione documenti: quando ci sono più soggetti dello stesso ruolo
  // (co-venditori / co-acquirenti) o più veicoli, le etichette si ripeterebbero
  // identiche ("CI fronte — venditore"). Numeriamo per posizione nelle liste già
  // ordinate per `ordine` così i documenti dei diversi soggetti si distinguono.
  // L'acquirente principale (dati inline sulla pratica, nessun coAcquirenteId) è
  // il n.1; i co-intestatari seguono (indice + 2).
  const numVenditori = pratica.venditori.length;
  const numAcquirenti = 1 + pratica.coAcquirenti.length;
  const numVeicoli = pratica.veicoli.length;
  const venditoreNumById = new Map(pratica.venditori.map((v, i): [string, number] => [v.id, i + 1]));
  const coAcquirenteNumById = new Map(
    pratica.coAcquirenti.map((c, i): [string, number] => [c.id, i + 2]),
  );
  const veicoloNumById = new Map(pratica.veicoli.map((v, i): [string, number] => [v.id, i + 1]));
  const documentoLabel = (d: (typeof pratica.documenti)[number]): string => {
    const base = labelDocumento(d.tipo);
    const dettagli: string[] = [];
    if (d.owner) {
      let owner = labelOwner(d.owner);
      if (d.owner === 'VENDITORE' && numVenditori > 1 && d.venditoreId) {
        const n = venditoreNumById.get(d.venditoreId);
        if (n) owner += ` ${n}`;
      } else if (d.owner === 'ACQUIRENTE' && numAcquirenti > 1) {
        const n = d.coAcquirenteId ? coAcquirenteNumById.get(d.coAcquirenteId) : 1;
        if (n) owner += ` ${n}`;
      }
      dettagli.push(owner);
    }
    if (d.veicoloId && numVeicoli > 1) {
      const n = veicoloNumById.get(d.veicoloId);
      if (n) dettagli.push(`veicolo ${n}`);
    }
    return dettagli.length ? `${base} — ${dettagli.join(' · ')}` : base;
  };

  // Quick-action nel dettaglio: renderizzate solo se l'utente ha la capability
  // corrispondente. Lo staff non ha permessi azienda (bypassato sopra), quindi
  // per lui questi restano sempre false — coerente: lo staff non lavora la
  // pratica al posto di broker/agenzia.
  const canProcessataPermesso = await hasPermesso('pratiche.processa');
  const canFirmaPermesso = await hasPermesso('pratiche.firma');
  const canAnnullaPermesso = await hasPermesso('pratiche.annulla');
  const canValutarePermesso = await hasPermesso('pratiche.valuta');
  const canSegnalarePermesso = await hasPermesso('pratiche.segnala');
  // Lo staff piattaforma non ha permessi azienda (companyId null) ma deve
  // continuare a scaricare i documenti dal dettaglio linkato da /admin/pratiche.
  const canDownload = isStaff || (await hasPermesso('pratiche.download'));

  const canProcessata =
    canProcessataPermesso &&
    companyType === 'AGENZIA' &&
    inScope(pratica.agenziaSedeId) &&
    pratica.stato === 'ACCETTATA';

  const canFirma =
    canFirmaPermesso &&
    companyType === 'AGENZIA' &&
    inScope(pratica.agenziaSedeId) &&
    pratica.stato === 'PROCESSATA' &&
    // Una segnalazione in verifica blocca la firma (il guard in
    // firmaPraticaCore resta la difesa vera).
    !pratica.flagSegnalata;

  const canAnnulla =
    canAnnullaPermesso &&
    companyType === 'DEALER' &&
    inScope(pratica.brokerSedeId) &&
    pratica.stato !== 'FIRMATA' &&
    pratica.stato !== 'ANNULLATA' &&
    pratica.stato !== 'SCADUTA' &&
    // Sistema Penali Broker: una segnalazione IN VERIFICA blocca l'annullamento
    // (il guard server in `annullaPraticaAction` resta comunque la difesa vera).
    !(pratica.flagSegnalata && pratica.segnalazioneStato === 'RICEVUTA');

  const firmaBound = markFirmaAvvenutaAction.bind(null, pratica.id);
  const processataBound = markPraticaProcessataAction.bind(null, pratica.id);

  const canValutare =
    canValutarePermesso &&
    companyType === 'DEALER' &&
    inScope(pratica.brokerSedeId) &&
    pratica.stato === 'FIRMATA' &&
    !pratica.valutazione &&
    !!pratica.agenziaAssegnata;

  // Sistema Penali Broker (SP-B): l'agenzia assegnata può segnalare un
  // problema solo prima della firma (ACCETTATA o PROCESSATA) e una sola
  // volta per pratica.
  const canSegnalare =
    canSegnalarePermesso &&
    companyType === 'AGENZIA' &&
    inScope(pratica.agenziaSedeId) &&
    (pratica.stato === 'ACCETTATA' || pratica.stato === 'PROCESSATA') &&
    !pratica.flagSegnalata;

  // Trattamento extra dello stato (pill "in revisione" / motivo annullamento).
  const statoInfo = statoExtra({
    stato: pratica.stato as PraticaStato,
    flagSegnalata: pratica.flagSegnalata,
    segnalazioneStato: pratica.segnalazioneStato,
    tipoSegnalazione: pratica.tipoSegnalazione,
    notaSegnalazione: pratica.notaSegnalazione,
    penaleAddebitatoCent: pratica.penaleAddebitatoCent,
    revisioneCompletata: pratica.revisioneCompletata,
    richiedeRevisioneManuale: pratica.richiedeRevisioneManuale,
  });

  // Pratica chiusa senza firma: fee, credito e margine non si sono mai mossi.
  const importiBarrati = importoMaiIncassato(pratica.stato as PraticaStato);

  const ruolo: GuidaRuolo =
    companyType === 'AGENZIA' ? 'AGENZIA' : companyType === 'DEALER' ? 'DEALER' : 'ALTRO';
  const guida = guidaStep({
    stato: pratica.stato as PraticaStato,
    ruolo,
    hasValutazione: !!pratica.valutazione,
  });

  return (
    <AppShell session={session} activePath="/pratiche">
      <div className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-6 sm:py-10">
        {isStaff ? (
          <BackButton fallbackHref="/admin/pratiche" />
        ) : (
          <Link
            href={backHref}
            className="mb-5 inline-flex items-center gap-1 text-[13px] font-semibold text-pv-navy-600 hover:underline underline-offset-4"
          >
            ← Tutte le pratiche
          </Link>
        )}

        <header className="mb-7 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-mono text-[13px] font-semibold text-pv-slate-500">
              {pratica.codicePratica ?? 'BOZZA'}
            </p>
            <h1 className="mt-1 flex flex-wrap items-center gap-3 text-[28px] font-extrabold tracking-tight text-pv-navy-900 sm:text-[32px]">
              <span>
                {pratica.veicoli[0]?.targa
                  ? pratica.veicoli.length > 1
                    ? `${pratica.veicoli[0].targa} +${pratica.veicoli.length - 1}`
                    : pratica.veicoli[0].targa
                  : 'Pratica senza targa'}
              </span>
              <StatusChip
                stato={pratica.stato as PraticaStato}
                tone={statoInfo?.kind === 'ANNULLATA_TEAM' ? 'danger' : undefined}
                viewerRole={
                  session.user.role === 'ADMIN_PIATTAFORMA' ||
                  session.user.role === 'ASSISTENTE'
                    ? 'ADMIN'
                    : companyType === 'AGENZIA'
                      ? 'AGENZIA'
                      : 'BROKER'
                }
              />
              <StatoExtraInfo extra={statoInfo} />
            </h1>
            <p className="mt-1 text-[14px] text-pv-slate-500">
              <TipoPraticaChip tipo={pratica.tipo} numeroVeicoli={pratica.numeroVeicoli} /> · {pratica.comune ?? '—'}
              {pratica.provincia ? ` (${pratica.provincia})` : ''}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-y-2">
            {canSegnalare && (
              <SegnalaProblemaButton
                praticaId={pratica.id}
                veicoli={pratica.veicoli.map((v) => ({ id: v.id, targa: v.targa }))}
              />
            )}
            {canAnnulla && <AnnullaPraticaButton praticaId={pratica.id} />}
            {isAdminPiattaforma(session.user.role) &&
              pratica.stato === 'PROCESSATA' &&
              !pratica.flagSegnalata &&
              pratica.agenziaAssegnata && (
                <AttestaFirmaButton
                  praticaId={pratica.id}
                  feeAgenziaCent={pratica.feeAgenziaCent}
                  creditoBrokerCent={pratica.creditoBrokerCent}
                  nomeAgenzia={pratica.agenziaAssegnata.ragioneSociale}
                  nomeBroker={pratica.broker.ragioneSociale}
                />
              )}
            {pratica.documenti.length > 0 && canDownload && (
              <DownloadDocumentiButton
                href={`/api/pratiche/${pratica.id}/zip`}
                className="rounded-[10px] border border-pv-slate-300 bg-white px-4 py-2 text-[13px] font-semibold text-pv-navy-700 hover:bg-pv-slate-50"
              />
            )}
          </div>
        </header>

        <GuidaStepCard
          guida={guida}
          cta={
            guida.cta === 'processata' && canProcessata ? (
              <form action={processataBound}>
                <SubmitButton size="sm" className="animate-pulse-soft" loadingLabel="Aggiornamento…">
                  Pratica processata
                </SubmitButton>
              </form>
            ) : guida.cta === 'firma' && canFirma ? (
              <form action={firmaBound}>
                <SubmitButton size="sm" className="animate-pulse-soft" loadingLabel="Aggiornamento…">
                  Firma avvenuta
                </SubmitButton>
              </form>
            ) : null
          }
        />

        {pratica.flagSegnalata && pratica.segnalazioneStato === 'RICEVUTA' && (
          <div className="mb-5">
            <Alert variant="warning" title="Segnalazione in verifica">
              {companyType === 'AGENZIA'
                ? 'La tua segnalazione è in fase di verifica dal team. Riceverai un aggiornamento appena gestita.'
                : 'È stata aperta una segnalazione su questa pratica. Il team la sta verificando.'}
            </Alert>
          </div>
        )}
        <PraticaToasts />

        {fattureVisibili.length > 0 && (
          <Card className="mb-5">
            <h2 className="text-[15px] font-bold text-pv-navy-800">Documenti fiscali</h2>
            <ul className="mt-2 divide-y divide-pv-slate-100 text-[13px]">
              {fattureVisibili.map((d) => (
                <li key={d.id} className="flex items-center justify-between py-2">
                  <Link
                    href={`/fatturazione/${d.id}`}
                    className="font-semibold text-pv-navy-600 hover:underline"
                  >
                    {labelTipoDocumento(d.tipo)} · N° {d.numeroDocumentoStr}
                  </Link>
                  <span
                    className={d.importoLordoCent < 0 ? 'text-pv-red-500' : 'text-pv-navy-900'}
                  >
                    {formatCurrencyCent(d.importoLordoCent)}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        )}

        {canValutare && pratica.agenziaAssegnata && (
          <div className="mb-5">
            <ValutazioneForm
              praticaId={pratica.id}
              agenziaNome={pratica.agenziaAssegnata.ragioneSociale}
            />
          </div>
        )}

        {pratica.valutazione && (
          <div className="mb-5">
            <Card>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
                    Valutazione
                  </p>
                  <p className="mt-1 text-[18px] font-bold text-pv-navy-800">
                    {'★'.repeat(pratica.valutazione.stelle)}
                    <span className="text-pv-slate-300">
                      {'★'.repeat(5 - pratica.valutazione.stelle)}
                    </span>
                    <span className="ml-2 text-[13px] font-normal text-pv-slate-500">
                      {pratica.valutazione.stelle}/5
                    </span>
                  </p>
                  {pratica.valutazione.note && (
                    <p className="mt-1 text-[13px] text-pv-slate-700">
                      &ldquo;{pratica.valutazione.note}&rdquo;
                    </p>
                  )}
                </div>
              </div>
            </Card>
          </div>
        )}

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
          <div className="space-y-5 lg:col-span-2">
            <Card>
              <h2 className="text-[15px] font-bold text-pv-navy-800">
                {pratica.veicoli.length > 1 ? `Veicoli (${pratica.veicoli.length})` : 'Dati veicolo'}
              </h2>
              {pratica.veicoli.length === 0 ? (
                <p className="mt-3 text-[13px] text-pv-slate-500">Nessun veicolo</p>
              ) : (
                <div className="mt-4 space-y-5">
                  {pratica.veicoli.map((v) => (
                    <div key={v.id}>
                      {pratica.veicoli.length > 1 && (
                        <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
                          Veicolo {v.ordine}
                        </p>
                      )}
                      <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-[13px] sm:grid-cols-2">
                        <InfoRow label="Targa" value={v.targa} />
                        <InfoRow label="Telaio" value={v.telaio} mono />
                        <InfoRow label="Proprietario attuale" value={v.proprietarioAttuale} />
                        <InfoRow label="Immatricolazione" value={formatDate(v.dataImmatricolazione)} />
                        <InfoRow label="Pre-2015" value={v.preImm2015 ? 'Sì' : 'No'} />
                        <InfoRow label="Comodato d'uso" value={v.flagComodatoDuso ? 'Sì' : 'No'} />
                        {/* Prezzo di vendita: messo in leggera evidenza rispetto agli
                            altri campi (blocco a tutta larghezza, importo più grande),
                            in modo delicato. */}
                        <div className="mt-1 flex items-center justify-between gap-3 rounded-lg border border-pv-navy-100 bg-pv-navy-50/60 px-3 py-2 sm:col-span-2">
                          <dt className="text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
                            Prezzo di vendita
                          </dt>
                          <dd className="text-[18px] font-extrabold tracking-tight text-pv-navy-900">
                            {v.prezzoVenditaCent != null
                              ? formatCurrencyCent(v.prezzoVenditaCent)
                              : '—'}
                          </dd>
                        </div>
                      </dl>
                    </div>
                  ))}
                </div>
              )}
              {pratica.veicoli.length > 1 && (
                <p className="mt-3 text-[11px] text-pv-slate-500">
                  Totale veicoli: {pratica.numeroVeicoli}
                </p>
              )}
            </Card>

            <Card>
              <h2 className="text-[15px] font-bold text-pv-navy-800">Parti coinvolte</h2>
              <div className="mt-4 grid grid-cols-1 gap-5 sm:grid-cols-2">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
                    {pratica.venditori.length > 1
                      ? `Venditori (${pratica.venditori.length})`
                      : 'Venditore'}
                  </p>
                  <p className="mt-1.5 text-[14px] font-semibold text-pv-navy-800">
                    {pratica.venditori[0]?.isPersonaGiuridica
                      ? pratica.venditori[0]?.ragioneSociale ?? '—'
                      : `${pratica.venditori[0]?.nome ?? ''} ${pratica.venditori[0]?.cognome ?? ''}`.trim() || '—'}
                    {pratica.venditori.length > 1 ? ` +${pratica.venditori.length - 1}` : ''}
                  </p>
                  <p className="text-[12px] text-pv-slate-500">
                    {pratica.venditori[0]?.isPersonaGiuridica
                      ? pratica.venditori[0]?.piva ?? '—'
                      : pratica.venditori[0]?.cf ?? '—'}
                  </p>
                  {(pratica.venditori[0]?.telefono || pratica.venditori[0]?.email) && (
                    <ContattiParte
                      telefono={pratica.venditori[0]?.telefono ?? null}
                      email={pratica.venditori[0]?.email ?? null}
                    />
                  )}
                </div>
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
                    Acquirente
                  </p>
                  <p className="mt-1.5 text-[14px] font-semibold text-pv-navy-800">
                    {pratica.acquirenteIsPersonaGiuridica
                      ? pratica.acquirenteRagioneSociale ?? '—'
                      : `${pratica.acquirenteNome ?? ''} ${pratica.acquirenteCognome ?? ''}`.trim() || '—'}
                  </p>
                  <p className="text-[12px] text-pv-slate-500">
                    {pratica.acquirenteIsPersonaGiuridica
                      ? pratica.acquirentePIVA ?? '—'
                      : pratica.acquirenteCF ?? '—'}
                  </p>
                  {(pratica.acquirenteTelefono || pratica.acquirenteEmail) && (
                    <ContattiParte
                      telefono={pratica.acquirenteTelefono}
                      email={pratica.acquirenteEmail}
                    />
                  )}
                  {pratica.acquirenteIndirizzoResidenza && (
                    <p className="mt-1.5 text-[12px] text-pv-slate-700">
                      <span className="font-semibold">Residenza acquirente (diversa dal documento):</span>{' '}
                      {pratica.acquirenteIndirizzoResidenza}
                    </p>
                  )}
                  {pratica.coAcquirenti.length > 0 && (
                    <div className="mt-3 border-t border-pv-slate-200 pt-3">
                      <p className="mb-1 text-[12px] font-semibold text-pv-slate-500">
                        Co-intestatari ({pratica.coAcquirenti.length})
                      </p>
                      <ul className="space-y-1">
                        {pratica.coAcquirenti.map((c) => (
                          <li key={c.id} className="text-[13px] text-pv-slate-700">
                            {c.isPersonaGiuridica
                              ? (c.ragioneSociale ?? '—')
                              : `${c.nome ?? ''} ${c.cognome ?? ''}`.trim() || '—'}
                            {' · '}
                            {c.isPersonaGiuridica ? (c.piva ?? '—') : (c.cf ?? '—')}
                            {c.indirizzoResidenza ? ` · residenza: ${c.indirizzoResidenza}` : ''}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </div>
              {(pratica.flagCointestazione || pratica.flagMinivoltura || pratica.flagProcura) && (
                <div className="mt-4 flex flex-wrap gap-2">
                  {pratica.flagCointestazione && <Flag>Cointestazione</Flag>}
                  {pratica.flagMinivoltura && <Flag>Minivoltura</Flag>}
                  {pratica.flagProcura && <Flag>Procura</Flag>}
                </div>
              )}
            </Card>

            <Card>
              <h2 className="text-[15px] font-bold text-pv-navy-800">Documenti</h2>
              {pratica.documenti.length === 0 ? (
                <p className="mt-3 text-[13px] text-pv-slate-500">
                  Nessun documento caricato
                </p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {pratica.documenti.map((d) => {
                    const failed = d.gatingStato === 'FAILED';
                    const overridden = d.gatingStato === 'OVERRIDDEN';
                    return (
                      <li
                        key={d.id}
                        className={
                          'rounded-[10px] border px-3 py-2 text-[13px] ' +
                          (failed
                            ? 'border-pv-red-500/30 bg-pv-red-50/30'
                            : 'border-pv-slate-200')
                        }
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <p className="font-semibold text-pv-navy-800">
                              {documentoLabel(d)}
                            </p>
                            <p className="truncate text-[12px] text-pv-slate-500">
                              {formatBytes(d.sizeBytes)}
                            </p>
                          </div>
                          <div className="ml-3 flex shrink-0 items-center gap-2">
                            <GatingBadge stato={d.gatingStato} />
                            {canDownload && (
                              <a
                                href={`/api/documenti/${d.id}`}
                                className="rounded-lg border border-pv-slate-300 px-3 py-1.5 text-xs font-semibold text-pv-navy-700 hover:bg-pv-slate-50"
                              >
                                Scarica
                              </a>
                            )}
                          </div>
                        </div>
                        {failed && d.gatingError && (
                          <p className="mt-2 rounded-[6px] bg-pv-red-50 px-2 py-1 text-[11.5px] text-pv-red-500">
                            ⚠ {d.gatingError}
                          </p>
                        )}
                        {overridden && (
                          <p className="mt-2 text-[11px] text-pv-orange-500">
                            ⓘ Validazione forzata da admin
                          </p>
                        )}
                        {failed && session.user.role === 'ADMIN_PIATTAFORMA' && (
                          <div className="mt-2">
                            <OverrideGatingButton documentoId={d.id} />
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>
          </div>

          <aside className="space-y-5">
            <Card>
              <h2 className="text-[15px] font-bold text-pv-navy-800">Parti commerciali</h2>

              {/* L'indirizzo dell'agenzia apre la card, staccato dall'elenco:
                  è il dato che manda una persona fisica in un posto fisico, e
                  in una riga da 13px identica a "Comune" e "Codice interno" si
                  perdeva. Senza agenzia assegnata non c'è nessun posto dove
                  andare e il blocco non compare (l'elenco qui sotto continua a
                  dire "Agenzia assegnata: —"). */}
              {as ? (
                <DoveAndareBox
                  intestazione={agenziaRagioneSociale}
                  sede={sedeNomeDistinto}
                  via={agenziaVia}
                  localita={agenziaLocalita}
                  queryMappe={agenziaQueryMappe}
                  telefono={agenziaTelefono}
                />
              ) : (
                cfgDistribuzione && (
                  <RicercaZonaBox
                    comune={pratica.comune}
                    raggioCorrenteM={pratica.raggioCorrenteM}
                    raggioMaxM={cfgDistribuzione.raggioMaxM}
                    zonaNonCoperta={pratica.zonaNonCopertaAt != null}
                    coordinateMancanti={pratica.lat == null || pratica.lng == null}
                  />
                )
              )}

              <dl className="mt-4 space-y-3 text-[13px]">
                <InfoRow label="Broker" value={pratica.broker.ragioneSociale} />
                <InfoRow label="Telefono broker" value={pratica.broker.telefono} />
                <InfoRow
                  label="Agenzia assegnata"
                  value={pratica.agenziaAssegnata?.ragioneSociale ?? '—'}
                />
                {/* Telefono e indirizzo dell'agenzia NON si ripetono qui: sono
                    nel blocco sopra. Ripeterli suggerirebbe due recapiti. */}
                {!as && (
                  <InfoRow
                    label="Telefono agenzia"
                    value={pratica.agenziaAssegnata?.telefono ?? null}
                  />
                )}
                <InfoRow label="Comune" value={pratica.comune} />
                {/* Economia della pratica. Due regole:
                    — ognuno vede solo il proprio importo (l'agenzia la fee che
                      le viene addebitata alla firma, il broker il credito che
                      le viene accreditato); l'intera catena, margine PV
                      compreso, resta allo staff di piattaforma;
                    — nessun gate sulla firma: gli importi nascono col
                      tariffario alla creazione della pratica, e nasconderli
                      fino alla firma rendeva dettaglio e lista incoerenti
                      (la lista li ha sempre mostrati).
                    Su pratica annullata o scaduta gli importi sono barrati:
                    nulla è stato addebitato né accreditato. */}
                {isStaff ? (
                  <>
                    <InfoRow
                      label="Fee agenzia"
                      barrato={importiBarrati}
                      value={
                        pratica.feeAgenziaCent > 0
                          ? formatCurrencyCent(pratica.feeAgenziaCent)
                          : '—'
                      }
                    />
                    <InfoRow
                      label="Credito broker"
                      barrato={importiBarrati}
                      value={
                        pratica.creditoBrokerCent > 0
                          ? formatCurrencyCent(pratica.creditoBrokerCent)
                          : '—'
                      }
                    />
                    <InfoRow
                      label="Margine PV"
                      barrato={importiBarrati}
                      value={
                        pratica.feeAgenziaCent > 0
                          ? formatCurrencyCent(
                              margineLordoCent({
                                feeAgenziaCent: pratica.feeAgenziaCent,
                                creditoBrokerCent: pratica.creditoBrokerCent,
                              }),
                            )
                          : '—'
                      }
                    />
                  </>
                ) : companyType === 'AGENZIA' ? (
                  <InfoRow
                    label="La tua fee"
                    barrato={importiBarrati}
                    value={
                      pratica.feeAgenziaCent > 0
                        ? formatCurrencyCent(pratica.feeAgenziaCent)
                        : '—'
                    }
                  />
                ) : (
                  <InfoRow
                    label="Il tuo compenso"
                    barrato={importiBarrati}
                    value={
                      pratica.creditoBrokerCent > 0
                        ? formatCurrencyCent(pratica.creditoBrokerCent)
                        : '—'
                    }
                  />
                )}
                <InfoRow label="Codice interno" value={pratica.codiceAgenziaInterno} />
              </dl>
            </Card>

            <Card>
              <h2 className="text-[15px] font-bold text-pv-navy-800">Timeline</h2>
              <Timeline
                pratica={pratica}
                showInternals={
                  session.user.role === 'ADMIN_PIATTAFORMA' ||
                  session.user.role === 'ASSISTENTE'
                }
                firmaForzataDaUser={firmaForzataDaUser}
              />
            </Card>

            {/* Item 02 release 2026-05: il broker non vede il dettaglio dei
                round e della coda agenzie. Visibile solo all'admin platform. */}
            {pratica.assegnazioni.length > 0 &&
              (session.user.role === 'ADMIN_PIATTAFORMA' ||
                session.user.role === 'ASSISTENTE') && (
                <Card>
                  <h2 className="text-[15px] font-bold text-pv-navy-800">Round distribuzione</h2>
                  {pratica.roundAccettazione !== null && (
                    <p className="mt-3 rounded-[10px] bg-pv-navy-100 px-3 py-2 text-[12.5px] text-pv-navy-800">
                      Accettata al{' '}
                      <strong>round {pratica.roundAccettazione}</strong>
                      {(() => {
                        const vincente = pratica.assegnazioni.find((a) => a.esito === 'ACCETTATA');
                        return vincente && vincente.raggioMetri > 0
                          ? ` · raggio ${formatKm(vincente.raggioMetri)}`
                          : '';
                      })()}
                    </p>
                  )}
                  <ul className="mt-3 space-y-2 text-[13px]">
                    {pratica.assegnazioni.map((a) => (
                      <li
                        key={a.id}
                        className="flex items-center justify-between gap-3 rounded-[10px] border border-pv-slate-200 px-3 py-2"
                      >
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-pv-navy-800">
                            {a.agenzia.ragioneSociale}
                          </p>
                          <p className="text-[11px] text-pv-slate-500">
                            R{a.round}
                            {a.raggioMetri > 0 ? ` · ${formatKm(a.raggioMetri)}` : ''} ·{' '}
                            {formatDateTime(a.invioAt)}
                          </p>
                        </div>
                        <span className="shrink-0 text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
                          {a.esito.toLowerCase().replace('_', ' ')}
                        </span>
                      </li>
                    ))}
                  </ul>
                </Card>
              )}

            {/* Fuori dalla condizione sulle assegnazioni: è proprio quando la
                pratica non è arrivata a nessuno che questa diagnostica serve
                di più ("perché nessuna agenzia l'ha ricevuta"). */}
            {copertura && <CoperturaCard copertura={copertura} />}

            {attestazione ? (
              <AttestazioneCard dichiarazione={attestazione} />
            ) : (
              // Finding 6 (review whole-branch 2026-07-27): la scrittura di
              // BrokerDichiarazione e' best-effort per le pratiche inviate
              // prima di questa release (e resta dentro una transazione che
              // PUO' fallire). Senza questa riga l'assenza del record e'
              // indistinguibile da "la feature non esisteva ancora" — solo
              // l'admin la vede, e' diagnostica, non un allarme.
              isAdminPiattaforma(session.user.role) && (
                <p className="px-1 text-[11px] text-pv-slate-400">
                  Nessuna attestazione registrata per questa pratica.
                </p>
              )
            )}
          </aside>
        </div>
      </div>
    </AppShell>
  );
}

/**
 * Indirizzo della sede agenzia in evidenza, in cima alle "Parti commerciali".
 *
 * È l'unico dato della card che si traduce in uno spostamento fisico: chi lo
 * legge deve poter capire dove andare senza rileggere. Da qui le scelte —
 * indirizzo su due righe come su una busta, corpo più grande del resto della
 * card, recapito e mappa a portata di pollice sul telefono.
 *
 * Il link mappe passa l'indirizzo in chiaro a Google al clic: è una
 * navigazione voluta dall'utente, non una chiamata che parte da sola.
 */
function DoveAndareBox({
  intestazione,
  sede,
  via,
  localita,
  queryMappe,
  telefono,
}: {
  /** Ragione sociale dell'agenzia assegnata. */
  intestazione: string | null;
  /** Nome della sede, solo se diverso dalla ragione sociale (vedi chiamante). */
  sede: string | null;
  via: string;
  localita: string;
  /** Indirizzo su una riga, da dare alle mappe come termine di ricerca. */
  queryMappe: string;
  telefono: string | null;
}) {
  const mapsHref = queryMappe
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(queryMappe)}`
    : null;
  const titolo = [intestazione, sede].filter(Boolean).join(' — ');

  return (
    <div className="mt-4 rounded-[12px] border border-pv-navy-100 bg-pv-navy-50/60 p-4">
      <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-pv-navy-700">
        <PinIcon />
        Dove andare
      </p>
      {titolo && <p className="mt-2 text-[13px] font-semibold text-pv-slate-700">{titolo}</p>}
      <p className="mt-0.5 text-[16px] font-extrabold leading-snug tracking-tight text-pv-navy-900">
        {via || '—'}
      </p>
      {localita && (
        <p className="text-[15px] font-semibold leading-snug text-pv-navy-900">{localita}</p>
      )}
      {(telefono || mapsHref) && (
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[13px] font-semibold">
          {telefono && (
            <a
              href={`tel:${telefono.replace(/\s/g, '')}`}
              className="text-pv-navy-700 underline hover:text-pv-navy-800"
            >
              {telefono}
            </a>
          )}
          {mapsHref && (
            <a
              href={mapsHref}
              target="_blank"
              rel="noopener noreferrer"
              className="text-pv-navy-700 underline hover:text-pv-navy-800"
            >
              Apri in mappe ↗
            </a>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Il "dove andare" quando ancora non c'è un dove: la zona in cui la
 * distribuzione sta cercando un'agenzia.
 *
 * Racconta la ricerca solo per centro e ampiezza. L'elenco delle agenzie
 * contattate e i motivi di esclusione sono un'altra cosa — diagnostica
 * admin-only, `CoperturaCard` — e non devono finire qui.
 *
 * Tre messaggi, perché tre sono le situazioni reali del motore:
 * ricerca in corso, raggio massimo esaurito senza agenzie (da cui si può
 * ripartire se una diventa disponibile), pratica non localizzabile (da cui
 * non si riparte da sola: lo dice il tick, che su lat/lng nulli non ha
 * nessuna ripresa possibile).
 */
function RicercaZonaBox({
  comune,
  raggioCorrenteM,
  raggioMaxM,
  zonaNonCoperta,
  coordinateMancanti,
}: {
  comune: string | null;
  /** Raggio già raggiunto. null = la distribuzione non ha ancora fatto un giro. */
  raggioCorrenteM: number | null;
  raggioMaxM: number;
  zonaNonCoperta: boolean;
  coordinateMancanti: boolean;
}) {
  const attorno = comune ? ` da ${comune}` : '';

  const { tono, etichetta, titolo, dettaglio } = coordinateMancanti
    ? {
        tono: 'avviso' as const,
        etichetta: 'Ricerca ferma',
        titolo: 'Non riusciamo a localizzare l’indirizzo della pratica',
        dettaglio:
          'Senza posizione la distribuzione automatica non può scegliere le agenzie. Scrivici e la sistemiamo.',
      }
    : zonaNonCoperta
      ? {
          tono: 'avviso' as const,
          etichetta: 'Nessuna agenzia in zona',
          titolo: `Nessuna agenzia disponibile entro ${formatKm(raggioMaxM)}${attorno}`,
          dettaglio:
            'La richiesta resta attiva: appena un’agenzia della zona diventa disponibile, la ricerca riparte. Nel frattempo puoi rivolgerti a un’agenzia di fiducia.',
        }
      : {
          tono: 'attesa' as const,
          etichetta: 'Ricerca in corso',
          titolo: comune
            ? `Stiamo cercando un’agenzia intorno a ${comune}`
            : 'Stiamo cercando un’agenzia in zona',
          dettaglio:
            raggioCorrenteM != null
              ? `Raggio attuale ${formatKm(raggioCorrenteM)}, si allarga fino a ${formatKm(raggioMaxM)}.`
              : `Partiamo dalle agenzie più vicine e allarghiamo fino a ${formatKm(raggioMaxM)}.`,
        };

  const stile =
    tono === 'avviso'
      ? 'border-pv-amber-500 bg-pv-amber-50'
      : 'border-pv-slate-200 bg-pv-slate-50';
  const stileEtichetta = tono === 'avviso' ? 'text-pv-navy-800' : 'text-pv-slate-500';

  return (
    <div className={`mt-4 rounded-[12px] border p-4 ${stile}`}>
      <p
        className={`flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider ${stileEtichetta}`}
      >
        <TargetIcon />
        {etichetta}
      </p>
      <p className="mt-2 text-[14px] font-bold leading-snug text-pv-navy-900">{titolo}</p>
      <p className="mt-1 text-[12.5px] leading-relaxed text-pv-slate-700">{dettaglio}</p>
    </div>
  );
}

function TargetIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5" aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="2" />
      <circle cx="12" cy="12" r="2" fill="currentColor" />
    </svg>
  );
}

function PinIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5" aria-hidden="true">
      <path
        d="M12 21s7-5.4 7-11a7 7 0 10-14 0c0 5.6 7 11 7 11z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="10" r="2.5" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

function InfoRow({
  label,
  value,
  mono,
  barrato,
}: {
  label: string;
  value: string | null | undefined;
  mono?: boolean;
  /** Importo mai movimentato (pratica annullata o scaduta): valore barrato. */
  barrato?: boolean;
}) {
  return (
    <div>
      <dt className="text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">{label}</dt>
      <dd
        className={`mt-0.5 ${barrato ? 'text-pv-slate-400' : 'text-pv-slate-900'} ${mono ? 'font-mono text-[12.5px]' : 'text-[13px]'}`}
      >
        {barrato && value ? (
          <s className="decoration-pv-slate-400" title="Pratica chiusa senza firma: importo mai movimentato">
            {value}
          </s>
        ) : (
          value || '—'
        )}
      </dd>
    </div>
  );
}

function ContattiParte({
  telefono,
  email,
}: {
  telefono: string | null;
  email: string | null;
}) {
  return (
    <p className="mt-1 text-[12px] text-pv-slate-700">
      {telefono && (
        <span>
          <span className="font-semibold text-pv-slate-500">Tel:</span>{' '}
          <a className="hover:underline" href={`tel:${telefono}`}>
            {telefono}
          </a>
        </span>
      )}
      {telefono && email && <span className="mx-1.5 text-pv-slate-400">·</span>}
      {email && (
        <span>
          <span className="font-semibold text-pv-slate-500">Email:</span>{' '}
          <a className="hover:underline" href={`mailto:${email}`}>
            {email}
          </a>
        </span>
      )}
    </p>
  );
}

function Flag({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full bg-pv-orange-500/15 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider text-pv-orange-500">
      {children}
    </span>
  );
}

function labelDocumento(t: string): string {
  const map: Record<string, string> = {
    LIBRETTO_CIRCOLAZIONE: 'Libretto circolazione',
    CI_FRONTE: 'CI fronte',
    CI_RETRO: 'CI retro',
    CODICE_FISCALE: 'Codice fiscale (fronte)',
    CODICE_FISCALE_RETRO: 'Codice fiscale (retro)',
    PROCURA: 'Procura',
    PERMESSO_SOGGIORNO: 'Permesso di soggiorno',
    VISURA_CAMERALE: 'Visura camerale',
    CERTIFICATO_PROPRIETA: 'Certificato di proprietà',
    ALTRO: 'Altro',
    DELEGA_VENDITA: 'Procura a vendere',
    DOCUMENTO_DELEGATO: 'Documento delegato',
    PATENTE: 'Patente (fronte)',
    PATENTE_RETRO: 'Patente (retro)',
    PASSAPORTO: 'Passaporto',
    LIBRETTO_CIRCOLAZIONE_RETRO: 'Libretto (retro)',
  };
  return map[t] ?? t;
}

function labelOwner(o: string): string {
  const map: Record<string, string> = {
    VENDITORE: 'venditore',
    ACQUIRENTE: 'acquirente',
    AMMINISTRATORE: 'amministratore',
    AZIENDA: 'azienda',
  };
  return map[o] ?? o;
}

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

function GatingBadge({ stato }: { stato: string }): React.ReactElement {
  const map: Record<string, { label: string; cls: string }> = {
    PASSED: { label: '✓ ok', cls: 'bg-pv-green-50 text-pv-green-500' },
    FAILED: { label: '✗ scartato', cls: 'bg-pv-red-50 text-pv-red-500' },
    OVERRIDDEN: { label: '⓿ override', cls: 'bg-pv-orange-50 text-pv-orange-500' },
    PENDING: { label: 'pending', cls: 'bg-pv-slate-100 text-pv-slate-500' },
    NONE: { label: '—', cls: 'bg-pv-slate-100 text-pv-slate-500' },
  };
  const m = map[stato] ?? map.NONE!;
  return (
    <span
      className={
        'rounded-full px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wider ' +
        m.cls
      }
    >
      {m.label}
    </span>
  );
}

type TimelineStep = {
  label: string;
  at: Date | null | undefined;
  active?: boolean;
  /** Riga secondaria opzionale sotto lo step (es. attestazione admin). */
  note?: string;
};

function Timeline({
  pratica,
  showInternals,
  firmaForzataDaUser,
}: {
  pratica: {
    createdAt: Date;
    submittedAt: Date | null;
    round1StartedAt: Date | null;
    round2StartedAt: Date | null;
    round3StartedAt: Date | null;
    escalationAt: Date | null;
    accettataAt: Date | null;
    processataAt: Date | null;
    firmaAvvenutaAt: Date | null;
    firmaForzataAt: Date | null;
    firmaForzataMotivo: string | null;
    autoAddebitoAt: Date | null;
    scadutaAt: Date | null;
    annullataAt: Date | null;
  };
  /**
   * Lato broker e agenzia (item 02 release 2026-05) gli step di routing
   * (round/escalation) sono dettagli operativi interni: vanno mostrati solo
   * all'admin platform. Riusato anche per la motivazione dell'attestazione
   * firma (Termini art. 11): stessa platea (isStaff), stesso criterio.
   */
  showInternals: boolean;
  /**
   * Chi ha attestato la firma (Termini art. 11: "il Gestore registra
   * internamente data, autore e motivazione"). Risolto dal chiamante da
   * `firmaForzataDaId` — null se non attestata o se il viewer non è staff.
   */
  firmaForzataDaUser?: { nome: string; cognome: string; email: string } | null;
}) {
  const steps: TimelineStep[] = [
    { label: 'Creazione pratica', at: pratica.createdAt },
    { label: 'Inviata alle agenzie', at: pratica.submittedAt },
    ...(showInternals
      ? [
          { label: 'Round 1 — comune', at: pratica.round1StartedAt },
          { label: 'Round 2 — limitrofi', at: pratica.round2StartedAt },
          { label: 'Round 3 — provincia', at: pratica.round3StartedAt },
          { label: 'Escalation admin', at: pratica.escalationAt },
        ]
      : []),
    { label: 'Accettata', at: pratica.accettataAt },
    { label: 'Processata', at: pratica.processataAt },
    {
      label: 'Firma avvenuta',
      at: pratica.firmaAvvenutaAt,
      // Trasparenza verso le parti (Termini art. 11): quando la firma è stata
      // attestata dal Gestore invece che segnalata dall'agenzia, sia broker
      // che agenzia lo vedono qui. La motivazione (perché) resta interna —
      // mostrata solo allo staff, sotto, come blocco separato.
      note: pratica.firmaForzataAt
        ? `Firma attestata dal team Passaggio Veloce il ${formatDate(pratica.firmaForzataAt)}`
        : undefined,
    },
    { label: 'Fee addebitata', at: pratica.autoAddebitoAt },
    { label: 'Scaduta', at: pratica.scadutaAt },
    { label: 'Annullata', at: pratica.annullataAt },
  ].filter((s) => s.at);

  if (steps.length === 0) {
    return <p className="mt-3 text-[13px] text-pv-slate-500">Nessun evento ancora</p>;
  }

  return (
    <>
      <ol className="relative mt-4 space-y-3 pl-5">
        <span className="absolute left-[5px] top-1 bottom-1 w-[2px] bg-pv-slate-200" aria-hidden />
        {steps.map((s, i) => (
          <li key={i} className="relative">
            <span className="absolute left-[-20px] top-1.5 h-3 w-3 rounded-full border-2 border-pv-navy-700 bg-white" />
            <p className="text-[13px] font-semibold text-pv-navy-800">{s.label}</p>
            <p className="text-[11px] text-pv-slate-500">{formatDateTime(s.at)}</p>
            {s.note && <p className="mt-0.5 text-[11px] text-pv-slate-500">{s.note}</p>}
          </li>
        ))}
      </ol>
      {showInternals && pratica.firmaForzataMotivo && (
        <div className="mt-3 rounded-[10px] border border-pv-slate-200 bg-pv-slate-100 px-3 py-2">
          <p className="text-[11px] font-bold uppercase tracking-wider text-pv-slate-700">
            Motivazione attestazione (interna)
          </p>
          {firmaForzataDaUser && (
            <p className="text-[11px] text-pv-slate-500">
              Attestata da {firmaForzataDaUser.nome} {firmaForzataDaUser.cognome} (
              {firmaForzataDaUser.email})
            </p>
          )}
          <p className="mt-1 text-[12.5px] text-pv-slate-700">{pratica.firmaForzataMotivo}</p>
        </div>
      )}
    </>
  );
}
