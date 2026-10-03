/** Référentiel Clients / Véhicules DDA Connect : recherche universelle et fiches. */
import { supabase } from "@/integrations/supabase/client";
import { coversAll, entityText, searchTokens } from "./search-tokens";
import { normalizeName, normalizePhone, normalizeRegistration } from "./winmotor/mapping";

export type RefVehicle = {
  id: string;
  registration_display: string | null;
  registration_normalized: string | null;
  vin: string | null;
  brand: string | null;
  range_name: string | null;
  model: string | null;
  version: string | null;
  color: string | null;
  energy: string | null;
  first_registration_date: string | null;
  next_ct_date: string | null;
  last_ct_date: string | null;
  last_mileage: number | null;
  last_mileage_at: string | null;
  last_visit_at: string | null;
  source_vehicle_id: string | null;
  site_id: string | null;
};

export type RefCustomer = {
  id: string;
  source_customer_id: string | null;
  customer_type: string;
  civility: string | null;
  last_name: string | null;
  first_name: string | null;
  company_name: string | null;
  site_id?: string | null;
};

const VEH_SELECT =
  "id, registration_display, registration_normalized, vin, brand, range_name, model, version, color, energy, first_registration_date, next_ct_date, last_ct_date, last_mileage, last_mileage_at, last_visit_at, source_vehicle_id, site_id";
const CUST_SELECT = "id, source_customer_id, customer_type, civility, last_name, first_name, company_name, site_id";

export function customerName(c: Pick<RefCustomer, "first_name" | "last_name" | "company_name"> | null): string {
  if (!c) return "—";
  if (c.company_name) return c.company_name;
  return [c.first_name, c.last_name].filter(Boolean).join(" ") || "—";
}

export function vehicleLabel(v: Pick<RefVehicle, "brand" | "model" | "range_name" | "version"> | null): string {
  if (!v) return "—";
  return [v.brand, v.range_name || v.model, v.version].filter(Boolean).join(" ") || "—";
}

/** Présentation WinMotor : gamme puis motorisation/modèle, sans doublon. */
export function refVehicleModel(v: Pick<RefVehicle, "range_name" | "model">): string {
  const range = (v.range_name ?? "").trim();
  const model = (v.model ?? "").trim();
  if (!range) return model;
  if (!model || model.toUpperCase() === range.toUpperCase()) return range;
  return `${range} / ${model}`;
}

export type SearchResult = {
  customers: (RefCustomer & { vehicles: RefVehicle[]; city: string | null; phone: string | null })[];
  vehicles: (RefVehicle & { customer: RefCustomer | null })[];
  orders: { id: string; or_number: string | null; or_date: string | null; plate: string | null; site_id: string | null }[];
};

/** Propriétaire courant de chaque véhicule : relation OWNER active la plus récente.
 *  Retourne une map vehicle_id -> customer_id (jamais de relation inactive ou arbitraire). */
async function fetchCurrentOwnerByVehicle(vehicleIds: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (!vehicleIds.length) return map;
  const { data } = await supabase
    .from("customer_vehicle_relations")
    .select("vehicle_id, customer_id, created_at")
    .in("vehicle_id", [...new Set(vehicleIds)])
    .eq("active", true)
    .eq("relationship_type", "OWNER")
    .order("created_at", { ascending: false });
  for (const r of (data ?? []) as { vehicle_id: string; customer_id: string }[]) {
    if (!map.has(r.vehicle_id)) map.set(r.vehicle_id, r.customer_id);
  }
  return map;
}

