import { describe, it, expect } from 'vitest';
import { parseLibrettoText } from './libretto-parser';

// Fixture basato sulla struttura OCR reale di Document AI su una carta di
// circolazione (Mod. MC 820 D), con dati personali ANONIMIZZATI. Riproduce:
// - i codici della sezione dati: (A) targa, (B) prima immatric., (C.2.1)/(C.2.2)
//   proprietario, (E) telaio, (I) — reso "(1)" dall'OCR — data della carta;
// - la legenda sul retro ("SIGNIFICATO DEI CODICI...") che ripete i codici come
//   DESCRIZIONI (la fonte del vecchio bug: il parser leggeva la legenda).
const REAL = `Mod. MC 820 D
REPUBBLICA ITALIANA
CARTA DI CIRCOLAZIONE
N°
(A)
A000000M000
AB123CD
(D.1) FIAT
(D.2) 312 AXA1A 00E
N° A000000M000
(B) 14.02.2012
(C.2.1) ROSSI
(C.2.2) MARIA
(A)
AB123CD
NATO IL 09.12.1980 (RSSMRA80A01F205X)
A MILANO (MI)
(C.2.3) VIA ROMA 1
MILANO (MI)
(D.3) FIAT 500
(E) ZFA31200000999999
(F.1)
(F.2) 1305 (F.3) 2105 (G)
(1) 21.04.2026
(J) M1
(K) OEZFA33EA
SIGNIFICATO DEI CODICI COMUNITARI ARMONIZZATI
(A) Numero di immatricolazione
(B) Data della prima immatricolazione del veicolo
(C.2) proprietario del veicolo
(C.2.1) cognome o ragione sociale
(C.2.2) nome/i o iniziale/i (se del caso)
(C.2.3) indirizzo nello Stato di immatricolazione
(E) numero di identificazione del veicolo
(1) data di immatricolazione alla quale si riferisce la carta di circolazione`;

describe('parseLibrettoText — carta reale (anonimizzata)', () => {
  const r = parseLibrettoText(REAL, 0.92);

  it('targa da (A), non il numero della carta', () => {
    expect(r.targa).toBe('AB123CD');
  });
  it('telaio da (E)', () => {
    expect(r.telaio).toBe('ZFA31200000999999');
  });
  it('data prima immatricolazione da (B)', () => {
    expect(r.dataImmatricolazione).toBe('2012-02-14');
  });
  it('data acquisto da (I) reso "(1)" dall’OCR', () => {
    expect(r.dataAcquisto).toBe('2026-04-21');
  });
  it('proprietario = (C.2.1) cognome + (C.2.2) nome', () => {
    expect(r.proprietarioAttuale).toBe('ROSSI MARIA');
    expect(r.proprietari).toEqual(['ROSSI MARIA']);
  });
  it('estrae il CF del proprietario tra (C.2.2) e (C.2.3)', () => {
    expect(r.proprietarioCf).toBe('RSSMRA80A01F205X');
  });
  it('pre-2015 dalla data di acquisto (I), NON dalla prima immatricolazione', () => {
    // (I)=2026 → post-2015, anche se (B)=2012.
    expect(r.preImm2015).toBe(false);
  });
  it('non legge la legenda come proprietario', () => {
    expect(r.proprietarioAttuale).not.toMatch(/COGNOME|RAGIONE|SOCIALE|NOME/);
  });
  it('confidence propagata', () => {
    expect(r.confidenceScore).toBe(0.92);
  });
});

describe('parseLibrettoText — co-intestatari (C.2 azienda + C.3 persona)', () => {
  // Caso leasing reale (anonimizzato): C.2 = società proprietaria (P.IVA),
  // C.3 = utilizzatore persona fisica (CF).
  const LEASE = `(A) AB123CD
(B) 18.08.2023
(C.2.1) ACME LEASING SPA
(C.2.3) CORSO ORBASSANO 367
TORINO (TO)
(08349560014)
(E) ZFA31200000999999
(C.3.1) ROSSI
(C.3.2) MARIO
NATO IL 22.02.1965 (RSSMRA80A01F205X)
A MILANO (MI)
(C.3.3) VIA ROMA 21
(1) 18.08.2023
SIGNIFICATO DEI CODICI COMUNITARI ARMONIZZATI
(C.2.1) cognome o ragione sociale`;

  it('estrae entrambi gli intestatari, strutturati', () => {
    const r = parseLibrettoText(LEASE, 0.9);
    expect(r.proprietari).toEqual(['ACME LEASING SPA', 'ROSSI MARIO']);
    expect(r.proprietariInfo).toEqual([
      { isPersonaGiuridica: true, ragioneSociale: 'ACME LEASING SPA', piva: '08349560014', display: 'ACME LEASING SPA' },
      { isPersonaGiuridica: false, cognome: 'ROSSI', nome: 'MARIO', cf: 'RSSMRA80A01F205X', display: 'ROSSI MARIO' },
    ]);
  });
});

