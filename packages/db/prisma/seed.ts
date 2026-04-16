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

  console.log('');
  console.log('✔ Seed completato');
  console.log(`  password dev (tutti gli utenti): ${DEV_PASSWORD}`);
}

main()
  .catch((e) => {
    console.error('✗ Seed error', e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