/** Recherche multi-termes : candidats par token, puis couples client ↔ véhicule couvrant tous les tokens. */
async function multiTokenMatches(tokens: string[], limit: number): Promise<{ customers: RefCustomer[]; vehicles: RefVehicle[] }> {
  const perTok = await Promise.all(
    tokens.map((t) =>
      Promise.all([
        supabase
          .from("customers")
          .select(CUST_SELECT)
          .or(`last_name_normalized.ilike.%${t}%,first_name_normalized.ilike.%${t}%,company_normalized.ilike.%${t}%,source_customer_id.eq.${t}`)
          .limit(30),
        supabase
          .from("ref_vehicles")
          .select(VEH_SELECT)
          .or(`registration_normalized.ilike.%${t}%,vin_normalized.ilike.%${t}%,brand.ilike.%${t}%,model.ilike.%${t}%,range_name.ilike.%${t}%,version.ilike.%${t}%`)
          .limit(30),
        /\d/.test(t)
          ? supabase.from("repair_orders").select("or_number, vehicle:vehicles(plate_normalized)").ilike("or_number", `%${t}%`).limit(10)
          : Promise.resolve({ data: [] as { or_number: string | null; vehicle: unknown }[] }),
      ]),
    ),
  );
  const custs = new Map<string, RefCustomer>();
  const vehs = new Map<string, RefVehicle>();
  const orsByPlate = new Map<string, string[]>();
  for (const [c, v, o] of perTok) {
    for (const x of (c.data ?? []) as RefCustomer[]) custs.set(x.id, x);
    for (const x of (v.data ?? []) as RefVehicle[]) vehs.set(x.id, x);
    for (const x of (o.data ?? []) as { or_number: string | null; vehicle: { plate_normalized?: string | null } | null }[]) {
      const pl = x.vehicle?.plate_normalized;
      if (pl && x.or_number) orsByPlate.set(pl, [...(orsByPlate.get(pl) ?? []), x.or_number]);
    }
  }
  const knownPlates = new Set([...vehs.values()].map((v) => v.registration_normalized));
  const orPlates = [...orsByPlate.keys()].filter((p) => !knownPlates.has(p));
  if (orPlates.length) {
    const { data } = await supabase.from("ref_vehicles").select(VEH_SELECT).in("registration_normalized", orPlates.slice(0, 30));
    for (const x of (data ?? []) as RefVehicle[]) vehs.set(x.id, x);
  }
  if (!custs.size && !vehs.size) return { customers: [], vehicles: [] };

  const cIds = [...custs.keys()];
  const vIds = [...vehs.keys()];
  const { data: relData } = await supabase
    .from("customer_vehicle_relations")
    .select("customer_id, vehicle_id")
    .eq("active", true)
    .or([cIds.length ? `customer_id.in.(${cIds.join(",")})` : "", vIds.length ? `vehicle_id.in.(${vIds.join(",")})` : ""].filter(Boolean).join(","))
    .limit(1000);
  const rels = (relData ?? []) as { customer_id: string; vehicle_id: string }[];
  const missC = [...new Set(rels.map((r) => r.customer_id).filter((id) => !custs.has(id)))].slice(0, 80);
  const missV = [...new Set(rels.map((r) => r.vehicle_id).filter((id) => !vehs.has(id)))].slice(0, 80);
  const [mc, mv] = await Promise.all([
    missC.length ? supabase.from("customers").select(CUST_SELECT).in("id", missC) : Promise.resolve({ data: [] }),
    missV.length ? supabase.from("ref_vehicles").select(VEH_SELECT).in("id", missV) : Promise.resolve({ data: [] }),
  ]);
  for (const x of (mc.data ?? []) as RefCustomer[]) custs.set(x.id, x);
  for (const x of (mv.data ?? []) as RefVehicle[]) vehs.set(x.id, x);

  const cText = (c: RefCustomer) => entityText([c.first_name, c.last_name, c.company_name, c.source_customer_id]);
  const vText = (v: RefVehicle) =>
    entityText([v.registration_normalized, v.vin, v.brand, v.model, v.range_name, v.version, v.source_vehicle_id, ...(orsByPlate.get(v.registration_normalized ?? "") ?? [])]);

  const customers = [...custs.values()].filter((c) => {
    const linked = rels.filter((r) => r.customer_id === c.id).map((r) => vehs.get(r.vehicle_id)).filter((v): v is RefVehicle => Boolean(v));
    return coversAll(tokens, [cText(c), ...linked.map(vText)]);
  });
  const vehicles = [...vehs.values()].filter((v) => {
    const linked = rels.filter((r) => r.vehicle_id === v.id).map((r) => custs.get(r.customer_id)).filter((c): c is RefCustomer => Boolean(c));
    return coversAll(tokens, [vText(v), ...linked.map(cText)]);
  });
  return { customers: customers.slice(0, limit), vehicles: vehicles.slice(0, limit) };
}

/** Recherche universelle : immat (même partielle), nom, société, n° client,
 *  téléphone, email, VIN, n° véhicule Winmotor ou n° OR. */
