/** Référentiel Clients / Véhicules DDA Connect : recherche universelle et fiches. */
import { supabase } from "@/integrations/supabase/client";
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
};

const VEH_SELECT =
  "id, registration_display, registration_normalized, vin, brand, range_name, model, version, color, energy, first_registration_date, next_ct_date, last_ct_date, last_mileage, last_mileage_at, last_visit_at, source_vehicle_id, site_id";
const CUST_SELECT = "id, source_customer_id, customer_type, civility, last_name, first_name, company_name";

export function customerName(c: Pick<RefCustomer, "first_name" | "last_name" | "company_name"> | null): string {
  if (!c) return "—";
  if (c.company_name) return c.company_name;
  return [c.first_name, c.last_name].filter(Boolean).join(" ") || "—";
}

export function vehicleLabel(v: Pick<RefVehicle, "brand" | "model" | "range_name" | "version"> | null): string {
  if (!v) return "—";
  return [v.brand, v.range_name || v.model, v.version].filter(Boolean).join(" ") || "—";
}

export type SearchResult = {
  customers: (RefCustomer & { vehicles: RefVehicle[]; city: string | null; phone: string | null })[];
  vehicles: (RefVehicle & { customer: RefCustomer | null })[];
  orders: { id: string; or_number: string | null; or_date: string | null; plate: string | null }[];
};

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
      .select("id, or_number, or_date, vehicle:vehicles(plate)")
      .ilike("or_number", `%${raw}%`)
      .limit(5),
  ]);

  const customerIds = new Set<string>((custRes.data ?? []).map((c) => c.id));
  for (const c of (contactRes.data ?? []) as { customer_id: string }[]) customerIds.add(c.customer_id);

  let customers = (custRes.data ?? []) as RefCustomer[];
  const missing = [...customerIds].filter((id) => !customers.some((c) => c.id === id));
  if (missing.length) {
    const { data } = await supabase.from("customers").select(CUST_SELECT).in("id", missing);
    customers = [...customers, ...((data ?? []) as RefCustomer[])];
  }

  const vehicles = (vehRes.data ?? []) as RefVehicle[];

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

  const customerOfVehicle = new Map<string, string>();
  for (const r of relations) if (!customerOfVehicle.has(r.vehicle_id)) customerOfVehicle.set(r.vehicle_id, r.customer_id);

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
  const { data: rel } = await supabase
    .from("customer_vehicle_relations")
    .select("customer_id")
    .eq("vehicle_id", v.id)
    .eq("active", true)
    .limit(1);
  const cid = (rel ?? [])[0]?.customer_id;
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
    supabase.from("customer_vehicle_relations").select("customer_id, relationship_type, active").eq("vehicle_id", id),
    supabase.from("vehicle_mileage_history").select("*").eq("vehicle_id", id).order("measured_at", { ascending: false }).limit(30),
  ]);
  const custIds = (rels ?? []).map((r) => r.customer_id);
  const { data: customers } = custIds.length
    ? await supabase.from("customers").select(CUST_SELECT).in("id", custIds)
    : { data: [] };

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
