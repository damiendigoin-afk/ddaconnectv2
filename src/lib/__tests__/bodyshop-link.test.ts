import { describe, expect, it } from "vitest";

import {
  attachExisting,
  createCustomerForCase,
  createVehicleForCase,
  customerDraftFromCase,
  customerInsertRow,
  linkErrorMessage,
  parseCaseAddress,
  parseCaseCustomerName,
  rankCustomerCandidates,
  rankVehicleCandidates,
  vehicleDraftFromCase,
  type CaseLinkSource,
} from "../bodyshop-link";
import { buildCustomerPatch, initialCustomerForm, planContactChanges } from "../customer-edit";
import { bodyshopCaseFilter as bodyshopCaseFilterForTest, caseMatchesTokens } from "../refbase";

/** Dossier réel OR 17264 sans fiches liées (customer_id / ref_vehicle_id NULL). */
const CASE_17264: CaseLinkSource = {
  id: "aa42ba81-7704-4ac5-8936-f4f8ad5a6c5e",
  site_id: "92f38b10-7444-44e1-8d86-84ce6b510a59",
  plate: "HF023QC",
  vin: "VR1URHPY4SW040557",
  vehicle_label: "DS3 CROSSBACK 1.2 PU",
  customer_name: "Mme VERNET ISABELLE",
  customer_phone: "0689351021",
  customer_email: "isabelle.vernet24@wanadoo.fr",
  customer_account: null,
  customer_address: null,
  customer_id: null,
  ref_vehicle_id: null,
};

/** Base factice en mémoire : tables + filtres eq/is/in/or minimaux. */
function fakeDb(seed: Record<string, Record<string, unknown>[]> = {}) {
  const tables: Record<string, Record<string, unknown>[]> = JSON.parse(JSON.stringify(seed));
  const log: string[] = [];
  let n = 0;
  const from = (t: string) => {
    tables[t] ??= [];
    const preds: ((r: Record<string, unknown>) => boolean)[] = [];
    let op: "select" | "insert" | "update" | "upsert" = "select";
    let payload: Record<string, unknown> | Record<string, unknown>[] = {};
    let single = false;
    const run = () => {
      const rows = tables[t]!;
      if (op === "insert" || op === "upsert") {
        const list = (Array.isArray(payload) ? payload : [payload]).map((p) => ({ id: `id-${++n}`, ...p }));
        rows.push(...list);
        log.push(`${op}:${t}`);
        return { data: single ? list[0] : list, error: null };
      }
      const hit = rows.filter((r) => preds.every((p) => p(r)));
      if (op === "update") {
        hit.forEach((r) => Object.assign(r, payload));
        log.push(`update:${t}:${hit.length}`);
      }
      return { data: single ? (hit[0] ?? null) : hit, error: null };
    };
    const q: Record<string, unknown> = {
      select: () => q,
      insert: (p: never) => ((op = "insert"), (payload = p), q),
      upsert: (p: never) => ((op = "upsert"), (payload = p), q),
      update: (p: never) => ((op = "update"), (payload = p), q),
      eq: (k: string, v: unknown) => (preds.push((r) => r[k] === v), q),
      is: (k: string, v: unknown) => (preds.push((r) => (r[k] ?? null) === v), q),
      in: (k: string, v: unknown[]) => (preds.push((r) => v.includes(r[k])), q),
      or: (f: string) => {
        const alts = f.split(",").map((x) => {
          const [k, o, ...rest] = x.split(".");
          return { k: k!, o, v: rest.join(".") };
        });
        preds.push((r) => alts.some((a) => (a.o === "eq" ? String(r[a.k] ?? "") === a.v : false)));
        return q;
      },
      order: () => q,
      limit: () => q,
      single: () => ((single = true), q),
      maybeSingle: () => ((single = true), q),
      then: (res: (v: unknown) => unknown) => Promise.resolve(run()).then(res),
    };
    return q;
  };
  return { db: { from }, tables, log };
}

