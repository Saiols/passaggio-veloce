import { prisma } from '@pv/db';
import { EmailModal } from './email-modal';
import { formatRelative } from '@/lib/format';

export async function InboxDemo() {
  const emails = await prisma.notificaInviata.findMany({
    orderBy: { sentAt: 'desc' },
    take: 50,
    select: {
      id: true,
      tipo: true,
      destinazione: true,
      subject: true,
      bodyPreview: true,
      payload: true,
      sentAt: true,
      providerRef: true,
    },
  });

  return (
    <div className="rounded-2xl border border-pv-slate-200 bg-white">
      <header className="flex items-center justify-between border-b border-pv-slate-100 px-5 py-3">
        <h2 className="text-base font-bold text-pv-navy-900">Inbox Demo</h2>
        <span className="text-xs text-pv-slate-500">Ultime 50</span>
      </header>
      {emails.length === 0 ? (
        <p className="p-5 text-sm text-pv-slate-500">Nessuna email simulata.</p>
      ) : (
        <ul className="max-h-[600px] divide-y divide-pv-slate-100 overflow-auto">
          {emails.map((e) => (
            <li key={e.id} className="px-5 py-3 hover:bg-pv-slate-50">
              <EmailModal
                email={{
                  id: e.id,
                  tipo: e.tipo,
                  destinazione: e.destinazione,
                  subject: e.subject,
                  bodyPreview: e.bodyPreview,
                  payload: e.payload,
                }}
              >
                <div className="flex items-start justify-between gap-3 text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-pv-navy-900">
                      {e.subject ?? '(senza oggetto)'}
                    </p>
                    <p className="truncate text-xs text-pv-slate-500">
                      {e.destinazione} · {e.tipo}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs text-pv-slate-500">
                    {e.sentAt ? formatRelative(e.sentAt) : ''}
                  </span>
                </div>
              </EmailModal>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
