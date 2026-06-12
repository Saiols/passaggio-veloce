/** Rende n stelle piene (arancio) + (5-n) vuote (slate). Presentazionale. */
export function Stars({ n }: { n: number }) {
  const full = Math.max(0, Math.min(5, n));
  return (
    <span className="text-[16px] leading-none" aria-label={`${full} su 5 stelle`}>
      <span className="text-pv-orange-500">{'★'.repeat(full)}</span>
      <span className="text-pv-slate-300">{'★'.repeat(5 - full)}</span>
    </span>
  );
}