describe('parseLibrettoText — doppio intestatario "(COMPR)" comproprietario', () => {
  // Caso reale (anonimizzato): il SECONDO intestatario è marcato "(COMPR)"
  // (comproprietario) invece di C.3. Document AI linearizza il blocco in modo
  // SPARSO — dopo "(COMPR) <cognome>" c'è il <nome> su riga a sé e poi salta al
  // riquadro successivo, mentre "NATO IL … (CF)" del comproprietario finisce
  // lontano nel testo. Prima del fix il parser (solo C.2/C.3) lo ignorava.
  const COMPR = `(A) AB123CD
(B) 04.06.2020
(C.2.1) ROSSI
(C.2.2) MARIO
NATO IL 09.12.1980 (RSSMRA80A01F205X)
A MILANO (MI)
(C.2.3) VIA ROMA 1
MILANO (MI)
(COMPR) BIANCHI
LAURA
A000000M000
(A)
AB123CD
(D.1) FIAT
(E) ZFA31200000999999
(I) 07.09.2023
VIA ROMA 1
MILANO (MI)
NATO IL 01.01.1980 (BNCLRA80A41F205G)
A MILANO (MI)
SIGNIFICATO DEI CODICI COMUNITARI ARMONIZZATI
(C.2.1) cognome o ragione sociale`;

  it('rileva il comproprietario (COMPR) come secondo intestatario, col CF associato', () => {
    const r = parseLibrettoText(COMPR, 0.9);
    expect(r.proprietari).toEqual(['ROSSI MARIO', 'BIANCHI LAURA']);
    expect(r.proprietariInfo).toEqual([
      { isPersonaGiuridica: false, cognome: 'ROSSI', nome: 'MARIO', cf: 'RSSMRA80A01F205X', display: 'ROSSI MARIO' },
      { isPersonaGiuridica: false, cognome: 'BIANCHI', nome: 'LAURA', cf: 'BNCLRA80A41F205G', display: 'BIANCHI LAURA' },
    ]);
  });
});

describe('parseLibrettoText — correzione OCR del codice fiscale (O↔0)', () => {
  // L'OCR confonde tipicamente O↔0: il carattere di controllo del CF (ultima
  // posizione, SEMPRE una lettera) può finire reso come "0". Va corretto e
  // validato col check-digit, altrimenti il CF del proprietario va perso.
  it('corregge il carattere di controllo reso "0" invece di "O"', () => {
    const t = `(A) AB123CD
(C.2.1) VERDI
(C.2.2) GIULIA
NATO IL 01.01.1980 (VRDGLI80A41F0140)
A MILANO (MI)
(C.2.3) VIA ROMA 1`;
    const r = parseLibrettoText(t, 0.9);
    expect(r.proprietarioCf).toBe('VRDGLI80A41F014O');
  });

  it('non inventa un CF da un token 16-char non valido', () => {
    const t = `(A) AB123CD
(C.2.1) NERI
(C.2.2) PAOLO
NATO IL 01.01.1980 (ABCDEF12X34Y5678)
A MILANO (MI)`;
    const r = parseLibrettoText(t, 0.9);
    expect(r.proprietarioCf).toBeUndefined();
  });
});

