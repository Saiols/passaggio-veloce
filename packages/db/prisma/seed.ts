import { PrismaClient } from '@prisma/client';
import { hash } from 'bcryptjs';

const prisma = new PrismaClient();

// Password dev: "DevPass123!" (rispetta policy: min 10, maiusc/minusc/numero)
const DEV_PASSWORD = 'DevPass123!';

/**
 * Upsert idempotente di uno User per email.
 *
 * Lo schema usa `@@unique([companyId, email])` (più un partial index per gli
 * admin platform con companyId NULL), quindi `prisma.user.upsert({ where: { email } })`
 * non è valido: `email` da sola non è una chiave unica per Prisma. Questo helper
 * replica la semantica originale (find-by-email → update | create) restando
 * compatibile con la chiave composta.
 */
async function upsertUserByEmail<
  C extends Record<string, unknown>,
  U extends Record<string, unknown>,
>(email: string, data: { create: C; update: U }) {
  const existing = await prisma.user.findFirst({ where: { email } });
  if (existing) {
    return prisma.user.update({
      where: { id: existing.id },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: data.update as any,
    });
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return prisma.user.create({ data: data.create as any });
}

async function main() {
  console.log('🌱 Seed start');
  const passwordHash = await hash(DEV_PASSWORD, 12);
  const now = new Date();

  // Admin piattaforma
  const admin = await upsertUserByEmail('admin@passaggioveloce.it', {
    update: {},
    create: {
      email: 'admin@passaggioveloce.it',
      passwordHash,
      nome: 'Admin',
      cognome: 'Piattaforma',
      role: 'ADMIN_PIATTAFORMA',
      status: 'ACTIVE',
      emailVerifiedAt: now,
    },
  });
  console.log(`  · admin: ${admin.email}`);

  // Assistente piattaforma (F-03 / D-02): vede pratiche, anagrafiche, wallet,
  // catalogo, escalation. Non vede dashboard finanziaria aggregata.
  const assistente = await upsertUserByEmail('assistente@passaggioveloce.it', {
    update: {},
    create: {
      email: 'assistente@passaggioveloce.it',
      passwordHash,
      nome: 'Assistente',
      cognome: 'Operativo',
      role: 'ASSISTENTE',
      status: 'ACTIVE',
      emailVerifiedAt: now,
    },
  });
  console.log(`  · assistente: ${assistente.email}`);

  // Dealer 1
  const dealer1 = await prisma.company.upsert({
    where: { partitaIva: '01234567890' },
    update: {},
    create: {
      type: 'DEALER',
      ragioneSociale: 'Auto Demo Venezia S.r.l.',
      partitaIva: '01234567890',
      pec: 'autodemo@pec.it',
      email: 'info@autodemove.it',
      telefono: '+39041123456',
      indirizzo: 'Via Garibaldi 10',
      citta: 'Venezia',
      cap: '30121',
      provincia: 'VE',
      iban: 'IT60X0542811101000000123456',
      sepaMandateAccepted: true,
      sepaMandateAcceptedAt: now,
      termsAcceptedAt: now,
      wallet: { create: { saldoCent: 0 } },
      users: {
        create: {
          email: 'dealer1@passaggioveloce.it',
          passwordHash,
          nome: 'Marco',
          cognome: 'Rossi',
          codiceFiscale: 'RSSMRC80A01L736Y',
          dataNascita: new Date('1980-01-01'),
          luogoNascita: 'Venezia',
          role: 'ADMIN_AZIENDA',
          status: 'ACTIVE',
          emailVerifiedAt: now,
        },
      },
    },
    include: { users: true },
  });
  console.log(`  · dealer: ${dealer1.ragioneSociale} (${dealer1.users[0]?.email})`);

  // ─────────────────────────────────────────────────────────────────────
  // Utente 2FA deterministico per il test E2E del login a due fattori.
  // ATTENZIONE: secret TOTP e backup codes sono SOLO per i test locali/E2E,
  // non vanno mai usati in produzione. Rispecchia dealer1 (ADMIN_AZIENDA
  // ACTIVE) così che, superato il 2FA, l'utente atterri su /dashboard.
  // È agganciato alla stessa company di dealer1 (una company può avere più
  // utenti). Il secret è la stringa base32 grezza, come la salva l'app
  // (generateTotpSecret ritorna `secret` e viene memorizzato così com'è).
  // I backup codes "AAAA-BBBB" e "CCCC-DDDD" sono hashati con bcrypt cost 12
  // — stesso helper/costo di hashBackupCodes — normalizzati a MAIUSCOLO
  // perché verifyBackupCode confronta sempre l'input in upper-case.
  const backupCodesPlain = ['AAAA-BBBB', 'CCCC-DDDD'];
  const twoFactorBackupCodes = await Promise.all(
    backupCodesPlain.map((c) => hash(c.toUpperCase(), 12)),
  );
  const dealer2fa = await upsertUserByEmail('dealer2fa@passaggioveloce.it', {
    update: {
      passwordHash,
      twoFactorEnabled: true,
      twoFactorSecret: 'KZXW6YTBOI7EQ5LFMRUGS3THNZUWK43F',
      twoFactorBackupCodes,
      companyId: dealer1.id,
    },
    create: {
      email: 'dealer2fa@passaggioveloce.it',
      passwordHash,
      nome: 'Daniela',
      cognome: 'Fattori',
      role: 'ADMIN_AZIENDA',
      status: 'ACTIVE',
      emailVerifiedAt: now,
      companyId: dealer1.id,
      twoFactorEnabled: true,
      twoFactorSecret: 'KZXW6YTBOI7EQ5LFMRUGS3THNZUWK43F',
      twoFactorBackupCodes,
    },
  });
  console.log(`  · dealer 2FA (E2E): ${dealer2fa.email} [2FA ON]`);

  // Dealer 2
  const dealer2 = await prisma.company.upsert({
    where: { partitaIva: '02345678901' },
    update: {},
    create: {
      type: 'DEALER',
      ragioneSociale: 'Rivenditori Padova SPA',
      partitaIva: '02345678901',
      pec: 'rivpadova@pec.it',
      email: 'info@rivpadova.it',
      indirizzo: 'Via Roma 45',
      citta: 'Padova',
      cap: '35100',
      provincia: 'PD',
      iban: 'IT60X0542811101000000234567',
      sepaMandateAccepted: true,
      sepaMandateAcceptedAt: now,
      termsAcceptedAt: now,
      wallet: { create: { saldoCent: 25000 } }, // 250€ saldo esempio
      users: {
        create: {
          email: 'dealer2@passaggioveloce.it',
          passwordHash,
          nome: 'Laura',
          cognome: 'Bianchi',
          codiceFiscale: 'BNCLRA85B42G224K',
          dataNascita: new Date('1985-02-02'),
          luogoNascita: 'Padova',
          role: 'ADMIN_AZIENDA',
          status: 'ACTIVE',
          emailVerifiedAt: now,
        },
      },
    },
    include: { users: true },
  });
  console.log(`  · dealer: ${dealer2.ragioneSociale} (${dealer2.users[0]?.email})`);

  // Agenzie
  const agenzieData = [
    {
      partitaIva: '10000000001',
      ragioneSociale: 'Agenzia Pratiche Venezia Centro',
      citta: 'Venezia',
      cap: '30122',
      provincia: 'VE',
      userEmail: 'agenzia1@passaggioveloce.it',
      userNome: 'Giorgio',
      userCognome: 'Verdi',
    },
    {
      partitaIva: '10000000002',
      ragioneSociale: 'Studio Auto Padova',
      citta: 'Padova',
      cap: '35131',
      provincia: 'PD',
      userEmail: 'agenzia2@passaggioveloce.it',
      userNome: 'Silvia',
      userCognome: 'Neri',
    },
    {
      partitaIva: '10000000003',
      ragioneSociale: 'Pratiche Auto Treviso',
      citta: 'Treviso',
      cap: '31100',
      provincia: 'TV',
      userEmail: 'agenzia3@passaggioveloce.it',
      userNome: 'Roberto',
      userCognome: 'Ferrari',
    },
  ];

  for (const a of agenzieData) {
    const agenzia = await prisma.company.upsert({
      where: { partitaIva: a.partitaIva },
      update: {},
      create: {
        type: 'AGENZIA',
        ragioneSociale: a.ragioneSociale,
        partitaIva: a.partitaIva,
        pec: `${a.partitaIva}@pec.it`,
        email: `info@${a.ragioneSociale.toLowerCase().replace(/\s+/g, '')}.it`,
        indirizzo: 'Via Principale 1',
        citta: a.citta,
        cap: a.cap,
        provincia: a.provincia,
        iban: `IT60X0542811101000000${a.partitaIva}`,
        sepaMandateAccepted: true,
        sepaMandateAcceptedAt: now,
        termsAcceptedAt: now,
        users: {
          create: {
            email: a.userEmail,
            passwordHash,
            nome: a.userNome,
            cognome: a.userCognome,
            role: 'ADMIN_AZIENDA',
            status: 'ACTIVE',
            emailVerifiedAt: now,
          },
        },
      },
    });

    // Orari standard lun-ven 9:00-13:00 / 15:00-18:30, sab 9:00-12:00
    const standardFasce = [
      { inizio: '09:00', fine: '13:00' },
      { inizio: '15:00', fine: '18:30' },
    ];
    const sabFasce = [{ inizio: '09:00', fine: '12:00' }];
    const giorni = [
      { g: 'LUN', f: standardFasce },
      { g: 'MAR', f: standardFasce },
      { g: 'MER', f: standardFasce },
      { g: 'GIO', f: standardFasce },
      { g: 'VEN', f: standardFasce },
      { g: 'SAB', f: sabFasce },
    ] as const;
    for (const { g, f } of giorni) {
      await prisma.orariApertura.upsert({
        where: { agenziaId_giorno: { agenziaId: agenzia.id, giorno: g } },
        update: { fasceOrarie: f },
        create: { agenziaId: agenzia.id, giorno: g, fasceOrarie: f },
      });
    }

    console.log(`  · agenzia: ${agenzia.ragioneSociale} (${a.userEmail}) + orari`);
  }

  // ============================================================
  // Sample pratiche — variano stato per popolare dashboard
  // ============================================================

  const agenzieAll = await prisma.company.findMany({
    where: { type: 'AGENZIA' },
    orderBy: { createdAt: 'asc' },
  });
  const agenziaVE = agenzieAll.find((a) => a.provincia === 'VE')!;
  const agenziaPD = agenzieAll.find((a) => a.provincia === 'PD')!;
  const agenziaTV = agenzieAll.find((a) => a.provincia === 'TV')!;

  const daysAgo = (n: number): Date => {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return d;
  };

  type PraticaSeed = {
    codicePratica: string;
    tipo: 'PASSAGGIO_PRIVATO' | 'MINIVOLTURE_MULTIPLE';
    stato:
      | 'BOZZA'
      | 'IN_ATTESA_ROUND_1'
      | 'ACCETTATA'
      | 'FIRMATA'
      | 'IN_ESCALATION';
    brokerId: string;
    agenziaAssegnataId?: string;
    comune: string;
    provincia: string;
    targa: string;
    telaio: string;
    proprietario: string;
    feeAgenziaCent: number;
    creditoBrokerCent: number;
    submittedAgo: number;
    accettataAgo?: number;
    firmaAgo?: number;
    assegnazioni: { agenziaId: string; round: number; esito: 'PENDING' | 'ACCETTATA' | 'RIFIUTATA' | 'TIMEOUT' | 'ASSEGNATA_ALTRO' }[];
  };

  const praticheSeed: PraticaSeed[] = [
    {
      codicePratica: 'PV-2026-00001',
      tipo: 'PASSAGGIO_PRIVATO',
      stato: 'FIRMATA',
      brokerId: dealer1.id,
      agenziaAssegnataId: agenziaVE.id,
      comune: 'Venezia',
      provincia: 'VE',
      targa: 'FA123GH',
      telaio: 'ZFA19500005123456',
      proprietario: 'Mario Rossi',
      feeAgenziaCent: 12000,
      creditoBrokerCent: 2500,
      submittedAgo: 30,
      accettataAgo: 29,
      firmaAgo: 12,
      assegnazioni: [
        { agenziaId: agenziaVE.id, round: 1, esito: 'ACCETTATA' },
        { agenziaId: agenziaPD.id, round: 1, esito: 'ASSEGNATA_ALTRO' },
        { agenziaId: agenziaTV.id, round: 1, esito: 'ASSEGNATA_ALTRO' },
      ],
    },
    {
      codicePratica: 'PV-2026-00002',
      tipo: 'PASSAGGIO_PRIVATO',
      stato: 'ACCETTATA',
      brokerId: dealer1.id,
      agenziaAssegnataId: agenziaPD.id,
      comune: 'Padova',
      provincia: 'PD',
      targa: 'GT789NO',
      telaio: 'WVWZZZ1KZBW234567',
      proprietario: 'Anna Verdi',
      feeAgenziaCent: 11500,
      creditoBrokerCent: 2500,
      submittedAgo: 6,
      accettataAgo: 5,
      assegnazioni: [
        { agenziaId: agenziaPD.id, round: 1, esito: 'ACCETTATA' },
        { agenziaId: agenziaVE.id, round: 1, esito: 'ASSEGNATA_ALTRO' },
      ],
    },
    {
      codicePratica: 'PV-2026-00003',
      tipo: 'MINIVOLTURE_MULTIPLE',
      stato: 'IN_ATTESA_ROUND_1',
      brokerId: dealer2.id,
      comune: 'Padova',
      provincia: 'PD',
      targa: 'EJ456LM',
      telaio: 'WAUZZZ8V3JA098765',
      proprietario: 'Giuseppe Bianchi',
      feeAgenziaCent: 9500,
      creditoBrokerCent: 1800,
      submittedAgo: 1,
      assegnazioni: [
        { agenziaId: agenziaPD.id, round: 1, esito: 'PENDING' },
        { agenziaId: agenziaVE.id, round: 1, esito: 'PENDING' },
        { agenziaId: agenziaTV.id, round: 1, esito: 'PENDING' },
      ],
    },
    {
      codicePratica: 'PV-2026-00004',
      tipo: 'PASSAGGIO_PRIVATO',
      stato: 'IN_ESCALATION',
      brokerId: dealer2.id,
      comune: 'Treviso',
      provincia: 'TV',
      targa: 'FB234PQ',
      telaio: 'JMBSNC74A4U056789',
      proprietario: 'Luca Ferrari',
      feeAgenziaCent: 12500,
      creditoBrokerCent: 2500,
      submittedAgo: 14,
      assegnazioni: [
        { agenziaId: agenziaTV.id, round: 1, esito: 'TIMEOUT' },
        { agenziaId: agenziaVE.id, round: 2, esito: 'TIMEOUT' },
        { agenziaId: agenziaPD.id, round: 3, esito: 'TIMEOUT' },
      ],
    },
    {
      codicePratica: 'PV-2026-00005',
      tipo: 'PASSAGGIO_PRIVATO',
      stato: 'FIRMATA',
      brokerId: dealer2.id,
      agenziaAssegnataId: agenziaTV.id,
      comune: 'Treviso',
      provincia: 'TV',
      targa: 'EZ567RS',
      telaio: 'VF1RFD00X57345678',
      proprietario: 'Francesca Neri',
      feeAgenziaCent: 11000,
      creditoBrokerCent: 2500,
      submittedAgo: 60,
      accettataAgo: 58,
      firmaAgo: 40,
      assegnazioni: [{ agenziaId: agenziaTV.id, round: 1, esito: 'ACCETTATA' }],
    },
    // BOZZA — broker la sta ancora compilando
    {
      codicePratica: 'PV-2026-DRAFT',
      tipo: 'PASSAGGIO_PRIVATO',
      stato: 'BOZZA',
      brokerId: dealer1.id,
      comune: 'Venezia',
      provincia: 'VE',
      targa: 'FA999ZZ',
      telaio: 'WFC19500009999999',
      proprietario: 'Carla Ferri',
      feeAgenziaCent: 0,
      creditoBrokerCent: 0,
      submittedAgo: 0,
      assegnazioni: [],
    },
  ];

  for (const p of praticheSeed) {
    const exists = await prisma.pratica.findUnique({
      where: { codicePratica: p.codicePratica },
    });
    if (exists) continue;

    const submittedAt = p.submittedAgo > 0 ? daysAgo(p.submittedAgo) : null;
    const accettataAt = p.accettataAgo ? daysAgo(p.accettataAgo) : null;
    const firmaAt = p.firmaAgo ? daysAgo(p.firmaAgo) : null;

    const pratica = await prisma.pratica.create({
      data: {
        codicePratica: p.stato === 'BOZZA' ? null : p.codicePratica,
        tipo: p.tipo,
        stato: p.stato,
        targa: p.targa,
        telaio: p.telaio,
        proprietarioAttuale: p.proprietario,
        dataImmatricolazione: new Date('2019-06-15'),
        comune: p.comune,
        provincia: p.provincia,
        brokerId: p.brokerId,
        agenziaAssegnataId: p.agenziaAssegnataId,
        feeAgenziaCent: p.feeAgenziaCent,
        creditoBrokerCent: p.creditoBrokerCent,
        submittedAt,
        round1StartedAt: submittedAt,
        accettataAt,
        firmaAvvenutaAt: firmaAt,
        venditoreNome: 'Fabio',
        venditoreCognome: 'Galli',
        venditoreCF: 'GLLFBA70A01F205P',
        acquirenteNome: 'Nuovo',
        acquirenteCognome: 'Proprietario',
        acquirenteCF: 'NVPRPR85E10L736X',
      },
    });

    // Assegnazioni
    for (const a of p.assegnazioni) {
      await prisma.praticaAssegnazione.create({
        data: {
          praticaId: pratica.id,
          agenziaId: a.agenziaId,
          round: a.round,
          esito: a.esito,
          invioAt: submittedAt ?? new Date(),
          esitoAt: a.esito === 'PENDING' ? null : (accettataAt ?? submittedAt ?? new Date()),
        },
      });
    }

    // Credito wallet broker su pratiche firmate
    if (p.stato === 'FIRMATA' && firmaAt) {
      const wallet = await prisma.wallet.findUnique({ where: { companyId: p.brokerId } });
      if (wallet) {
        const newBalance = wallet.saldoCent + p.creditoBrokerCent;
        await prisma.wallet.update({
          where: { id: wallet.id },
          data: { saldoCent: newBalance },
        });
        await prisma.transazioneWallet.create({
          data: {
            walletId: wallet.id,
            tipo: 'CREDITO_PRATICA',
            importoCent: p.creditoBrokerCent,
            saldoPostCent: newBalance,
            praticaId: pratica.id,
            createdAt: firmaAt,
          },
        });
      }
    }

    console.log(`  · pratica ${p.codicePratica} [${p.stato}]`);
  }

  // ============================================================
  // DEMO ACCOUNTS (separati dagli account dev — password DemoPass2026!)
  // ============================================================

  const DEMO_PASSWORD = 'DemoPass2026!';
  const demoPasswordHash = await hash(DEMO_PASSWORD, 12);

  // Demo Admin (no company)
  await upsertUserByEmail('admin@demo.passaggioveloce.it', {
    create: {
      email: 'admin@demo.passaggioveloce.it',
      passwordHash: demoPasswordHash,
      nome: 'Admin',
      cognome: 'Demo',
      role: 'ADMIN_PIATTAFORMA',
      status: 'ACTIVE',
      emailVerifiedAt: now,
    },
    update: { passwordHash: demoPasswordHash },
  });

  // Demo Dealer Company
  const demoDealerCompany = await prisma.company.upsert({
    where: { partitaIva: '99999999991' },
    create: {
      type: 'DEALER',
      ragioneSociale: 'Demo Auto Srl',
      partitaIva: '99999999991',
      pec: 'pec@demoauto.it',
      email: 'info@demoauto.it',
      indirizzo: 'Via Roma 1',
      citta: 'Padova',
      cap: '35100',
      provincia: 'PD',
      iban: 'IT60X0542811101000000000001',
      sepaMandateAccepted: true,
      sepaMandateAcceptedAt: now,
      termsAcceptedAt: now,
      wallet: { create: { saldoCent: 0 } },
    },
    update: {},
  });

  await upsertUserByEmail('dealer@demo.passaggioveloce.it', {
    create: {
      email: 'dealer@demo.passaggioveloce.it',
      passwordHash: demoPasswordHash,
      nome: 'Mario',
      cognome: 'Rossi',
      role: 'ADMIN_AZIENDA',
      status: 'ACTIVE',
      emailVerifiedAt: now,
      companyId: demoDealerCompany.id,
    },
    update: { passwordHash: demoPasswordHash, companyId: demoDealerCompany.id },
  });

  await upsertUserByEmail('dealer-junior@demo.passaggioveloce.it', {
    create: {
      email: 'dealer-junior@demo.passaggioveloce.it',
      passwordHash: demoPasswordHash,
      nome: 'Luca',
      cognome: 'Bianchi',
      role: 'UTENTE_AZIENDA',
      status: 'ACTIVE',
      emailVerifiedAt: now,
      companyId: demoDealerCompany.id,
    },
    update: { passwordHash: demoPasswordHash, companyId: demoDealerCompany.id },
  });

  // Demo Agenzia Company
  const demoAgenziaCompany = await prisma.company.upsert({
    where: { partitaIva: '99999999992' },
    create: {
      type: 'AGENZIA',
      ragioneSociale: 'Demo Pratiche Auto Snc',
      partitaIva: '99999999992',
      pec: 'pec@demopratiche.it',
      email: 'info@demopratiche.it',
      indirizzo: 'Via Milano 5',
      citta: 'Padova',
      cap: '35100',
      provincia: 'PD',
      iban: 'IT60X0542811101000000000002',
      sepaMandateAccepted: true,
      sepaMandateAcceptedAt: now,
      termsAcceptedAt: now,
    },
    update: {},
  });

  await upsertUserByEmail('agenzia@demo.passaggioveloce.it', {
    create: {
      email: 'agenzia@demo.passaggioveloce.it',
      passwordHash: demoPasswordHash,
      nome: 'Giulia',
      cognome: 'Verdi',
      role: 'ADMIN_AZIENDA',
      status: 'ACTIVE',
      emailVerifiedAt: now,
      companyId: demoAgenziaCompany.id,
    },
    update: { passwordHash: demoPasswordHash, companyId: demoAgenziaCompany.id },
  });

  // Orari standard agenzia demo (lun-ven 9-13 + 15-18:30, sab 9-12)
  // Stesso pattern delle altre agenzie: fasceOrarie come JSON, enum GiornoSettimana
  const demoStandardFasce = [
    { inizio: '09:00', fine: '13:00' },
    { inizio: '15:00', fine: '18:30' },
  ];
  const demoSabFasce = [{ inizio: '09:00', fine: '12:00' }];
  const demoGiorni = [
    { g: 'LUN', f: demoStandardFasce },
    { g: 'MAR', f: demoStandardFasce },
    { g: 'MER', f: demoStandardFasce },
    { g: 'GIO', f: demoStandardFasce },
    { g: 'VEN', f: demoStandardFasce },
    { g: 'SAB', f: demoSabFasce },
  ] as const;
  for (const { g, f } of demoGiorni) {
    await prisma.orariApertura.upsert({
      where: { agenziaId_giorno: { agenziaId: demoAgenziaCompany.id, giorno: g } },
      update: { fasceOrarie: f },
      create: { agenziaId: demoAgenziaCompany.id, giorno: g, fasceOrarie: f },
    });
  }

  console.log('');
  console.log('  [DEMO ACCOUNTS]');
  console.log(`  · demo admin: admin@demo.passaggioveloce.it`);
  console.log(`  · demo dealer: dealer@demo.passaggioveloce.it (company: Demo Auto Srl)`);
  console.log(`  · demo dealer-junior: dealer-junior@demo.passaggioveloce.it`);
  console.log(`  · demo agenzia: agenzia@demo.passaggioveloce.it (company: Demo Pratiche Auto Snc)`);

  // ============================================================
  // DEMO CAST AGGIUNTIVO — 2 dealer + 5 agenzie, Veneto
  // ============================================================

  /**
   * Helper interno: crea/upsert una company (DEALER o AGENZIA) con il relativo
   * utente ADMIN_AZIENDA. Per le agenzie aggiunge anche gli orari standard.
   * La sospensione avviene tramite soft-delete (deletedAt), perché lo schema
   * Company non ha un campo `sospesa` esplicito.
   */
  async function createDemoCompany(args: {
    type: 'DEALER' | 'AGENZIA';
    ragioneSociale: string;
    partitaIva: string;
    citta: string;
    provincia: string;
    cap: string;
    indirizzo: string;
    iban: string;
    pec: string;
    email: string;
    userEmail: string;
    userNome: string;
    userCognome: string;
    passwordHash: string;
    orari?: boolean;
    sospesa?: boolean;
  }) {
    const companyData = {
      type: args.type,
      ragioneSociale: args.ragioneSociale,
      partitaIva: args.partitaIva,
      pec: args.pec,
      email: args.email,
      indirizzo: args.indirizzo,
      citta: args.citta,
      cap: args.cap,
      provincia: args.provincia,
      iban: args.iban,
      sepaMandateAccepted: true,
      sepaMandateAcceptedAt: now,
      termsAcceptedAt: now,
      ...(args.sospesa ? { deletedAt: now } : {}),
      ...(args.type === 'DEALER' ? { wallet: { create: { saldoCent: 0 } } } : {}),
    };

    const company = await prisma.company.upsert({
      where: { partitaIva: args.partitaIva },
      update: {},
      create: companyData,
    });

    await upsertUserByEmail(args.userEmail, {
      create: {
        email: args.userEmail,
        passwordHash: args.passwordHash,
        nome: args.userNome,
        cognome: args.userCognome,
        role: 'ADMIN_AZIENDA',
        status: 'ACTIVE',
        emailVerifiedAt: now,
        companyId: company.id,
      },
      update: { passwordHash: args.passwordHash, companyId: company.id },
    });

    if (args.orari) {
      const stdFasce = [
        { inizio: '09:00', fine: '13:00' },
        { inizio: '15:00', fine: '18:30' },
      ];
      const sabFasce = [{ inizio: '09:00', fine: '12:00' }];
      const giorni = [
        { g: 'LUN', f: stdFasce },
        { g: 'MAR', f: stdFasce },
        { g: 'MER', f: stdFasce },
        { g: 'GIO', f: stdFasce },
        { g: 'VEN', f: stdFasce },
        { g: 'SAB', f: sabFasce },
      ] as const;
      for (const { g, f } of giorni) {
        await prisma.orariApertura.upsert({
          where: { agenziaId_giorno: { agenziaId: company.id, giorno: g } },
          update: { fasceOrarie: f },
          create: { agenziaId: company.id, giorno: g, fasceOrarie: f },
        });
      }
    }

    const tag = args.sospesa ? ' [SOSPESA]' : '';
    const orariTag = args.orari ? ' + orari' : '';
    console.log(`  · ${args.type.toLowerCase()}: ${args.ragioneSociale} (${args.userEmail})${orariTag}${tag}`);
    return company;
  }

  // Dealer 3 — Auto Veneto Srl, Venezia
  await createDemoCompany({
    type: 'DEALER',
    ragioneSociale: 'Auto Veneto Srl',
    partitaIva: '99999999993',
    citta: 'Venezia',
    provincia: 'VE',
    cap: '30100',
    indirizzo: 'Via Torino 22',
    iban: 'IT60X0542811101000000000003',
    pec: 'pec@autoveneto.it',
    email: 'info@autoveneto.it',
    userEmail: 'auto-veneto@demo.passaggioveloce.it',
    userNome: 'Paolo',
    userCognome: 'Moro',
    passwordHash: demoPasswordHash,
  });

  // Dealer 4 — Concessionaria Treviso Spa, Treviso
  await createDemoCompany({
    type: 'DEALER',
    ragioneSociale: 'Concessionaria Treviso Spa',
    partitaIva: '99999999994',
    citta: 'Treviso',
    provincia: 'TV',
    cap: '31100',
    indirizzo: 'Via Feltrina 88',
    iban: 'IT60X0542811101000000000004',
    pec: 'pec@conctreviso.it',
    email: 'info@conctreviso.it',
    userEmail: 'treviso@demo.passaggioveloce.it',
    userNome: 'Elena',
    userCognome: 'Zago',
    passwordHash: demoPasswordHash,
  });

  // Agenzia — Studio Auto Padova 2
  await createDemoCompany({
    type: 'AGENZIA',
    ragioneSociale: 'Studio Auto Padova 2',
    partitaIva: '99999999995',
    citta: 'Padova',
    provincia: 'PD',
    cap: '35100',
    indirizzo: 'Via Altinate 12',
    iban: 'IT60X0542811101000000000005',
    pec: 'pec@studioautopd2.it',
    email: 'info@studioautopd2.it',
    userEmail: 'agenzia-pd2@demo.passaggioveloce.it',
    userNome: 'Chiara',
    userCognome: 'Rizzi',
    passwordHash: demoPasswordHash,
    orari: true,
  });

  // Agenzia — Veneto Trapassi, Venezia
  await createDemoCompany({
    type: 'AGENZIA',
    ragioneSociale: 'Veneto Trapassi',
    partitaIva: '99999999996',
    citta: 'Venezia',
    provincia: 'VE',
    cap: '30170',
    indirizzo: 'Via Martiri della Libertà 3',
    iban: 'IT60X0542811101000000000006',
    pec: 'pec@venetotrapassi.it',
    email: 'info@venetotrapassi.it',
    userEmail: 'agenzia-ve@demo.passaggioveloce.it',
    userNome: 'Andrea',
    userCognome: 'Fabbris',
    passwordHash: demoPasswordHash,
    orari: true,
  });

  // Agenzia — Trapasso Veloce TV, Treviso
  await createDemoCompany({
    type: 'AGENZIA',
    ragioneSociale: 'Trapasso Veloce TV',
    partitaIva: '99999999997',
    citta: 'Treviso',
    provincia: 'TV',
    cap: '31100',
    indirizzo: 'Viale Vittorio Veneto 9',
    iban: 'IT60X0542811101000000000007',
    pec: 'pec@trapassovelicetv.it',
    email: 'info@trapassovelicetv.it',
    userEmail: 'agenzia-tv@demo.passaggioveloce.it',
    userNome: 'Davide',
    userCognome: 'Conte',
    passwordHash: demoPasswordHash,
    orari: true,
  });

  // Agenzia — Vicenza Auto Pratiche, Vicenza
  await createDemoCompany({
    type: 'AGENZIA',
    ragioneSociale: 'Vicenza Auto Pratiche',
    partitaIva: '99999999998',
    citta: 'Vicenza',
    provincia: 'VI',
    cap: '36100',
    indirizzo: 'Corso Palladio 44',
    iban: 'IT60X0542811101000000000008',
    pec: 'pec@vicenzaauto.it',
    email: 'info@vicenzaauto.it',
    userEmail: 'agenzia-vi@demo.passaggioveloce.it',
    userNome: 'Monica',
    userCognome: 'Sartori',
    passwordHash: demoPasswordHash,
    orari: true,
  });

  // Agenzia — Verona Trapassi, Verona — SOSPESA via soft-delete (deletedAt)
  // Non esiste campo `sospesa` nello schema Company; il soft-delete è il meccanismo
  // standard: l'engine distribuzione esclude le company con deletedAt != null.
  await createDemoCompany({
    type: 'AGENZIA',
    ragioneSociale: 'Verona Trapassi',
    partitaIva: '99999999999',
    citta: 'Verona',
    provincia: 'VR',
    cap: '37121',
    indirizzo: 'Via Mazzini 11',
    iban: 'IT60X0542811101000000000009',
    pec: 'pec@veronatrapassi.it',
    email: 'info@veronatrapassi.it',
    userEmail: 'agenzia-vr@demo.passaggioveloce.it',
    userNome: 'Simone',
    userCognome: 'Mancini',
    passwordHash: demoPasswordHash,
    orari: true,
    sospesa: true,
  });

  // ============================================================
  // PRATICHE STATI MISTI — ~30 pratiche per popolare le dashboard demo
  // ============================================================

  function generateTarga(seed: number): string {
    const letters1 =
      String.fromCharCode(65 + (seed % 26)) +
      String.fromCharCode(65 + ((seed * 7) % 26));
    const numbers = String((seed * 11) % 1000).padStart(3, '0');
    const letters2 =
      String.fromCharCode(65 + ((seed * 13) % 26)) +
      String.fromCharCode(65 + ((seed * 17) % 26));
    return `${letters1}${numbers}${letters2}`;
  }

  function generateTelaio(seed: number): string {
    return `WAUZZZ${String(seed).padStart(11, '0')}`.slice(0, 17);
  }

  function generateCodicePratica(year: number, seq: number): string {
    return `PV-${year}-${String(seq).padStart(5, '0')}`;
  }

  // Carica tutti i dealer e le agenzie demo
  const allDealers = await prisma.company.findMany({
    where: { type: 'DEALER', deletedAt: null },
    select: { id: true, ragioneSociale: true, provincia: true },
    orderBy: { createdAt: 'asc' },
  });

  const allAgenzie = await prisma.company.findMany({
    where: { type: 'AGENZIA', deletedAt: null },
    select: { id: true, ragioneSociale: true, provincia: true },
    orderBy: { createdAt: 'asc' },
  });

  // Serve almeno 3 dealer e 5 agenzie per le assegnazioni
  const dealers = allDealers.slice(0, 4); // fino a 4 dealer
  const agenzie = allAgenzie; // tutte le agenzie attive

  let codiceSeq = 100; // sequenza codici pratiche

  const comuniPerProvincia: Record<string, { comune: string; provincia: string }> = {
    VE: { comune: 'Venezia', provincia: 'VE' },
    PD: { comune: 'Padova', provincia: 'PD' },
    TV: { comune: 'Treviso', provincia: 'TV' },
    VI: { comune: 'Vicenza', provincia: 'VI' },
    VR: { comune: 'Verona', provincia: 'VR' },
  };

  function getLuogo(i: number) {
    const provs = Object.values(comuniPerProvincia);
    return provs[i % provs.length];
  }

  function msAgo(ms: number): Date {
    return new Date(now.getTime() - ms);
  }
  const DAY_MS = 86_400_000;

  // Helper: crea pratica se non esiste già
  async function upsertPratica(codice: string, data: Parameters<typeof prisma.pratica.create>[0]['data']) {
    const exists = await prisma.pratica.findFirst({ where: { codicePratica: codice } });
    if (exists) {
      console.log(`  · pratica ${codice} già esistente, skip`);
      return exists;
    }
    const p = await prisma.pratica.create({ data });
    console.log(`  · pratica ${codice} [${data.stato}]`);
    return p;
  }

  console.log('');
  console.log('  [PRATICHE STATI MISTI]');

  // ──────────────────────────────────────────────────
  // BOZZA × 2
  // ──────────────────────────────────────────────────
  for (let i = 0; i < 2; i++) {
    const seq = codiceSeq++;
    const codice = generateCodicePratica(2026, seq);
    const broker = dealers[i % dealers.length];
    const luogo = getLuogo(i);
    // BOZZA non ha codicePratica (nullable)
    const exists = await prisma.pratica.findFirst({
      where: {
        targa: generateTarga(seq),
        stato: 'BOZZA',
        brokerId: broker.id,
      },
    });
    if (!exists) {
      await prisma.pratica.create({
        data: {
          tipo: 'PASSAGGIO_PRIVATO',
          stato: 'BOZZA',
          brokerId: broker.id,
          comune: luogo.comune,
          provincia: luogo.provincia,
          targa: generateTarga(seq),
          telaio: generateTelaio(seq),
          dataImmatricolazione: new Date('2017-03-10'),
          feeAgenziaCent: 0,
          creditoBrokerCent: 0,
        },
      });
      console.log(`  · pratica BOZZA #${seq} [BOZZA]`);
    } else {
      console.log(`  · pratica BOZZA #${seq} già esistente, skip`);
    }
  }

  // ──────────────────────────────────────────────────
  // IN_ATTESA_ROUND_1 × 5
  // (5 PraticaAssegnazione round=1 esito=PENDING per agenzia diversa)
  // ──────────────────────────────────────────────────
  for (let i = 0; i < 5; i++) {
    const seq = codiceSeq++;
    const codice = generateCodicePratica(2026, seq);
    const broker = dealers[i % dealers.length];
    const luogo = getLuogo(i);
    const submittedAt = msAgo((i + 1) * DAY_MS);

    const pratica = await upsertPratica(codice, {
      codicePratica: codice,
      tipo: i % 2 === 0 ? 'PASSAGGIO_PRIVATO' : 'MINIVOLTURE_MULTIPLE',
      stato: 'IN_ATTESA_ROUND_1',
      brokerId: broker.id,
      comune: luogo.comune,
      provincia: luogo.provincia,
      targa: generateTarga(seq),
      telaio: generateTelaio(seq),
      dataImmatricolazione: new Date('2018-05-20'),
      feeAgenziaCent: 9500,
      creditoBrokerCent: 1800,
      submittedAt,
      round1StartedAt: submittedAt,
      venditoreNome: 'Venditore',
      venditoreCognome: `Demo${seq}`,
      venditoreCF: 'VNDDMO70A01F205P',
      acquirenteNome: 'Acquirente',
      acquirenteCognome: `Demo${seq}`,
      acquirenteCF: 'CQRDMO85E10L736X',
    });

    // Crea assegnazioni PENDING per le prime 5 agenzie (o quante ne abbiamo)
    const agenzieRound = agenzie.slice(0, Math.min(5, agenzie.length));
    for (const ag of agenzieRound) {
      const assExist = await prisma.praticaAssegnazione.findFirst({
        where: { praticaId: pratica.id, agenziaId: ag.id, round: 1 },
      });
      if (!assExist) {
        await prisma.praticaAssegnazione.create({
          data: {
            praticaId: pratica.id,
            agenziaId: ag.id,
            round: 1,
            esito: 'PENDING',
            invioAt: submittedAt,
          },
        });
      }
    }
  }

  // ──────────────────────────────────────────────────
  // IN_ATTESA_ROUND_2 × 2
  // round1 fail (TIMEOUT) × 3 agenzie + round2 PENDING × 3 agenzie diverse
  // ──────────────────────────────────────────────────
  for (let i = 0; i < 2; i++) {
    const seq = codiceSeq++;
    const codice = generateCodicePratica(2026, seq);
    const broker = dealers[i % dealers.length];
    const luogo = getLuogo(i + 2);
    const submittedAt = msAgo((i + 8) * DAY_MS);
    const round2StartedAt = msAgo((i + 4) * DAY_MS);

    const pratica = await upsertPratica(codice, {
      codicePratica: codice,
      tipo: 'PASSAGGIO_PRIVATO',
      stato: 'IN_ATTESA_ROUND_2',
      brokerId: broker.id,
      comune: luogo.comune,
      provincia: luogo.provincia,
      targa: generateTarga(seq),
      telaio: generateTelaio(seq),
      dataImmatricolazione: new Date('2016-11-08'),
      feeAgenziaCent: 10000,
      creditoBrokerCent: 2000,
      submittedAt,
      round1StartedAt: submittedAt,
      round2StartedAt,
      venditoreNome: 'Venditore',
      venditoreCognome: `R2Demo${seq}`,
      venditoreCF: 'VNDDMO70A01F205P',
      acquirenteNome: 'Acquirente',
      acquirenteCognome: `R2Demo${seq}`,
      acquirenteCF: 'CQRDMO85E10L736X',
    });

    // Round 1: prime 3 agenzie TIMEOUT
    const agenzieR1 = agenzie.slice(0, Math.min(3, agenzie.length));
    for (const ag of agenzieR1) {
      const assExist = await prisma.praticaAssegnazione.findFirst({
        where: { praticaId: pratica.id, agenziaId: ag.id, round: 1 },
      });
      if (!assExist) {
        await prisma.praticaAssegnazione.create({
          data: {
            praticaId: pratica.id,
            agenziaId: ag.id,
            round: 1,
            esito: 'TIMEOUT',
            invioAt: submittedAt,
            esitoAt: round2StartedAt,
          },
        });
      }
    }

    // Round 2: agenzie 3-5 (o successive disponibili) PENDING
    const agenzieR2 = agenzie.slice(3, Math.min(6, agenzie.length));
    for (const ag of agenzieR2) {
      const assExist = await prisma.praticaAssegnazione.findFirst({
        where: { praticaId: pratica.id, agenziaId: ag.id, round: 2 },
      });
      if (!assExist) {
        await prisma.praticaAssegnazione.create({
          data: {
            praticaId: pratica.id,
            agenziaId: ag.id,
            round: 2,
            esito: 'PENDING',
            invioAt: round2StartedAt,
          },
        });
      }
    }
  }

  // ──────────────────────────────────────────────────
  // IN_ATTESA_ROUND_3 × 1
  // round1 TIMEOUT × 2 agenzie + round2 TIMEOUT × 2 + round3 PENDING × 2
  // ──────────────────────────────────────────────────
  {
    const seq = codiceSeq++;
    const codice = generateCodicePratica(2026, seq);
    const broker = dealers[0];
    const submittedAt = msAgo(15 * DAY_MS);
    const round2StartedAt = msAgo(10 * DAY_MS);
    const round3StartedAt = msAgo(5 * DAY_MS);

    const pratica = await upsertPratica(codice, {
      codicePratica: codice,
      tipo: 'PASSAGGIO_PRIVATO',
      stato: 'IN_ATTESA_ROUND_3',
      brokerId: broker.id,
      comune: 'Vicenza',
      provincia: 'VI',
      targa: generateTarga(seq),
      telaio: generateTelaio(seq),
      dataImmatricolazione: new Date('2015-07-22'),
      feeAgenziaCent: 11000,
      creditoBrokerCent: 2200,
      submittedAt,
      round1StartedAt: submittedAt,
      round2StartedAt,
      round3StartedAt,
      venditoreNome: 'Venditore',
      venditoreCognome: `R3Demo${seq}`,
      venditoreCF: 'VNDDMO70A01F205P',
      acquirenteNome: 'Acquirente',
      acquirenteCognome: `R3Demo${seq}`,
      acquirenteCF: 'CQRDMO85E10L736X',
    });

    // Round 1: agenzie 0-1 TIMEOUT
    for (let r = 0; r < Math.min(2, agenzie.length); r++) {
      const ag = agenzie[r];
      const assExist = await prisma.praticaAssegnazione.findFirst({
        where: { praticaId: pratica.id, agenziaId: ag.id, round: 1 },
      });
      if (!assExist) {
        await prisma.praticaAssegnazione.create({
          data: {
            praticaId: pratica.id,
            agenziaId: ag.id,
            round: 1,
            esito: 'TIMEOUT',
            invioAt: submittedAt,
            esitoAt: round2StartedAt,
          },
        });
      }
    }

    // Round 2: agenzie 2-3 RIFIUTATA
    for (let r = 2; r < Math.min(4, agenzie.length); r++) {
      const ag = agenzie[r];
      const assExist = await prisma.praticaAssegnazione.findFirst({
        where: { praticaId: pratica.id, agenziaId: ag.id, round: 2 },
      });
      if (!assExist) {
        await prisma.praticaAssegnazione.create({
          data: {
            praticaId: pratica.id,
            agenziaId: ag.id,
            round: 2,
            esito: 'RIFIUTATA',
            invioAt: round2StartedAt,
            esitoAt: round3StartedAt,
          },
        });
      }
    }

    // Round 3: agenzie 4-5 PENDING
    for (let r = 4; r < Math.min(6, agenzie.length); r++) {
      const ag = agenzie[r];
      const assExist = await prisma.praticaAssegnazione.findFirst({
        where: { praticaId: pratica.id, agenziaId: ag.id, round: 3 },
      });
      if (!assExist) {
        await prisma.praticaAssegnazione.create({
          data: {
            praticaId: pratica.id,
            agenziaId: ag.id,
            round: 3,
            esito: 'PENDING',
            invioAt: round3StartedAt,
          },
        });
      }
    }
  }

  // ──────────────────────────────────────────────────
  // ACCETTATA × 4
  // ──────────────────────────────────────────────────
  for (let i = 0; i < 4; i++) {
    const seq = codiceSeq++;
    const codice = generateCodicePratica(2026, seq);
    const broker = dealers[i % dealers.length];
    const agenzia = agenzie[i % agenzie.length];
    const luogo = getLuogo(i);
    const submittedAt = msAgo((i + 5) * DAY_MS);
    const accettataAt = msAgo((i + 3) * DAY_MS);

    const pratica = await upsertPratica(codice, {
      codicePratica: codice,
      tipo: i % 2 === 0 ? 'PASSAGGIO_PRIVATO' : 'MINIVOLTURE_MULTIPLE',
      stato: 'ACCETTATA',
      brokerId: broker.id,
      agenziaAssegnataId: agenzia.id,
      comune: luogo.comune,
      provincia: luogo.provincia,
      targa: generateTarga(seq),
      telaio: generateTelaio(seq),
      dataImmatricolazione: new Date('2019-01-14'),
      feeAgenziaCent: 11000,
      creditoBrokerCent: 2500,
      submittedAt,
      round1StartedAt: submittedAt,
      accettataAt,
      venditoreNome: 'Venditore',
      venditoreCognome: `AccDemo${seq}`,
      venditoreCF: 'VNDDMO70A01F205P',
      acquirenteNome: 'Acquirente',
      acquirenteCognome: `AccDemo${seq}`,
      acquirenteCF: 'CQRDMO85E10L736X',
    });

    // Assegnazione accettata
    const assExist = await prisma.praticaAssegnazione.findFirst({
      where: { praticaId: pratica.id, agenziaId: agenzia.id, round: 1 },
    });
    if (!assExist) {
      await prisma.praticaAssegnazione.create({
        data: {
          praticaId: pratica.id,
          agenziaId: agenzia.id,
          round: 1,
          esito: 'ACCETTATA',
          invioAt: submittedAt,
          esitoAt: accettataAt,
        },
      });
    }
  }

  // ──────────────────────────────────────────────────
  // FIRMATA × 12
  // ──────────────────────────────────────────────────
  for (let i = 0; i < 12; i++) {
    const seq = codiceSeq++;
    const codice = generateCodicePratica(2026, seq);
    const broker = dealers[i % dealers.length];
    const agenzia = agenzie[i % agenzie.length];
    const luogo = getLuogo(i);
    const daysAgoNum = i + 1;
    const firmaAt = msAgo(daysAgoNum * DAY_MS);
    const accettataAt = msAgo((daysAgoNum + 1) * DAY_MS);
    const submittedAt = msAgo((daysAgoNum + 2) * DAY_MS);
    const autoAddebitoAt = new Date(firmaAt.getTime() + 5 * 60_000);

    const pratica = await upsertPratica(codice, {
      codicePratica: codice,
      tipo: i % 3 === 0 ? 'MINIVOLTURE_MULTIPLE' : 'PASSAGGIO_PRIVATO',
      stato: 'FIRMATA',
      brokerId: broker.id,
      agenziaAssegnataId: agenzia.id,
      comune: luogo.comune,
      provincia: luogo.provincia,
      targa: generateTarga(seq),
      telaio: generateTelaio(seq),
      dataImmatricolazione: new Date('2020-04-11'),
      feeAgenziaCent: 6000,
      creditoBrokerCent: 2500,
      submittedAt,
      round1StartedAt: submittedAt,
      accettataAt,
      firmaAvvenutaAt: firmaAt,
      autoAddebitoAt,
      venditoreNome: 'Venditore',
      venditoreCognome: `FirmaDemo${seq}`,
      venditoreCF: 'VNDDMO70A01F205P',
      acquirenteNome: 'Acquirente',
      acquirenteCognome: `FirmaDemo${seq}`,
      acquirenteCF: 'CQRDMO85E10L736X',
    });

    // Assegnazione accettata
    const assExist = await prisma.praticaAssegnazione.findFirst({
      where: { praticaId: pratica.id, agenziaId: agenzia.id, round: 1 },
    });
    if (!assExist) {
      await prisma.praticaAssegnazione.create({
        data: {
          praticaId: pratica.id,
          agenziaId: agenzia.id,
          round: 1,
          esito: 'ACCETTATA',
          invioAt: submittedAt,
          esitoAt: accettataAt,
        },
      });
    }

    // Credito wallet broker
    const wallet = await prisma.wallet.findUnique({ where: { companyId: broker.id } });
    if (wallet) {
      const newBalance = wallet.saldoCent + 2500;
      await prisma.wallet.update({
        where: { id: wallet.id },
        data: { saldoCent: newBalance },
      });
      await prisma.transazioneWallet.create({
        data: {
          walletId: wallet.id,
          tipo: 'CREDITO_PRATICA',
          importoCent: 2500,
          saldoPostCent: newBalance,
          praticaId: pratica.id,
          createdAt: firmaAt,
        },
      });
    }
  }

  // ──────────────────────────────────────────────────
  // IN_ESCALATION × 2
  // tutti e 3 i round falliti
  // ──────────────────────────────────────────────────
  for (let i = 0; i < 2; i++) {
    const seq = codiceSeq++;
    const codice = generateCodicePratica(2026, seq);
    const broker = dealers[i % dealers.length];
    const luogo = getLuogo(i + 1);
    const submittedAt = msAgo(20 * DAY_MS);
    const round2StartedAt = msAgo(14 * DAY_MS);
    const round3StartedAt = msAgo(7 * DAY_MS);
    const escalationAt = msAgo(2 * DAY_MS);

    const pratica = await upsertPratica(codice, {
      codicePratica: codice,
      tipo: 'PASSAGGIO_PRIVATO',
      stato: 'IN_ESCALATION',
      brokerId: broker.id,
      comune: luogo.comune,
      provincia: luogo.provincia,
      targa: generateTarga(seq),
      telaio: generateTelaio(seq),
      dataImmatricolazione: new Date('2014-09-03'),
      feeAgenziaCent: 12000,
      creditoBrokerCent: 2500,
      submittedAt,
      round1StartedAt: submittedAt,
      round2StartedAt,
      round3StartedAt,
      escalationAt,
      venditoreNome: 'Venditore',
      venditoreCognome: `EscDemo${seq}`,
      venditoreCF: 'VNDDMO70A01F205P',
      acquirenteNome: 'Acquirente',
      acquirenteCognome: `EscDemo${seq}`,
      acquirenteCF: 'CQRDMO85E10L736X',
    });

    // Round 1: agenzie 0-1 TIMEOUT
    for (let r = 0; r < Math.min(2, agenzie.length); r++) {
      const ag = agenzie[r];
      const assExist = await prisma.praticaAssegnazione.findFirst({
        where: { praticaId: pratica.id, agenziaId: ag.id, round: 1 },
      });
      if (!assExist) {
        await prisma.praticaAssegnazione.create({
          data: {
            praticaId: pratica.id,
            agenziaId: ag.id,
            round: 1,
            esito: 'TIMEOUT',
            invioAt: submittedAt,
            esitoAt: round2StartedAt,
          },
        });
      }
    }

    // Round 2: agenzie 2-3 RIFIUTATA
    for (let r = 2; r < Math.min(4, agenzie.length); r++) {
      const ag = agenzie[r];
      const assExist = await prisma.praticaAssegnazione.findFirst({
        where: { praticaId: pratica.id, agenziaId: ag.id, round: 2 },
      });
      if (!assExist) {
        await prisma.praticaAssegnazione.create({
          data: {
            praticaId: pratica.id,
            agenziaId: ag.id,
            round: 2,
            esito: 'RIFIUTATA',
            invioAt: round2StartedAt,
            esitoAt: round3StartedAt,
          },
        });
      }
    }

    // Round 3: agenzie 4+ TIMEOUT
    for (let r = 4; r < Math.min(6, agenzie.length); r++) {
      const ag = agenzie[r];
      const assExist = await prisma.praticaAssegnazione.findFirst({
        where: { praticaId: pratica.id, agenziaId: ag.id, round: 3 },
      });
      if (!assExist) {
        await prisma.praticaAssegnazione.create({
          data: {
            praticaId: pratica.id,
            agenziaId: ag.id,
            round: 3,
            esito: 'TIMEOUT',
            invioAt: round3StartedAt,
            esitoAt: escalationAt,
          },
        });
      }
    }
  }

  // ──────────────────────────────────────────────────
  // ANNULLATA × 2
  // ──────────────────────────────────────────────────
  for (let i = 0; i < 2; i++) {
    const seq = codiceSeq++;
    const codice = generateCodicePratica(2026, seq);
    const broker = dealers[i % dealers.length];
    const luogo = getLuogo(i);
    const submittedAt = msAgo((i + 10) * DAY_MS);
    const annullataAt = msAgo((i + 5) * DAY_MS);

    await upsertPratica(codice, {
      codicePratica: codice,
      tipo: 'PASSAGGIO_PRIVATO',
      stato: 'ANNULLATA',
      brokerId: broker.id,
      comune: luogo.comune,
      provincia: luogo.provincia,
      targa: generateTarga(seq),
      telaio: generateTelaio(seq),
      dataImmatricolazione: new Date('2016-02-28'),
      feeAgenziaCent: 0,
      creditoBrokerCent: 0,
      submittedAt,
      round1StartedAt: submittedAt,
      annullataAt,
      venditoreNome: 'Venditore',
      venditoreCognome: `AnnDemo${seq}`,
      venditoreCF: 'VNDDMO70A01F205P',
      acquirenteNome: 'Acquirente',
      acquirenteCognome: `AnnDemo${seq}`,
      acquirenteCF: 'CQRDMO85E10L736X',
    });
  }

  // ============================================================
  // TASK 31 — Wallet, Transazioni, Payout, Valutazioni, FeeAddebito
  // ============================================================

  console.log('');
  console.log('  [TASK 31 — FINANZIARIO DEMO]');

  // Ricarica i 3 dealer demo per avere gli ID corretti
  const demoDealerComp = await prisma.company.findUnique({ where: { partitaIva: '99999999991' } }); // Demo Auto Srl
  const autoVenetoComp = await prisma.company.findUnique({ where: { partitaIva: '99999999993' } }); // Auto Veneto Srl
  const consTrevisoComp = await prisma.company.findUnique({ where: { partitaIva: '99999999994' } }); // Concessionaria Treviso Spa
  const demoPraticheComp = await prisma.company.findUnique({ where: { partitaIva: '99999999992' } }); // Demo Pratiche Auto Snc (agenzia principale)

  // Agenzie demo aggiuntive per valutazioni
  const studioPd2Comp = await prisma.company.findUnique({ where: { partitaIva: '99999999995' } });
  const venetoTrapassiComp = await prisma.company.findUnique({ where: { partitaIva: '99999999996' } });
  const trapassoTvComp = await prisma.company.findUnique({ where: { partitaIva: '99999999997' } });
  const vicenzaAutoComp = await prisma.company.findUnique({ where: { partitaIva: '99999999998' } });
  const veronaTrapassiComp = await prisma.company.findUnique({ where: { partitaIva: '99999999999' } }); // sospesa

  // ── 1. WALLET DEMO DEALER ──────────────────────────────────────
  // Demo Auto Srl → 1.250 € (sopra soglia auto-payout)
  if (demoDealerComp) {
    await prisma.wallet.upsert({
      where: { companyId: demoDealerComp.id },
      create: { companyId: demoDealerComp.id, saldoCent: 125_000 },
      update: { saldoCent: 125_000 },
    });
    console.log('  · wallet Demo Auto Srl → 125.000 cent');
  }

  // Auto Veneto Srl → 480 € (sotto soglia, può payout manuale)
  if (autoVenetoComp) {
    await prisma.wallet.upsert({
      where: { companyId: autoVenetoComp.id },
      create: { companyId: autoVenetoComp.id, saldoCent: 48_000 },
      update: { saldoCent: 48_000 },
    });
    console.log('  · wallet Auto Veneto Srl → 48.000 cent');
  }

  // Concessionaria Treviso → 0 €
  if (consTrevisoComp) {
    await prisma.wallet.upsert({
      where: { companyId: consTrevisoComp.id },
      create: { companyId: consTrevisoComp.id, saldoCent: 0 },
      update: { saldoCent: 0 },
    });
    console.log('  · wallet Concessionaria Treviso → 0 cent');
  }

  // ── 2. TRANSAZIONI STORICHE DEMO AUTO SRL ──────────────────────
  if (demoDealerComp) {
    const demoWallet = await prisma.wallet.findUnique({ where: { companyId: demoDealerComp.id } });
    if (demoWallet) {
      const existingTxCount = await prisma.transazioneWallet.count({
        where: { walletId: demoWallet.id, note: 'SEED-DEMO' },
      });

      if (existingTxCount === 0) {
        // 13 CREDITO_PRATICA: da 0 a 175.000 (2500 × 13 = 32.500 prima della sottrazione payout)
        // poi 1 PAYOUT_AUTOMATICO storico ESEGUITO (−50.000)
        // poi 2 CREDITO_PRATICA finali + 1 RETTIFICA_ADMIN per arrivare a 125.000
        let saldo = 0;
        const baseDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000); // 90gg fa

        for (let i = 0; i < 13; i++) {
          saldo += 10_000;
          const txDate = new Date(baseDate.getTime() + i * 5 * 24 * 60 * 60 * 1000);
          await prisma.transazioneWallet.create({
            data: {
              walletId: demoWallet.id,
              tipo: 'CREDITO_PRATICA',
              importoCent: 10_000,
              saldoPostCent: saldo,
              note: 'SEED-DEMO',
              createdAt: txDate,
            },
          });
        }
        // saldo ora = 130.000

        // PAYOUT_AUTOMATICO storico — già ESEGUITO
        const payoutStorico = await prisma.payout.create({
          data: {
            walletId: demoWallet.id,
            importoCent: 50_000,
            stato: 'ESEGUITO',
            automatico: true,
            richiestoAt: new Date(baseDate.getTime() + 40 * 24 * 60 * 60 * 1000),
            eseguitoAt: new Date(baseDate.getTime() + 41 * 24 * 60 * 60 * 1000),
            providerRef: 'DEMO-PAYOUT-001',
          },
        });
        saldo -= 50_000;
        // saldo ora = 80.000
        await prisma.transazioneWallet.create({
          data: {
            walletId: demoWallet.id,
            tipo: 'PAYOUT_AUTOMATICO',
            importoCent: -50_000,
            saldoPostCent: saldo,
            payoutId: payoutStorico.id,
            note: 'SEED-DEMO',
            createdAt: new Date(baseDate.getTime() + 41 * 24 * 60 * 60 * 1000),
          },
        });

        // 2 CREDITO_PRATICA aggiuntivi (da 80.000 a 120.000)
        for (let i = 0; i < 2; i++) {
          saldo += 20_000;
          await prisma.transazioneWallet.create({
            data: {
              walletId: demoWallet.id,
              tipo: 'CREDITO_PRATICA',
              importoCent: 20_000,
              saldoPostCent: saldo,
              note: 'SEED-DEMO',
              createdAt: new Date(baseDate.getTime() + (50 + i * 5) * 24 * 60 * 60 * 1000),
            },
          });
        }
        // saldo ora = 120.000

        // 1 RETTIFICA_ADMIN: +5.000 → 125.000
        saldo += 5_000;
        await prisma.transazioneWallet.create({
          data: {
            walletId: demoWallet.id,
            tipo: 'RETTIFICA_ADMIN',
            importoCent: 5_000,
            saldoPostCent: saldo,
            note: 'SEED-DEMO',
            createdAt: new Date(baseDate.getTime() + 65 * 24 * 60 * 60 * 1000),
          },
        });

        console.log(`  · transazioni Demo Auto Srl: 13 CREDITO + 1 PAYOUT_AUTOMATICO + 2 CREDITO + 1 RETTIFICA = 17 tx (saldo target: ${saldo})`);
      } else {
        console.log('  · transazioni Demo Auto Srl già presenti (SEED-DEMO), skip');
      }
    }
  }

  // ── 3. TRANSAZIONI STORICHE AUTO VENETO SRL (~5 CREDITO_PRATICA) ──
  if (autoVenetoComp) {
    const veWallet = await prisma.wallet.findUnique({ where: { companyId: autoVenetoComp.id } });
    if (veWallet) {
      const existingVeTxCount = await prisma.transazioneWallet.count({
        where: { walletId: veWallet.id, note: 'SEED-DEMO' },
      });

      if (existingVeTxCount === 0) {
        let saldo = 0;
        const baseDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

        for (let i = 0; i < 5; i++) {
          saldo += Math.round(48_000 / 5); // ~9600 each, ultimo arrotondato
          const txDate = new Date(baseDate.getTime() + i * 6 * 24 * 60 * 60 * 1000);
          await prisma.transazioneWallet.create({
            data: {
              walletId: veWallet.id,
              tipo: 'CREDITO_PRATICA',
              importoCent: Math.round(48_000 / 5),
              saldoPostCent: saldo,
              note: 'SEED-DEMO',
              createdAt: txDate,
            },
          });
        }
        // Aggiusta arrotondamento: se saldo != 48000, aggiungi rettifica
        if (saldo !== 48_000) {
          const diff = 48_000 - saldo;
          await prisma.transazioneWallet.create({
            data: {
              walletId: veWallet.id,
              tipo: 'RETTIFICA_ADMIN',
              importoCent: diff,
              saldoPostCent: 48_000,
              note: 'SEED-DEMO',
              createdAt: now,
            },
          });
        }
        console.log('  · transazioni Auto Veneto Srl: 5 CREDITO_PRATICA');
      } else {
        console.log('  · transazioni Auto Veneto Srl già presenti (SEED-DEMO), skip');
      }
    }
  }

  // ── 4. PAYOUT RICHIESTO per Auto Veneto Srl ─────────────────────
  if (autoVenetoComp) {
    const veWallet = await prisma.wallet.findUnique({ where: { companyId: autoVenetoComp.id } });
    if (veWallet) {
      const existingPayout = await prisma.payout.findFirst({
        where: { walletId: veWallet.id, stato: 'RICHIESTO' },
      });
      if (!existingPayout) {
        await prisma.payout.create({
          data: {
            walletId: veWallet.id,
            importoCent: 48_000,
            stato: 'RICHIESTO',
            automatico: false,
            richiestoAt: new Date(now.getTime() - 2 * 60 * 60 * 1000), // 2h fa
          },
        });
        console.log('  · payout RICHIESTO Auto Veneto Srl: 48.000 cent, manuale');
      } else {
        console.log('  · payout RICHIESTO Auto Veneto già presente, skip');
      }
    }
  }

  // ── 5. PRATICHE FIRMATA EXTRA per valutazioni (solo se non abbastanza per demo agenzie) ──
  // Demo Pratiche Auto Snc necessita 12+1 valutazioni → servono 13 pratiche FIRMATA assegnate a lei
  // Creiamo le pratiche mancanti con codici "PV-SEED-VAL-NNN" (idempotenti)
  const demoDealerForVal = demoDealerComp;
  const agenziaForVal = demoPraticheComp;

  if (demoDealerForVal && agenziaForVal) {
    let valPraticaSeq = 0;
    for (let i = 0; i < 15; i++) {
      const codice = `PV-SEED-VAL-${String(i + 1).padStart(3, '0')}`;
      const exists = await prisma.pratica.findFirst({ where: { codicePratica: codice } });
      if (exists) continue;
      const firmaAt = new Date(now.getTime() - (90 - i * 5) * 24 * 60 * 60 * 1000);
      const accettataAt = new Date(firmaAt.getTime() - 2 * 24 * 60 * 60 * 1000);
      const submittedAt = new Date(firmaAt.getTime() - 3 * 24 * 60 * 60 * 1000);
      await prisma.pratica.create({
        data: {
          codicePratica: codice,
          tipo: i % 3 === 0 ? 'MINIVOLTURE_MULTIPLE' : 'PASSAGGIO_PRIVATO',
          stato: 'FIRMATA',
          brokerId: demoDealerForVal.id,
          agenziaAssegnataId: agenziaForVal.id,
          comune: 'Padova',
          provincia: 'PD',
          targa: `VA${String(i + 1).padStart(3, '0')}LD`,
          telaio: `WAUVALSEED${String(i + 1).padStart(7, '0')}`,
          dataImmatricolazione: new Date('2020-01-01'),
          feeAgenziaCent: 6_000,
          creditoBrokerCent: 2_500,
          submittedAt,
          round1StartedAt: submittedAt,
          accettataAt,
          firmaAvvenutaAt: firmaAt,
          venditoreNome: 'Venditore',
          venditoreCognome: `Val${i + 1}`,
          venditoreCF: 'VNDDMO70A01F205P',
          acquirenteNome: 'Acquirente',
          acquirenteCognome: `Val${i + 1}`,
          acquirenteCF: 'CQRDMO85E10L736X',
        },
      });
      valPraticaSeq++;
    }
    if (valPraticaSeq > 0) {
      console.log(`  · create ${valPraticaSeq} pratiche FIRMATA extra per valutazioni Demo Pratiche Auto Snc`);
    }
  }

  // Pratiche FIRMATA extra per le altre 4 agenzie demo attive (2-8 valutazioni target)
  const agenzieExtraVal: Array<{ comp: typeof studioPd2Comp; codPrefix: string; target: number }> = [
    { comp: studioPd2Comp, codPrefix: 'PV-SEED-PD2', target: 8 },
    { comp: venetoTrapassiComp, codPrefix: 'PV-SEED-VET', target: 5 },
    { comp: trapassoTvComp, codPrefix: 'PV-SEED-TTV', target: 6 },
    { comp: vicenzaAutoComp, codPrefix: 'PV-SEED-VAP', target: 2 },
  ];

  if (demoDealerComp) {
    for (const { comp, codPrefix, target } of agenzieExtraVal) {
      if (!comp) continue;
      for (let i = 0; i < target; i++) {
        const codice = `${codPrefix}-${String(i + 1).padStart(3, '0')}`;
        const exists = await prisma.pratica.findFirst({ where: { codicePratica: codice } });
        if (exists) continue;
        const firmaAt = new Date(now.getTime() - (60 - i * 4) * 24 * 60 * 60 * 1000);
        const accettataAt = new Date(firmaAt.getTime() - 2 * 24 * 60 * 60 * 1000);
        const submittedAt = new Date(firmaAt.getTime() - 3 * 24 * 60 * 60 * 1000);
        await prisma.pratica.create({
          data: {
            codicePratica: codice,
            tipo: i % 2 === 0 ? 'PASSAGGIO_PRIVATO' : 'MINIVOLTURE_MULTIPLE',
            stato: 'FIRMATA',
            brokerId: demoDealerComp.id,
            agenziaAssegnataId: comp.id,
            comune: comp.citta,
            provincia: comp.provincia,
            targa: `${codPrefix.slice(-2)}${String(i + 1).padStart(3, '0')}XX`,
            telaio: `WAUSED${codPrefix.slice(-3)}${String(i + 1).padStart(8, '0')}`.slice(0, 17),
            dataImmatricolazione: new Date('2019-09-15'),
            feeAgenziaCent: 6_000,
            creditoBrokerCent: 2_500,
            submittedAt,
            round1StartedAt: submittedAt,
            accettataAt,
            firmaAvvenutaAt: firmaAt,
            venditoreNome: 'Venditore',
            venditoreCognome: `Extra${i + 1}`,
            venditoreCF: 'VNDDMO70A01F205P',
            acquirenteNome: 'Acquirente',
            acquirenteCognome: `Extra${i + 1}`,
            acquirenteCF: 'CQRDMO85E10L736X',
          },
        });
      }
    }
    console.log('  · pratiche FIRMATA extra create per agenzie demo (PD2/VET/TTV/VAP)');
  }

  // Pratiche FIRMATA extra per Verona Trapassi (5 valutazioni 1-2 stelle, agenzia sospesa)
  if (demoDealerComp && veronaTrapassiComp) {
    for (let i = 0; i < 5; i++) {
      const codice = `PV-SEED-VR-${String(i + 1).padStart(3, '0')}`;
      const exists = await prisma.pratica.findFirst({ where: { codicePratica: codice } });
      if (exists) continue;
      const firmaAt = new Date(now.getTime() - (120 - i * 7) * 24 * 60 * 60 * 1000);
      const accettataAt = new Date(firmaAt.getTime() - 2 * 24 * 60 * 60 * 1000);
      const submittedAt = new Date(firmaAt.getTime() - 3 * 24 * 60 * 60 * 1000);
      await prisma.pratica.create({
        data: {
          codicePratica: codice,
          tipo: 'PASSAGGIO_PRIVATO',
          stato: 'FIRMATA',
          brokerId: demoDealerComp.id,
          agenziaAssegnataId: veronaTrapassiComp.id,
          comune: 'Verona',
          provincia: 'VR',
          targa: `VR${String(i + 1).padStart(3, '0')}SS`,
          telaio: `WAUVROSED${String(i + 1).padStart(8, '0')}`,
          dataImmatricolazione: new Date('2018-06-01'),
          feeAgenziaCent: 6_000,
          creditoBrokerCent: 2_500,
          submittedAt,
          round1StartedAt: submittedAt,
          accettataAt,
          firmaAvvenutaAt: firmaAt,
          venditoreNome: 'Venditore',
          venditoreCognome: `Vr${i + 1}`,
          venditoreCF: 'VNDDMO70A01F205P',
          acquirenteNome: 'Acquirente',
          acquirenteCognome: `Vr${i + 1}`,
          acquirenteCF: 'CQRDMO85E10L736X',
        },
      });
    }
  }

  // ── 5. VALUTAZIONI ──────────────────────────────────────────────
  // Carica tutte le pratiche FIRMATA per attaccarci le valutazioni
  const praticheFirmate = await prisma.pratica.findMany({
    where: { stato: 'FIRMATA', agenziaAssegnataId: { not: null } },
    select: { id: true, agenziaAssegnataId: true, brokerId: true, codicePratica: true },
    orderBy: { createdAt: 'asc' },
  });

  // Helper per creare valutazione idempotente
  async function createValutazioneIfNotExists(
    praticaId: string,
    agenziaId: string,
    dealerId: string,
    stelle: number,
    note: string | null,
    segnalazioneAbuso: boolean,
  ) {
    const exists = await prisma.valutazione.findFirst({ where: { praticaId } });
    if (exists) return false;
    await prisma.valutazione.create({
      data: { praticaId, agenziaId, dealerId, stelle, note, segnalazioneAbuso },
    });
    return true;
  }

  // Mappa agenziaId → pratiche assegnate a quella agenzia
  const pratichePerAgenzia = new Map<string, typeof praticheFirmate>();
  for (const p of praticheFirmate) {
    if (!p.agenziaAssegnataId) continue;
    if (!pratichePerAgenzia.has(p.agenziaAssegnataId)) {
      pratichePerAgenzia.set(p.agenziaAssegnataId, []);
    }
    pratichePerAgenzia.get(p.agenziaAssegnataId)!.push(p);
  }

  let totalValutazioni = 0;

  // Demo Pratiche Auto Snc: 12 valutazioni 4-5 stelle + 1 con segnalazioneAbuso
  if (demoPraticheComp) {
    const pratiche = pratichePerAgenzia.get(demoPraticheComp.id) ?? [];
    const notePosite = [
      'Ottimo servizio, pratica evasa in tempi record.',
      'Molto professionali, consigliati.',
      'Comunicazione perfetta, nessun problema.',
      'Rapidi ed efficienti.',
      'Fantastica esperienza, torneremo sicuramente.',
      'Pratici e disponibili.',
      'Lavoro impeccabile.',
      'Nessuna critica, tutto perfetto.',
      'Consegna in anticipo rispetto ai tempi previsti.',
      'Massima professionalità.',
      'Team competente e cordiale.',
    ];
    let created = 0;
    for (let i = 0; i < pratiche.length && created < 12; i++) {
      const p = pratiche[i];
      const stelle = i < 8 ? 5 : 4; // 8 da 5 stelle, 4 da 4 stelle
      const ok = await createValutazioneIfNotExists(
        p.id,
        demoPraticheComp.id,
        p.brokerId,
        stelle,
        notePosite[i % notePosite.length] ?? null,
        false,
      );
      if (ok) { created++; totalValutazioni++; }
    }
    // 1 valutazione con segnalazioneAbuso (cerca una pratica ancora senza valutazione)
    for (const p of pratiche) {
      const exists = await prisma.valutazione.findFirst({ where: { praticaId: p.id } });
      if (!exists) {
        await createValutazioneIfNotExists(
          p.id,
          demoPraticheComp.id,
          p.brokerId,
          4,
          'Inizialmente in ritardo, poi risolto. Segnalo comportamento non corretto nella prima fase.',
          true,
        );
        totalValutazioni++;
        break;
      }
    }
    console.log(`  · valutazioni Demo Pratiche Auto Snc: ~${created} create (target 12+1 abuso)`);
  }

  // Agenzie attive aggiuntive: 2-8 valutazioni mix 3-5 stelle
  const agenzieAttiveConTarget: Array<{ comp: typeof studioPd2Comp; target: number; minStelle: number }> = [
    { comp: studioPd2Comp, target: 8, minStelle: 3 },
    { comp: venetoTrapassiComp, target: 5, minStelle: 3 },
    { comp: trapassoTvComp, target: 6, minStelle: 3 },
    { comp: vicenzaAutoComp, target: 2, minStelle: 3 },
  ];

  const noteMix = [
    'Buon servizio, qualche piccolo ritardo.',
    'Soddisfatti nel complesso.',
    'Professionale, ma comunicazione migliorabile.',
    'Buona esperienza complessiva.',
    'Nella media, niente da segnalare.',
    'Discreta disponibilità.',
    'Puntuale e preciso.',
    'Ha gestito bene la pratica.',
  ];

  for (const { comp, target, minStelle } of agenzieAttiveConTarget) {
    if (!comp) continue;
    const pratiche = pratichePerAgenzia.get(comp.id) ?? [];
    let created = 0;
    for (let i = 0; i < pratiche.length && created < target; i++) {
      const p = pratiche[i];
      const stelle = minStelle + (i % (5 - minStelle + 1)); // mix da minStelle a 5
      const ok = await createValutazioneIfNotExists(
        p.id,
        comp.id,
        p.brokerId,
        Math.min(stelle, 5),
        noteMix[i % noteMix.length] ?? null,
        false,
      );
      if (ok) { created++; totalValutazioni++; }
    }
    console.log(`  · valutazioni ${comp.ragioneSociale}: ${created} create`);
  }

  // Verona Trapassi (sospesa): 5 valutazioni 1-2 stelle (coerenza narrativa)
  if (veronaTrapassiComp) {
    // Cerca pratiche in cui questa agenzia era assegnata (anche con deletedAt)
    const praticheVerona = await prisma.pratica.findMany({
      where: { stato: 'FIRMATA', agenziaAssegnataId: veronaTrapassiComp.id },
      select: { id: true, agenziaAssegnataId: true, brokerId: true },
    });
    let created = 0;
    for (let i = 0; i < praticheVerona.length && created < 5; i++) {
      const p = praticheVerona[i];
      const stelle = i % 2 === 0 ? 1 : 2;
      const noteNeg = [
        'Non si sono presentati all\'appuntamento.',
        'Pratica persa, nessuna comunicazione.',
        'Esperienza pessima, non consigliata.',
        'Ritardi inaccettabili.',
        'Comportamento scorretto.',
      ];
      const ok = await createValutazioneIfNotExists(
        p.id,
        veronaTrapassiComp.id,
        p.brokerId,
        stelle,
        noteNeg[i % noteNeg.length] ?? null,
        false,
      );
      if (ok) { created++; totalValutazioni++; }
    }
    // Se non ci sono pratiche di Verona Trapassi come agenzia assegnata, non possiamo creare valutazioni
    // (require praticaId univoco legato a quella agenzia)
    console.log(`  · valutazioni Verona Trapassi (sospesa): ${created} create`);
  }

  console.log(`  · totale valutazioni create: ${totalValutazioni}`);

  // ── 6. FEEADDEBITO SCHEDULED SCADUTI ─────────────────────────────
  // 3 FeeAddebito con scheduledAt -1h per pratiche FIRMATA seed (processabili da "Esegui job")
  const praticheFirmateSeed = await prisma.pratica.findMany({
    where: { stato: 'FIRMATA', agenziaAssegnataId: { not: null } },
    take: 6, // prendiamo più candidate per sicurezza
    select: { id: true, agenziaAssegnataId: true, codicePratica: true },
    orderBy: { createdAt: 'asc' }, // le più vecchie (seed originale)
  });

  let feeCreated = 0;
  for (const p of praticheFirmateSeed) {
    if (feeCreated >= 3) break;
    if (!p.agenziaAssegnataId) continue;

    const exists = await prisma.feeAddebito.findFirst({ where: { praticaId: p.id } });
    if (exists) continue;

    await prisma.feeAddebito.create({
      data: {
        praticaId: p.id,
        agenziaId: p.agenziaAssegnataId,
        importoCent: 6_000,
        tipo: 'ADDEBITO_FIRMA',
        stato: 'SCHEDULED',
        scheduledAt: new Date(now.getTime() - 3_600_000), // 1h fa
      },
    });
    feeCreated++;
    console.log(`  · FeeAddebito SCHEDULED pratica ${p.codicePratica} (6.000 cent, scheduledAt -1h)`);
  }
  console.log(`  · FeeAddebito SCHEDULED creati: ${feeCreated}/3`);

  // ATECO ammessi di default (gruppo 45 = commercio autoveicoli per i dealer;
  // 82.11/82.99 provvisori per le agenzie — DA CONFERMARE col commercialista).
  const atecoDefaults: Array<{ companyType: 'DEALER' | 'AGENZIA'; code: string; label: string }> = [
    { companyType: 'DEALER', code: '4511', label: 'Commercio autoveicoli (ATECORI 2007)' },
    { companyType: 'DEALER', code: '4519', label: 'Commercio altri autoveicoli (ATECORI 2007)' },
    { companyType: 'DEALER', code: '453', label: 'Commercio parti e accessori auto' },
    { companyType: 'DEALER', code: '454', label: 'Commercio/riparazione motocicli' },
    { companyType: 'DEALER', code: '4781', label: 'Commercio al dettaglio autoveicoli (ATECO 2025)' },
    { companyType: 'AGENZIA', code: '8211', label: 'Servizi integrati di supporto (DA CONFERMARE)' },
    { companyType: 'AGENZIA', code: '8299', label: 'Altri servizi di supporto alle imprese (DA CONFERMARE)' },
  ];
  for (const a of atecoDefaults) {
    await prisma.atecoAllowedCode.upsert({
      where: { companyType_code: { companyType: a.companyType, code: a.code } },
      create: a,
      update: { label: a.label },
    });
  }
  console.log(`  · ateco allowlist: ${atecoDefaults.length} codici`);

  console.log('');
  console.log('✔ Seed completato');
  console.log(`  password dev (tutti gli utenti): ${DEV_PASSWORD}`);
  console.log(`  password demo (account demo): ${DEMO_PASSWORD}`);
  console.log(`  NOTE: documenti placeholder non generati (Plan B — solo record Pratica)`);
}

main()
  .catch((e) => {
    console.error('✗ Seed error', e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
