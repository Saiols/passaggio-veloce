export function KeyTakeaway({ items }: { items: readonly string[] }) {
  return (
    <aside className="my-8 rounded-[14px] border border-pv-navy-200 bg-pv-navy-50 p-6">
      <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-pv-navy-700 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-white">
        TL;DR
      </div>
      <ul className="space-y-2 text-[14.5px] leading-relaxed text-pv-navy-900">
        {items.map((item, i) => (
          <li key={i} className="flex items-start gap-3">
            <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-pv-orange-500" aria-hidden="true" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </aside>
  );
}
