export type CostRow = {
  voce: string;
  importo: string;
  note?: string;
};

export function CostsTable({
  rows,
  total,
  caption,
}: {
  rows: readonly CostRow[];
  total?: string;
  caption?: string;
}) {
  return (
    <div className="my-6 overflow-x-auto">
      <table className="w-full border-collapse text-[14px]">
        {caption && (
          <caption className="mb-2 text-left text-[13px] text-pv-slate-500">{caption}</caption>
        )}
        <thead>
          <tr className="border-b-2 border-pv-navy-200 text-left text-[12px] font-bold uppercase tracking-wider text-pv-navy-700">
            <th className="py-2 pr-4">Voce</th>
            <th className="py-2 pr-4">Importo</th>
            <th className="py-2">Note</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-pv-slate-200">
              <td className="py-3 pr-4 font-medium text-pv-navy-900">{row.voce}</td>
              <td className="py-3 pr-4 font-mono text-pv-slate-700">{row.importo}</td>
              <td className="py-3 text-[13px] text-pv-slate-500">{row.note ?? ''}</td>
            </tr>
          ))}
        </tbody>
        {total && (
          <tfoot>
            <tr className="border-t-2 border-pv-navy-700 font-bold text-pv-navy-900">
              <td className="py-3 pr-4">Totale stimato</td>
              <td className="py-3 pr-4 font-mono">{total}</td>
              <td />
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}