export async function universalSearch(term: string, limit = 20): Promise<SearchResult> {
  const raw = term.trim();
  const empty: SearchResult = { customers: [], vehicles: [], orders: [] };
  if (raw.length < 2) return empty;

  const reg = normalizeRegistration(raw);
  const name = normalizeName(raw);
  const phone = normalizePhone(raw);
  const email = raw.toLowerCase();

  const vehFilters = [
    reg ? `registration_normalized.ilike.%${reg}%` : "",
    reg ? `vin_normalized.ilike.%${reg}%` : "",
    `source_vehicle_id.eq.${raw}`,
  ]
    .filter(Boolean)
    .join(",");

  const custFilters = [
    name ? `last_name_normalized.ilike.%${name}%` : "",
    name ? `first_name_normalized.ilike.%${name}%` : "",
    name ? `company_normalized.ilike.%${name}%` : "",
    `source_customer_id.eq.${raw}`,
  ]
    .filter(Boolean)
    .join(",");

  const contactValue = phone || (email.includes("@") ? email : "");

  const [vehRes, custRes, contactRes, orderRes] = await Promise.all([
    supabase.from("ref_vehicles").select(VEH_SELECT).or(vehFilters).limit(limit),
    supabase.from("customers").select(CUST_SELECT).or(custFilters).limit(limit),
    contactValue
      ? supabase.from("customer_contacts").select("customer_id").ilike("normalized_value", `%${contactValue}%`).limit(limit)
      : Promise.resolve({ data: [] as { customer_id: string }[] }),
    supabase
      .from("repair_orders")
      .select("id, or_number, or_date, site_id, vehicle:vehicles(plate)")
      .ilike("or_number", `%${raw}%`)
      .limit(5),
  ]);

  let custBase = (custRes.data ?? []) as RefCustomer[];
  let vehBase = (vehRes.data ?? []) as RefVehicle[];
  // Multi-termes : les tokens se répartissent entre client et véhicules/OR liés.
  const tokens = searchTokens(raw);
  if (tokens.length > 1) {
    const mt = await multiTokenMatches(tokens, limit);
    custBase = [...mt.customers, ...custBase.filter((c) => !mt.customers.some((m) => m.id === c.id))];
    vehBase = [...mt.vehicles, ...vehBase.filter((v) => !mt.vehicles.some((m) => m.id === v.id))];
  }

  const customerIds = new Set<string>(custBase.map((c) => c.id));
  for (const c of (contactRes.data ?? []) as { customer_id: string }[]) customerIds.add(c.customer_id);

  let customers = custBase;
  const missing = [...customerIds].filter((id) => !customers.some((c) => c.id === id));
  if (missing.length) {
    const { data } = await supabase.from("customers").select(CUST_SELECT).in("id", missing);
    customers = [...customers, ...((data ?? []) as RefCustomer[])];
  }

  const vehicles = vehBase;

  // véhicules des clients trouvés + client de chaque véhicule trouvé
  const relCustomerIds = customers.map((c) => c.id);
  const relVehicleIds = vehicles.map((v) => v.id);
  const { data: rels } = relCustomerIds.length || relVehicleIds.length
    ? await supabase
        .from("customer_vehicle_relations")
        .select("customer_id, vehicle_id")
        .or(
          [
            relCustomerIds.length ? `customer_id.in.(${relCustomerIds.join(",")})` : "",
            relVehicleIds.length ? `vehicle_id.in.(${relVehicleIds.join(",")})` : "",
          ]
            .filter(Boolean)
            .join(","),
        )
        .limit(500)
    : { data: [] as { customer_id: string; vehicle_id: string }[] };

  const relations = (rels ?? []) as { customer_id: string; vehicle_id: string }[];
  const extraVehicleIds = relations.map((r) => r.vehicle_id).filter((id) => !relVehicleIds.includes(id));
  const extraCustomerIds = relations.map((r) => r.customer_id).filter((id) => !relCustomerIds.includes(id));

  const [extraVeh, extraCust] = await Promise.all([
    extraVehicleIds.length
      ? supabase.from("ref_vehicles").select(VEH_SELECT).in("id", [...new Set(extraVehicleIds)].slice(0, 60))
      : Promise.resolve({ data: [] }),
    extraCustomerIds.length
      ? supabase.from("customers").select(CUST_SELECT).in("id", [...new Set(extraCustomerIds)].slice(0, 60))
      : Promise.resolve({ data: [] }),
  ]);

  const allVehicles = new Map<string, RefVehicle>();
  for (const v of [...vehicles, ...((extraVeh.data ?? []) as RefVehicle[])]) allVehicles.set(v.id, v);
  const allCustomers = new Map<string, RefCustomer>();
  for (const c of [...customers, ...((extraCust.data ?? []) as RefCustomer[])]) allCustomers.set(c.id, c);

  // Propriétaire courant de chaque véhicule trouvé : relation OWNER active la plus récente
  const customerOfVehicle = await fetchCurrentOwnerByVehicle(vehicles.map((v) => v.id));

  // coordonnées & ville pour l'affichage
  const custList = customers.slice(0, limit);
  const ids = custList.map((c) => c.id);
  const [contacts, addresses] = await Promise.all([
    ids.length ? supabase.from("customer_contacts").select("customer_id, type, value").in("customer_id", ids) : Promise.resolve({ data: [] }),
    ids.length ? supabase.from("customer_addresses").select("customer_id, city").in("customer_id", ids) : Promise.resolve({ data: [] }),
  ]);
  const phoneOf = new Map<string, string>();
  for (const c of (contacts.data ?? []) as { customer_id: string; type: string; value: string }[]) {
    if (c.type !== "EMAIL" && !phoneOf.has(c.customer_id)) phoneOf.set(c.customer_id, c.value);
  }
  const cityOf = new Map<string, string>();
  for (const a of (addresses.data ?? []) as { customer_id: string; city: string | null }[]) {
    if (a.city && !cityOf.has(a.customer_id)) cityOf.set(a.customer_id, a.city);
  }

  return {
    customers: custList.map((c) => ({
      ...c,
      city: cityOf.get(c.id) ?? null,
      phone: phoneOf.get(c.id) ?? null,
      vehicles: relations
        .filter((r) => r.customer_id === c.id)
        .map((r) => allVehicles.get(r.vehicle_id))
        .filter((v): v is RefVehicle => Boolean(v))
        .slice(0, 8),
    })),
    vehicles: vehicles.slice(0, limit).map((v) => ({
      ...v,
      customer: allCustomers.get(customerOfVehicle.get(v.id) ?? "") ?? null,
    })),
    orders: (orderRes.data ?? []).map((o) => ({
      id: o.id,
      or_number: o.or_number,
      or_date: o.or_date,
      site_id: (o as { site_id?: string | null }).site_id ?? null,
      plate: (o.vehicle as { plate?: string } | null)?.plate ?? null,
    })),
  };
}

