import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { QrCode, ShieldCheck, UserPlus } from "lucide-react";
import { toast } from "sonner";
import QRCode from "qrcode";

import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/lib/auth";
import type { AppRole, UserStatus } from "@/lib/auth";
import { fetchUsers, ROLE_LABELS, setUserRole, setUserStatus, STATUS_LABELS } from "@/lib/users";

export const Route = createFileRoute("/utilisateurs")({
  head: () => ({
    meta: [
      { title: "Utilisateurs — DDA Connect" },
      {
        name: "description",
        content: "Gestion des salariés DDA Connect : validation des comptes, rôles et invitation par QR code.",
      },
      { property: "og:title", content: "Utilisateurs — DDA Connect" },
      { property: "og:description", content: "Validation des comptes et attribution des rôles." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: UsersPage,
});

const STATUS_STYLE: Record<UserStatus, string> = {
  pending: "bg-status-watch-soft text-status-watch",
  active: "bg-status-ok-soft text-status-ok",
  disabled: "bg-muted text-muted-foreground",
};

function UsersPage() {
  const { isManager, loading, user } = useAuth();
  const qc = useQueryClient();
  const [qrOpen, setQrOpen] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState("");
  const inviteUrl = typeof window !== "undefined" ? `${window.location.origin}/auth?invite=1` : "";

  const users = useQuery({ queryKey: ["users"], queryFn: fetchUsers, enabled: isManager });

  useEffect(() => {
    if (!qrOpen || !inviteUrl) return;
    void QRCode.toDataURL(inviteUrl, { width: 512, margin: 1 }).then(setQrDataUrl);
  }, [qrOpen, inviteUrl]);

  const mutate = useMutation({
    mutationFn: async (a: { id: string; role?: AppRole; status?: UserStatus }) => {
      if (a.role) await setUserRole(a.id, a.role);
      if (a.status) await setUserStatus(a.id, a.status);
    },
    onSuccess: async () => {
      toast.success("Utilisateur mis à jour");
      await qc.invalidateQueries({ queryKey: ["users"] });
    },
    onError: () => toast.error("Modification impossible"),
  });

  if (loading) {
    return (
      <AppShell title="Utilisateurs" back={{ to: "/" }}>
        <p className="text-sm text-muted-foreground">Chargement…</p>
      </AppShell>
    );
  }

  if (!isManager) {
    return (
      <AppShell title="Utilisateurs" back={{ to: "/" }}>
        <div className="card-surface p-5 text-sm">
          <p className="font-bold uppercase">Accès réservé aux managers</p>
          <p className="mt-1 text-muted-foreground">
            La gestion des utilisateurs n'est pas accessible avec votre profil.
          </p>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell title="Utilisateurs" subtitle="Gestion des accès" back={{ to: "/" }}>
      <div className="space-y-4">
        <button
          onClick={() => setQrOpen((v) => !v)}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand px-4 py-4 text-sm font-extrabold uppercase text-brand-foreground"
        >
          <UserPlus className="h-5 w-5" /> Ajouter un utilisateur
        </button>

        {qrOpen ? (
          <div className="card-surface space-y-3 p-4 text-center">
            <div className="flex items-center justify-center gap-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">
              <QrCode className="h-4 w-4" /> Scanner pour créer un compte
            </div>
            {qrDataUrl ? (
              <img src={qrDataUrl} alt="QR code d'inscription DDA Connect" className="mx-auto h-56 w-56 rounded-lg bg-white p-2" />
            ) : (
              <p className="text-sm text-muted-foreground">Génération du QR code…</p>
            )}
            <p className="break-all text-xs text-muted-foreground">{inviteUrl}</p>
            <p className="text-xs text-muted-foreground">
              Le salarié scanne, se connecte avec Google, puis apparaît ci-dessous en « En attente ».
            </p>
          </div>
        ) : null}

        <div className="space-y-2">
          {(users.data ?? []).map((u) => (
            <div key={u.id} className="card-surface space-y-3 p-4">
              <div className="flex items-start gap-3">
                {u.avatar_url ? (
                  <img src={u.avatar_url} alt="" className="h-10 w-10 rounded-full object-cover" />
                ) : (
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-secondary text-sm font-bold">
                    {(u.first_name ?? u.email ?? "?").slice(0, 1).toUpperCase()}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-bold">
                    {[u.first_name, u.last_name].filter(Boolean).join(" ") || "—"}
                    {u.id === user?.id ? <span className="ml-2 text-xs text-muted-foreground">(vous)</span> : null}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">{u.email}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                    <span className={`rounded-full px-2 py-0.5 font-bold uppercase ${STATUS_STYLE[u.status]}`}>
                      {STATUS_LABELS[u.status]}
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 font-bold uppercase">
                      <ShieldCheck className="h-3 w-3" /> {u.role ? ROLE_LABELS[u.role] : "—"}
                    </span>
                    <span className="text-muted-foreground">
                      {new Date(u.created_at).toLocaleDateString("fr-FR")}
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                {u.status !== "active" ? (
                  <Action label="Valider" onClick={() => mutate.mutate({ id: u.id, status: "active" })} primary />
                ) : null}
                {u.role !== "manager" ? (
                  <Action label="Passer manager" onClick={() => mutate.mutate({ id: u.id, role: "manager" })} />
                ) : null}
                {u.role !== "salarie" ? (
                  <Action label="Passer salarié" onClick={() => mutate.mutate({ id: u.id, role: "salarie" })} />
                ) : null}
                {u.status !== "disabled" && u.id !== user?.id ? (
                  <Action label="Désactiver" onClick={() => mutate.mutate({ id: u.id, status: "disabled" })} />
                ) : null}
              </div>
            </div>
          ))}
          {users.data?.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              Aucun utilisateur.
            </p>
          ) : null}
        </div>
      </div>
    </AppShell>
  );
}

function Action({ label, onClick, primary }: { label: string; onClick: () => void; primary?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-lg px-3 py-2 text-xs font-bold uppercase ${
        primary ? "bg-brand text-brand-foreground" : "border-2 border-border bg-card"
      }`}
    >
      {label}
    </button>
  );
}
