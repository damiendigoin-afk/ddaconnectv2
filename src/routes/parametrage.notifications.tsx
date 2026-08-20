import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Plus, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { fetchSites } from "@/lib/sites";

export const Route = createFileRoute("/parametrage/notifications")({
  head: () => ({
    meta: [
      { title: "Notifications Front Office — DDA Connect" },
      {
        name: "description",
        content:
          "Destinataires e-mail prévenus automatiquement à la fin d'un Tour Véhicule, gérés par établissement.",
      },
      { property: "og:title", content: "Notifications Front Office — DDA Connect" },
      { property: "og:description", content: "Gestion des destinataires de fin de Tour Véhicule." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: NotificationsSettings,
});

type Recipient = {
  id: string;
  site_id: string | null;
  email: string;
  label: string | null;
  active: boolean;
};

const ALL = "__all__";

function NotificationsSettings() {
  const { isManager } = useAuth();
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [label, setLabel] = useState("");
  const [siteId, setSiteId] = useState<string>(ALL);

  const sites = useQuery({ queryKey: ["sites"], queryFn: fetchSites });
  const recipients = useQuery({
    queryKey: ["tour-notification-recipients"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tour_notification_recipients")
        .select("id, site_id, email, label, active")
        .order("email");
      if (error) throw error;
      return (data ?? []) as Recipient[];
    },
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["tour-notification-recipients"] });

  const add = useMutation({
    mutationFn: async () => {
      const value = email.trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) throw new Error("Adresse e-mail invalide");
      const { error } = await supabase.from("tour_notification_recipients").insert({
        email: value,
        label: label.trim() || null,
        site_id: siteId === ALL ? null : siteId,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      setEmail("");
      setLabel("");
      toast.success("Destinataire ajouté");
      await invalidate();
    },
    onError: (e: Error) => toast.error(e.message || "Ajout impossible"),
  });

  const update = useMutation({
    mutationFn: async (row: Recipient) => {
      const { error } = await supabase
        .from("tour_notification_recipients")
        .update({
          email: row.email.trim().toLowerCase(),
          label: row.label?.trim() || null,
          site_id: row.site_id,
          active: row.active,
        })
        .eq("id", row.id);
      if (error) throw error;
    },
    onSuccess: async () => {
      toast.success("Destinataire mis à jour");
      await invalidate();
    },
    onError: () => toast.error("Mise à jour impossible"),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("tour_notification_recipients").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: async () => {
      toast.success("Destinataire supprimé");
      await invalidate();
    },
    onError: () => toast.error("Suppression impossible"),
  });

  if (!isManager) {
    return (
      <AppShell title="Notifications Front Office" back={{ to: "/parametrage" }}>
        <p className="rounded-lg bg-amber-100 px-3 py-3 text-sm text-amber-950">
          Accès réservé aux managers.
        </p>
      </AppShell>
    );
  }

  return (
    <AppShell
      title="Notifications Front Office"
      subtitle="Fin de Tour Véhicule"
      back={{ to: "/parametrage" }}
    >
      <p className="mb-4 text-sm text-muted-foreground">
        Ces adresses reçoivent automatiquement un e-mail, avec le rapport PDF en pièce jointe, dès qu'un
        Tour Véhicule est terminé sur l'établissement concerné.
      </p>

      <section className="card-surface mb-6 space-y-2 p-4">
        <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
          Ajouter un destinataire
        </h2>
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          type="email"
          inputMode="email"
          placeholder="adresse@garage.fr"
          className="w-full rounded-lg border-2 border-border bg-background px-3 py-2.5 text-base"
        />
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Nom / fonction (optionnel)"
          className="w-full rounded-lg border-2 border-border bg-background px-3 py-2.5 text-base"
        />
        <select
          value={siteId}
          onChange={(e) => setSiteId(e.target.value)}
          className="w-full rounded-lg border-2 border-border bg-background px-3 py-2.5 text-base"
        >
          <option value={ALL}>Tous les établissements</option>
          {(sites.data ?? []).map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <button
          onClick={() => add.mutate()}
          disabled={add.isPending}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand px-4 py-3 font-extrabold uppercase text-brand-foreground"
        >
          <Plus className="h-5 w-5" /> Ajouter
        </button>
      </section>

      <div className="space-y-3">
        {(recipients.data ?? []).map((r) => (
          <RecipientRow
            key={r.id}
            row={r}
            sites={(sites.data ?? []).map((s) => ({ id: s.id, name: s.name }))}
            onSave={(next) => update.mutate(next)}
            onDelete={() => {
              if (window.confirm(`Supprimer ${r.email} ?`)) remove.mutate(r.id);
            }}
          />
        ))}
        {recipients.data?.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            Aucun destinataire configuré : aucune notification ne sera envoyée.
          </p>
        ) : null}
      </div>
    </AppShell>
  );
}

function RecipientRow({
  row,
  sites,
  onSave,
  onDelete,
}: {
  row: Recipient;
  sites: { id: string; name: string }[];
  onSave: (next: Recipient) => void;
  onDelete: () => void;
}) {
  const [draft, setDraft] = useState<Recipient>(row);
  const dirty = JSON.stringify(draft) !== JSON.stringify(row);

  return (
    <div className="card-surface space-y-2 p-3">
      <input
        value={draft.email}
        onChange={(e) => setDraft({ ...draft, email: e.target.value })}
        type="email"
        className="w-full rounded-lg border-2 border-border bg-background px-3 py-2 text-base"
      />
      <input
        value={draft.label ?? ""}
        onChange={(e) => setDraft({ ...draft, label: e.target.value })}
        placeholder="Nom / fonction"
        className="w-full rounded-lg border-2 border-border bg-background px-3 py-2 text-base"
      />
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={draft.site_id ?? ALL}
          onChange={(e) => setDraft({ ...draft, site_id: e.target.value === ALL ? null : e.target.value })}
          className="flex-1 rounded-lg border-2 border-border bg-background px-3 py-2 text-sm"
        >
          <option value={ALL}>Tous les établissements</option>
          {sites.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm font-semibold">
          <input
            type="checkbox"
            checked={draft.active}
            onChange={(e) => setDraft({ ...draft, active: e.target.checked })}
          />
          Actif
        </label>
      </div>
      <div className="flex gap-2">
        <button
          onClick={() => onSave(draft)}
          disabled={!dirty}
          className="flex flex-1 items-center justify-center gap-2 rounded-lg border-2 border-border bg-card px-3 py-2 text-sm font-bold uppercase disabled:opacity-40"
        >
          <Save className="h-4 w-4" /> Enregistrer
        </button>
        <button
          onClick={onDelete}
          aria-label="Supprimer le destinataire"
          className="rounded-lg bg-destructive px-3 py-2 text-destructive-foreground"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}