/** Recherche d'un véhicule du référentiel par immatriculation (scan plaque / OCR OR). */
export async function findRefVehicleByPlate(plate: string): Promise<(RefVehicle & { customer: RefCustomer | null }) | null> {
  const reg = normalizeRegistration(plate);
  if (!reg) return null;
  const { data } = await supabase.from("ref_vehicles").select(VEH_SELECT).eq("registration_normalized", reg).limit(1);
  const v = (data ?? [])[0] as RefVehicle | undefined;
  if (!v) return null;
  const cid = (await fetchCurrentOwnerByVehicle([v.id])).get(v.id);
  if (!cid) return { ...v, customer: null };
  const { data: c } = await supabase.from("customers").select(CUST_SELECT).eq("id", cid).maybeSingle();
  return { ...v, customer: (c as RefCustomer) ?? null };
}

export async function fetchCustomer(id: string) {
  const [{ data: customer }, { data: contacts }, { data: addresses }, { data: rels }] = await Promise.all([
    supabase.from("customers").select("*").eq("id", id).maybeSingle(),
    supabase.from("customer_contacts").select("*").eq("customer_id", id).order("is_primary", { ascending: false }),
    supabase.from("customer_addresses").select("*").eq("customer_id", id).eq("active", true),
    supabase.from("customer_vehicle_relations").select("vehicle_id, relationship_type, active").eq("customer_id", id),
  ]);
  const vehIds = (rels ?? []).map((r) => r.vehicle_id);
  const { data: vehicles } = vehIds.length
    ? await supabase.from("ref_vehicles").select(VEH_SELECT).in("id", vehIds)
    : { data: [] };
  return {
    customer: customer as (RefCustomer & Record<string, unknown>) | null,
    contacts: (contacts ?? []) as { id: string; type: string; value: string; is_primary: boolean; source: string }[],
    addresses: (addresses ?? []) as {
      id: string;
      address_line_1: string | null;
      address_line_2: string | null;
      address_line_3: string | null;
      postal_code: string | null;
      city: string | null;
      country: string | null;
    }[],
    vehicles: (vehicles ?? []) as RefVehicle[],
  };
}