describe('parseLibrettoText — ricevuta PRA / minivoltura (venditore commerciante)', () => {
  // Testo OCR reale (Document AI) del documento PRA del commerciante.
  const PRA1 = `Ministero delle Infrastrutture e dei Trasporti
DOCUMENTO NON VALIDO PER LA CIRCOLAZIONE
A684319MI25 03/10/2025
DP243SK WFODXXGAJD8G75490
FORD W GMBH JD3 FUJA1 5BEBKA
FIESTA
0EWF017EST86
M1
AUTOVETTURA PER TRASPORTO DI PERSONE USO PROPRIO
055,00 kw
EURO4 Massa massima
1520 kg
DIMENSIONE AUTO MILANO SPL
13180640966
BUCCINASCO (MI)
PZZA CAVALIERI DI VITT VENETO 23
Art. 56 comma 6 D. Lgs. n. 446/1997
N. Progressivo PRA 25/N620029S
Scrittura Privata del 03-10-2025
Vincoli/Gravami: No
IMPOSTA DI BOLLO ASSOLTA IN MODO VIRTUALE
MI1417`;

  // Secondo esempio: targa e telaio su righe separate, telaio senza refusi.
  const PRA2 = `Ministero delle Infrastrutture e dei Trasporti
DOCUMENTO NON VALIDO PER LA CIRCOLAZIONE
A081814MI26 03/02/2026
GT440ZX
RENAULT
VF1RJA00672164604
M1
RJA BE2 MG5WA2HA5000
CLIO
DIMENSIONE AUTO MILANO SPL
13180640966
BUCCINASCO (MI)
N. Progressivo PRA 26/B504321K
Scrittura Privata del 03-02-2026`;

  it('intestatario = azienda commerciante (ragione sociale + P.IVA)', () => {
    const r = parseLibrettoText(PRA1, 0.9);
    expect(r.targa).toBe('DP243SK');
    expect(r.proprietariInfo).toEqual([
      {
        isPersonaGiuridica: true,
        ragioneSociale: 'DIMENSIONE AUTO MILANO SPL',
        piva: '13180640966',
        display: 'DIMENSIONE AUTO MILANO SPL',
      },
    ]);
    expect(r.proprietari).toEqual(['DIMENSIONE AUTO MILANO SPL']);
    expect(r.dataAcquisto).toBe('2025-10-03');
    expect(r.preImm2015).toBe(false);
  });

  it('telaio: normalizza il refuso OCR O→0 nel VIN', () => {
    expect(parseLibrettoText(PRA1, 0.9).telaio).toBe('WF0DXXGAJD8G75490');
  });

  it('secondo esempio: targa/telaio su righe separate', () => {
    const r = parseLibrettoText(PRA2, 0.9);
    expect(r.targa).toBe('GT440ZX');
    expect(r.telaio).toBe('VF1RJA00672164604');
    expect(r.proprietari).toEqual(['DIMENSIONE AUTO MILANO SPL']);
    expect(r.dataAcquisto).toBe('2026-02-03');
  });
});

describe('parseLibrettoText — carta di circolazione CON annotazione PRA', () => {
  // Caso reale (Mod. MC 820 D, anonimizzato): una carta di circolazione VALIDA,
  // con proprietario in (C.2.x), che riporta anche l'annotazione di un passaggio
  // ("N. Progressivo PRA" + "Scrittura Privata del ..."). NON è una ricevuta PRA
  // (quella è "DOCUMENTO NON VALIDO PER LA CIRCOLAZIONE", testo libero, senza
  // codici armonizzati): il proprietario va letto da (C.2.1)/(C.2.2).
  const CARTA_CON_PRA = `Mod. MC 820 D
REPUBBLICA ITALIANA
CARTA DI CIRCOLAZIONE
N°
(A)
A000000M000
AB123CD
(B) 14.02.2012
(C.2.1) ROSSI
(C.2.2) MARIA
(A)
AB123CD
NATO IL 09.12.1980 (RSSMRA80A01F205X)
A MILANO (MI)
(C.2.3) VIA ROMA 1
MILANO (MI)
(E) ZFA31200000999999
(1) 21.04.2026
(J) M1
N. Progressivo PRA 26/F968092T
Scrittura Privata del 21-04-2026
Vincoli/Gravami:No
Foglio 1 di 1
SIGNIFICATO DEI CODICI COMUNITARI ARMONIZZATI
(C.2.1) cognome o ragione sociale`;

  const r = parseLibrettoText(CARTA_CON_PRA, 0.9);

  it('legge il proprietario da (C.2.1)/(C.2.2), non lo tratta come ricevuta PRA', () => {
    expect(r.proprietarioAttuale).toBe('ROSSI MARIA');
    expect(r.proprietari).toEqual(['ROSSI MARIA']);
  });
  it('estrae CF, targa e data acquisto dalla carta', () => {
    expect(r.proprietarioCf).toBe('RSSMRA80A01F205X');
    expect(r.targa).toBe('AB123CD');
    expect(r.dataAcquisto).toBe('2026-04-21');
  });
});

