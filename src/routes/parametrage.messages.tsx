import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/lib/auth";
import { toastError } from "@/lib/errors";
import { listTemplates, saveTemplate, type MessageTemplate } from "@/lib/templates";

export const Route = createFileRoute("/parametrage/messages")({
  head: () => ({
    meta: [
      { title: "Modèles de messages — DDA Connect" },
      {
        name: "description",
        content:
          "Modifier les textes préremplis des communications DDA Connect (passage terrain expert, travaux complémentaires, autres motifs) sans développement.",
      },
      { property: "og:title", content: "Modèles de messages — DDA Connect" },
      { property: "og:description", content: "Objets et corps de message administrables par les managers." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: TemplatesPage,
});

function TemplatesPage() {
  const { isManager } = useAuth();
  const qc = useQueryClient();
  const templates = useQuery({ queryKey: ["message-templates"], queryFn: listTemplates, enabled: isManager });

  const save = useMutation({
    mutationFn: (v: { id: string; subject: string; body: string }) =>
      saveTemplate(v.id, { subject: v.subject, body: v.body }),
    onSuccess: async () => {
      toast.success("Modèle enregistré");
      await qc.invalidateQueries({ queryKey: ["message-templates"] });
    },
    onError: (e) => toastError(e, "Enregistrement du modèle impossible"),
  });

  if (!isManager) {
    return (
      <AppShell title="Modèles de messages" back={{ to: "/parametrage/global" }}>
        <p className="rounded-lg bg-amber-100 px-3 py-3 text-sm text-amber-950">Accès réservé aux managers.</p>
      </AppShell>
    );
  }

  return (
    <AppShell title="Modèles de messages" subtitle="Textes préremplis" back={{ to: "/parametrage/global" }}>
      <p className="mb-3 rounded-lg bg-secondary px-3 py-2 text-xs text-muted-foreground">
        Variables disponibles : {"{{plate}}"} {"{{vehicle}}"} {"{{or}}"} {"{{claim}}"} {"{{customer}}"}
      </p>
      <div className="space-y-3">
        {(templates.data ?? []).map((t) => (
          <Editor key={t.id} tpl={t} onSave={(subject, body) => save.mutate({ id: t.id, subject, body })} />
        ))}
        {templates.data?.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucun modèle.</p>
        ) : null}
      </div>
    </AppShell>
  );
}

function Editor({ tpl, onSave }: { tpl: MessageTemplate; onSave: (subject: string, body: string) => void }) {
  const [subject, setSubject] = useState(tpl.subject);
  const [body, setBody] = useState(tpl.body);

  return (
    <div className="space-y-2 rounded-xl border-2 border-border bg-card p-3">
      <div className="text-sm font-extrabold uppercase tracking-wide">{tpl.label}</div>
      <input
        value={subject}
        onChange={(e) => setSubject(e.target.value)}
        aria-label={`Objet du modèle ${tpl.label}`}
        className="w-full rounded-lg border-2 border-border bg-card px-3 py-2 text-sm font-bold"
      />
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={8}
        aria-label={`Corps du modèle ${tpl.label}`}
        className="w-full rounded-lg border-2 border-border bg-card px-3 py-2 text-sm"
      />
      <button
        onClick={() => onSave(subject, body)}
        className="w-full rounded-lg bg-brand px-3 py-3 text-xs font-extrabold uppercase text-brand-foreground"
      >
        Enregistrer
      </button>
    </div>
  );
}
