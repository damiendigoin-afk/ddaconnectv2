import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
import { Area, Badge, Field, Section, Select } from "@/components/bits";
import { useAuth } from "@/lib/auth";
import { toastError } from "@/lib/errors";
import { deleteArticle, KB_CATEGORIES, listArticles, saveArticle } from "@/lib/knowledge";

export const Route = createFileRoute("/connaissances/")({
  head: () => ({
    meta: [
      { title: "Base de connaissances — Procédures atelier — DDA Connect" },
      { name: "description", content: "Procédures, astuces et modes opératoires partagés entre les équipes atelier, carrosserie et magasin." },
      { property: "og:title", content: "Base de connaissances — Procédures atelier" },
      { property: "og:description", content: "Fiches pratiques et procédures internes du garage." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: KnowledgeHub,
});

function KnowledgeHub() {
  const qc = useQueryClient();
  const { displayName, user } = useAuth();
  const rows = useQuery({ queryKey: ["kb"], queryFn: listArticles });
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ title: "", category: "general", body: "", tags: "" });

  const list = rows.data ?? [];
  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return list.filter(
      (a) =>
        (!cat || a.category === cat) &&
        (!needle ||
          a.title.toLowerCase().includes(needle) ||
          a.body.toLowerCase().includes(needle) ||
          a.tags.some((t) => t.toLowerCase().includes(needle))),
    );
  }, [list, q, cat]);

  const create = useMutation({
    mutationFn: () =>
      saveArticle({
        title: form.title.trim(),
        category: form.category,
        body: form.body,
        tags: form.tags.split(",").map((t) => t.trim()).filter(Boolean),
        author_id: user?.id ?? null,
        author_name: displayName || null,
      } as never),
    onSuccess: () => {
      toast.success("Fiche publiée");
      setOpen(false);
      setForm({ title: "", category: "general", body: "", tags: "" });
      void qc.invalidateQueries({ queryKey: ["kb"] });
    },
    onError: (e) => toastError(e, "Publication impossible"),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteArticle(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["kb"] }),
    onError: (e) => toastError(e, "Suppression impossible"),
  });

  return (
    <AppShell
      title="Base de connaissances"
      subtitle="Procédures et modes opératoires"
      back={{ to: "/" }}
      right={
        <button onClick={() => setOpen((v) => !v)} aria-label="Nouvelle fiche" className="rounded-lg bg-brand px-3 py-2 text-brand-foreground">
          <Plus className="h-5 w-5" />
        </button>
      }
    >
      <div className="space-y-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Rechercher une procédure, un mot-clé…"
          className="w-full rounded-lg border-2 border-border bg-card px-3 py-3 text-base outline-none focus:border-brand"
        />
        <div className="flex flex-wrap gap-2">
          {KB_CATEGORIES.map((c) => (
            <button
              key={c.key}
              onClick={() => setCat(cat === c.key ? "" : c.key)}
              className={`rounded-lg border-2 px-2 py-1 text-[11px] font-bold uppercase ${
                cat === c.key ? "border-brand bg-brand/10 text-brand" : "border-border"
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      {open ? (
        <Section title="Nouvelle fiche">
          <div className="space-y-3 rounded-xl border-2 border-border bg-card p-3">
            <Field label="Titre" value={form.title} onChange={(v) => setForm({ ...form, title: v })} />
            <Select label="Catégorie" value={form.category} onChange={(v) => setForm({ ...form, category: v })} options={KB_CATEGORIES} allowEmpty={false} />
            <Area label="Contenu" rows={8} value={form.body} onChange={(v) => setForm({ ...form, body: v })} />
            <Field label="Mots-clés (séparés par des virgules)" value={form.tags} onChange={(v) => setForm({ ...form, tags: v })} />
            <button
              onClick={() => create.mutate()}
              disabled={create.isPending || !form.title.trim()}
              className="w-full rounded-lg bg-brand py-3 font-bold uppercase text-brand-foreground disabled:opacity-60"
            >
              Publier
            </button>
          </div>
        </Section>
      ) : null}

      <Section title={`Fiches (${visible.length})`}>
        {!rows.isLoading && !visible.length ? (
          <p className="rounded-xl border-2 border-dashed border-border p-4 text-sm text-muted-foreground">
            Aucune fiche pour l'instant. Créez la première procédure partagée de l'atelier.
          </p>
        ) : null}
        <div className="space-y-2">
          {visible.map((a) => (
            <details key={a.id} className="rounded-xl border-2 border-border bg-card p-3">
              <summary className="cursor-pointer list-none">
                <div className="flex items-center gap-2">
                  <Badge>{KB_CATEGORIES.find((c) => c.key === a.category)?.label ?? a.category}</Badge>
                  <span className="flex-1 text-sm font-bold">{a.title}</span>
                </div>
                <div className="mt-1 text-[11px] text-muted-foreground">
                  {a.author_name ?? "—"} · {new Date(a.updated_at).toLocaleDateString("fr-FR")}
                </div>
              </summary>
              <p className="mt-2 whitespace-pre-wrap text-sm">{a.body}</p>
              {a.tags.length ? (
                <div className="mt-2 flex flex-wrap gap-1">
                  {a.tags.map((t) => (
                    <Badge key={t}>{t}</Badge>
                  ))}
                </div>
              ) : null}
              <button
                onClick={() => remove.mutate(a.id)}
                className="mt-2 flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-[11px] font-bold uppercase text-muted-foreground"
              >
                <Trash2 className="h-3 w-3" /> Supprimer
              </button>
            </details>
          ))}
        </div>
      </Section>
    </AppShell>
  );
}