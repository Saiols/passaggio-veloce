import 'server-only';
import {
  type LibrettoCircolazioneData,
  type OcrExtractInput,
  type OcrProvider,
  OcrFailedError,
} from './types';

type MindeeField = { value?: string; confidence?: number };

type MindeePrediction = {
  targa?: MindeeField;
  telaio?: MindeeField;
  proprietario_attuale?: MindeeField;
  data_immatricolazione?: MindeeField;
  flag_comodato_uso?: MindeeField;
};

type MindeeResponse = {
  document: {
    inference: {
      prediction: MindeePrediction;
    };
  };
};

export class MindeeOcrProvider implements OcrProvider {
  readonly name = 'mindee' as const;

  constructor(
    private readonly apiKey: string,
    private readonly endpointUrl: string,
  ) {}

  async extractLibretto(input: OcrExtractInput): Promise<LibrettoCircolazioneData> {
    const form = new FormData();
    form.append(
      'document',
      new Blob([new Uint8Array(input.buffer)], { type: input.mimeType }),
      input.originalFilename ?? 'libretto',
    );

    const res = await fetch(this.endpointUrl, {
      method: 'POST',
      headers: { Authorization: `Token ${this.apiKey}` },
      body: form,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '<no body>');
      throw new OcrFailedError(`Mindee HTTP ${res.status}: ${body.slice(0, 200)}`);
    }

    const json = (await res.json()) as MindeeResponse;
    const p = json.document.inference.prediction;

    const dataIso = p.data_immatricolazione?.value;
    const year = dataIso ? parseInt(dataIso.slice(0, 4), 10) : null;
    const preImm2015 = year !== null && !Number.isNaN(year) && year < 2015;

    return {
      targa: p.targa?.value?.toUpperCase().replace(/\s+/g, ''),
      telaio: p.telaio?.value?.toUpperCase().replace(/\s+/g, ''),
      proprietarioAttuale: p.proprietario_attuale?.value,
      dataImmatricolazione: dataIso,
      preImm2015,
      flagComodatoDuso: p.flag_comodato_uso?.value === 'sì',
      confidenceScore: averageConfidence(p),
      rawText: undefined,
    };
  }
}

function averageConfidence(p: MindeePrediction): number {
  const scores = [
    p.targa?.confidence,
    p.telaio?.confidence,
    p.proprietario_attuale?.confidence,
    p.data_immatricolazione?.confidence,
  ].filter((c): c is number => typeof c === 'number');
  if (scores.length === 0) return 0;
  return scores.reduce((a, b) => a + b, 0) / scores.length;
}
