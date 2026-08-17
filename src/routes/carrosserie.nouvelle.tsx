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
import { refPrefill } from "@/lib/refbase";
import { listAgreements, listExperts, listFirms, listInsurers } from "@/lib/referentials";

export const Route = createFileRoute("/carrosserie/nouvelle")({
  head: () => ({
    meta: [
      { title: "Nouveau dossier carrosserie — DDA Connect" },
      { name: "description", content: "Créer un dossier carrosserie à partir d'une immatriculation, d'un scan d'OR ou d'une saisie manuelle." },
      { property: "og:title", content: "Nouveau dossier carrosserie — DDA Connect" },
      { property: "og:description", content: "Création rapide d'un dossier carrosserie depuis l'atelier." },
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
  const [pendingDoc, setPendingDoc] = useState<{ file: File; kind: string } | null>(null);

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

  const DOC_CATEGORY: Record<string, string> = {
    plaque: "vehicule",
    carte_grise: "vehicule",
    or: "or",
    avis_sinistre: "sinistre",
    rapport_expertise: "expertise",
    autre: "autres",
  };

  /** Identification unique par document : plaque, carte grise, OR, avis de sinistre… */
  async function onDocument(r: DocIdentifyResult) {
    setMsg("");
    setPendingDoc({ file: r.file, kind: r.kind });
    const e = r.extracted;
    if (e.or_number) setOrNumber(e.or_number);
    if (e.claim_number) setClaim(e.claim_number);
    if (e.customer_name) setCustomerName((v) => v || e.customer_name!);
    if (e.customer_phone) setCustomerPhone((v) => v || e.customer_phone!);
    if (e.customer_email) setCustomerEmail((v) => v || e.customer_email!);
    if (e.vin) setVin((v) => v || e.vin!);
    if (e.brand || e.model) setVehicleLabelText((v) => v || [e.brand, e.model].filter(Boolean).join(" "));
    if (e.plate) {
      setPlate(formatPlate(e.plate));
      await applyPlate(e.plate);
    } else {
      setMsg("Immatriculation non détectée : saisis-la à la main, le document reste joint au dossier.");
    }
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
          category: DOC_CATEGORY[pendingDoc.kind] ?? "autres",
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

        {msg ? <p className="rounded-lg bg-amber-100 px-3 py-2 text-sm text-amber-950">{msg}</p> : null}
        {found ? <p className="rounded-lg bg-emerald-100 px-3 py-2 text-sm text-emerald-950">Trouvé en base : {found}</p> : null}

        <Field label="Immatriculation" value={plate} onChange={setPlate} placeholder="AA-123-BB" />
        <button onClick={() => void applyPlate(plate)} className="w-full rounded-lg border-2 border-border py-2 text-sm font-bold">
          Rechercher dans la base
        </button>

        <Field label="Véhicule" value={vehicleLabelText} onChange={setVehicleLabelText} />
        <Field label="VIN" value={vin} onChange={setVin} />
        <Field label="Client" value={customerName} onChange={setCustomerName} />
        <Field label="Téléphone" value={customerPhone} onChange={setCustomerPhone} />
        <Field label="E-mail" value={customerEmail} onChange={setCustomerEmail} type="email" />
        <Field label="N° OR" value={orNumber} onChange={setOrNumber} />

        <Select label="Origine de la mission" value={origin} onChange={setOrigin} options={MISSION_ORIGINS.map((o) => ({ key: o.key, label: o.label }))} allowEmpty={false} />
        <Select label="Assurance" value={insurerId} onChange={setInsurerId} options={(insurers.data ?? []).map((i) => ({ key: i.id, label: i.name }))} />
        <Select label="Agrément" value={agreementId} onChange={setAgreementId} options={(agreements.data ?? []).map((a) => ({ key: a.id, label: a.name }))} />
        <Select label="Cabinet d'expertise" value={firmId} onChange={setFirmId} options={(firms.data ?? []).map((f) => ({ key: f.id, label: f.name }))} />
        <Select
          label="Expert"
          value={expertId}
          onChange={setExpertId}
          options={(experts.data ?? [])
            .filter((e) => !firmId || e.firm_id === firmId)
            .map((e) => ({ key: e.id, label: [e.first_name, e.last_name].filter(Boolean).join(" ") }))}
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
