import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Megaphone, Upload } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/lib/auth";
import {
  AD_BRANDS,
  adUrl,
  fetchAdAssets,
  isRunning,
  markShown,
  nextInRotation,
  updateAdAsset,
  uploadAdAsset,
  type AdAsset,
  type AdBrand,
} from "@/lib/communication";

export const Route = createFileRoute("/communication/")({
  head: () => ({
    meta: [
      { title: "Communication — Bibliothèque publicitaire DDA Connect" },
      {
        name: "description",
        content:
          "Bibliothèque des supports publicitaires Renault et Dacia : ajout, période de diffusion, activation et rotation linéaire.",
      },
      { property: "og:title", content: "Communication — Bibliothèque publicitaire DDA Connect" },
      { property: "og:description", content: "Supports publicitaires du garage et rotation d'affichage." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CommunicationPage,
});

function CommunicationPage() {
  const { user, displayName } = useAuth();
  const [showArchived, setShowArchived] = useState(false);
  const assets = useQuery({
    queryKey: ["ad-assets", showArchived],
    queryFn: () => fetchAdAssets(showArchived),
  });
  const list = useMemo(() => assets.data ?? [], [assets.data]);

  const [title, setTitle] = useState("");
  const [brand, setBrand] = useState<AdBrand>("renault");
  const [startsOn, setStartsOn] = useState("");
  const [endsOn, setEndsOn] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  const [current, setCurrent] = useState<AdAsset | null>(null);
  const [currentUrl, setCurrentUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!list.length) {
      setCurrent(null);
      return;
    }
    setCurrent((c) => c ?? nextInRotation(list));
  }, [list]);

  useEffect(() => {
    if (!current) {
      setCurrentUrl(null);
      return;
    }
    void adUrl(current.storage_path).then(setCurrentUrl);
  }, [current]);

  async function add() {
    if (!file || !title.trim()) {
      toast.error("Titre et fichier obligatoires.");
      return;
    }
    setBusy(true);
    try {
      await uploadAdAsset({
        file,
        title: title.trim(),
        brand,
        startsOn: startsOn || null,
        endsOn: endsOn || null,
        userId: user?.id ?? null,
        userName: displayName ?? null,
      });
      setTitle("");
      setFile(null);
      setStartsOn("");
      setEndsOn("");
      toast.success("Support ajouté");
      await assets.refetch();
    } catch {
      toast.error("Ajout impossible : vérifiez le fichier.");
    } finally {
      setBusy(false);
    }
  }

  async function patch(a: AdAsset, p: Partial<AdAsset>) {
    await updateAdAsset(a.id, p);
    await assets.refetch();
  }

  async function rotate() {
    if (current) await markShown(current);
    const refreshed = await assets.refetch();
    const fresh = refreshed.data ?? [];
    setCurrent(nextInRotation(fresh));
  }

  return (
    <AppShell title="Communication" subtitle="Bibliothèque publicitaire" back={{ to: "/" }}>
      <div className="space-y-4">
        <section className="card-surface space-y-3 p-4">
          <h2 className="flex items-center gap-2 text-sm font-extrabold uppercase">
            <Megaphone className="h-4 w-4 text-brand" /> Rotation en cours
          </h2>
          {current ? (
            <>
              {currentUrl && (current.mime_type ?? "").startsWith("image/") ? (
                <img
                  src={currentUrl}
                  alt={`Support publicitaire ${current.title}`}
                  className="max-h-64 w-full rounded-lg border border-border object-contain"
                />
              ) : currentUrl ? (
                <a href={currentUrl} target="_blank" rel="noopener" className="text-sm font-bold text-brand underline">
                  Ouvrir « {current.title} »
                </a>
              ) : null}
              <p className="text-xs text-muted-foreground">
                {current.title} · {current.brand} · diffusé {current.shown_count} fois
              </p>
            </>
          ) : (
            <p className="text-xs text-muted-foreground">Aucun support actif dans sa période de diffusion.</p>
          )}
          <button
            onClick={() => void rotate()}
            className="w-full rounded-lg border-2 border-border px-4 py-3 text-xs font-extrabold uppercase"
          >
            Support suivant
          </button>
        </section>

        <section className="card-surface space-y-2 p-4">
          <h2 className="text-sm font-extrabold uppercase">Ajouter un support</h2>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Titre du support"
            className="w-full rounded-lg border-2 border-border px-3 py-2 text-sm"
          />
          <div className="flex gap-2">
            {AD_BRANDS.map((b) => (
              <button
                key={b.key}
                onClick={() => setBrand(b.key)}
                className={`flex-1 rounded-lg px-3 py-2 text-xs font-extrabold uppercase ${
                  brand === b.key ? "bg-brand text-brand-foreground" : "border-2 border-border"
                }`}
              >
                {b.label}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs text-muted-foreground">
              Début (facultatif)
              <input
                type="date"
                value={startsOn}
                onChange={(e) => setStartsOn(e.target.value)}
                className="mt-1 w-full rounded-lg border-2 border-border px-2 py-2 text-sm"
              />
            </label>
            <label className="text-xs text-muted-foreground">
              Fin (facultatif)
              <input
                type="date"
                value={endsOn}
                onChange={(e) => setEndsOn(e.target.value)}
                className="mt-1 w-full rounded-lg border-2 border-border px-2 py-2 text-sm"
              />
            </label>
          </div>
          <label className="flex cursor-pointer items-center gap-2 rounded-lg border-2 border-dashed border-border px-3 py-3 text-xs font-bold uppercase">
            <Upload className="h-4 w-4 text-brand" />
            {file ? file.name : "Choisir un PDF ou une image"}
            <input
              type="file"
              accept="application/pdf,image/*"
              className="hidden"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </label>
          <button
            disabled={busy}
            onClick={() => void add()}
            className="w-full rounded-lg bg-brand px-4 py-3 text-xs font-extrabold uppercase text-brand-foreground disabled:opacity-50"
          >
            Ajouter le support
          </button>
        </section>

        <section className="card-surface space-y-2 p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-extrabold uppercase">Supports ({list.length})</h2>
            <button
              onClick={() => setShowArchived((v) => !v)}
              className="text-xs font-bold uppercase text-muted-foreground underline"
            >
              {showArchived ? "Masquer archivés" : "Voir archivés"}
            </button>
          </div>
          {list.map((a) => (
            <div key={a.id} className="space-y-2 border-t border-border pt-2 text-xs">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="font-extrabold uppercase">{a.title}</div>
                  <div className="text-muted-foreground">
                    {a.brand} · {a.starts_on ?? "—"} → {a.ends_on ?? "—"} ·{" "}
                    {a.archived ? "archivé" : isRunning(a) ? "en diffusion" : "hors diffusion"}
                  </div>
                </div>
                <button
                  onClick={() => void patch(a, { active: !a.active })}
                  className={`rounded-lg px-3 py-2 font-extrabold uppercase ${
                    a.active ? "bg-brand text-brand-foreground" : "border-2 border-border"
                  }`}
                >
                  {a.active ? "Actif" : "Inactif"}
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                <input
                  defaultValue={a.title}
                  onBlur={(e) => {
                    const v = e.target.value.trim();
                    if (v && v !== a.title) void patch(a, { title: v });
                  }}
                  className="min-w-[8rem] flex-1 rounded border border-border px-2 py-1"
                  aria-label={`Titre de ${a.title}`}
                />
                <select
                  defaultValue={a.brand}
                  onChange={(e) => void patch(a, { brand: e.target.value })}
                  className="rounded border border-border px-2 py-1"
                  aria-label={`Marque de ${a.title}`}
                >
                  {AD_BRANDS.map((b) => (
                    <option key={b.key} value={b.key}>
                      {b.label}
                    </option>
                  ))}
                </select>
                <input
                  type="date"
                  defaultValue={a.starts_on ?? ""}
                  onChange={(e) => void patch(a, { starts_on: e.target.value || null })}
                  className="rounded border border-border px-2 py-1"
                  aria-label={`Début de ${a.title}`}
                />
                <input
                  type="date"
                  defaultValue={a.ends_on ?? ""}
                  onChange={(e) => void patch(a, { ends_on: e.target.value || null })}
                  className="rounded border border-border px-2 py-1"
                  aria-label={`Fin de ${a.title}`}
                />
                <button
                  onClick={() => void patch(a, { archived: !a.archived })}
                  className="rounded border border-border px-2 py-1 font-bold uppercase"
                >
                  {a.archived ? "Restaurer" : "Archiver"}
                </button>
              </div>
            </div>
          ))}
          {!list.length ? <p className="text-xs text-muted-foreground">Aucun support enregistré.</p> : null}
        </section>
      </div>
    </AppShell>
  );
}
