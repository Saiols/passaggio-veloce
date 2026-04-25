import { PrismaClient } from '@prisma/client';
import { hash } from 'bcryptjs';

const prisma = new PrismaClient();

// Password dev: "DevPass123!" (rispetta policy: min 10, maiusc/minusc/numero)
const DEV_PASSWORD = 'DevPass123!';

async function main() {
  console.log('🌱 Seed start');
  const passwordHash = await hash(DEV_PASSWORD, 12);
  const now = new Date();

  // Admin piattaforma
  const admin = await prisma.user.upsert({
    where: { email: 'admin@passaggioveloce.it' },
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
    tipo: 'TRAPASSO_NETTO' | 'MINIVOLTURA';
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
      tipo: 'TRAPASSO_NETTO',
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
      tipo: 'TRAPASSO_NETTO',
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
      tipo: 'MINIVOLTURA',
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
      tipo: 'TRAPASSO_NETTO',
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
      tipo: 'TRAPASSO_NETTO',
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
      tipo: 'TRAPASSO_NETTO',
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
  await prisma.user.upsert({
    where: { email: 'admin@demo.passaggioveloce.it' },
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

  await prisma.user.upsert({
    where: { email: 'dealer@demo.passaggioveloce.it' },
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

  await prisma.user.upsert({
    where: { email: 'dealer-junior@demo.passaggioveloce.it' },
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

  await prisma.user.upsert({
    where: { email: 'agenzia@demo.passaggioveloce.it' },
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

  console.log('');
  console.log('✔ Seed completato');
  console.log(`  password dev (tutti gli utenti): ${DEV_PASSWORD}`);
  console.log(`  password demo (account demo): ${DEMO_PASSWORD}`);
}

main()
  .catch((e) => {
    console.error('✗ Seed error', e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
