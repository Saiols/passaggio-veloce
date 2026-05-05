import { formatCurrencyCent } from '@/lib/format';
import type { RendimentoBucket } from './rendimento';

const W = 720;
const H = 220;
const PADDING_X = 44;
const PADDING_TOP = 18;
const PADDING_BOTTOM = 32;

/**
 * Bar chart SVG inline (server-rendered): nessuna libreria esterna,
 * design system Trust Blue. Mostra il rendimento del periodo in colonne
 * verticali con label sotto e valore in tooltip nativo (title).
 */
export function RendimentoChart({
  buckets,
  accent = 'navy',
}: {
  buckets: RendimentoBucket[];
  accent?: 'navy' | 'orange';
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
          {formatCurrencyCent(maxVal)}
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
          return (
            <g key={i}>
              <title>
                {b.label}: {formatCurrencyCent(b.importoCent)}
              </title>
              <rect
                x={x}
                y={y}
                width={barWidth}
                height={h}
                fill={fill}
                rx={3}
              />
              <text
                x={cx}
                y={H - 12}
                textAnchor="middle"
                fontSize="10"
                fill="var(--pv-slate-500)"
              >
                {b.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
