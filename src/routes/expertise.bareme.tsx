import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/lib/auth";
import { fetchPriceRules } from "@/lib/expertise";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/expertise/bareme")({
  head: () => ({
    meta: [
      { title: "Barème de chiffrage — DDA Connect" },
      {
        name: "description",
        content:
          "Montants indicatifs par type d'intervention utilisés pour estimer les remises en état des expertises.",
      },
      { property: "og:title", content: "Barème de chiffrage — DDA Connect" },
      {
        property: "og:description",
        content: "Montants indicatifs par type d'intervention, modifiables par le manager.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PriceRulesPage,
});

function PriceRulesPage() {
  const { isManager } = useAuth();
  const q = useQuery({ queryKey: ["price-rules"], queryFn: fetchPriceRules });

  async function save(id: string, patch: Record<string, unknown>) {
    const { error } = await supabase.from("repair_price_rules").update(patch).eq("id", id);
    if (error) {
      toast.error("Modification refusée.");
      return;
    }
    toast.success("Barème mis à jour");
    await q.refetch();
  }

  return (
    <AppShell
      title="Barème de chiffrage"
      subtitle="Montants indicatifs par intervention"
      back={{ to: "/expertises" }}
    >
      {!isManager ? (
        <p className="card-surface p-4 text-sm text-muted-foreground">
          Seul un manager peut modifier le barème.
        </p>
      ) : null}
      <ul className="space-y-2">
        {(q.data ?? []).map((r) => (
          <li key={r.id} className="card-surface flex items-center gap-3 p-4">
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-bold">{r.label}</div>
              <div className="text-xs text-muted-foreground">
                {r.manual_only ? "Chiffrage manuel" : "Montant proposé automatiquement"}
              </div>
            </div>
            <input
              type="number"
              disabled={!isManager}
              defaultValue={r.amount != null ? String(r.amount) : ""}
              onBlur={(e) => {
                const v = e.target.value;
                void save(r.id, {
                  amount: v === "" ? null : Number(v),
                  manual_only: v === "",
                });
              }}
              className="w-28 rounded-lg border-2 border-border bg-background px-3 py-2.5 text-right text-base font-extrabold disabled:opacity-60"
            />
            <span className="text-sm font-bold text-muted-foreground">€</span>
          </li>
        ))}
      </ul>
    </AppShell>
  );
}