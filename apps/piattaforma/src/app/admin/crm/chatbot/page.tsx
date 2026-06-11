import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { prisma } from '@pv/db';
import { AppShell } from '@/components/app-shell';
import { Alert } from '@/components/ui';
import { canViewChatbot, canManageChatbot } from '@/lib/auth/permissions';
import { CrmChatbotClient } from './client';

export default async function AdminCrmChatbotPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!canViewChatbot(session.user.role)) {
    return (
      <AppShell session={session} activePath="/admin/crm/chatbot">
        <div className="mx-auto max-w-3xl px-5 py-10 sm:px-6">
          <Alert variant="info" title="Sezione riservata">
            La configurazione Chatbot è riservata a Admin / AD / CTO.
          </Alert>
        </div>
      </AppShell>
    );
  }

  const bots = await prisma.crmChatbot.findMany({
    where: { deletedAt: null },
    orderBy: { createdAt: 'desc' },
  });

  const botsSerializable = bots.map((b) => ({
    id: b.id,
    nome: b.nome,
    target: b.target,
    canale: b.canale,
    posizione: b.posizione,
    attivo: b.attivo,
    prompt: b.prompt,
    obiettivo: b.obiettivo,
    qa: b.qa,
    escalation: b.escalation,
    createdAt: b.createdAt.toISOString(),
    updatedAt: b.updatedAt.toISOString(),
  }));

  return (
    <AppShell session={session} activePath="/admin/crm/chatbot">
      <div className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-6 sm:py-10">
        <header className="mb-6">
          <p className="text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
            Admin · CRM
          </p>
          <h1 className="mt-1 text-[28px] font-extrabold tracking-tight text-pv-navy-900 sm:text-[32px]">
            Chatbot
          </h1>
          <p className="mt-1 text-[13px] text-pv-slate-500">
            Configura i bot testuali (sito, WhatsApp, mail). Il bot del sito
            è un componente inline della stessa Next app — l&apos;integrazione
            WhatsApp/mail (WATI/Manychat) arriva con CRM-H.
          </p>
        </header>

        <CrmChatbotClient
          bots={botsSerializable}
          canManage={canManageChatbot(session.user.role)}
        />
      </div>
    </AppShell>
  );
}
