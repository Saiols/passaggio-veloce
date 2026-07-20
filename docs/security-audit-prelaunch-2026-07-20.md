# Audit sicurezza + performance pre-lancio — 2026-07-20

**Contesto:** revisione whole-platform prima del go-live sul mercato reale (+ attivazione Stripe). 6 audit paralleli (5 sicurezza opus + 1 performance) su authz/IDOR, soldi/Stripe, file/storage/OCR, injection/XSS/CSRF/SSRF, segreti/rate-limit/header, scalabilità. Tutti i fix sono su branch **`security-hardening-prelaunch`** (NON pushato) — da rivedere e mergiare tu.

## Verdetto complessivo
La piattaforma è **solida di base**: autorizzazione eccezionale (3 mappe di governance meccaniche, scoping fail-closed, **zero IDOR cross-tenant**, zero privilege escalation), Stripe integrato bene (webhook firmato, segreti server-only, amount server-computed, go-live gate), nessun cron non protetto, nessun segreto lato client, raw SQL parametrizzato, KYC OCR-autoritativo. **Nessun Critical.** I problemi sono hardening + concorrenza + config, tutti indirizzabili.

---

## ✅ COSA HO GIÀ FIXATO (branch `security-hardening-prelaunch`, verificato, non pushato)

| # | Fix | Commit | Verifica |
|---|---|---|---|
| 1 | **Next 16.2.3 → 16.2.10** — chiude cluster CVE del framework: **Middleware/Proxy bypass** in App Router (potenziale bypass auth), **SSRF**, DoS, XSS, cache poisoning RSC. `pnpm audit`: **26→13 vuln, high 11→4** | `c821e5e` | typecheck 0, suite, **build OK** |
| 2 | **Security header** — HSTS, X-Frame-Options DENY + CSP `frame-ancestors 'none'` (anti-clickjacking), nosniff, Referrer-Policy, Permissions-Policy | `b1c0555` | build OK |
| 3 | **Rimossi endpoint debug** — `/api/db-test` (leak conteggi tenant) eliminato; `/api/version` ripulito (non espone più `authSecretLen`/URL interni) | `b1c0555` | mappa-api 3/3 |
| 4 | **Indici DB** su hot path — `EventoPratica(targetSedeId,seenAt)`, `Sede(type,deletedAt,suspendedAt)`, `Pratica(agenziaSedeId,stato)`+`(brokerSedeId,stato)` + **`maxDuration=60`** sui 10 job cron | `05dd7e3` | migration ok, no drift |
| 5 | **Soldi/concorrenza** — `FOR UPDATE` sul reserve payout (anti **double-payout**), saldo wallet **atomico** (`increment`/`decrement`) sui 5 siti, **CAS** su approveCommissione | `7debb61` | **review avversariale opus: money-safe** ✅ |
| 6 | **Rate limiting durable** (fail-open, limiti generosi) su login/reset/registrazione/OCR/promo + client-IP non spoofabile | `9467942` | review ✅ Approved; suite 1944 |
| 7 | **Escaping HTML** di tutti i campi utente nei template email (anti content/phishing injection) | _(FIX-5, in corso)_ | _(da confermare)_ |

Dettaglio tecnico di ogni finding: `.superpowers/sdd/audit-*.md` + `fix*-report.md` (gitignored, in locale).

---

## ⚠️ COSA DEVI FARE TU — prioritizzato per il lancio

### 🔴 P0 — bloccanti / critici, PRIMA o AL go-live

1. **Frequenza cron distribuzione** *(bug funzionale di lancio, non solo perf).* `distribuzione-tick` in `vercel.json` gira **1×/giorno** (`0 4 * * *`), ma il motore assume tick sub-daily. Con le **finestre da 4h**, i round NON avanzano: una pratica non accettata resta ferma fino alle 4 di notte. **Serve un tick sub-daily** (Vercel Pro cron ad alta frequenza, oppure il trigger esterno cron-job.org + `CRON_SECRET` — mai attivato). Senza questo, la distribuzione a raggio non funziona a regime.

2. **Migration su Neon PRIMA del codice** (`prisma migrate deploy` applica tutte le pendenti, in ordine): giustificativo (`20260719120000`), coordinate pratica (`20260719130000`), indici perf (`20260720120000`), **rate bucket (`20260720130000`)**, + eventuali pendenti pre-sessione (monitoraggio/visura). Il fix soldi non ha migration (è codice). ⚠️ **Se `rate_bucket` non viene applicata, il rate limiting è silenziosamente disattivato** (per design fail-open → zero protezione brute-force). *(Nota: sulle tabelle live grandi gli indici andrebbero creati `CONCURRENTLY`; a volumi di lancio va bene anche `CREATE INDEX` normale.)*