describe('parseLibrettoText — telaio da (E), non dal codice omologazione (D.2)', () => {
  // Caso reale (Mod. MC 820 D): il campo (D.2) "tipo/variante/versione" riporta
  // un codice di omologazione di 17 caratteri alfanumerici (FM6FM62S0347CP1CA)
  // che combacia col pattern del VIN e PRECEDE (E). Il telaio vero è in (E)
  // "numero di identificazione del veicolo". Il parser deve ancorarsi a (E).
  const CARTA_D2_COLLISIONE = `Mod. MC 820 D
REPUBBLICA ITALIANA
CARTA DI CIRCOLAZIONE
N° A106469MI25
(A) FW248XP
(D.1) VOLKSWAGEN
(D.2) A1 DGTEXOAC4 FM6FM62S0347CP1CA
(D.3) T-ROC
(E) WVGZZZA1ZKV096161
(F.2) 1890 (F.3) 3390 (G)
(1) 12.02.2025
(J) M1
SIGNIFICATO DEI CODICI COMUNITARI ARMONIZZATI
(E) numero di identificazione del veicolo`;

  it('legge il telaio da (E), non il codice di (D.2)', () => {
    const r = parseLibrettoText(CARTA_D2_COLLISIONE, 0.9);
    expect(r.telaio).toBe('WVGZZZA1ZKV096161');
    expect(r.telaio).not.toBe('FM6FM62S0347CP1CA');
  });

  it('targa da (A)', () => {
    expect(parseLibrettoText(CARTA_D2_COLLISIONE, 0.9).targa).toBe('FW248XP');
  });
});

describe('parseLibrettoText — proprietario da etichetta di trasferimento (retro)', () => {
  // Caso reale (anonimizzato): auto ex-noleggio. (C.2.1) resta la società
  // locatrice, ma la proprietà è stata trasferita a una persona tramite
  // ETICHETTA applicata sul retro ("TRASFERIMENTO DI PROPRIETA'" → "PROPRIETARIO
  // <cognome> <nome>" + CF). Nella linearizzazione OCR l'etichetta compare DOPO
  // la legenda (che il parser normalmente scarta). La legenda contiene
  // "proprietario del veicolo": è un'esca per falsi positivi che NON deve essere
  // letta come intestatario. Il proprietario dell'etichetta SOSTITUISCE (C.2.x).
  const TRASFERIMENTO_RETRO = `Mod MC 820 D
REPUBBLICA ITALIANA
CARTA DI CIRCOLAZIONE
(A)
A098020M117
FK039PJ
(B) 30.06.2017
(C.2.1) NOLEGGIO AUTO ITALIA
SPA
(C.2.3) VIA GATTAMELATA 41
MILANO (MI)
(12345678903)
(D.1) CITROEN
(D.2) 3 ABHZ T/2SM
(D.3) C4 PICASSO
(E) VF73ABHZTHJ717960
(1) 30.06.2017
(J) M1
(J.1) AUTOVETTURA PER TRASPORTO DI
PERSONE USO DI TERZI DA
LOCARE SENZA CONDUC.
SIGNIFICATO DEI CODICI COMUNITARI ARMONIZZATI
(C.2) proprietario del veicolo
(C.2.1) cognome o ragione sociale
(E) numero di identificazione del veicolo
*** TRASFERIMENTO DI PROPRIETA' E CAMBIO USO ***
/19.09.2017
NATO IL 12.12.1975 A MILANO
PROPRIETARIO ROSSI MARA
RES. MILANO
(MI)
-MI (RSSMRA80A01F205X)
USO PROPRIO-AUTOVETTURA PER TRASPORTO DI PERSONE
IND. VIA CUSTODI 4
***********
**
*
MILANO, 19.09.2017`;

  const r = parseLibrettoText(TRASFERIMENTO_RETRO, 0.9);

  it('legge il proprietario dall’etichetta, non la società in (C.2.1)', () => {
    expect(r.proprietarioAttuale).toBe('ROSSI MARA');
    expect(r.proprietarioAttuale).not.toMatch(/NOLEGGIO/);
  });
  it('estrae il CF persona fisica dall’etichetta', () => {
    expect(r.proprietarioCf).toBe('RSSMRA80A01F205X');
  });
  it('l’etichetta SOSTITUISCE la società (non la affianca)', () => {
    expect(r.proprietari).toEqual(['ROSSI MARA']);
    expect(r.proprietariInfo).toEqual([
      { isPersonaGiuridica: false, cognome: 'ROSSI', nome: 'MARA', cf: 'RSSMRA80A01F205X', display: 'ROSSI MARA' },
    ]);
  });
  it('non legge la legenda "proprietario del veicolo" come intestatario', () => {
    expect(r.proprietarioAttuale).not.toMatch(/VEICOLO|DEL/);
  });
  it('targa e telaio restano corretti', () => {
    expect(r.targa).toBe('FK039PJ');
    expect(r.telaio).toBe('VF73ABHZTHJ717960');
  });
  it('data acquisto = data dell’etichetta di trasferimento, non (I)', () => {
    // (1) 30.06.2017 sulla carta, ma il trasferimento al privato è del 19.09.2017.
    expect(r.dataAcquisto).toBe('2017-09-19');
  });

  it('gestisce il separatore "*" tra cognome e nome', () => {
    const conAsterisco = TRASFERIMENTO_RETRO.replace('PROPRIETARIO ROSSI MARA', 'PROPRIETARIO ROSSI*MARA');
    const r2 = parseLibrettoText(conAsterisco, 0.9);
    expect(r2.proprietarioAttuale).toBe('ROSSI MARA');
    expect(r2.proprietariInfo?.[0]).toMatchObject({ cognome: 'ROSSI', nome: 'MARA' });
  });
});

