/** Édition contrôlée d'une fiche client : patch ciblé, contacts sans doublon, adresse principale. */
import { normalizeEmail, normalizeName, normalizePhone } from "./winmotor/mapping";

type Db = { from: (t: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any

export type ContactRow = { id: string; type: string; value: string; normalized_value?: string | null };
export type AddressRow = { id: string; address_line_1: string | null; postal_code: string | null; city: string | null };

export type CustomerForm = {
  civility: string;
  last_name: string;
  first_name: string;
  company_name: string;
  customer_type: string;
  mobile: string;
  phone: string;
  email: string;
  address_line_1: string;
  postal_code: string;
  city: string;
};

const IDENTITY = ["civility", "last_name", "first_name", "company_name", "customer_type"] as const;

export function initialCustomerForm(c: Record<string, unknown>, contacts: ContactRow[], addr: AddressRow | undefined): CustomerForm {
  const s = (v: unknown) => (v == null ? "" : String(v));
  return {
    civility: s(c["civility"]),
    last_name: s(c["last_name"]),
    first_name: s(c["first_name"]),
    company_name: s(c["company_name"]),
    customer_type: s(c["customer_type"]) || "individual",
    mobile: contacts.find((x) => x.type === "MOBILE")?.value ?? "",
    phone: contacts.find((x) => x.type === "PHONE")?.value ?? "",
    email: contacts.find((x) => x.type === "EMAIL")?.value ?? "",
    address_line_1: s(addr?.address_line_1),
    postal_code: s(addr?.postal_code),
    city: s(addr?.city),
  };
}

/** Champs d'identité modifiés uniquement (+ colonnes normalisées de recherche). */
export function buildCustomerPatch(before: CustomerForm, after: CustomerForm): Record<string, string | null> {
  const patch: Record<string, string | null> = {};
  for (const k of IDENTITY) {
    if (before[k].trim() !== after[k].trim()) patch[k] = after[k].trim() || (k === "customer_type" ? "individual" : null);
  }
  if ("last_name" in patch) patch["last_name_normalized"] = normalizeName(after.last_name) || null;
  if ("first_name" in patch) patch["first_name_normalized"] = normalizeName(after.first_name) || null;
  if ("company_name" in patch) patch["company_normalized"] = normalizeName(after.company_name) || null;
  return patch;
}

export type ContactOp =
  | { op: "insert"; type: string; value: string; normalized_value: string }
  | { op: "update"; id: string; value: string; normalized_value: string }
  | { op: "deactivate"; id: string }
  | { op: "invalid"; type: string };

/** Pour chaque type (MOBILE/PHONE/EMAIL) : met à jour la ligne existante, n'en crée pas de seconde identique. */
export function planContactChanges(contacts: ContactRow[], before: CustomerForm, after: CustomerForm): ContactOp[] {
  const ops: ContactOp[] = [];
  const spec: [string, keyof CustomerForm, (v: string) => string][] = [
    ["MOBILE", "mobile", normalizePhone],
    ["PHONE", "phone", normalizePhone],
    ["EMAIL", "email", normalizeEmail],
  ];
  for (const [type, key, norm] of spec) {
    const next = after[key].trim();
    if (next === before[key].trim()) continue;
    const existing = contacts.find((c) => c.type === type);
    if (!next) {
      if (existing) ops.push({ op: "deactivate", id: existing.id });
      continue;
    }
    const n = norm(next);
    if (!n) {
      ops.push({ op: "invalid", type });
      continue;
    }
    const value = type === "EMAIL" ? n : next;
    const dup = contacts.find((c) => c.type === type && (c.normalized_value ?? "") === n && c.id !== existing?.id);
    if (dup) {
      // La valeur existe déjà sur une autre ligne du même type : on retire seulement l'ancienne.
      if (existing) ops.push({ op: "deactivate", id: existing.id });
      continue;
    }
    ops.push(existing ? { op: "update", id: existing.id, value, normalized_value: n } : { op: "insert", type, value, normalized_value: n });
  }
  return ops;
}

export async function saveCustomer(db: Db, customerId: string, contacts: ContactRow[], addr: AddressRow | undefined, before: CustomerForm, after: CustomerForm) {
  const ops = planContactChanges(contacts, before, after);
  const bad = ops.find((o) => o.op === "invalid");
  if (bad) throw new Error(bad.type === "EMAIL" ? "E-mail invalide." : "Numéro de téléphone invalide.");
  const patch = buildCustomerPatch(before, after);
  if (Object.keys(patch).length) {
    const { error } = await db.from("customers").update(patch).eq("id", customerId);
    if (error) throw error;
  }
  for (const o of ops) {
    const q =
      o.op === "insert"
        ? db
            .from("customer_contacts")
            .upsert({ customer_id: customerId, type: o.type, value: o.value, normalized_value: o.normalized_value, source: "DDA", active: true }, { onConflict: "customer_id,type,normalized_value" })
        : o.op === "update"
          ? db.from("customer_contacts").update({ value: o.value, normalized_value: o.normalized_value, active: true }).eq("id", o.id)
          : o.op === "deactivate"
            ? db.from("customer_contacts").update({ active: false }).eq("id", o.id)
            : null;
    if (q) {
      const { error } = await q;
      if (error) throw error;
    }
  }
  const addrChanged = (["address_line_1", "postal_code", "city"] as const).some((k) => before[k].trim() !== after[k].trim());
  if (addrChanged) {
    const row = { address_line_1: after.address_line_1.trim() || null, postal_code: after.postal_code.trim() || null, city: after.city.trim() || null };
    const { error } = addr
      ? await db.from("customer_addresses").update(row).eq("id", addr.id)
      : await db.from("customer_addresses").insert({ ...row, customer_id: customerId, type: "MAIN", source: "DDA", country: "FRANCE" });
    if (error) throw error;
  }
  return { patch, ops, addrChanged };
}
