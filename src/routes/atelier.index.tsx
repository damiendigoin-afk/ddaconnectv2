import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Camera, ChevronRight, CircleDot, ClipboardCheck, Gauge, Search } from "lucide-react";

import { AppShell } from "@/components/AppShell";
import { supabase } from "@/integrations/supabase/client";
import { useModuleAccess } from "@/lib/module-access";
import { useSite } from "@/lib/site-context";
import { formatPlate } from "@/lib/plate";

export const Route = createFileRoute("/atelier/")({
  head: () => ({
    meta: [
      { title: "Atelier — DDA Connect" },
      {
        name: "description",
        content: "Scanner un OR ou une plaque, ouvrir un OR WinMotor, devis pneus et expertise véhicule.",
      },
      { property: "og:title", content: "Atelier — DDA Connect" },
      { property: "og:description", content: "Le point d'entrée terrain de l'atelier, centré sur l'OR WinMotor." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AtelierHub,
});

type RecentOr = { id: string; or_number: string | null; site_id: string | null; updated_at: string; vehicle: { plate: string | null } | null };

function AtelierHub() {
  const navigate = useNavigate();
  const { can } = useModuleAccess();
  const { sites } = useSite();
  const siteName = (id: string | null) => sites.find((s) => s.id === id)?.name ?? null;
  const [orNum, setOrNum] = useState("");
  const [orNote, setOrNote] = useState<string | null>(null);

  const recent = useQuery({
    queryKey: ["atelier-recent-or"],
    enabled: can("tour"),
    queryFn: async () => {
      const { data } = await supabase
        .from("repair_orders")
        .select("id, or_number, site_id, updated_at, vehicle:vehicles(plate)")
        .not("or_number", "is", null)
        .order("updated_at", { ascending: false })
        .limit(6);
      return (data ?? []) as unknown as RecentOr[];
    },
  });

  async function openOr() {
    const n = orNum.trim();
    if (!n) return;
    setOrNote(null);
    const { data } = await supabase.from("repair_orders").select("id").eq("or_number", n).limit(2);
    if (data?.length === 1) navigate({ to: "/or/$orId", params: { orId: data[0]!.id } });
    else if (!data?.length) setOrNote("Aucun OR WinMotor connu avec ce numéro. Il doit d'abord être créé dans WinMotor puis importé.");
    else setOrNote("Plusieurs dossiers portent ce numéro : utilisez la recherche de l'accueil pour choisir le bon site.");
  }

  const cls = "flex items-center gap-4 rounded-xl border-2 border-border bg-card px-4 py-4 active:scale-[0.99]";

  return (
    <AppShell title="Atelier" back={{ to: "/" }}>
      <div className="space-y-3">
        {can("tour") ? (
          <Link to="/scan-plaque" className="flex items-center gap-4 rounded-xl bg-brand px-4 py-5 text-brand-foreground shadow-sm">
            <Camera className="h-7 w-7 shrink-0" />
            <div className="flex-1">
              <div className="text-base font-extrabold uppercase">Scanner OR / plaque</div>
              <div className="text-xs font-medium opacity-80">Plaque : fiche véhicule · N° OR : dossier atelier</div>
            </div>
            <ChevronRight className="h-5 w-5" />
          </Link>
        ) : null}

        {can("tour") ? (
          <form
            className="card-surface space-y-2 p-4"
            onSubmit={(e) => {
              e.preventDefault();
              void openOr();
            }}
          >
            <label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Ouvrir un OR WinMotor</label>
            <div className="flex gap-2">
              <input
                value={orNum}
                onChange={(e) => setOrNum(e.target.value)}
                inputMode="numeric"
                placeholder="N° OR WinMotor"
                className="min-w-0 flex-1 rounded-lg border-2 border-border bg-card px-3 py-3 text-base outline-none focus:border-brand"
              />
              <button type="submit" className="rounded-lg bg-primary px-4 font-bold uppercase text-primary-foreground" aria-label="Ouvrir l'OR">
                <Search className="h-5 w-5" />
              </button>
            </div>
            {orNote ? <p className="text-xs text-muted-foreground">{orNote}</p> : null}
          </form>
        ) : null}

        {can("pneus") ? (
          <Link to="/devis/pneus" className={cls}>
            <CircleDot className="h-6 w-6 shrink-0 text-brand" />
            <div className="flex-1">
              <div className="text-sm font-extrabold uppercase">Devis pneus</div>
              <div className="text-xs text-muted-foreground">Dimension, offres chiffrées et impression client</div>
            </div>
            <ChevronRight className="h-5 w-5" />
          </Link>
        ) : null}

        {can("expertise") ? (
          <Link to="/expertises" className={cls}>
            <ClipboardCheck className="h-6 w-6 shrink-0 text-brand" />
            <div className="flex-1">
              <div className="text-sm font-extrabold uppercase">Expertise véhicule</div>
              <div className="text-xs text-muted-foreground">État des lieux photo — possible sans OR</div>
            </div>
            <ChevronRight className="h-5 w-5" />
          </Link>
        ) : null}

        {(recent.data ?? []).length ? (
          <section className="space-y-2 pt-2">
            <h2 className="px-1 text-xs font-extrabold uppercase tracking-widest text-muted-foreground">OR récents</h2>
            {(recent.data ?? []).map((o) => (
              <Link key={o.id} to="/or/$orId" params={{ orId: o.id }} className="flex items-center justify-between rounded-xl border-2 border-border bg-card px-3 py-3">
                <span className="font-bold">OR {o.or_number}</span>
                <span className="text-xs text-muted-foreground">
                  {[formatPlate(o.vehicle?.plate ?? ""), siteName(o.site_id)].filter(Boolean).join(" · ")}
                </span>
              </Link>
            ))}
          </section>
        ) : null}

        <div className="flex flex-wrap gap-x-4 gap-y-1 px-1 pt-2 text-xs text-muted-foreground">
          {can("tour") ? <Link to="/tour-vehicule" className="underline">Tours véhicule (liste)</Link> : null}
          {can("maintenance") ? (
            <Link to="/maintenance" className="inline-flex items-center gap-1 underline">
              <Gauge className="h-3 w-3" /> Maintenance prédictive
            </Link>
          ) : null}
        </div>
      </div>
    </AppShell>
  );
}
