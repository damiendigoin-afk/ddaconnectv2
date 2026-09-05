/**
 * Communication — un seul site à la fois.
 * Bibliothèque, rotation 7 jours glissants, budget, rayon et statistiques
 * appartiennent au site sélectionné à l'entrée de la page.
 */
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Megaphone, Upload } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/lib/auth";
import { useSite } from "@/lib/site-context";
import {
  ROTATION_DAYS,
  assetUrl,
  currentRotation,
  fetchSettings,
  fetchSiteAssets,
  saveSettings,
  setAssetActive,
  startRotationIfNeeded,
  type SiteAdAsset,
} from "@/lib/communication-site";

export const Route = createFileRoute("/communication/")({
  head: () => ({
    meta: [
      { title: "Communication — Publicité locale par site DDA Connect" },
      {
        name: "description",
        content:
          "Visuels publicitaires d'un site : rotation automatique de 7 jours, budget, rayon de diffusion et résultats réels.",
      },
      { property: "og:title", content: "Communication — Publicité locale par site DDA Connect" },
      {
        property: "og:description",
        content: "Visuels, rotation 7 jours, budget et rayon de diffusion du site.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CommunicationPage,
});

const fmtDate = (d: Date | null) =>
  d ? d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" }) : "—";

function CommunicationPage() {
  const { user } = useAuth();
  const { sites, site, active, isGroup, setActive } = useSite();
  const siteId = isGroup ? "" : (site?.id ?? "");

  const assets = useQuery({
    queryKey: ["com-assets", siteId],
    queryFn: () => fetchSiteAssets(siteId),
    enabled: !!siteId,
  });
  const settings = useQuery({
    queryKey: ["com-settings", siteId],
    queryFn: () => fetchSettings(siteId),
    enabled: !!siteId,
  });

  const list = useMemo(() => (assets.data ?? []) as SiteAdAsset[], [assets.data]);
  const rotation = useMemo(() => currentRotation(list), [list]);

  const [currentUrl, setCurrentUrl] = useState<string | null>(null);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [budget, setBudget] = useState("");
  const [radius, setRadius] = useState("");
  const [gbp, setGbp] = useState("");

  useEffect(() => {
    setBudget(settings.data?.monthly_budget != null ? String(settings.data.monthly_budget) : "");
    setRadius(settings.data?.radius_km != null ? String(settings.data.radius_km) : "");
    setGbp(settings.data?.gbp_url ?? "");
  }, [settings.data]);

  useEffect(() => {
    const cur = rotation.current;
    if (!cur) {
      setCurrentUrl(null);
      return;
    }
    void assetUrl(cur.storage_path).then(setCurrentUrl);
    void startRotationIfNeeded(cur);
  }, [rotation.current?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let cancelled = false;
    void Promise.all(
      list.map(async (a) => [a.id, await assetUrl(a.storage_path)] as const),
    ).then((pairs) => {
      if (cancelled) return;
      const map: Record<string, string> = {};
      for (const [id, url] of pairs) if (url) map[id] = url;
      setThumbs(map);
    });
    return () => {
      cancelled = true;
    };
  }, [list]);

  async function add() {
    if (!file || !siteId) {
      toast.error("Choisissez une image.");
      return;
    }
    setBusy(true);
    try {
      await uploadImage(file, siteId, user?.id ?? null);
      setFile(null);
      toast.success("Visuel ajouté");
      await assets.refetch();
    } catch {
      toast.error("Ajout impossible : choisissez une image (JPG ou PNG).");
    } finally {
      setBusy(false);
    }
  }

  async function toggle(a: SiteAdAsset) {
    await setAssetActive(a.id, !a.active);
    await assets.refetch();
  }

  async function persistSettings() {
    if (!siteId) return;
    try {
      await saveSettings(
        {
          site_id: siteId,
          monthly_budget: budget.trim() ? Number(budget.replace(",", ".")) : null,
          radius_km: radius.trim() ? Number(radius) : null,
          gbp_url: gbp.trim() || null,
        },
        user?.id ?? null,
      );
      toast.success("Réglages du site enregistrés");
      await settings.refetch();
    } catch {
      toast.error("Enregistrement impossible.");
    }
  }

  if (!siteId) {
    return (
      <AppShell title="Communication" subtitle="Publicité locale" back={{ to: "/" }}>
        <section className="card-surface space-y-3 p-4">
          <h2 className="text-sm font-extrabold uppercase">Choisir le site</h2>
          <p className="text-xs text-muted-foreground">
            La communication se pilote site par site : visuels, rotation, budget, rayon et résultats
            sont propres à chaque garage.
          </p>
          {sites.map((s) => (
            <button
              key={s.id}
              onClick={() => setActive(s.id)}
              className="w-full rounded-lg border-2 border-border px-4 py-3 text-xs font-extrabold uppercase"
            >
              {s.name}
            </button>
          ))}
        </section>
      </AppShell>
    );
  }

  return (
    <AppShell title="Communication" subtitle={site?.name ?? active} back={{ to: "/" }}>
      <div className="space-y-4">
        <section className="card-surface space-y-3 p-4">
          <h2 className="flex items-center gap-2 text-sm font-extrabold uppercase">
            <Megaphone className="h-4 w-4 text-brand" /> Rotation en cours
          </h2>
          {rotation.current ? (
            <>
              {currentUrl ? (
                <img
                  src={currentUrl}
                  alt={`Visuel publicitaire diffusé pour ${site?.name ?? "le site"}`}
                  className="max-h-64 w-full rounded-lg border border-border object-contain"
                />
              ) : null}
              <p className="text-xs text-muted-foreground">
                Diffusion pendant {ROTATION_DAYS} jours, jusqu'au {fmtDate(rotation.endsAt)}. Le
                visuel suivant démarre automatiquement ensuite.
              </p>
            </>
          ) : (
            <p className="text-xs text-muted-foreground">
              Aucun visuel actif pour ce site : ajoutez une image ci-dessous.
            </p>
          )}
          {rotation.next.length ? (
            <div className="text-xs">
              <div className="font-extrabold uppercase">File des suivants</div>
              <ol className="mt-1 list-decimal space-y-0.5 pl-4 text-muted-foreground">
                {rotation.next.map((a) => (
                  <li key={a.id}>{a.file_name ?? a.title}</li>
                ))}
              </ol>
            </div>
          ) : null}
        </section>

        <section className="card-surface space-y-2 p-4">
          <h2 className="text-sm font-extrabold uppercase">Ajouter un visuel</h2>
          <label className="flex cursor-pointer items-center gap-2 rounded-lg border-2 border-dashed border-border px-3 py-3 text-xs font-bold uppercase">
            <Upload className="h-4 w-4 text-brand" />
            {file ? file.name : "Choisir une image"}
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </label>
          <button
            disabled={busy || !file}
            onClick={() => void add()}
            className="w-full rounded-lg bg-brand px-4 py-3 text-xs font-extrabold uppercase text-brand-foreground disabled:opacity-50"
          >
            Ajouter
          </button>
        </section>

        <section className="card-surface space-y-2 p-4">
          <h2 className="text-sm font-extrabold uppercase">Réglages du site</h2>
          <label className="block text-xs text-muted-foreground">
            Budget mensuel (€)
            <input
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
              inputMode="decimal"
              placeholder="montant libre"
              className="mt-1 w-full rounded-lg border-2 border-border px-3 py-2 text-sm text-foreground"
            />
          </label>
          <label className="block text-xs text-muted-foreground">
            Rayon de diffusion (km)
            <input
              value={radius}
              onChange={(e) => setRadius(e.target.value)}
              inputMode="numeric"
              className="mt-1 w-full rounded-lg border-2 border-border px-3 py-2 text-sm text-foreground"
            />
          </label>
          <label className="block text-xs text-muted-foreground">
            Fiche Google Business du site (destination au clic)
            <input
              value={gbp}
              onChange={(e) => setGbp(e.target.value)}
              placeholder="https://…"
              className="mt-1 w-full rounded-lg border-2 border-border px-3 py-2 text-sm text-foreground"
            />
          </label>
          <button
            onClick={() => void persistSettings()}
            className="w-full rounded-lg border-2 border-border px-4 py-3 text-xs font-extrabold uppercase"
          >
            Enregistrer
          </button>
          <p className="text-[11px] text-muted-foreground">
            Toutes les publicités de ce site renvoient vers cette fiche. Les commentaires reçus
            restent sur Facebook et Instagram.
          </p>
        </section>

        <section className="card-surface space-y-2 p-4">
          <h2 className="text-sm font-extrabold uppercase">Résultats</h2>
          <p className="text-xs text-muted-foreground">
            Dépense, portée, clics, appels et itinéraires s'afficheront ici une fois les comptes
            Meta et Google Business reliés dans Paramètres API. Aucun chiffre n'est estimé :
            actuellement indisponible — comptes non connectés.
          </p>
        </section>

        <section className="card-surface space-y-2 p-4">
          <h2 className="text-sm font-extrabold uppercase">Visuels du site ({list.length})</h2>
          {list.map((a) => (
            <div key={a.id} className="flex items-center gap-3 border-t border-border pt-2 text-xs">
              {thumbs[a.id] ? (
                <img
                  src={thumbs[a.id]}
                  alt={`Aperçu du visuel ${a.file_name ?? a.title}`}
                  className="h-16 w-24 rounded border border-border object-cover"
                />
              ) : (
                <div className="h-16 w-24 rounded border border-dashed border-border" />
              )}
              <div className="flex-1">
                <div className="font-extrabold">{a.file_name ?? a.title}</div>
                <div className="text-muted-foreground">
                  {a.active ? "Dans la rotation" : "Hors rotation"}
                  {a.started_at ? ` · lancé le ${fmtDate(new Date(a.started_at))}` : ""}
                </div>
              </div>
              <button
                onClick={() => void toggle(a)}
                className={`rounded-lg px-3 py-2 font-extrabold uppercase ${
                  a.active ? "bg-brand text-brand-foreground" : "border-2 border-border"
                }`}
              >
                {a.active ? "Actif" : "Désactivé"}
              </button>
            </div>
          ))}
          {!list.length ? <p className="text-xs text-muted-foreground">Aucun visuel enregistré.</p> : null}
        </section>
      </div>
    </AppShell>
  );
}

async function uploadImage(file: File, siteId: string, userId: string | null) {
  const { uploadSiteAsset } = await import("@/lib/communication-site");
  await uploadSiteAsset({ file, siteId, userId });
}
