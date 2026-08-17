import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { QrCode, ShieldCheck, UserPlus } from "lucide-react";
import { toast } from "sonner";
import QRCode from "qrcode";

import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/lib/auth";
import type { AppRole, UserStatus } from "@/lib/auth";
import { fetchUsers, ROLE_LABELS, setUserNames, setUserRole, setUserStatus, STATUS_LABELS } from "@/lib/users";
import { fetchAllModuleAccess, MODULES, setModuleAccess } from "@/lib/access";
import { fetchOperators, linkOperator, normPerson } from "@/lib/stats";
import { toastError } from "@/lib/errors";

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
  const access = useQuery({ queryKey: ["module-access"], queryFn: fetchAllModuleAccess, enabled: isManager });
  const operators = useQuery({ queryKey: ["winmotor-operators"], queryFn: fetchOperators, enabled: isManager });
  const [openId, setOpenId] = useState<string | null>(null);

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
    onError: (e) => toastError(e, "Modification de l'utilisateur impossible"),
  });

  const edit = useMutation({
    mutationFn: async (a: {
      id: string;
      firstName: string;
      lastName: string;
      alias: string;
      siteId: string | null;
    }) => {
      await setUserNames(a.id, a.firstName, a.lastName);
      if (a.alias.trim()) await linkOperator(a.alias.trim().toUpperCase(), a.siteId, a.id);
    },
    onSuccess: async () => {
      toast.success("Fiche utilisateur enregistrée");
      await qc.invalidateQueries();
    },
    onError: (e) => toastError(e, "Enregistrement de la fiche impossible"),
  });

  const perm = useMutation({
    mutationFn: (a: { id: string; key: string; allowed: boolean }) => setModuleAccess(a.id, a.key, a.allowed),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["module-access"] });
    },
    onError: (e) => toastError(e, "Modification des accès impossible"),
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
                <Action
                  label={openId === u.id ? "Fermer la fiche" : "Fiche & accès"}
                  onClick={() => setOpenId((v) => (v === u.id ? null : u.id))}
                />
              </div>

              {openId === u.id ? (
                <UserEditor
                  user={u}
                  alias={
                    (operators.data ?? []).find((o) => o.user_id === u.id)?.alias ??
                    ((operators.data ?? []).find(
                      (o) => o.normalized === normPerson([u.first_name, u.last_name].filter(Boolean).join(" ")),
                    )?.alias ??
                      "")
                  }
                  modules={access.data?.get(u.id) ?? new Set<string>()}
                  onSave={(v) =>
                    edit.mutate({
                      id: u.id,
                      firstName: v.firstName,
                      lastName: v.lastName,
                      alias: v.alias,
                      siteId: u.site_id,
                    })
                  }
                  onToggle={(key, allowed) => perm.mutate({ id: u.id, key, allowed })}
                />
              ) : null}
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

function UserEditor({
  user,
  alias,
  modules,
  onSave,
  onToggle,
}: {
  user: { first_name: string | null; last_name: string | null };
  alias: string;
  modules: Set<string>;
  onSave: (v: { firstName: string; lastName: string; alias: string }) => void;
  onToggle: (key: string, allowed: boolean) => void;
}) {
  const [firstName, setFirstName] = useState(user.first_name ?? "");
  const [lastName, setLastName] = useState(user.last_name ?? "");
  const [wmAlias, setWmAlias] = useState(alias);

  return (
    <div className="space-y-3 rounded-lg border-2 border-border bg-secondary/40 p-3">
      <div className="grid grid-cols-2 gap-2">
        <Input label="Prénom" value={firstName} onChange={setFirstName} />
        <Input label="Nom" value={lastName} onChange={setLastName} />
      </div>
      <Input
        label="Nom Winmotor (productif)"
        value={wmAlias}
        onChange={setWmAlias}
        placeholder="ex. CORDONNIER JULIEN"
      />
      <p className="text-[11px] text-muted-foreground">
        Ce nom sert au rapprochement automatique des statistiques Winmotor : il est mémorisé et appliqué aux imports
        passés et futurs.
      </p>

      <div className="space-y-1">
        <div className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Accès aux modules</div>
        <div className="flex flex-wrap gap-2">
          {MODULES.map((m) => {
            const on = modules.has(m.key);
            return (
              <button
                key={m.key}
                onClick={() => onToggle(m.key, !on)}
                className={`rounded-lg px-3 py-2 text-xs font-bold uppercase ${
                  on ? "bg-brand text-brand-foreground" : "border-2 border-border bg-card text-muted-foreground"
                }`}
              >
                {m.label}
              </button>
            );
          })}
        </div>
      </div>

      <button
        onClick={() => onSave({ firstName, lastName, alias: wmAlias })}
        className="w-full rounded-lg bg-brand px-3 py-3 text-xs font-extrabold uppercase text-brand-foreground"
      >
        Enregistrer la fiche
      </button>
    </div>
  );
}

function Input({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{label}</span>
      <input
        value={value}
        placeholder={placeholder ?? ""}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border-2 border-border bg-card px-3 py-2 text-sm font-bold"
      />
    </label>
  );
}
