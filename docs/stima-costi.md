# Trapasso Facile - Stima Costi

## A. Costo di Sviluppo

### Scenario 1: Lo sviluppiamo noi (tu + Claude)

In questo scenario il costo vivo e' essenzialmente il tuo tempo + gli strumenti.

| Voce | Costo |
|------|-------|
| Claude Code (abbonamento Pro/Max) | 20-200 USD/mese |
| Dominio (trapassofacile.it o simile) | 10-30 EUR/anno |
| Hosting sviluppo/staging | 0-20 EUR/mese (free tier iniziali) |
| Il tuo tempo | Non quantificabile, ma significativo |

**Costo vivo totale stimato per arrivare a un MVP: 500 - 2.000 EUR**

> Nota: questo scenario e' realistico MA richiede che tu abbia (o acquisisca)
> competenze full-stack. Il progetto e' complesso: auth, upload documenti,
> OCR/IA, mappe, notifiche, due dashboard diverse, fatturazione elettronica.
> Non e' un progetto da weekend.

---

### Scenario 2: Commissionato a una software house / freelancer (benchmark di mercato)

Questo serve per capire il **valore di mercato** di quello che state costruendo.

| Modulo | Stima di mercato (EUR) |
|--------|----------------------|
| UI/UX Design (wireframe, prototipo, design system) | 5.000 - 12.000 |
| Auth + Registrazione + Verifica documenti | 4.000 - 8.000 |
| Dashboard Dealer (3 step + gestione pratiche) | 8.000 - 15.000 |
| Dashboard Agenzia (workflow pratiche) | 8.000 - 15.000 |
| Pannello Admin piattaforma | 6.000 - 12.000 |
| OCR/IA lettura libretto | 5.000 - 10.000 |
| Sistema notifiche (email + push) | 2.000 - 5.000 |
| Mappa selezione agenzie | 2.000 - 4.000 |
| Fatturazione elettronica (SDI) | 5.000 - 12.000 |
| Sistema pagamenti (Stripe/equivalente) | 3.000 - 6.000 |
| Infrastruttura, CI/CD, deploy | 3.000 - 6.000 |
| Testing e QA | 4.000 - 8.000 |
| **TOTALE** | **55.000 - 113.000** |

> Queste cifre riflettono tariffe italiane/europee per sviluppatori mid-senior
> (250-500 EUR/giorno). Una software house strutturata potrebbe chiedere di piu'.
> Un team offshore (Est Europa, India) potrebbe costare il 40-60% in meno
> ma con rischi su qualita' e comunicazione.

---

## B. Costi Operativi Mensili (post-lancio)

Questi sono i costi ricorrenti per tenere la piattaforma in piedi e funzionante.
Le stime sono basate su un volume iniziale di **100-500 pratiche/mese**.

### Infrastruttura e Hosting

| Servizio | Cosa fa | Costo/mese (EUR) |
|----------|---------|-------------------|
| **Hosting applicativo** (Vercel, Railway, AWS ECS, o VPS) | Serve il frontend e il backend | 20 - 100 |
| **Database** (PostgreSQL su Supabase, PlanetScale, o RDS) | Dati utenti, pratiche, transazioni | 0 - 50 (free tier poi scala) |
| **Storage documenti** (AWS S3 / Cloudflare R2) | PDF e immagini dei documenti | 5 - 30 |
| **CDN** (Cloudflare) | Performance e protezione | 0 (free tier sufficiente) |
| **Subtotale infrastruttura** | | **25 - 180** |

### Servizi AI / OCR

| Servizio | Cosa fa | Costo/mese (EUR) |
|----------|---------|-------------------|
| **OCR libretto** (OpenAI GPT-4o Vision / Google Document AI / AWS Textract) | Lettura automatica del libretto | 50 - 300 |
| Note | GPT-4o Vision: ~0.01-0.03 USD per pagina. A 500 pratiche/mese con ~2-3 pagine ciascuna = ~15-45 USD. Con retry e validazione, si stima di piu' | |
| **Subtotale IA** | | **50 - 300** |

> ATTENZIONE: il costo IA scala linearmente con il volume.
> A 5.000 pratiche/mese il costo potrebbe essere 500-3.000 EUR/mese.
> Vale la pena valutare modelli self-hosted (open source) se i volumi crescono.

### Email e Comunicazioni

| Servizio | Cosa fa | Costo/mese (EUR) |
|----------|---------|-------------------|
| **Email transazionali** (Resend / SendGrid) | Notifiche, conferme, OTP | 0 - 20 (free tier generosi) |
| **PEC** (se necessaria per comunicazioni ufficiali) | Invio PEC automatizzate | 30 - 80 |
| **Subtotale comunicazioni** | | **30 - 100** |

### Mappe e Geolocalizzazione

| Servizio | Cosa fa | Costo/mese (EUR) |
|----------|---------|-------------------|
| **Google Maps Platform** / Mapbox | Mappa agenzie, geocoding | 0 - 50 |
| Note | Google Maps: 200 USD/mese di credito gratuito. Mapbox ha free tier generoso. Per il volume previsto, probabilmente gratis o quasi | |
| **Subtotale mappe** | | **0 - 50** |

### Pagamenti e Fatturazione