describe('parseLibrettoText — regime dal trasferimento (ex-noleggio pre→post 2015)', () => {
  // Auto immatricolata a una società nel 2012 (pre-2015) e trasferita a un
  // privato nel 2016 (post-2015): il regime dell'ATTUALE proprietario è
  // POST-2015. La data di acquisto deve venire dall'etichetta, non da (I)/(B).
  const PRE_POST = `(A) AB123CD
(B) 14.02.2012
(C.2.1) NOLEGGIO AUTO ITALIA
SPA
(12345678903)
(E) ZFA31200000999999
(1) 14.02.2012
SIGNIFICATO DEI CODICI COMUNITARI ARMONIZZATI
(C.2) proprietario del veicolo
*** TRASFERIMENTO DI PROPRIETA' E CAMBIO USO ***
/15.06.2016
NATO IL 01.01.1980 A MILANO
PROPRIETARIO ROSSI MARA
RES. MILANO
-MI (RSSMRA80A01F205X)`;
  const r = parseLibrettoText(PRE_POST, 0.9);

  it('data acquisto dal trasferimento (2016), non da (I)/(B) 2012', () => {
    expect(r.dataAcquisto).toBe('2016-06-15');
  });
  it('preImm2015 = false (regime del trasferimento post-2015, non l’immatricolazione 2012)', () => {
    expect(r.preImm2015).toBe(false);
  });
  it('proprietario = persona dell’etichetta', () => {
    expect(r.proprietarioAttuale).toBe('ROSSI MARA');
  });
});

