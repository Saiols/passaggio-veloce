# Trapasso Facile - Riassunto Esecutivo

## Cos'e'

Piattaforma web B2B che fa da **broker digitale** tra commercianti/dealer auto e agenzie di pratiche auto per i passaggi di proprieta veicoli in Italia. Non fa la pratica, non accede al PRA: garantisce solo che i documenti arrivino all'agenzia **completi e corretti**.

---

## Come funziona (in breve)

1. Il **dealer** carica libretto + documenti di venditore e acquirente
2. L'**IA** verifica che ogni documento sia quello giusto (una CI e' davvero una CI)
3. Il dealer sceglie un **comune** e la pratica viene inviata a **5 agenzie** nella zona
4. La **prima agenzia** che accetta si prende il lavoro (logica Deliveroo)
5. I clienti si presentano in agenzia con un **codice pratica** per corsia preferenziale
6. L'agenzia flagga la **firma avvenuta**, scatta l'addebito

---

## Come si guadagna

| Tipo pratica | L'agenzia paga | A TF vanno | Al broker vanno |
|-------------|---------------|-----------|----------------|
| Trapasso netto | 75 EUR | 50 EUR | 25 EUR (wallet) |
| Minivoltura | 15 EUR | 15 EUR | 0 EUR |
| Lotto massivo | 15 EUR/veicolo | 15 EUR/veicolo | 0 EUR |

Il cliente finale paga +100 EUR all'agenzia per la corsia preferenziale (solo trapasso netto).

---

## Target anno 1

- 100 dealer attivi
- 50 agenzie partner
- 5.000 pratiche completate
- ~180.000 EUR revenue TF (prima dei costi)

---

## Cosa dobbiamo fare (MVP)

- Registrazione e login (dealer + agenzie + admin) con multi-utente
- Upload documenti con validazione IA (tipo documento corretto)
- OCR lettura libretto (targa, telaio, comodato d'uso, certificato proprieta)
- Dashboard dealer: 4 step (libretto -> documenti -> comune -> invio)
- Caricamento lotti massivi (bulk)
- Invio pratica a 5 agenzie con logica primo-che-accetta
- Dashboard agenzia: accetta/rifiuta, download ZIP, countdown 20gg, flagga firma
- Wallet broker con soglie payout (500 manuale, 1000 auto) + rendiconti
- Addebito automatico a firma o al giorno 20
- 8 tipi di notifiche email (invio, accettazione, solleciti, firma, payout, auto-addebito)
- Sistema valutazione agenzie (5 stelle post-firma, impatto su algoritmo distribuzione)
- Raccolta volontaria listini prezzi (popup opzionale post-registrazione) — ⚠️ **SOSPESA giu-2026** (modulo disattivato e nascosto)
- Pannello admin (utenti, pratiche, monitoring, osservatorio prezzi interno)

---

## Cosa dovremo fare dopo il lancio (Fase 2 - anno 2-3)

- Pubblicazione "Osservatorio Prezzi TF" (report semestrale pubblico)
- Certificazione volontaria agenzie partner (badge qualita, accesso prioritario)
- Benchmark anonimo per le agenzie (posizionamento vs media zona)
- Tariffario di riferimento TF adottabile volontariamente
- Espansione ai privati (C2C)

---

## Visione lungo termine (Fase 3 - anno 3+)

Agenzie branded Trapasso Facile con listino nazionale standardizzato e pagamento completo della pratica in piattaforma (modello Facile.it).

---

## Cosa stiamo aspettando prima di iniziare

1. **Validazione commercialista** sul modello wallet / rendiconto / fattura broker
2. **Risposta su fallback** se nessuna delle 5 agenzie accetta la pratica

---

## Rischi principali

- Il **modulo pagamenti** e' il piu complesso (wallet, soglie, payout, auto-addebiti, rendiconti, 3 tipi di fee)
- La **validazione IA dei documenti** e' la promessa core: se fallisce, crolla tutto
- La **race condition** sull'invio a 5 agenzie va gestita con attenzione
- Il cliente paga **+100 EUR**: deve percepire valore reale
- L'**enforcement della policy prezzi** si basa solo su segnalazione del dealer

---

## Team (da organigramma aprile 2026)

| Ruolo | Chi | Focus |
|-------|-----|-------|
| Fondatore Strategico | Alberto De Vivo | Strategy, IP, investitori |
| CEO & Amministratore | Andrea Saino | Operativita, admin piattaforma e CRM |
| CTO (Socio Fondatore) | Da identificare | Sviluppo piattaforma, AI/OCR, infrastruttura |
| Commercialista (esterno) | Da definire | Fiscalita, validazione wallet/rendiconti |
| Sales & Business Dev | Da definire | Onboarding dealer e agenzie |

---

## CRM Interno (separato dalla piattaforma)

Strumento interno per il team TF per gestire lead e onboarding. 6 ruoli gerarchici: Admin > AD > CTO > CFO (solo lettura economica) > Sales Manager (gestisce CRM e team Sales) > Sales (solo contatti assegnati).

> **Nota:** il documento CRM usa il nome "Passaggio Veloce" e il dominio @passaggioveloce.it - da chiarire se e' il naming definitivo.