export async function fetchRefVehicle(id: string) {
  const [{ data: vehicle }, { data: rels }, { data: mileages }] = await Promise.all([
    supabase.from("ref_vehicles").select("*").eq("id", id).maybeSingle(),
    supabase
      .from("customer_vehicle_relations")
      .select("customer_id, relationship_type, active, created_at")
      .eq("vehicle_id", id)
      .eq("active", true)
      .eq("relationship_type", "OWNER")
      .order("created_at", { ascending: false }),
    supabase.from("vehicle_mileage_history").select("*").eq("vehicle_id", id).order("measured_at", { ascending: false }).limit(30),
  ]);
  const custIds = (rels ?? []).map((r) => r.customer_id);
  const { data: customersRaw } = custIds.length
    ? await supabase.from("customers").select(CUST_SELECT).in("id", custIds)
    : { data: [] };
  // Ordre = relation OWNER active la plus récente en premier (propriétaire courant)
  const byId = new Map(((customersRaw ?? []) as RefCustomer[]).map((c) => [c.id, c]));
  const customers = custIds.map((cid) => byId.get(cid)).filter((c): c is RefCustomer => Boolean(c));

  const v = vehicle as (RefVehicle & Record<string, unknown>) | null;
  // Historique DDA Connect rattaché par immatriculation normalisée
  let orders: { id: string; or_number: string | null; or_date: string | null; created_at: string }[] = [];
  let legacyVehicleId: string | null = null;
  if (v?.registration_normalized) {
    const { data: lv } = await supabase
      .from("vehicles")
      .select("id")
      .eq("plate_normalized", v.registration_normalized)
      .limit(1);
    legacyVehicleId = (lv ?? [])[0]?.id ?? null;
    if (legacyVehicleId) {
      const { data: ords } = await supabase
        .from("repair_orders")
        .select("id, or_number, or_date, created_at")
        .eq("vehicle_id", legacyVehicleId)
        .order("created_at", { ascending: false })
        .limit(20);
      orders = ords ?? [];
    }
  }
  const orderIds = orders.map((o) => o.id);
  const [{ data: inspections }, { data: expertises }] = await Promise.all([
    orderIds.length
      ? supabase
          .from("vehicle_inspections")
          .select("id, inspection_type, status, started_at, mileage")
          .in("repair_order_id", orderIds)
          .order("started_at", { ascending: false })
      : Promise.resolve({ data: [] }),
    legacyVehicleId
      ? supabase
          .from("vehicle_expertises")
          .select("id, expertise_type, status, created_at")
          .eq("vehicle_id", legacyVehicleId)
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [] }),
  ]);

  return {
    vehicle: v,
    customers: (customers ?? []) as RefCustomer[],
    relations: (rels ?? []) as { customer_id: string; relationship_type: string; active: boolean }[],
    mileages: (mileages ?? []) as { id: string; mileage: number; measured_at: string | null; source: string; created_at: string }[],
    orders,
    inspections: (inspections ?? []) as { id: string; inspection_type: string; status: string; started_at: string; mileage: number | null }[],
    expertises: (expertises ?? []) as { id: string; expertise_type: string; status: string; created_at: string }[],
    legacyVehicleId,
  };
}

export async function fetchSites() {
  const { data, error } = await supabase.from("sites").select("id, name, is_default").order("name");
  if (error) throw error;
  return data ?? [];
}

export async function fetchImports() {
  const { data, error } = await supabase.from("imports").select("*").order("created_at", { ascending: false }).limit(50);
  if (error) throw error;
  return data ?? [];
}

export async function countRef() {
  const [c, v] = await Promise.all([
    supabase.from("customers").select("id", { count: "exact", head: true }),
    supabase.from("ref_vehicles").select("id", { count: "exact", head: true }),
  ]);
  return { customers: c.count ?? 0, vehicles: v.count ?? 0 };
}

export type RefPrefill = {
  vehicleId: string;
  customerId: string | null;
  label: string;
  fields: Record<string, string>;
};

/** Pré-remplissage OR / expertise à partir du référentiel importé (OCR OR, scan plaque). */
export async function refPrefill(plate: string): Promise<RefPrefill | null> {
  const found = await findRefVehicleByPlate(plate);
  if (!found) return null;
  return buildPrefill(found, found.customer);
}