| Servizio | Cosa fa | Costo/mese (EUR) |
|----------|---------|-------------------|
| **Payment gateway** (Stripe) | Incasso fee piattaforma | 1.4% + 0.25 EUR per transazione |
| **Fatturazione elettronica** (FattureInCloud, Aruba, o API SDI) | Emissione fatture XML verso SDI | 15 - 50 |
| **Subtotale pagamenti** | | **15 - 50** + commissioni variabili |

> Le commissioni Stripe sono 1.4% + 0.25 EUR per transazione.
> Con la fee media di ~25,50 EUR, il costo Stripe e' ~0,61 EUR per pratica.
> Alternativa: Stripe SEPA Direct Debit (0.35 EUR flat per transazione) potrebbe essere piu conveniente per addebiti ricorrenti autorizzati.

### Sicurezza e Compliance

| Servizio | Cosa fa | Costo/mese (EUR) |
|----------|---------|-------------------|
| **SSL/TLS** | Certificato HTTPS | 0 (Let's Encrypt) |
| **WAF / DDoS protection** (Cloudflare) | Protezione applicativa | 0 - 20 |
| **Backup automatici** | Backup DB e documenti | 5 - 20 |
| **Logging e monitoring** (Sentry, Better Stack) | Errori e uptime | 0 - 30 (free tier) |
| **Subtotale sicurezza** | | **5 - 70** |

### Costi Legali e Compliance (non tecnici ma necessari)

| Voce | Costo | Frequenza |
|------|-------|-----------|
| **Consulenza legale** (privacy, T&C, GDPR) | 2.000 - 5.000 EUR | Una tantum + aggiornamenti |
| **DPO** (Data Protection Officer, obbligatorio se trattate dati su larga scala) | 1.500 - 4.000 EUR/anno | Annuale |
| **Assicurazione RC professionale** | 500 - 2.000 EUR/anno | Annuale |
| **Commercialista / contabilita' societa'** | 200 - 500 EUR/mese | Mensile |

---

## C. Riepilogo

### Costi di sviluppo (una tantum)
| Scenario | Range |
|----------|-------|
| Fai-da-te (tu + Claude) | 500 - 2.000 EUR (costi vivi) |
| Commissionato (benchmark) | 55.000 - 113.000 EUR |

### Costi operativi mensili (post-lancio, 100-500 pratiche/mese)
| Categoria | Min/mese | Max/mese |
|-----------|----------|----------|
| Infrastruttura | 25 EUR | 180 EUR |
| IA / OCR | 50 EUR | 300 EUR |
| Email e comunicazioni | 30 EUR | 100 EUR |
| Mappe | 0 EUR | 50 EUR |
| Pagamenti e fatturazione | 15 EUR | 50 EUR |
| Sicurezza e monitoring | 5 EUR | 70 EUR |
| **Totale tecnico** | **125 EUR** | **750 EUR** |
| Commercialista | 200 EUR | 500 EUR |
| **Totale con costi societari** | **325 EUR** | **1.250 EUR** |

### Break-even indicativo (aggiornato v2)
Fee confermata v2: **75 EUR per trapasso netto** (50 TF + 25 broker), **15 EUR per minivoltura** (tutto TF).
La quota che resta a Trapasso Facile e' quindi 50 EUR/trapasso e 15 EUR/minivoltura.

Con costi operativi medi di ~500 EUR/mese:
- **Break-even: ~10-12 pratiche/mese** (solo quota TF)
- Target primo anno: 5.000 pratiche = ~417 pratiche/mese

Revenue stimata primo anno (mix 60/40 trapasso/minivoltura):
- 3.000 trapasso x 50 EUR = 150.000 EUR (quota TF)
- 2.000 minivoltura x 15 EUR = 30.000 EUR
- **Revenue TF: ~180.000 EUR/anno**
- Payout broker: 3.000 x 25 EUR = **75.000 EUR/anno** (costo per TF)
- **Margine netto TF: ~105.000 EUR/anno** (prima dei costi operativi)

Commissioni Stripe (stima su 5.000 pratiche):
- SEPA Direct Debit: 0.35 EUR/transazione = ~1.750 EUR/anno
- Payout broker: costi aggiuntivi per bonifici uscenti

---

## D. Raccomandazioni

1. **Pricing aggiornato (v2).** 75 EUR/trapasso addebitati all'agenzia (di cui 25 al broker). L'agenzia applica +100 EUR al cliente. Il modello regge se il volume di pratiche giustifica la fee per l'agenzia.
2. **Partire con free tier ovunque.** Vercel, Supabase, Cloudflare, Resend hanno free tier generosi.
3. **OCR: iniziare con API pay-per-use** (GPT-4o Vision) e valutare modelli open source se i volumi crescono.
4. **Fatturazione elettronica: usare un servizio gestito** (FattureInCloud API, Aruba) piuttosto che integrarsi direttamente con SDI.
5. **Non sottovalutare i costi legali.** GDPR, T&C, informativa privacy sono obbligatori prima del lancio.
6. **Validare il modello wallet/rendiconto con un commercialista** prima di sviluppare il modulo pagamenti. Il flusso rendiconto -> fattura broker ha implicazioni fiscali non banali.
7. **SEPA Direct Debit consigliato** rispetto a card per gli addebiti automatici alle agenzie (0.35 EUR flat vs 1.4% + 0.25).