describe("Dossier carrosserie → fiches (cas OR 17264)", () => {
  it("brouillons construits depuis le dossier, sans invention", () => {
    const c = customerDraftFromCase(CASE_17264);
    expect(c).toMatchObject({ civility: "Mme", last_name: "VERNET", first_name: "ISABELLE", mobile: "0689351021", phone: "", email: "isabelle.vernet24@wanadoo.fr" });
    expect(c.account).toBe("");
    expect(c.address_line_1).toBe("");
    const v = vehicleDraftFromCase(CASE_17264);
    expect(v).toEqual({ registration: "HF023QC", vin: "VR1URHPY4SW040557", brand: "DS", model: "DS3 CROSSBACK 1.2 PU" });
  });

  it("compte et adresse persistés sont repris", () => {
    const c = customerDraftFromCase({ ...CASE_17264, customer_account: "402515", customer_address: "3 RUE PORTE CAMPAN, 24540 MONTPAZIER" });
    expect(c).toMatchObject({ account: "402515", address_line_1: "3 RUE PORTE CAMPAN", postal_code: "24540", city: "MONTPAZIER" });
    expect(customerInsertRow(c, "s1")).toMatchObject({ source_system: "winmotor", source_customer_id: "402515", last_name_normalized: "VERNET" });
    expect(customerInsertRow({ ...c, account: "" }, "s1").source_system).toBe("dda");
  });

  it("parse nom/adresse", () => {
    expect(parseCaseCustomerName("M. DE LA TOUR Jean")).toMatchObject({ civility: "M.", last_name: "DE LA TOUR", first_name: "Jean" });
    expect(parseCaseCustomerName("GARAGE DUPONT SARL")).toMatchObject({ customer_type: "company", company_name: "GARAGE DUPONT SARL" });
    expect(parseCaseAddress("12 rue X")).toEqual({ address_line_1: "12 rue X", postal_code: "", city: "" });
  });

  it("la recherche accueil retrouve le dossier sans fiches liées", () => {
    const hit = { ...CASE_17264, or_number: "17264" };
    for (const t of ["HF-023-QC", "hf023", "VR1URHPY4SW040557", "vernet isabelle", "17264", "isabelle vernet"]) expect(caseMatchesTokens(hit, t)).toBe(true);
    expect(caseMatchesTokens(hit, "vernet marie")).toBe(false);
    expect(bodyshopCaseFilterForTest("HF-023-QC")).toContain("plate.ilike.%HF023QC%");
  });
});

describe("Doublons", () => {
  const d = vehicleDraftFromCase(CASE_17264);
  it("véhicule : plaque + VIN identiques = certain ; VIN contradictoire = choix", () => {
    expect(rankVehicleCandidates(d, [{ id: "v1", registration_normalized: "HF023QC", vin: "VR1URHPY4SW040557", site_id: null }])[0]!.certain).toBe(true);
    const m = rankVehicleCandidates(d, [{ id: "v2", registration_normalized: "HF023QC", vin: "VF1AAAAAAAAAAAAAA", site_id: null }])[0]!;
    expect(m.certain).toBe(false);
    expect(m.conflicts).toContain("VIN différent");
  });
  it("deux fiches certaines = doublon existant, choix explicite", () => {
    const r = rankVehicleCandidates(d, [
      { id: "a", registration_normalized: "HF023QC", vin: null, site_id: null },
      { id: "b", registration_normalized: "HF023QC", vin: null, site_id: null },
    ]);
    expect(r.every((m) => !m.certain)).toBe(true);
  });
  it("client : homonyme seul ≠ certain ; nom + mobile = certain ; prénom différent = conflit", () => {
    const cd = customerDraftFromCase(CASE_17264);
    const base = { source_customer_id: null, company_name: null, site_id: null };
    expect(rankCustomerCandidates(cd, [{ id: "c1", last_name: "VERNET", first_name: "ISABELLE", ...base }], null)[0]!.certain).toBe(false);
    expect(rankCustomerCandidates(cd, [{ id: "c1", last_name: "Vernet", first_name: "Isabelle", contacts: ["0689351021"], ...base }], null)[0]!.certain).toBe(true);
    const m = rankCustomerCandidates(cd, [{ id: "c2", last_name: "VERNET", first_name: "MARIE", contacts: ["0689351021"], ...base }], null)[0]!;
    expect(m.certain).toBe(false);
    expect(m.conflicts).toContain("Nom ou prénom différent");
  });
  it("client : compte WinMotor d'un autre site non certain", () => {
    const cd = { ...customerDraftFromCase(CASE_17264), account: "402515" };
    const r = rankCustomerCandidates(cd, [{ id: "c3", last_name: "VERNET", first_name: "ISABELLE", source_customer_id: "402515", company_name: null, site_id: "autre" }], "lalinde");
    expect(r[0]!.reasons).not.toContain("Compte WinMotor 402515");
  });
});

