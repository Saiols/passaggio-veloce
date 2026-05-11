import { formatCurrencyCent } from '@/lib/format';
import type { RendimentoBucket } from './rendimento';

const W = 720;
const H = 220;
// PADDING_X dimensionato per contenere la label massima dell'asse Y
// ("9.999,99 €" ≈ 50u a fontSize 10) con textAnchor="end" a x=PADDING_X-8.
const PADDING_X = 64;
const PADDING_TOP = 18;
const PADDING_BOTTOM = 32;

/** Numero massimo di label X visibili: oltre questo si dirada. */
const MAX_X_LABELS = 8;

/**
 * Bar chart SVG inline (server-rendered): nessuna libreria esterna,
 * design system Trust Blue. Mostra il rendimento del periodo in colonne
 * verticali con label sotto e valore in tooltip nativo (title).
 *
 * - Stagger animation: ogni barra entra dal basso con delay incrementale
 *   (CSS keyframe definito in globals.css come pv-bar-grow).
 * - Label X diradate: con > MAX_X_LABELS bucket mostriamo solo ogni N-esimo
 *   per evitare sovrapposizione. Sempre visibili: prima e ultima.
 * - Linea hover su barra: opacità aumenta + cursor pointer (CSS).
 */
export function RendimentoChart({
  buckets,
  accent = 'navy',
  formatValue = formatCurrencyCent,
}: {
  buckets: RendimentoBucket[];
  accent?: 'navy' | 'orange';
  /** Override formatting valore (default: currency da cent). */
  formatValue?: (n: number) => string;
}) {
  if (buckets.length === 0) {
    return (
      <div className="mt-3 rounded-[12px] bg-pv-slate-50 px-5 py-12 text-center text-[13px] text-pv-slate-500">
        Nessun movimento nel periodo.
      </div>
    );
  }

  const maxVal = Math.max(...buckets.map((b) => b.importoCent), 1);
  const innerW = W - PADDING_X * 2;
  const innerH = H - PADDING_TOP - PADDING_BOTTOM;
  const barWidth = Math.max(4, (innerW / buckets.length) * 0.7);
  const stride = innerW / buckets.length;

  const fill =
    accent === 'navy' ? 'var(--pv-navy-600)' : 'var(--pv-orange-500)';

  // Diradiamo le label X quando ci sono troppi bucket (es. 30d): mostriamo
  // ogni labelStride. Garantiamo sempre la prima e l'ultima per dare i
  // riferimenti temporali del periodo.
  const labelStride = Math.max(1, Math.ceil(buckets.length / MAX_X_LABELS));

  return (
    <div className="mt-4 overflow-x-auto">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMinYMid meet"
        role="img"
        aria-label="Grafico rendimento"
        className="block w-full min-w-[420px]"
      >
        {/* Asse Y: 0 e max */}
        <text
          x={PADDING_X - 8}
          y={PADDING_TOP + 4}
          textAnchor="end"
          fontSize="10"
          fill="var(--pv-slate-500)"
        >
          {formatValue(maxVal)}
        </text>
        <text
          x={PADDING_X - 8}
          y={PADDING_TOP + innerH + 4}
          textAnchor="end"
          fontSize="10"
          fill="var(--pv-slate-500)"
        >
          0
        </text>

        {/* Linea zero */}
        <line
          x1={PADDING_X}
          y1={PADDING_TOP + innerH}
          x2={W - PADDING_X}
          y2={PADDING_TOP + innerH}
          stroke="var(--pv-slate-200)"
          strokeWidth="1"
        />

        {buckets.map((b, i) => {
          const h = (Math.max(b.importoCent, 0) / maxVal) * innerH;
          const cx = PADDING_X + stride * i + stride / 2;
          const x = cx - barWidth / 2;
          const y = PADDING_TOP + innerH - h;
          const baseline = PADDING_TOP + innerH;
          // Mostra label se prima, ultima o multipli di labelStride. Per
          // evitare sovrapposizione tra ultimo (sempre visibile) e penultimo
          // multiplo, saltiamo i multipli che cadono troppo vicini all'ultimo.
          const lastIdx = buckets.length - 1;
          const minDistance = Math.floor(labelStride / 2);
          const isMultiplo = i % labelStride === 0;
          const tooCloseToLast = lastIdx - i < minDistance;
          const showLabel =
            i === 0 || i === lastIdx || (isMultiplo && !tooCloseToLast);
          return (
            <g key={i}>
              <rect
                x={x}
                y={y}
                width={barWidth}
                height={h}
                fill={fill}
                rx={3}
                className="pv-rendimento-bar"
                style={{
                  // Animazione stagger: ogni barra entra dal baseline
                  // crescendo, con delay proporzionale all'indice.
                  transformOrigin: `${cx}px ${baseline}px`,
                  animationDelay: `${i * 25}ms`,
                }}
                aria-label={`${b.label}: ${formatValue(b.importoCent)}`}
              >
                <title>{`${b.label}: ${formatValue(b.importoCent)}`}</title>
              </rect>
              {showLabel && (
                <text
                  x={cx}
                  y={H - 12}
                  textAnchor="middle"
                  fontSize="10"
                  fill="var(--pv-slate-500)"
                >
                  {b.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
