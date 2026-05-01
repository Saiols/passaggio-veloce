'use client';

import { useState, useTransition, useRef } from 'react';
import { Alert, Button, Checkbox, Field, Input, Select } from '@/components/ui';
import { WizardProgress } from '@/components/wizard-progress';
import { extractLibrettoAction, submitNuovaPraticaAction } from './actions';

const STEPS = [
  { id: 1, label: 'Tipo & libretto', title: 'Tipo pratica e libretto', hint: 'Scegli il tipo di pratica e carica il libretto di circolazione.' },
  { id: 2, label: 'Parti', title: 'Parti coinvolte', hint: 'Dati del venditore e dell\'acquirente + eventuali flag speciali.' },
  { id: 3, label: 'Invio', title: 'Localizzazione e invio', hint: 'Comune di riferimento e riepilogo finale.' },
] as const;

type Tipo = 'PASSAGGIO_PRIVATO' | 'MINIVOLTURE_MULTIPLE';

type Ocr = {
  targa: string;
  telaio: string;
  proprietarioAttuale: string;
  dataImmatricolazione: string;
  preImm2015: boolean;
  flagComodatoDuso: boolean;
};

type Parte = {
  isPG: boolean;
  nome: string;
  cognome: string;
  cf: string;
  ragioneSociale: string;
  piva: string;
};

const emptyParte = (): Parte => ({
  isPG: false,
  nome: '',
  cognome: '',
  cf: '',
  ragioneSociale: '',
  piva: '',
});

