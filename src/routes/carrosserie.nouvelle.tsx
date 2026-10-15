import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { AppShell } from "@/components/AppShell";
import { Area, Field, Select } from "@/components/bits";
import { DocIdentify, type DocIdentifyResult } from "@/components/DocIdentify";
import { useAuth } from "@/lib/auth";
import { createCase, MISSION_ORIGINS } from "@/lib/bodyshop";
import { uploadCaseDocument } from "@/lib/documents";
import { formatPlate, normalizePlate } from "@/lib/plate";
import { refPrefill, type RefPrefill } from "@/lib/refbase";
import { buildCaseFormPrefill, type CaseFormPrefill, type DocExtract } from "@/lib/bodyshop-doc";
import { listAgreements, listExperts, listFirms, listInsurers } from "@/lib/referentials";

export const Route = createFileRoute("/carrosserie/nouvelle")({
  head: () => ({
    meta: [
      { title: "Nouveau dossier carrosserie — DDA Connect" },
      {
        name: "description",
        content:
          "Créer un dossier carrosserie à partir d'une immatriculation, d'un scan d'OR ou d'une saisie manuelle.",
      },
      { property: "og:title", content: "Nouveau dossier carrosserie — DDA Connect" },
      {
        property: "og:description",
        content: "Création rapide d'un dossier carrosserie depuis l'atelier.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: NewCase,
});

function NewCase() {
  const navigate = useNavigate();
  const { user, displayName } = useAuth();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [found, setFound] = useState("");

  const [plate, setPlate] = useState("");
  const [vehicleLabelText, setVehicleLabelText] = useState("");
  const [vin, setVin] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [orNumber, setOrNumber] = useState("");
  const [origin, setOrigin] = useState("manuel");
  const [insurerId, setInsurerId] = useState("");
  const [agreementId, setAgreementId] = useState("");
  const [firmId, setFirmId] = useState("");
  const [expertId, setExpertId] = useState("");
  const [claim, setClaim] = useState("");
  const [payer, setPayer] = useState("assurance");
  const [isHail, setIsHail] = useState(false);
  const [isVge, setIsVge] = useState(false);
  const [comments, setComments] = useState("");
  const [refVehicleId, setRefVehicleId] = useState<string | null>(null);
  const [customerId, setCustomerId] = useState<string | null>(null);
  /** Le document d'identification est conservé et rattaché au dossier dès sa création. */
  const [pendingDoc, setPendingDoc] = useState<{ file: File; kind: string; category: string } | null>(null);
  const [check, setCheck] = useState<{ extract: DocExtract; prefill: CaseFormPrefill; ref: RefPrefill | null } | null>(null);

  const insurers = useQuery({ queryKey: ["insurers"], queryFn: listInsurers });
  const agreements = useQuery({ queryKey: ["agreements"], queryFn: listAgreements });
  const firms = useQuery({ queryKey: ["firms"], queryFn: listFirms });
  const experts = useQuery({ queryKey: ["experts"], queryFn: listExperts });

  async function applyPlate(raw: string) {
    const p = normalizePlate(raw);
    if (p.length < 5) return;
    const ref = await refPrefill(p);
    if (!ref) {
      setFound("");
      return;
    }
    setFound(ref.label);
    setRefVehicleId(ref.vehicleId);
    setCustomerId(ref.customerId);
    const f = ref.fields;
    setPlate(f["plate"] ?? p);
    setVin((v) => v || (f["vin"] ?? ""));
    setVehicleLabelText((v) => v || [f["brand"], f["model"]].filter(Boolean).join(" "));
    setCustomerName((v) => v || [f["first_name"], f["last_name"]].filter(Boolean).join(" "));
    setCustomerPhone((v) => v || f["mobile"] || f["phone"] || "");
    setCustomerEmail((v) => v || f["email"] || "");
  }

  /** Identification unique par document : OR (moteur atelier), plaque, carte grise, sinistre… */
  async function onDocument(r: DocIdentifyResult) {
    setMsg("");
    const e = r.extracted;
    const ref = r.prefill;
    const f = buildCaseFormPrefill(e, ref?.fields);
    setPendingDoc({ file: r.file, kind: r.kind, category: f.docCategory });
    // Le document prime ; la base ne complète que les vides. Grêle, VGE, payeur, origine : jamais déduits.
    if (f.plate) setPlate(f.plate);
    if (f.vin) setVin(f.vin);
    if (f.vehicleLabel) setVehicleLabelText(f.vehicleLabel);
    if (f.customerName) setCustomerName(f.customerName);
    if (f.customerPhone) setCustomerPhone(f.customerPhone);
    if (f.customerEmail) setCustomerEmail(f.customerEmail);
    if (f.orNumber) setOrNumber(f.orNumber);
    if (f.claim) setClaim(f.claim);
    if (f.comments) setComments((c) => (c ? `${c}\n\n${f.comments}` : f.comments));
    setFound(ref ? ref.label : "");
    setRefVehicleId(ref && f.linkRef ? ref.vehicleId : null);
    setCustomerId(ref && f.linkRef && !f.conflicts.some((c) => c.field === "customer_name") ? ref.customerId : null);
    setCheck({ extract: e, prefill: f, ref });
    if (!f.plate)
      setMsg("Immatriculation non détectée : saisis-la à la main, le document reste joint au dossier.");
  }

  async function submit() {
    if (!normalizePlate(plate)) {
      setMsg("Immatriculation obligatoire.");
      return;
    }
    setBusy(true);
    try {
      const row = await createCase({
        plate: normalizePlate(plate),
        vin: vin || null,
        vehicle_label: vehicleLabelText || null,
        customer_name: customerName || null,
        customer_phone: customerPhone || null,
        customer_email: customerEmail || null,
        or_number: orNumber || null,
        mission_origin: origin,
        mission_date: new Date().toISOString().slice(0, 10),
        insurer_id: insurerId || null,
        agreement_id: agreementId || null,
        expert_firm_id: firmId || null,
        expert_id: expertId || null,
        claim_number: claim || null,
        payer,
        is_hail: isHail,
        is_vge: isVge,
        comments: comments || null,
        ref_vehicle_id: refVehicleId,
        customer_id: customerId,
        case_state: "mission_creee",
        physical_state: "pas_entre",
      });
      if (pendingDoc) {
        await uploadCaseDocument({
          caseId: row.id,
          file: pendingDoc.file,
          category: pendingDoc.category,
          docType: pendingDoc.kind,
          origin: "identification",
          author: { userId: user?.id ?? null, userName: displayName },
        }).catch(() => setMsg("Dossier créé, mais le document n'a pas pu être joint."));
      }
      await navigate({ to: "/carrosserie/$caseId", params: { caseId: row.id } });
    } catch {
      setMsg("Création impossible.");
      setBusy(false);
    }
  }

  return (
    <AppShell title="Nouveau dossier" subtitle="Carrosserie" back={{ to: "/carrosserie" }}>
      <div className="space-y-3">
        <DocIdentify compact={false} onResult={(r) => void onDocument(r)} onError={setMsg} />
        {pendingDoc ? (
          <p className="text-xs text-muted-foreground">
            Document joint au dossier à la création : {pendingDoc.file.name}
          </p>
        ) : null}

        {check ? <DocCheck check={check} onLink={() => {
          setRefVehicleId(check.ref?.vehicleId ?? null);
          setCustomerId(check.ref?.customerId ?? null);
          setCheck({ ...check, prefill: { ...check.prefill, linkRef: true } });
        }} /> : null}

        {msg ? (
          <p className="rounded-lg bg-amber-100 px-3 py-2 text-sm text-amber-950">{msg}</p>
        ) : null}
        {found ? (
          <p className="rounded-lg bg-emerald-100 px-3 py-2 text-sm text-emerald-950">
            Trouvé en base : {found}
          </p>
        ) : null}

        <Field label="Immatriculation" value={plate} onChange={setPlate} placeholder="AA-123-BB" />
        <button
          onClick={() => void applyPlate(plate)}
          className="w-full rounded-lg border-2 border-border py-2 text-sm font-bold"
        >
          Rechercher dans la base
        </button>

        <Field label="Véhicule" value={vehicleLabelText} onChange={setVehicleLabelText} />
        <Field label="VIN" value={vin} onChange={setVin} />
        <Field label="Client" value={customerName} onChange={setCustomerName} />
        <Field label="Téléphone" value={customerPhone} onChange={setCustomerPhone} />
        <Field label="E-mail" value={customerEmail} onChange={setCustomerEmail} type="email" />
        <Field label="N° OR" value={orNumber} onChange={setOrNumber} />

        <Select
          label="Origine de la mission"
          value={origin}
          onChange={setOrigin}
          options={MISSION_ORIGINS.map((o) => ({ key: o.key, label: o.label }))}
          allowEmpty={false}
        />
        <Select
          label="Assurance"
          value={insurerId}
          onChange={setInsurerId}
          options={(insurers.data ?? []).map((i) => ({ key: i.id, label: i.name }))}
        />
        <Select
          label="Agrément"
          value={agreementId}
          onChange={setAgreementId}
          options={(agreements.data ?? []).map((a) => ({ key: a.id, label: a.name }))}
        />
        <Select
          label="Cabinet d'expertise"
          value={firmId}
          onChange={setFirmId}
          options={(firms.data ?? []).map((f) => ({ key: f.id, label: f.name }))}
        />
        <Select
          label="Expert"
          value={expertId}
          onChange={setExpertId}
          options={(experts.data ?? [])
            .filter((e) => !firmId || e.firm_id === firmId)
            .map((e) => ({
              key: e.id,
              label: [e.first_name, e.last_name].filter(Boolean).join(" "),
            }))}
        />
        <Field label="N° de sinistre" value={claim} onChange={setClaim} />
        <Select
          label="Payeur"
          value={payer}
          onChange={setPayer}
          options={[
            { key: "assurance", label: "Assurance" },
            { key: "client", label: "Client" },
            { key: "mixte", label: "Mixte" },
          ]}
          allowEmpty={false}
        />

        <div className="flex gap-2">
          <button
            onClick={() => setIsHail(!isHail)}
            className={`flex-1 rounded-lg border-2 py-3 text-sm font-bold ${isHail ? "border-brand bg-brand/10" : "border-border"}`}
          >
            Grêle
          </button>
          <button
            onClick={() => setIsVge(!isVge)}
            className={`flex-1 rounded-lg border-2 py-3 text-sm font-bold ${isVge ? "border-brand bg-brand/10" : "border-border"}`}
          >
            VGE
          </button>
        </div>

        <Area label="Commentaires" value={comments} onChange={setComments} />

        <button
          onClick={() => void submit()}
          disabled={busy}
          className="w-full rounded-xl bg-brand px-4 py-4 text-lg font-extrabold uppercase tracking-wide text-brand-foreground disabled:opacity-50"
        >
          Créer le dossier
        </button>
      </div>
    </AppShell>
  );
}

/** Contrôle avant validation : champs détectés, à vérifier, divergences avec la base. */
function DocCheck({
  check,
  onLink,
}: {
  check: { extract: DocExtract; prefill: CaseFormPrefill; ref: RefPrefill | null };
  onLink: () => void;
}) {
  const { extract: e, prefill: f, ref } = check;
  const rows: [string, string | null | undefined][] = [
    ["N° OR", e.or_number],
    ["Immatriculation", e.plate],
    ["VIN", e.vin],
    ["Véhicule", e.vehicle_label ?? ([e.brand, e.model].filter(Boolean).join(" ") || null)],
    ["Client", e.customer_name],
    ["N° compte", e.customer_account],
    ["Téléphone", e.customer_phone],
    ["E-mail", e.customer_email],
    ["Adresse", e.customer_address],
  ];
  return (
    <section className="space-y-2 rounded-lg border-2 border-border bg-card p-3 text-xs">
      <div className="font-extrabold uppercase">
        Contrôle du document {e.engine === "repair_order" ? "— lu comme ordre de réparation WinMotor" : ""}
      </div>
      <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className={v ? "font-semibold" : "text-muted-foreground"}>{v || "non détecté — à saisir"}</dd>
          </div>
        ))}
      </dl>
      {e.uncertain?.length ? (
        <p className="rounded bg-amber-100 px-2 py-1 text-amber-950">À vérifier (illisible ou douteux, laissé vide) : {e.uncertain.join(", ")}</p>
      ) : null}
      {f.fromBase.length ? (
        <p className="text-muted-foreground">Complété depuis la base (absent du document) : {f.fromBase.join(", ")}</p>
      ) : null}
      {f.conflicts.length ? (
        <div className="space-y-1 rounded bg-red-100 px-2 py-1 text-red-950">
          <p className="font-bold">Divergences avec la base — valeurs du document conservées :</p>
          {f.conflicts.map((c) => (
            <p key={c.field}>
              {c.label} : document « {c.doc} » / base « {c.base} »
            </p>
          ))}
          {ref && !f.linkRef ? (
            <button type="button" onClick={onLink} className="rounded border-2 border-border bg-card px-2 py-1 font-bold">
              Lier quand même à la fiche {ref.label}
            </button>
          ) : null}
        </div>
      ) : null}
      {e.engine === "repair_order" ? (
        <p className="text-muted-foreground">Assurance, expert, sinistre, grêle et VGE ne sont pas lus sur un OR : à renseigner si besoin.</p>
      ) : null}
    </section>
  );
}