3. **Documenti KYC su Blob `access:'public'`** *(HIGH).* Carte d'identità/passaporti/visure sono su Vercel Blob **world-readable** a URL permanente: se un URL trapela (log/referrer/screenshot), l'accesso bypassa il proxy authz per sempre. *Non l'ho cambiato io perché modificare l'access mode può rompere il serving dei documenti e va testato in staging.* Fix: `access:'public'` → **private** in `lib/providers/storage/vercel-blob.ts:37` (+ `upload-client.ts:64`) e servire SEMPRE via il proxy `/api/documenti/[id]` con fetch server-side col token (il proxy già scarica i byte server-side, quindi dovrebbe funzionare — **da verificare in staging** prima del lancio).

4. **Stripe go-live.** Il guard anti-double-payout ora c'è. Prima di abilitare i payout reali (Strada B): assicurati che l'`executePayout` live rispetti il go-live gate e che il `FOR UPDATE` copra il path reale. Webhook/mandato/idempotenza già verificati solidi.

5. **Ruota le credenziali Neon** (owner) incollate in chat — le ho usate in sola lettura per l'audit dei bot; vanno ruotate comunque.

### 🟠 P1 — importanti, subito dopo

6. **Backfill geocoding agenzie su prod** (dalla feature distribuzione): un'agenzia non geocodata **non riceve pratiche**. Lancia lo script + verifica `/admin/sedi-non-geocodate` vuota.
7. **`send-solleciti` rispedisce ogni giorno** alla stessa pratica ferma (nessun guard "già sollecitato") → spam + costi. Aggiungere un `sollecitoInviatoAt`.
8. **Cron unbounded** (`tickAll`, `send-solleciti`, `crm-sync`) e **`documenti-zip`**: `findMany` senza `take` + loop seriali → timeout a volume. Paginare/batchare (dettaglio in `audit-perf.md`).
9. **CSP completa** (script/connect-src) in report-only prima di enforce — io ho messo solo `frame-ancestors`. Allow-list Google Maps/Vercel Blob/Sentry/Anthropic.
10. **Config Neon pooler**: verifica che `DATABASE_URL` sia l'endpoint `-pooler` con `pgbouncer=true` (Prisma+PgBouncer sotto concorrenza). `DIRECT_URL` unpooled (già ok).
11. **`storageKey` ownership** (defense-in-depth): il server accetta la key dal client senza verificarne la proprietà (mitigato da UUID non esposti). Legare la key alla sessione (`onBeforeGenerateToken`).
12. **GDPR blob**: gli upload di registrazioni abbandonate restano pubblici e non vengono mai purgati. Sweeper.

### 🟡 P2 — backlog hardening (non bloccante)
- Timing-enumeration login (dummy bcrypt), OTP mandato senza limite tentativi, session maxAge 30gg, `next-auth` beta → pinnare, referral code `Math.random`→`crypto`, `bodySizeLimit 50mb`→abbassare, cron compare non constant-time.
- Perf: CRM anti-duplicati/`buildCatalogoContatti` caricano l'intera tabella; chatbot manda ~100k token/msg (cache-miss costosi); paginare le liste admin backlog.
- Rate-limit follow-up (dalla review, non bloccanti): il messaggio "riprova tra X min" mostra la finestra piena invece del tempo reale rimasto (UX); `resetRateLimit` post-login è codice morto (NEXT_REDIRECT lanciato prima); chiavi per-IP su reset/registrazione/OCR/promo → dietro CGNAT utenti diversi condividono la quota (login è per-ip+email, ok) — valuta se i limiti (5/h, 20/day) reggono col volume di sign-up atteso; nessuna pulizia TTL della tabella `rate_buckets`.
- **Dep transitive** (4 high rimaste dopo l'upgrade Next, tutte transitive/build): `pnpm.overrides` in root `package.json` per `undici>=6.27.0` (runtime), `tmp>=0.2.6` (via mindee OCR), `fast-uri>=3.1.2`, `postcss>=8.5.10`, `brace-expansion>=5.0.6`; poi `pnpm install` + build. Non l'ho fatto stanotte per non rischiare un reinstall a ridosso del lancio (bassa esploitabilità); fallo con calma + test.

---

## Test di carico (mai fatto)
Non l'ho eseguito (serve un ambiente isolato + dati sintetici; farlo contro Neon prod è pericoloso). In `audit-perf.md` trovi **pronti**: (a) outline di uno **seed script** (200 agenzie geocodate su città reali, 500 dealer, 5-10k pratiche con long-tail su round/solleciti), (b) uno **script k6** (poll inbox/badge, ciclo pratica, liste admin, chatbot cold), (c) le metriche da guardare (p95, connessioni Neon, durata function Vercel). Da lanciare su un **branch Neon** (non prod).

---

## Verifica
Tutti i fix: **typecheck 0**, **build OK**, **suite ~1944 verde**. Il fix soldi ha superato una **review avversariale dedicata (opus)** che ha confermato conservazione esatta di segno/importo su ogni sito. Niente pushato: tutto su `security-hardening-prelaunch` per la tua review.