describe("Création / rattachement (base factice)", () => {
  it("crée véhicule puis client, lie le dossier et la relation propriétaire, sans OR", async () => {
    const { db, tables, log } = fakeDb({ bodyshop_cases: [{ ...CASE_17264 }] });
    const v = await createVehicleForCase(db, CASE_17264, vehicleDraftFromCase(CASE_17264));
    expect(v.linked).toBe(true);
    const row = tables["bodyshop_cases"]![0]! as CaseLinkSource;
    expect(row.ref_vehicle_id).toBe(v.id);
    expect(tables["ref_vehicles"]![0]).toMatchObject({ registration_normalized: "HF023QC", vin_normalized: "VR1URHPY4SW040557", source_system: "dda", site_id: CASE_17264.site_id });
    const c = await createCustomerForCase(db, row, customerDraftFromCase(row));
    expect(c.linked).toBe(true);
    expect(tables["customer_contacts"]!.map((x) => x["type"]).sort()).toEqual(["EMAIL", "MOBILE"]);
    expect(tables["customer_vehicle_relations"]![0]).toMatchObject({ customer_id: c.id, vehicle_id: v.id, relationship_type: "OWNER" });
    expect(log.some((l) => l.includes("repair_orders"))).toBe(false);
  });

  it("double clic : la seconde création ne duplique pas la fiche", async () => {
    const { db, tables } = fakeDb({ bodyshop_cases: [{ ...CASE_17264 }] });
    await createVehicleForCase(db, CASE_17264, vehicleDraftFromCase(CASE_17264));
    await expect(createVehicleForCase(db, CASE_17264, vehicleDraftFromCase(CASE_17264))).rejects.toThrow(/existe déjà/);
    expect(tables["ref_vehicles"]).toHaveLength(1);
  });

  it("client déjà lié entre-temps : pas de seconde fiche", async () => {
    const { db, tables } = fakeDb({ bodyshop_cases: [{ ...CASE_17264, customer_id: "deja" }] });
    const r = await createCustomerForCase(db, CASE_17264, customerDraftFromCase(CASE_17264));
    expect(r).toEqual({ id: "deja", linked: false });
    expect(tables["customers"]).toHaveLength(0);
  });

  it("rattacher une fiche existante ne remplace pas un lien déjà posé", async () => {
    const { db, tables } = fakeDb({ bodyshop_cases: [{ ...CASE_17264, ref_vehicle_id: "v-existant" }] });
    expect(await attachExisting(db, CASE_17264, "vehicle", "v-autre")).toBe(false);
    expect(tables["bodyshop_cases"]![0]!["ref_vehicle_id"]).toBe("v-existant");
  });

  it("erreur de droits traduite", () => {
    expect(linkErrorMessage({ message: "new row violates row-level security policy" })).toMatch(/Droits insuffisants/);
  });
});

describe("Édition fiche client", () => {
  const cust = { civility: "Mme", last_name: "VERNET", first_name: "ISABELLE", company_name: null, customer_type: "individual" };
  const contacts = [{ id: "m1", type: "MOBILE", value: "06 89 35 10 21", normalized_value: "0689351021" }];
  const before = initialCustomerForm(cust, contacts, undefined);
  it("patch ciblé avec colonnes normalisées", () => {
    expect(buildCustomerPatch(before, { ...before, first_name: "Isabelle Marie" })).toEqual({ first_name: "Isabelle Marie", first_name_normalized: "ISABELLEMARIE" });
    expect(buildCustomerPatch(before, before)).toEqual({});
  });
  it("contacts : met à jour la ligne existante, pas de doublon, invalide refusé", () => {
    expect(planContactChanges(contacts, before, { ...before, mobile: "0611223344" })).toEqual([{ op: "update", id: "m1", value: "0611223344", normalized_value: "0611223344" }]);
    expect(planContactChanges(contacts, before, { ...before, email: "a@b.fr" })).toEqual([{ op: "insert", type: "EMAIL", value: "a@b.fr", normalized_value: "a@b.fr" }]);
    expect(planContactChanges(contacts, before, { ...before, mobile: "" })).toEqual([{ op: "deactivate", id: "m1" }]);
    expect(planContactChanges(contacts, before, { ...before, email: "pas-un-mail" })).toEqual([{ op: "invalid", type: "EMAIL" }]);
  });
});