export function WizardNuovaPratica({ error }: { error?: string }) {
  const [step, setStep] = useState(1);
  const [tipo, setTipo] = useState<Tipo>('PASSAGGIO_PRIVATO');
  const [numeroVeicoli, setNumeroVeicoli] = useState<number>(1);

  const handleTipoChange = (next: Tipo) => {
    setTipo(next);
    setNumeroVeicoli(next === 'PASSAGGIO_PRIVATO' ? 1 : 2);
  };
  const librettoRef = useRef<File | null>(null);
  const [librettoName, setLibrettoName] = useState<string | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [ocrError, setOcrError] = useState<string | null>(null);
  const [ocr, setOcr] = useState<Ocr | null>(null);

  const [venditore, setVenditore] = useState<Parte>(emptyParte());
  const [acquirente, setAcquirente] = useState<Parte>(emptyParte());
  const [flagCointestazione, setFlagCointestazione] = useState(false);
  const [flagMinivoltura, setFlagMinivoltura] = useState(false);
  const [flagProcura, setFlagProcura] = useState(false);

  const [comune, setComune] = useState('');
  const [provincia, setProvincia] = useState('');

  const [submitting, startSubmit] = useTransition();

  const onFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    librettoRef.current = file;
    setLibrettoName(file.name);
    setOcrError(null);
    setExtracting(true);
    try {
      const fd = new FormData();
      fd.append('libretto', file);
      const res = await extractLibrettoAction(fd);
      if (res.ok) {
        setOcr({
          targa: res.data.targa ?? '',
          telaio: res.data.telaio ?? '',
          proprietarioAttuale: res.data.proprietarioAttuale ?? '',
          dataImmatricolazione: res.data.dataImmatricolazione ?? '',
          preImm2015: res.data.preImm2015,
          flagComodatoDuso: res.data.flagComodatoDuso,
        });
      } else {
        setOcrError(res.error);
      }
    } catch (err) {
      setOcrError((err as Error).message);
    } finally {
      setExtracting(false);
    }
  };

  const handleFinalSubmit = () => {
    if (!librettoRef.current || !ocr) return;
    const fd = new FormData();
    fd.append('libretto', librettoRef.current);
    fd.append('tipo', tipo);
    fd.append('numeroVeicoli', String(numeroVeicoli));
    fd.append('targa', ocr.targa);
    fd.append('telaio', ocr.telaio);
    fd.append('proprietarioAttuale', ocr.proprietarioAttuale);
    fd.append('dataImmatricolazione', ocr.dataImmatricolazione);
    fd.append('preImm2015', ocr.preImm2015 ? 'true' : 'false');
    fd.append('flagComodatoDuso', ocr.flagComodatoDuso ? 'true' : 'false');

    fd.append('venditoreIsPG', venditore.isPG ? 'true' : 'false');
    if (venditore.isPG) {
      fd.append('venditoreRagioneSociale', venditore.ragioneSociale);
      fd.append('venditorePIVA', venditore.piva);
    } else {
      fd.append('venditoreNome', venditore.nome);
      fd.append('venditoreCognome', venditore.cognome);
      fd.append('venditoreCF', venditore.cf);
    }

    fd.append('acquirenteIsPG', acquirente.isPG ? 'true' : 'false');
    if (acquirente.isPG) {
      fd.append('acquirenteRagioneSociale', acquirente.ragioneSociale);
      fd.append('acquirentePIVA', acquirente.piva);
    } else {
      fd.append('acquirenteNome', acquirente.nome);
      fd.append('acquirenteCognome', acquirente.cognome);
      fd.append('acquirenteCF', acquirente.cf);
    }

    fd.append('flagCointestazione', flagCointestazione ? 'true' : 'false');
    fd.append('flagMinivoltura', flagMinivoltura ? 'true' : 'false');
    fd.append('flagProcura', flagProcura ? 'true' : 'false');

    fd.append('comune', comune);
    fd.append('provincia', provincia);

    startSubmit(async () => {
      await submitNuovaPraticaAction(fd);
    });
  };

  const current = STEPS.find((s) => s.id === step)!;
  const canStep2 =
    !!ocr &&
    ocr.targa.length >= 5 &&
    ocr.telaio.length >= 11 &&
    ocr.proprietarioAttuale.length > 0 &&
    /^\d{4}-\d{2}-\d{2}$/.test(ocr.dataImmatricolazione);

  const canStep3 = parteValida(venditore) && parteValida(acquirente);

  const canSubmit = comune.trim().length > 0 && /^[A-Za-z]{2}$/.test(provincia.trim());

  return (
    <>
      <WizardProgress steps={STEPS} current={step} label="Nuova pratica" />
      <div className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-6 sm:py-10">
        <header className="mb-6">
          <h1 className="text-[28px] font-extrabold tracking-tight text-pv-navy-900 sm:text-[32px]">
            {current.title}
          </h1>
          <p className="mt-2 max-w-xl text-[14px] leading-relaxed text-pv-slate-500">
            {current.hint}
          </p>
        </header>

        {error && (
          <div className="mb-5">
            <Alert variant="error">{error}</Alert>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-5">
            <div className="rounded-[16px] border border-pv-slate-200 bg-white p-5 shadow-[var(--pv-shadow-card)]">
              <Field label="Tipo pratica" required>
                <Select
                  value={tipo}
                  onChange={(e) => handleTipoChange(e.target.value as Tipo)}
                >
                  <option value="PASSAGGIO_PRIVATO">Passaggio di proprietà privato</option>
                  <option value="MINIVOLTURE_MULTIPLE">
                    Minivolture multiple (commercianti)
                  </option>
                </Select>
              </Field>

              <div className="mt-4 rounded-[10px] border border-pv-slate-200 bg-pv-slate-50 p-3 text-[12.5px] leading-relaxed text-pv-slate-700">
                <p className="mb-1.5 font-bold uppercase tracking-wider text-[11px] text-pv-slate-500">
                  Quando usare quale tipo
                </p>
                <ul className="space-y-1.5">
                  <li>
                    <span className="font-semibold text-pv-navy-800">
                      Passaggio di proprietà privato
                    </span>
                    : un solo veicolo, da privato a privato. È il caso classico
                    del cliente che vende l&apos;auto a un altro privato.
                  </li>
                  <li>
                    <span className="font-semibold text-pv-navy-800">
                      Minivolture multiple
                    </span>
                    : commercianti / concessionari che caricano più veicoli in
                    un&apos;unica pratica. Richiede almeno 2 veicoli.
                  </li>
                </ul>
              </div>

              {tipo === 'MINIVOLTURE_MULTIPLE' && (
                <div className="mt-4">
                  <Field label="Numero veicoli" required>
                    <Input
                      type="number"
                      min={2}
                      max={50}
                      value={numeroVeicoli}
                      onChange={(e) =>
                        setNumeroVeicoli(Math.max(2, Number(e.target.value) || 2))
                      }
                    />
                  </Field>
                  <p className="mt-1 text-[12px] text-pv-slate-500">
                    Le minivolture multiple richiedono almeno 2 veicoli.
                  </p>
                </div>
              )}
            </div>

            <div className="rounded-[16px] border border-pv-slate-200 bg-white p-5 shadow-[var(--pv-shadow-card)]">
              <Field label="Libretto di circolazione (PDF/JPG/PNG)" required>
                <label className="flex cursor-pointer items-center justify-between gap-3 rounded-[10px] border-[1.5px] border-dashed border-pv-slate-300 bg-pv-slate-50 px-4 py-3 text-[13px] transition-colors hover:border-pv-navy-600">
                  <span className="truncate text-pv-slate-700">
                    {librettoName ?? 'Seleziona o trascina il file'}
                  </span>
                  <span className="shrink-0 rounded-[8px] bg-pv-navy-700 px-3 py-1.5 font-semibold text-white">
                    {librettoName ? 'Cambia' : 'Sfoglia'}
                  </span>
                  <input
                    type="file"
                    accept="application/pdf,image/jpeg,image/png"
                    onChange={onFileSelected}
                    className="sr-only"
                  />
                </label>
              </Field>

              {extracting && (
                <p className="mt-3 text-[13px] text-pv-slate-500">Estrazione dati in corso…</p>
              )}
              {ocrError && (
                <div className="mt-3">
                  <Alert variant="error">{ocrError}</Alert>
                </div>
              )}

              {ocr && (
                <div className="mt-4 rounded-[12px] border border-pv-slate-200 bg-pv-slate-50 p-4">
                  <p className="mb-3 text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
                    Dati estratti — correggi se serve
                  </p>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <Field label="Targa" required>
                      <Input
                        value={ocr.targa}
                        onChange={(e) => setOcr({ ...ocr, targa: e.target.value.toUpperCase() })}
                      />
                    </Field>
                    <Field label="Telaio" required>
                      <Input
                        value={ocr.telaio}
                        onChange={(e) => setOcr({ ...ocr, telaio: e.target.value.toUpperCase() })}
                      />
                    </Field>
                    <Field label="Proprietario attuale" required className="sm:col-span-2">
                      <Input
                        value={ocr.proprietarioAttuale}
                        onChange={(e) =>
                          setOcr({ ...ocr, proprietarioAttuale: e.target.value })
                        }
                      />
                    </Field>
                    <Field label="Data immatricolazione" required>
                      <Input
                        type="date"
                        value={ocr.dataImmatricolazione}
                        onChange={(e) =>
                          setOcr({ ...ocr, dataImmatricolazione: e.target.value })
                        }
                      />
                    </Field>
                    <div className="flex flex-col gap-2 pt-6">
                      <label className="flex items-center gap-2 text-[13px] text-pv-slate-700">
                        <Checkbox
                          checked={ocr.preImm2015}
                          onChange={(e) => setOcr({ ...ocr, preImm2015: e.target.checked })}
                        />
                        Pre-2015 (richiede certificato di proprietà)
                      </label>
                      <label className="flex items-center gap-2 text-[13px] text-pv-slate-700">
                        <Checkbox
                          checked={ocr.flagComodatoDuso}
                          onChange={(e) =>
                            setOcr({ ...ocr, flagComodatoDuso: e.target.checked })
                          }
                        />
                        Comodato d&apos;uso rilevato
                      </label>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="flex justify-end">
              <Button disabled={!canStep2} onClick={() => setStep(2)}>
                Avanti
              </Button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-5">
            <div className="rounded-[16px] border border-pv-slate-200 bg-white p-5 shadow-[var(--pv-shadow-card)]">
              <h2 className="mb-3 text-[15px] font-bold text-pv-navy-800">Venditore</h2>
              <ParteForm parte={venditore} onChange={setVenditore} />
            </div>

            <div className="rounded-[16px] border border-pv-slate-200 bg-white p-5 shadow-[var(--pv-shadow-card)]">
              <h2 className="mb-3 text-[15px] font-bold text-pv-navy-800">Acquirente</h2>
              <ParteForm parte={acquirente} onChange={setAcquirente} />
            </div>

            <div className="rounded-[16px] border border-pv-slate-200 bg-white p-5 shadow-[var(--pv-shadow-card)]">
              <h2 className="mb-3 text-[15px] font-bold text-pv-navy-800">Flag pratica</h2>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <label className="flex items-center gap-2 text-[13px] text-pv-slate-700">
                  <Checkbox
                    checked={flagCointestazione}
                    onChange={(e) => setFlagCointestazione(e.target.checked)}
                  />
                  Cointestazione
                </label>
                <label className="flex items-center gap-2 text-[13px] text-pv-slate-700">
                  <Checkbox
                    checked={flagMinivoltura}
                    onChange={(e) => setFlagMinivoltura(e.target.checked)}
                  />
                  Minivoltura
                </label>
                <label className="flex items-center gap-2 text-[13px] text-pv-slate-700">
                  <Checkbox
                    checked={flagProcura}
                    onChange={(e) => setFlagProcura(e.target.checked)}
                  />
                  Procura
                </label>
              </div>
            </div>

            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
              <Button variant="secondary" onClick={() => setStep(1)}>
                Indietro
              </Button>
              <Button disabled={!canStep3} onClick={() => setStep(3)}>
                Avanti
              </Button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-5">
            <div className="rounded-[16px] border border-pv-slate-200 bg-white p-5 shadow-[var(--pv-shadow-card)]">
              <h2 className="mb-3 text-[15px] font-bold text-pv-navy-800">Localizzazione</h2>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <Field label="Comune" required className="sm:col-span-2">
                  <Input value={comune} onChange={(e) => setComune(e.target.value)} placeholder="Venezia" />
                </Field>
                <Field label="Provincia" required>
                  <Input
                    maxLength={2}
                    value={provincia}
                    onChange={(e) => setProvincia(e.target.value.toUpperCase())}
                    placeholder="VE"
                  />
                </Field>
              </div>
            </div>

            <div className="rounded-[16px] border border-pv-slate-200 bg-white p-5 shadow-[var(--pv-shadow-card)]">
              <h2 className="mb-3 text-[15px] font-bold text-pv-navy-800">Riepilogo</h2>
              <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-[13px] sm:grid-cols-2">
                <RiepilogoRow label="Tipo" value={labelTipo(tipo)} />
                <RiepilogoRow label="Libretto" value={librettoName ?? '—'} />
                <RiepilogoRow label="Targa" value={ocr?.targa ?? '—'} />
                <RiepilogoRow label="Telaio" value={ocr?.telaio ?? '—'} />
                <RiepilogoRow label="Proprietario" value={ocr?.proprietarioAttuale ?? '—'} />
                <RiepilogoRow
                  label="Venditore"
                  value={parteNome(venditore)}
                />
                <RiepilogoRow
                  label="Acquirente"
                  value={parteNome(acquirente)}
                />
                {tipo === 'MINIVOLTURE_MULTIPLE' && (
                  <RiepilogoRow label="Numero veicoli" value={String(numeroVeicoli)} />
                )}
                <RiepilogoRow label="Comune" value={comune || '—'} />
              </dl>
            </div>

            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
              <Button variant="secondary" onClick={() => setStep(2)} disabled={submitting}>
                Indietro
              </Button>
              <Button
                onClick={handleFinalSubmit}
                disabled={!canSubmit || submitting}
                loading={submitting}
                loadingLabel="Invio pratica…"
              >
                Invia pratica alle agenzie
              </Button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

function ParteForm({ parte, onChange }: { parte: Parte; onChange: (p: Parte) => void }) {
  return (
    <div>
      <div className="mb-3 flex gap-3 text-[13px]">
        <label className="flex items-center gap-2">
          <input
            type="radio"
            checked={!parte.isPG}
            onChange={() => onChange({ ...parte, isPG: false })}
          />
          Persona fisica
        </label>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            checked={parte.isPG}
            onChange={() => onChange({ ...parte, isPG: true })}
          />
          Persona giuridica
        </label>
      </div>
      {parte.isPG ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Ragione sociale" required>
            <Input
              value={parte.ragioneSociale}
              onChange={(e) => onChange({ ...parte, ragioneSociale: e.target.value })}
            />
          </Field>
          <Field label="Partita IVA" required>
            <Input
              value={parte.piva}
              onChange={(e) => onChange({ ...parte, piva: e.target.value.replace(/\D/g, '') })}
              maxLength={11}
            />
          </Field>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Nome" required>
            <Input value={parte.nome} onChange={(e) => onChange({ ...parte, nome: e.target.value })} />
          </Field>
          <Field label="Cognome" required>
            <Input
              value={parte.cognome}
              onChange={(e) => onChange({ ...parte, cognome: e.target.value })}
            />
          </Field>
          <Field label="Codice fiscale" required className="sm:col-span-2">
            <Input
              value={parte.cf}
              onChange={(e) => onChange({ ...parte, cf: e.target.value.toUpperCase() })}
              maxLength={16}
            />
          </Field>
        </div>
      )}
    </div>
  );
}

function RiepilogoRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-pv-slate-500">{label}</dt>
      <dd className="font-semibold text-pv-navy-800">{value}</dd>
    </>
  );
}

function parteValida(p: Parte): boolean {
  if (p.isPG) return p.ragioneSociale.trim().length > 0 && p.piva.length === 11;
  return (
    p.nome.trim().length > 0 && p.cognome.trim().length > 0 && p.cf.trim().length === 16
  );
}

function parteNome(p: Parte): string {
  if (p.isPG) return p.ragioneSociale || '—';
  return `${p.nome} ${p.cognome}`.trim() || '—';
}

function labelTipo(t: Tipo): string {
  if (t === 'PASSAGGIO_PRIVATO') return 'Passaggio di proprietà privato';
  if (t === 'MINIVOLTURE_MULTIPLE') return 'Minivolture multiple';
  return t;
}
