import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { KeyRound } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/parametrage/api")({
  head: () => ({
    meta: [
      { title: "Paramètres API — DDA Connect" },
      {
        name: "description",
        content:
          "Configuration des services externes de DDA Connect : OCR, email, stockage, géocodage. Clés masquées et test de connexion.",
      },
      { property: "og:title", content: "Paramètres API — DDA Connect" },
      { property: "og:description", content: "Services externes, clés masquées et statut du dernier test." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ApiSettings,
});

type ApiSetting = {
  id: string;
  service: string;
  label: string;
  active: boolean;
  endpoint: string | null;
  secret_name: string | null;
  key_hint: string | null;
  last_test_at: string | null;
  last_test_ok: boolean | null;
  last_test_message: string | null;
};

async function fetchSettings(): Promise<ApiSetting[]> {
  const { data, error } = await supabase.from("api_settings").select("*").order("label");
  if (error) throw error;
  return (data ?? []) as ApiSetting[];
}

function ApiSettings() {
  const { isManager } = useAuth();
  const q = useQuery({ queryKey: ["api-settings"], queryFn: fetchSettings, enabled: isManager });
  const [busy, setBusy] = useState<string | null>(null);

  async function patch(row: ApiSetting, p: Partial<ApiSetting>) {
    const { error } = await supabase.from("api_settings").update(p).eq("id", row.id);
    if (error) toast.error("Enregistrement impossible.");
    await q.refetch();
  }

  /** Test de connexion : vérifie que le secret est bien configuré côté serveur. */
  async function test(row: ApiSetting) {
    setBusy(row.id);
    try {
      const res = await fetch(`/api/public/api-check?service=${encodeURIComponent(row.service)}`);
      const json = (await res.json()) as { ok: boolean; message: string; hint?: string | null };
      await patch(row, {
        last_test_at: new Date().toISOString(),
        last_test_ok: json.ok,
        last_test_message: json.message,
        key_hint: json.hint ?? row.key_hint,
      });
      if (json.ok) toast.success(json.message);
      else toast.error(json.message);
    } catch {
      await patch(row, {
        last_test_at: new Date().toISOString(),
        last_test_ok: false,
        last_test_message: "Test impossible (service injoignable)",
      });
      toast.error("Test impossible.");
    } finally {
      setBusy(null);
    }
  }

  if (!isManager) {
    return (
      <AppShell title="Paramètres API" subtitle="Services externes" back={{ to: "/parametrage" }}>
        <p className="rounded-lg bg-amber-100 px-3 py-3 text-sm text-amber-950">Accès réservé aux administrateurs.</p>
      </AppShell>
    );
  }

  return (
    <AppShell title="Paramètres API" subtitle="Services externes" back={{ to: "/parametrage" }}>
      <div className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Les clés ne sont jamais affichées : elles restent stockées côté serveur. Sans clé configurée, l'application
          reste utilisable en mode manuel.
        </p>
        {(q.data ?? []).map((s) => (
          <section key={s.id} className="card-surface space-y-2 p-4 text-xs">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-extrabold uppercase">
                <KeyRound className="h-4 w-4 text-brand" /> {s.label}
              </div>
              <button
                onClick={() => void patch(s, { active: !s.active })}
                className={`rounded-lg px-3 py-2 font-extrabold uppercase ${
                  s.active ? "bg-brand text-brand-foreground" : "border-2 border-border"
                }`}
              >
                {s.active ? "Actif" : "Inactif"}
              </button>
            </div>
            <label className="block text-muted-foreground">
              Nom du secret serveur
              <input
                defaultValue={s.secret_name ?? ""}
                onBlur={(e) => void patch(s, { secret_name: e.target.value.trim() || null })}
                placeholder="EX : RESEND_API_KEY"
                className="mt-1 w-full rounded border border-border px-2 py-2 text-sm"
              />
            </label>
            <label className="block text-muted-foreground">
              Endpoint (facultatif)
              <input
                defaultValue={s.endpoint ?? ""}
                onBlur={(e) => void patch(s, { endpoint: e.target.value.trim() || null })}
                className="mt-1 w-full rounded border border-border px-2 py-2 text-sm"
              />
            </label>
            <p className="text-muted-foreground">
              Clé : {s.key_hint ? `••••••${s.key_hint}` : "non renseignée"}
            </p>
            <div className="flex items-center justify-between gap-2">
              <span className={s.last_test_ok ? "text-status-ok" : "text-muted-foreground"}>
                {s.last_test_at
                  ? `Dernier test : ${new Date(s.last_test_at).toLocaleString("fr-FR")} — ${s.last_test_message ?? ""}`
                  : "Jamais testé"}
              </span>
              <button
                disabled={busy === s.id}
                onClick={() => void test(s)}
                className="rounded-lg border-2 border-border px-3 py-2 font-extrabold uppercase disabled:opacity-50"
              >
                Tester
              </button>
            </div>
          </section>
        ))}
      </div>
    </AppShell>
  );
}