describe('parseLibrettoText — più etichette: vince quella con la data più recente', () => {
  // Più etichette di trasferimento affiancate nel riquadro in basso a sinistra:
  // prevale quella con la DATA PIÙ RECENTE (l'ultimo trasferimento). Il regime
  // segue la data del trasferimento vincente.
  const MULTI = `(A) AB123CD
(B) 14.02.2012
(C.2.1) NOLEGGIO AUTO ITALIA
SPA
(12345678903)
(E) ZFA31200000999999
(1) 14.02.2012
SIGNIFICATO DEI CODICI COMUNITARI ARMONIZZATI
(C.2) proprietario del veicolo
*** TRASFERIMENTO DI PROPRIETA' E CAMBIO USO ***
/10.03.2014
NATO IL 10.01.1985 A MILANO
PROPRIETARIO BIANCHI LUCA
-MI (BNCLCU85T10A562O)
*** TRASFERIMENTO DI PROPRIETA' E CAMBIO USO ***
/20.05.2019
NATO IL 01.01.1990 A MILANO
PROPRIETARIO VERDI ANNA
-MI (VRDNNA90A41F205M)`;

  it('prevale l’etichetta più recente (VERDI 2019 vs BIANCHI 2014)', () => {
    const r = parseLibrettoText(MULTI, 0.9);
    expect(r.proprietarioAttuale).toBe('VERDI ANNA');
    expect(r.proprietarioCf).toBe('VRDNNA90A41F205M');
    expect(r.proprietari).toEqual(['VERDI ANNA']);
  });
  it('data acquisto + regime dalla data dell’etichetta vincente', () => {
    const r = parseLibrettoText(MULTI, 0.9);
    expect(r.dataAcquisto).toBe('2019-05-20');
    expect(r.preImm2015).toBe(false);
  });
  it('è la data a decidere, non l’ordine nel testo', () => {
    // Inverto l'ordine: la più recente (2019) appare PRIMA della più vecchia.
    const inv = `(A) AB123CD
(C.2.1) NOLEGGIO AUTO ITALIA
SPA
(12345678903)
(E) ZFA31200000999999
SIGNIFICATO DEI CODICI COMUNITARI ARMONIZZATI
*** TRASFERIMENTO DI PROPRIETA' ***
/20.05.2019
NATO IL 01.01.1990 A MILANO
PROPRIETARIO VERDI ANNA
-MI (VRDNNA90A41F205M)
*** TRASFERIMENTO DI PROPRIETA' ***
/10.03.2014
NATO IL 10.01.1985 A MILANO
PROPRIETARIO BIANCHI LUCA
-MI (BNCLCU85T10A562O)`;
    const r = parseLibrettoText(inv, 0.9);
    expect(r.proprietarioAttuale).toBe('VERDI ANNA');
    expect(r.dataAcquisto).toBe('2019-05-20');
  });
});

describe('parseLibrettoText — pre-2015 da (I)', () => {
  it('(I) anteriore al 2015 → preImm2015 true', () => {
    const txt = '(B) 20.06.2009\n(C.2.1) BIANCHI\n(C.2.2) LUCA\n(A) FA123GH\n(1) 10.03.2010';
    const r = parseLibrettoText(txt, 0.9);
    expect(r.dataAcquisto).toBe('2010-03-10');
    expect(r.preImm2015).toBe(true);
  });
  it('senza (I): fallback alla prima immatricolazione', () => {
    const r = parseLibrettoText('(B) 12.03.2012\n(A) AB123CD', 0.9);
    expect(r.dataAcquisto).toBeUndefined();
    expect(r.preImm2015).toBe(true); // (B) 2012 < 2015
  });
});

describe('parseLibrettoText — testo combinato fronte+retro', () => {
  const fronte = `(A) FW248XP
(D.2) A1 DGTEXOAC4 FM6FM62S0347CP1CA
(E) WVGZZZA1ZKV096161
(C.2.1) NOLEGGIO AUTO ITALIA
SPA
(12345678903)`;
  const retro = `SIGNIFICATO DEI CODICI COMUNITARI ARMONIZZATI
(C.2) proprietario del veicolo
*** TRASFERIMENTO DI PROPRIETA' ***
/19.09.2017
NATO IL 12.12.1975 A MILANO
PROPRIETARIO ROSSI MARA
-MI (RSSMRA80A01F205X)`;
  const r = parseLibrettoText(`${fronte}\n${retro}`, 0.9);
  it('telaio da (E) del fronte', () => {
    expect(r.telaio).toBe('WVGZZZA1ZKV096161');
  });
  it('proprietario dall’etichetta del retro (override C.2.1)', () => {
    expect(r.proprietarioAttuale).toBe('ROSSI MARA');
    expect(r.proprietarioCf).toBe('RSSMRA80A01F205X');
  });
});

describe('parseLibrettoText — robustezza', () => {
  it('campi assenti restano undefined senza lanciare', () => {
    const r = parseLibrettoText('TESTO SENZA DATI', 0.5);
    expect(r.targa).toBeUndefined();
    expect(r.telaio).toBeUndefined();
    expect(r.proprietarioAttuale).toBeUndefined();
    expect(r.preImm2015).toBe(false);
  });
  it('rileva comodato in varie formulazioni', () => {
    expect(parseLibrettoText("... COMODATO D'USO ...", 0.9).flagComodatoDuso).toBe(true);
    expect(parseLibrettoText('... locazione/comodato ...', 0.9).flagComodatoDuso).toBe(true);
  });
  it('non segnala comodato se assente', () => {
    expect(parseLibrettoText('CARTA DI CIRCOLAZIONE (A) AB123CD', 0.9).flagComodatoDuso).toBe(false);
  });
});