/** Pré-remplissage à partir d'un véhicule déjà sélectionné dans la recherche universelle. */
export async function refPrefillByVehicle(
  vehicleId: string,
  customer?: RefCustomer | null,
): Promise<RefPrefill | null> {
  const { data } = await supabase.from("ref_vehicles").select(VEH_SELECT).eq("id", vehicleId).maybeSingle();
  const v = data as RefVehicle | null;
  if (!v) return null;
  let cust = customer ?? null;
  if (!cust) {
    const cid = (await fetchCurrentOwnerByVehicle([vehicleId])).get(vehicleId);
    if (cid) {
      const { data: c } = await supabase.from("customers").select(CUST_SELECT).eq("id", cid).maybeSingle();
      cust = (c as RefCustomer) ?? null;
    }
  }
  return buildPrefill(v, cust);
}

async function buildPrefill(found: RefVehicle, customer: RefCustomer | null): Promise<RefPrefill> {
  const plate = found.registration_display ?? "";
  const fields: Record<string, string> = {
    plate: found.registration_display ?? plate.toUpperCase(),
    vin: found.vin ?? "",
    brand: found.brand ?? "",
    model: refVehicleModel(found),
    first_registration: found.first_registration_date ?? "",
    mileage: found.last_mileage ? String(found.last_mileage) : "",
  };
  if (customer) {
    fields["last_name"] = customer.last_name ?? customer.company_name ?? "";
    fields["first_name"] = customer.first_name ?? "";
    fields["account_number"] = customer.source_customer_id ?? "";
    const [{ data: contacts }, { data: addresses }] = await Promise.all([
      supabase.from("customer_contacts").select("type, value").eq("customer_id", customer.id).eq("active", true),
      supabase.from("customer_addresses").select("*").eq("customer_id", customer.id).eq("active", true).limit(1),
    ]);
    for (const c of (contacts ?? []) as { type: string; value: string }[]) {
      if (c.type === "EMAIL" && !fields["email"]) fields["email"] = c.value;
      if (c.type === "MOBILE" && !fields["mobile"]) fields["mobile"] = c.value;
      if ((c.type === "PHONE" || c.type === "WORK_PHONE") && !fields["phone"]) fields["phone"] = c.value;
    }
    const a = (addresses ?? [])[0] as
      | { address_line_1: string | null; address_line_2: string | null; postal_code: string | null; city: string | null }
      | undefined;
    if (a) {
      fields["address"] = a.address_line_1 ?? "";
      fields["address_extra"] = a.address_line_2 ?? "";
      fields["postal_code"] = a.postal_code ?? "";
      fields["city"] = a.city ?? "";
    }
  }
  return {
    vehicleId: found.id,
    customerId: customer?.id ?? null,
    label: `${found.registration_display ?? plate} — ${vehicleLabel(found)}${customer ? ` · ${customerName(customer)}` : ""}`,
    fields,
  };
}

/**
 * Le référentiel WinMotor est prioritaire pour l'identité véhicule. Il complète
 * la lecture OR et réaligne la fiche opérationnelle portant la même plaque/VIN.
 * Aucun nettoyage global ni création d'OR n'est effectué ici.
 */
export async function prioritizeRefVehicleIdentity(vehicle: Record<string, unknown>): Promise<Record<string, unknown>> {
  const plate = typeof vehicle["plate"] === "string" ? vehicle["plate"] : "";
  const vin = typeof vehicle["vin"] === "string" ? vehicle["vin"].toUpperCase().replace(/\s/g, "") : "";
  const reg = normalizeRegistration(plate);
  if (!reg && !vin) return vehicle;
  let q = supabase.from("ref_vehicles").select(VEH_SELECT).limit(2);
  q = reg ? q.eq("registration_normalized", reg) : q.eq("vin_normalized", vin);
  const { data } = await q;
  const ref = ((data ?? [])[0] ?? null) as RefVehicle | null;
  if (!ref) return vehicle;
  const identity = {
    plate: ref.registration_display || plate,
    vin: ref.vin || vin || null,
    brand: ref.brand || null,
    model: refVehicleModel(ref) || null,
  };
  const filters = [reg ? `plate_normalized.eq.${reg}` : "", ref.vin ? `vin.eq.${ref.vin}` : ""].filter(Boolean).join(",");
  if (filters) await supabase.from("vehicles").update(identity).or(filters);
  return { ...vehicle, ...Object.fromEntries(Object.entries(identity).filter(([, v]) => v)) };
}
