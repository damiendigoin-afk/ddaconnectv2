import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Camera, Check, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
import { MediaThumb } from "@/components/PhotoManager";
import { PhotoAnnotator } from "@/components/PhotoAnnotator";
import { BurstCamera, type BurstShot } from "@/components/BurstCamera";
import { useAuth } from "@/lib/auth";
import {
  CONDITIONS,
  DAMAGE_TYPES,
  ELEMENT_SIZES,
  EXTERIOR_STEPS,
  INTERVENTIONS,
  KEYS_OPTIONS,
  MILEAGE_STEP,
  REG_DOC_OPTIONS,
  STEPS,
  VEHICLE_ZONES,
  addDamage,
  deleteDamage,
  deleteExpertisePhoto,
  euro,
  fetchExpertise,
  fetchPriceRules,
  guidedPhotoSteps,
  interiorSteps,
  suggestCost,
  totals,
  updateDamage,
  updateExpertise,
  uploadExpertisePhoto,
  type Annotation,
  type ExpertiseDamage,
  type ExpertisePhoto,
  type PhotoStep,
  type PriceRule,
} from "@/lib/expertise";
import { ocrOdometer } from "@/lib/ocr.functions";
import { blobToDataUrl, compressImage } from "@/lib/photo";

export const Route = createFileRoute("/expertise/$exId/")({
  head: () => ({
    meta: [
      { title: "Expertise en cours — DDA Connect" },
      {
        name: "description",
        content:
          "Parcours photo guidé, état général et relevé des dommages chiffrés d'une expertise véhicule.",
      },
      { property: "og:title", content: "Expertise en cours — DDA Connect" },
      {
        property: "og:description",
        content: "Parcours photo guidé et relevé des dommages du véhicule.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ExpertiseRunner,
});

function Field({
  label,
  value,
  onSave,
  type = "text",
}: {
  label: string;
  value: string;
  onSave: (v: string) => void;
  type?: string;
}) {
  const [local, setLocal] = useState(value);
  useEffect(() => setLocal(value), [value]);
  return (
    <label className="block text-xs font-bold uppercase tracking-wide text-muted-foreground">
      {label}
      <input
        type={type}
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={() => local !== value && onSave(local)}
        className="mt-1 w-full rounded-lg border-2 border-border bg-background px-3 py-3 text-base font-semibold text-foreground"
      />
    </label>
  );
}

function Choice({
  options,
  value,
  onChange,
}: {
  options: readonly { key: string; label: string }[] | readonly string[];
  value: string | null;
  onChange: (v: string) => void;
}) {
  const norm = options.map((o) => (typeof o === "string" ? { key: o, label: o } : o));
  return (
    <div className="flex flex-wrap gap-2">
      {norm.map((o) => (
        <button
          key={o.key}
          type="button"
          onClick={() => onChange(o.key)}
          className={`rounded-lg border-2 px-3 py-2.5 text-sm font-bold ${
            value === o.key ? "border-brand bg-brand/10" : "border-border bg-card"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function ExpertiseRunner() {
  const { exId } = Route.useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const q = useQuery({ queryKey: ["expertise", exId], queryFn: () => fetchExpertise({ id: exId }) });
  const rules = useQuery({ queryKey: ["price-rules"], queryFn: fetchPriceRules });
  const [stepIdx, setStepIdx] = useState(0);
  const [busy, setBusy] = useState(false);
  const [burstOpen, setBurstOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState({ done: 0, total: 0 });

  const e = q.data?.expertise;
  const photos = q.data?.photos ?? [];
  const damages = q.data?.damages ?? [];

  useEffect(() => {
    if (!e) return;
    const i = STEPS.findIndex((s) => s.key === e.step);
    if (i > 0) setStepIdx(i);
  }, [e?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function patch(p: Record<string, unknown>) {
    if (!e) return;
    await updateExpertise(e.id, p);
    await q.refetch();
  }

  async function goTo(i: number) {
    const clamped = Math.max(0, Math.min(STEPS.length - 1, i));
    setStepIdx(clamped);
    if (e) await updateExpertise(e.id, { step: STEPS[clamped]!.key });
  }

  if (q.isLoading || !e) {
    return (
      <AppShell title="Expertise" back={{ to: "/expertises" }}>
        <p className="text-sm text-muted-foreground">Chargement…</p>
      </AppShell>
    );
  }

  const step = STEPS[stepIdx]!;
  const interior = interiorSteps(null);
  const guidedDefs = new Map<string, PhotoStep & { sequence: number }>();
  guidedDefs.set(MILEAGE_STEP.key, { ...MILEAGE_STEP, sequence: 0 });
  EXTERIOR_STEPS.forEach((s2, i) => guidedDefs.set(s2.key, { ...s2, sequence: i + 1 }));
  interior.forEach((s2, i) => guidedDefs.set(s2.key, { ...s2, sequence: i + 1 }));

  async function handleGuidedFinish(shots: BurstShot[]) {
    setBurstOpen(false);
    setUploading(true);
    setUploadProgress({ done: 0, total: shots.length });
    try {
      let detectedMileage: number | null = null;
      for (let i = 0; i < shots.length; i++) {
        const shot = shots[i]!;
        const def = guidedDefs.get(shot.key);
        const compressed = await compressImage(
          new File([shot.blob], "p.jpg", { type: "image/jpeg" }),
          1800,
          0.85,
        );
        await uploadExpertisePhoto({
          expertiseId: e!.id,
          file: compressed,
          photoType: shot.key,
          category: def?.category ?? "complementaire",
          label: def?.label ?? shot.label,
          sequence: def?.sequence ?? 300 + i,
          required: def?.required ?? false,
        });
        if (shot.key === "compteur") {
          try {
            const res = await ocrOdometer({ data: { dataUrl: shot.dataUrl, filename: "compteur.jpg" } });
            if (res.ok) detectedMileage = res.mileage;
          } catch (err) {
            console.error(err);
          }
        }
        setUploadProgress({ done: i + 1, total: shots.length });
      }
      if (detectedMileage != null) await patch({ mileage: detectedMileage });
      await q.refetch();
      toast.success("Reportage photo enregistré.");
      const etatIdx = STEPS.findIndex((s2) => s2.key === "etat");
      if (etatIdx >= 0) await goTo(etatIdx);
    } catch (err) {
      console.error(err);
      toast.error("Échec de l'envoi du reportage.");
    } finally {
      setUploading(false);
    }
  }

  if (burstOpen) {
    return (
      <BurstCamera
        title="Reportage photo expertise"
        steps={[...guidedDefs.values()].map((d) => ({ key: d.key, label: d.label, ...(d.mask ? { mask: d.mask } : {}) }))}
        onFinish={(shots) => void handleGuidedFinish(shots)}
        onCancel={() => setBurstOpen(false)}
      />
    );
  }

  return (
    <AppShell
      title={`Expertise ${e.plate ?? ""}`}
      subtitle={step.label}
      back={{ to: "/expertises" }}
    >
      <div className="mb-4 flex gap-1 overflow-x-auto pb-1">
        {STEPS.map((s, i) => (
          <button
            key={s.key}
            onClick={() => void goTo(i)}
            className={`whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-bold uppercase ${
              i === stepIdx ? "bg-brand text-brand-foreground" : "bg-secondary text-muted-foreground"
            }`}
          >
            {i + 1}. {s.label}
          </button>
        ))}
      </div>

      {step.key === "identite" ? (
        <section className="card-surface space-y-3 p-4">
          <Field label="Immatriculation" value={e.plate ?? ""} onSave={(v) => void patch({ plate: v })} />
          <div className="grid grid-cols-2 gap-3">
            <Field label="Marque" value={e.brand ?? ""} onSave={(v) => void patch({ brand: v })} />
            <Field label="Modèle" value={e.model ?? ""} onSave={(v) => void patch({ model: v })} />
          </div>
          <Field label="Version / finition" value={e.version ?? ""} onSave={(v) => void patch({ version: v })} />
          <Field label="VIN" value={e.vin ?? ""} onSave={(v) => void patch({ vin: v })} />
          <div className="grid grid-cols-2 gap-3">
            <Field
              label="1re immatriculation"
              type="date"
              value={e.first_registration ?? ""}
              onSave={(v) => void patch({ first_registration: v || null })}
            />
            <Field label="Énergie" value={e.energy ?? ""} onSave={(v) => void patch({ energy: v })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Couleur" value={e.color ?? ""} onSave={(v) => void patch({ color: v })} />
            <Field
              label="Propriétaire"
              value={e.owner_name ?? ""}
              onSave={(v) => void patch({ owner_name: v })}
            />
          </div>
          <div>
            <p className="pb-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">
              Nombre de clés
            </p>
            <Choice options={KEYS_OPTIONS} value={e.keys_count} onChange={(v) => void patch({ keys_count: v })} />
          </div>
          <div>
            <p className="pb-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">
              Carte grise
            </p>
            <Choice
              options={REG_DOC_OPTIONS}
              value={e.registration_doc}
              onChange={(v) => void patch({ registration_doc: v })}
            />
          </div>
        </section>
      ) : null}

      {uploading ? (
        <div className="card-surface mb-3 flex items-center gap-3 p-4">
          <Loader2 className="h-5 w-5 animate-spin" />
          <p className="text-sm font-bold">
            Envoi des photos… {uploadProgress.done}/{uploadProgress.total}
          </p>
        </div>
      ) : null}

      {step.key === "compteur" ? (
        <div className="space-y-3">
          <button
            type="button"
            onClick={() => setBurstOpen(true)}
            disabled={uploading}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand px-4 py-4 text-sm font-extrabold uppercase text-brand-foreground disabled:opacity-60"
          >
            <Camera className="h-4 w-4" /> Lancer le reportage photo complet
          </button>
          <MileageStep
            expertiseId={e.id}
            mileage={e.mileage}
            photo={photos.find((p) => p.photo_type === "compteur") ?? null}
            onChange={() => void q.refetch()}
            onMileage={(m) => void patch({ mileage: m })}
          />
        </div>
      ) : null}

      {step.key === "exterieur" || step.key === "interieur" ? (
        <PhotoTour
          expertiseId={e.id}
          steps={step.key === "exterieur" ? EXTERIOR_STEPS : interior}
          photos={photos}
          onChange={() => void q.refetch()}
        />
      ) : null}

      {step.key === "etat" ? (
        <section className="card-surface space-y-4 p-4">
          <div>
            <p className="pb-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">
              État extérieur
            </p>
            <Choice
              options={CONDITIONS}
              value={e.exterior_condition}
              onChange={(v) => void patch({ exterior_condition: v })}
            />
          </div>
          <div>
            <p className="pb-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">
              État intérieur
            </p>
            <Choice
              options={CONDITIONS}
              value={e.interior_condition}
              onChange={(v) => void patch({ interior_condition: v })}
            />
          </div>
          <label className="block text-xs font-bold uppercase tracking-wide text-muted-foreground">
            Commentaire général
            <textarea
              defaultValue={e.general_comment ?? ""}
              rows={4}
              onBlur={(ev) => void patch({ general_comment: ev.target.value })}
              className="mt-1 w-full rounded-lg border-2 border-border bg-background px-3 py-3 text-base font-medium text-foreground"
            />
          </label>
        </section>
      ) : null}

      {step.key === "dommages" ? (
        <DamagesStep
          expertiseId={e.id}
          damages={damages}
          photos={photos}
          userId={user?.id ?? null}
          rules={rules.data ?? []}
          onChange={() => void q.refetch()}
        />
      ) : null}

      {step.key === "valorisation" ? (
        <section className="card-surface space-y-3 p-4">
          <div className="rounded-xl bg-secondary p-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="uppercase text-muted-foreground">Remises en état</span>
              <span className="font-extrabold">{euro(totals(damages).total)}</span>
            </div>
            {totals(damages).pending > 0 ? (
              <p className="pt-1 text-xs text-muted-foreground">
                {totals(damages).pending} poste(s) restant à chiffrer.
              </p>
            ) : null}
          </div>
          <Field
            label="Valeur marché estimée (€)"
            type="number"
            value={e.market_value != null ? String(e.market_value) : ""}
            onSave={(v) => void patch({ market_value: v === "" ? null : Number(v) })}
          />
          <Field
            label="Proposition de reprise (€)"
            type="number"
            value={e.buyback_value != null ? String(e.buyback_value) : ""}
            onSave={(v) => void patch({ buyback_value: v === "" ? null : Number(v) })}
          />
          {e.market_value != null ? (
            <p className="text-xs text-muted-foreground">
              Valeur marché diminuée des remises en état :{" "}
              <span className="font-bold text-foreground">
                {euro(Math.max(0, Number(e.market_value) - totals(damages).total))}
              </span>
            </p>
          ) : null}
          <label className="block text-xs font-bold uppercase tracking-wide text-muted-foreground">
            Commentaire de valorisation
            <textarea
              defaultValue={e.valuation_comment ?? ""}
              rows={3}
              onBlur={(ev) => void patch({ valuation_comment: ev.target.value })}
              className="mt-1 w-full rounded-lg border-2 border-border bg-background px-3 py-3 text-base font-medium text-foreground"
            />
          </label>
        </section>
      ) : null}

      <div className="mt-6 grid grid-cols-2 gap-2">
        <button
          onClick={() => void goTo(stepIdx - 1)}
          disabled={stepIdx === 0}
          className="rounded-xl border-2 border-border bg-card px-4 py-4 text-sm font-bold uppercase disabled:opacity-40"
        >
          Précédent
        </button>
        {stepIdx < STEPS.length - 1 ? (
          <button
            onClick={() => void goTo(stepIdx + 1)}
            className="rounded-xl bg-brand px-4 py-4 text-sm font-extrabold uppercase text-brand-foreground"
          >
            Suivant
          </button>
        ) : (
          <button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await updateExpertise(e.id, {
                  status: e.status === "sent" ? "sent" : "completed",
                  completed_at: new Date().toISOString(),
                });
                await navigate({ to: "/expertise/$exId/rapport", params: { exId: e.id } });
              } finally {
                setBusy(false);
              }
            }}
            className="flex items-center justify-center gap-2 rounded-xl bg-brand px-4 py-4 text-sm font-extrabold uppercase text-brand-foreground disabled:opacity-60"
          >
            <Check className="h-4 w-4" /> Terminer
          </button>
        )}
      </div>
      {step.key === "dommages" ? (
        <p className="pt-3 text-center text-sm font-bold">
          Total estimé : <span className="text-brand">{euro(totals(damages).total)}</span>
        </p>
      ) : null}
    </AppShell>
  );
}

/* ------------------------------- Compteur ------------------------------- */

function MileageStep({
  expertiseId,
  mileage,
  photo,
  onChange,
  onMileage,
}: {
  expertiseId: string;
  mileage: number | null;
  photo: ExpertisePhoto | null;
  onChange: () => void;
  onMileage: (m: number) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function capture(file: File) {
    setBusy(true);
    try {
      const compressed = await compressImage(file, 1600, 0.85);
      await uploadExpertisePhoto({
        expertiseId,
        file: compressed,
        photoType: "compteur",
        category: "exterieur",
        label: "Compteur kilométrique",
        sequence: 0,
        required: true,
      });
      const dataUrl = await blobToDataUrl(compressed);
      const res = await ocrOdometer({ data: { dataUrl, filename: file.name } });
      if (res.ok) {
        onMileage(res.mileage);
        toast.success(`Kilométrage détecté : ${res.mileage.toLocaleString("fr-FR")} km`);
      } else {
        toast.message("Photo enregistrée, saisissez le kilométrage manuellement.");
      }
      onChange();
    } catch (err) {
      console.error(err);
      toast.error("Échec de l'enregistrement de la photo.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card-surface space-y-3 p-4">
      <p className="text-sm text-muted-foreground">
        La photo du compteur est obligatoire : elle justifie le kilométrage relevé.
      </p>
      {photo ? (
        <MediaThumb path={photo.storage_path} className="w-full rounded-lg object-cover" />
      ) : null}
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        disabled={busy}
        className="flex w-full items-center justify-center gap-2 rounded-lg border-2 border-border bg-card px-3 py-3 text-sm font-bold uppercase"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
        {photo ? "Reprendre la photo" : "Photo du compteur"}
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(ev) => {
          const f = ev.target.files?.[0];
          if (f) void capture(f);
          ev.target.value = "";
        }}
      />
      <Field
        label="Kilométrage (km)"
        type="number"
        value={mileage != null ? String(mileage) : ""}
        onSave={(v) => onMileage(Number(v) || 0)}
      />
    </section>
  );
}

/* ------------------------------ Parcours photo ------------------------------ */

function PhotoTour({
  expertiseId,
  steps,
  photos,
  onChange,
}: {
  expertiseId: string;
  steps: PhotoStep[];
  photos: ExpertisePhoto[];
  onChange: () => void;
}) {
  const [busyKey, setBusyKey] = useState("");
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});

  async function capture(stepDef: PhotoStep, index: number, file: File) {
    setBusyKey(stepDef.key);
    try {
      const compressed = await compressImage(file, 1800, 0.85);
      await uploadExpertisePhoto({
        expertiseId,
        file: compressed,
        photoType: stepDef.key,
        category: stepDef.category,
        label: stepDef.label,
        sequence: index + 1,
        required: stepDef.required,
      });
      onChange();
    } catch (err) {
      console.error(err);
      toast.error("Échec de l'envoi de la photo.");
    } finally {
      setBusyKey("");
    }
  }

  const done = steps.filter((s) => photos.some((p) => p.photo_type === s.key)).length;

  return (
    <section className="space-y-3">
      <p className="px-1 text-sm font-bold">
        {done}/{steps.length} vues réalisées
      </p>
      {steps.map((s, i) => {
        const existing = photos.find((p) => p.photo_type === s.key);
        return (
          <div key={s.key} className="card-surface p-4">
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="text-sm font-extrabold uppercase">
                  {i + 1}. {s.label}
                  {s.required ? <span className="text-brand"> *</span> : null}
                </div>
                <div className="text-xs text-muted-foreground">{s.hint}</div>
              </div>
              {existing ? <Check className="h-5 w-5 text-status-ok" /> : null}
            </div>
            {existing ? (
              <div className="mt-3 flex items-start gap-2">
                <MediaThumb
                  path={existing.report_path ?? existing.storage_path}
                  className="h-24 w-32 rounded-lg object-cover"
                />
                <button
                  type="button"
                  aria-label={`Supprimer la photo ${s.label}`}
                  onClick={async () => {
                    await deleteExpertisePhoto(existing);
                    onChange();
                  }}
                  className="rounded-lg border-2 border-border p-2 text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => inputs.current[s.key]?.click()}
                disabled={busyKey === s.key}
                className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border-2 border-border bg-card px-3 py-3 text-sm font-bold uppercase"
              >
                {busyKey === s.key ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Camera className="h-4 w-4" />
                )}
                Prendre la photo
              </button>
            )}
            <input
              ref={(el) => {
                inputs.current[s.key] = el;
              }}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(ev) => {
                const f = ev.target.files?.[0];
                if (f) void capture(s, i, f);
                ev.target.value = "";
              }}
            />
          </div>
        );
      })}
    </section>
  );
}

/* -------------------------------- Dommages -------------------------------- */

function DamagesStep({
  expertiseId,
  damages,
  photos,
  userId,
  rules,
  onChange,
}: {
  expertiseId: string;
  damages: ExpertiseDamage[];
  photos: ExpertisePhoto[];
  userId: string | null;
  rules: PriceRule[];
  onChange: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<{ url: string; blob: Blob } | null>(null);
  const [busy, setBusy] = useState(false);
  const nextNumber = useMemo(
    () => damages.reduce((m, d) => Math.max(m, d.damage_number), 0) + 1,
    [damages],
  );

  async function saveAnnotated(annotated: Blob, annotation: Annotation) {
    if (!draft) return;
    setBusy(true);
    try {
      const photo = await uploadExpertisePhoto({
        expertiseId,
        file: draft.blob,
        photoType: `dommage_${nextNumber}`,
        category: "dommage",
        label: `Dommage n°${nextNumber}`,
        sequence: 100 + nextNumber,
        annotated,
      });
      await addDamage({
        expertise_id: expertiseId,
        photo_id: photo.id,
        damage_number: nextNumber,
        annotation_data: annotation as unknown,
        cost_pending: true,
        created_by: userId,
      });
      URL.revokeObjectURL(draft.url);
      setDraft(null);
      onChange();
      toast.success(`Dommage n°${nextNumber} ajouté`);
    } catch (err) {
      console.error(err);
      toast.error("Enregistrement du dommage impossible.");
    } finally {
      setBusy(false);
    }
  }

  if (draft) {
    return (
      <section className="card-surface space-y-3 p-4">
        {busy ? (
          <p className="text-sm text-muted-foreground">Enregistrement…</p>
        ) : (
          <PhotoAnnotator
            src={draft.url}
            number={nextNumber}
            onCancel={() => {
              URL.revokeObjectURL(draft.url);
              setDraft(null);
            }}
            onValidate={(blob, annotation) => void saveAnnotated(blob, annotation)}
          />
        )}
      </section>
    );
  }

  return (
    <section className="space-y-3">
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand px-4 py-4 text-sm font-extrabold uppercase text-brand-foreground"
      >
        <Plus className="h-5 w-5" /> Ajouter un dommage
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={async (ev) => {
          const f = ev.target.files?.[0];
          ev.target.value = "";
          if (!f) return;
          const blob = await compressImage(f, 1800, 0.85);
          setDraft({ url: URL.createObjectURL(blob), blob });
        }}
      />
      {damages.length === 0 ? (
        <p className="card-surface p-4 text-sm text-muted-foreground">
          Aucun dommage constaté pour l'instant.
        </p>
      ) : (
        damages.map((d) => (
          <DamageCard
            key={d.id}
            damage={d}
            photo={photos.find((p) => p.id === d.photo_id) ?? null}
            rules={rules}
            onChange={onChange}
          />
        ))
      )}
    </section>
  );
}

function DamageCard({
  damage,
  photo,
  rules,
  onChange,
}: {
  damage: ExpertiseDamage;
  photo: ExpertisePhoto | null;
  rules: PriceRule[];
  onChange: () => void;
}) {
  async function patch(p: Partial<ExpertiseDamage>) {
    await updateDamage(damage.id, p);
    onChange();
  }

  return (
    <article className="card-surface space-y-3 p-4">
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-extrabold uppercase">Dommage n°{damage.damage_number}</h3>
        <button
          type="button"
          aria-label={`Supprimer le dommage ${damage.damage_number}`}
          onClick={async () => {
            await deleteDamage(damage.id);
            onChange();
          }}
          className="rounded-lg border-2 border-border p-2 text-destructive"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
      {photo ? (
        <MediaThumb
          path={photo.report_path ?? photo.storage_path}
          className="w-full rounded-lg object-cover"
        />
      ) : null}
      <div>
        <p className="pb-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">
          Type de dommage
        </p>
        <Choice
          options={DAMAGE_TYPES}
          value={damage.damage_type}
          onChange={(v) => void patch({ damage_type: v })}
        />
      </div>
      <label className="block text-xs font-bold uppercase tracking-wide text-muted-foreground">
        Zone du véhicule
        <select
          value={damage.vehicle_zone ?? ""}
          onChange={(ev) => void patch({ vehicle_zone: ev.target.value })}
          className="mt-1 w-full rounded-lg border-2 border-border bg-background px-3 py-3 text-base font-semibold text-foreground"
        >
          <option value="">— Choisir —</option>
          {VEHICLE_ZONES.map((z) => (
            <option key={z} value={z}>
              {z}
            </option>
          ))}
        </select>
      </label>
      <div>
        <p className="pb-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">
          Intervention
        </p>
        <Choice
          options={INTERVENTIONS}
          value={damage.intervention}
          onChange={(v) => {
            const s = suggestCost(rules, v, damage.element_size);
            void patch({
              intervention: v,
              recommended_action: v,
              estimated_cost: s.amount,
              cost_pending: s.manual || s.amount == null,
            });
          }}
        />
      </div>
      <div>
        <p className="pb-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">
          Taille de l'élément
        </p>
        <Choice
          options={ELEMENT_SIZES}
          value={damage.element_size}
          onChange={(v) => {
            const s = suggestCost(rules, damage.intervention, v);
            void patch({
              element_size: v,
              estimated_cost: s.amount,
              cost_pending: s.manual || s.amount == null,
            });
          }}
        />
      </div>
      <Field
        label="Coût estimé (€)"
        type="number"
        value={damage.estimated_cost != null ? String(damage.estimated_cost) : ""}
        onSave={(v) =>
          void patch({
            estimated_cost: v === "" ? null : Number(v),
            cost_pending: v === "",
          })
        }
      />
      <label className="block text-xs font-bold uppercase tracking-wide text-muted-foreground">
        Commentaire
        <textarea
          defaultValue={damage.comment ?? ""}
          rows={2}
          onBlur={(ev) => void patch({ comment: ev.target.value })}
          className="mt-1 w-full rounded-lg border-2 border-border bg-background px-3 py-3 text-base font-medium text-foreground"
        />
      </label>
    </article>
  );
}