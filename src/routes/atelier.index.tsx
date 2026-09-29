import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { localDocText } from "@/lib/doc-text.browser";
import { orScanNeedsRetry } from "@/lib/doc-rules";
import { useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Camera, ChevronRight, CircleDot, ClipboardCheck, Gauge, Search, History, Loader2 } from "lucide-react";

import { AppShell } from "@/components/AppShell";
import { supabase } from "@/integrations/supabase/client";
import { useModuleAccess } from "@/lib/module-access";
import { useSite } from "@/lib/site-context";
import { formatPlate } from "@/lib/plate";
import { compressImage, blobToDataUrl } from "@/lib/photo";
import { ocrRepairOrder } from "@/lib/ocr.functions";
import {
  CONFLICT_LABELS,
  decideOrScan,
  interpretEnsure,
  isWinmotorOrNumber,
  parseRepairOrderScan,
  type DossierConflict,
  type DossierData,
} from "@/lib/or-scan-decision";
import { applyDossierConflict, ensureWinmotorDossier } from "@/lib/or-dossier";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";

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
  const { sites, site } = useSite();
  const { displayName } = useAuth();
  const siteName = (id: string | null) => sites.find((s) => s.id === id)?.name ?? null;
  const [orNum, setOrNum] = useState("");
  const [orNote, setOrNote] = useState<string | null>(null);
  const [needPlate, setNeedPlate] = useState(false);
  const [plateIn, setPlateIn] = useState("");
  const [lastScan, setLastScan] = useState<ReturnType<typeof parseRepairOrderScan> | null>(null);
  const [conflicts, setConflicts] = useState<{ orId: string; items: DossierConflict[] } | null>(null);
  const [scanning, setScanning] = useState(false);
  const cameraRef = useRef<HTMLInputElement>(null);

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

  async function ensureAndOpen(orNumber: string, plate: string | null, data: DossierData | null) {
    const r = await ensureWinmotorDossier({ siteId: site?.id ?? null, orNumber, plate, data, userName: displayName || null });
    const a = interpretEnsure(orNumber, r);
    if (a.kind === "open") {
      if (a.created) toast.success(`Fiche dossier OR WinMotor ${orNumber} créée`);
      setNeedPlate(false);
      if (r.conflicts?.length) {
        // Lecture différente d'une donnée existante : jamais d'écrasement silencieux.
        setConflicts({ orId: a.orId, items: r.conflicts });
        return;
      }
      navigate({ to: "/or/$orId", params: { orId: a.orId } });
      return;
    }
    if (a.kind === "needs_plate") setNeedPlate(true);
    setOrNote(a.note);
  }

  async function openOr() {
    const n = orNum.trim();
    if (!n) return;
    setOrNote(null);
    if (!isWinmotorOrNumber(n)) {
      setOrNote("Numéro d'OR WinMotor invalide (3 à 8 chiffres).");
      return;
    }
    setScanning(true);
    try {
      const data = lastScan && lastScan.or_number === n ? lastScan.data : null;
      await ensureAndOpen(n, needPlate && plateIn.trim() ? plateIn.trim() : null, data);
    } finally {
      setScanning(false);
    }
  }

  async function scanPhoto(file: File) {
    setScanning(true);
    setOrNote(null);
    setConflicts(null);
    try {
      const blob = await compressImage(file, 1800, 0.9);
      const dataUrl = await blobToDataUrl(blob);
      // Lecture complète de l'OR papier (comme la V2) : OCR/règles d'abord, IA seulement si autorisée.
      const res = await ocrRepairOrder({ data: { text: await localDocText(dataUrl), dataUrl } });
      if (!res.ok) {
        setOrNote(`${res.error} Saisissez le numéro manuellement.`);
        return;
      }
      const scan = parseRepairOrderScan(res.json);
      const plate = scan.plate ? formatPlate(scan.plate) : null;
      setLastScan(scan);
      if (scan.or_number) setOrNum(scan.or_number);
      if (plate) setPlateIn(plate);
      const d = decideOrScan({ or_number: scan.or_number, plate });
      if (d.kind === "ensure") await ensureAndOpen(d.or_number, d.plate, scan.data);
      else if (d.kind === "plate") navigate({ to: "/scan-plaque", search: { plate: d.plate, note: d.note ?? undefined } });
      else setOrNote(d.note);
    } catch (e) {
      console.error(e);
      setOrNote("Analyse impossible. Saisissez le numéro manuellement.");
    } finally {
      setScanning(false);
    }
  }

  const cls = "flex items-center gap-4 rounded-xl border-2 border-border bg-card px-4 py-4 active:scale-[0.99]";

  return (
    <AppShell title="Atelier" back={{ to: "/" }}>
      <div className="space-y-3">
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
              <button type="submit" className="shrink-0 rounded-lg bg-primary px-4 font-bold uppercase text-primary-foreground" aria-label="Ouvrir l'OR">
                <Search className="h-5 w-5" />
              </button>
              <label
                htmlFor="atelier-or-camera"
                aria-disabled={scanning}
                className={`flex shrink-0 cursor-pointer items-center rounded-lg bg-brand px-4 text-brand-foreground ${scanning ? "pointer-events-none opacity-60" : ""}`}
                aria-label="Photographier un OR ou une plaque"
              >
                {scanning ? <Loader2 className="h-5 w-5 animate-spin" /> : <Camera className="h-5 w-5" />}
              </label>
              <input
                id="atelier-or-camera"
                ref={cameraRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="sr-only"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) void scanPhoto(f);
                }}
              />
            </div>
            {needPlate ? (
              <input
                value={plateIn}
                onChange={(e) => setPlateIn(e.target.value.toUpperCase())}
                placeholder="Immatriculation (ex. AB-123-CD)"
                aria-label="Immatriculation du véhicule"
                className="w-full rounded-lg border-2 border-border bg-card px-3 py-3 text-base uppercase outline-none focus:border-brand"
              />
            ) : null}
            {orNote ? <p className="text-xs text-muted-foreground">{orNote}</p> : null}
          </form>
        ) : null}

        {conflicts ? (
          <div className="card-surface space-y-2 p-4">
            <p className="text-sm font-bold">Lecture différente de la fiche existante</p>
            <p className="text-xs text-muted-foreground">Rien n'a été remplacé. Choisissez pour chaque donnée.</p>
            {conflicts.items.map((c, i) => (
              <div key={`${c.entity}-${c.field}`} className="rounded-lg border border-border p-2 text-xs">
                <div className="font-bold">{CONFLICT_LABELS[c.field] ?? c.field}</div>
                <div>Fiche : {c.current || "—"}</div>
                <div>Lu sur l'OR : {c.read || "—"}</div>
                {c.field !== "plate" ? (
                  <button
                    type="button"
                    className="mt-1 rounded-md bg-secondary px-2 py-1 font-bold"
                    onClick={async () => {
                      if (await applyDossierConflict(c)) {
                        toast.success("Donnée mise à jour");
                        setConflicts((s) => (s ? { ...s, items: s.items.filter((_, j) => j !== i) } : s));
                      } else toast.error("Mise à jour impossible");
                    }}
                  >
                    Remplacer par la lecture
                  </button>
                ) : null}
              </div>
            ))}
            <button
              type="button"
              className="w-full rounded-lg bg-primary px-4 py-3 font-bold uppercase text-primary-foreground"
              onClick={() => navigate({ to: "/or/$orId", params: { orId: conflicts.orId } })}
            >
              Garder le reste et ouvrir le dossier
            </button>
          </div>
        ) : null}

        {can("tour") ? (
          <Link to="/tours" className={cls}>
            <History className="h-6 w-6 shrink-0 text-brand" />
            <div className="flex-1">
              <div className="text-sm font-extrabold uppercase">Tours du véhicule</div>
              <div className="text-xs text-muted-foreground">Derniers tours clôturés, du plus récent au plus ancien</div>
            </div>
            <ChevronRight className="h-5 w-5" />
          </Link>
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
