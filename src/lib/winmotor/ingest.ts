/** Ingestion d'un export Winmotor dans le référentiel DDA Connect.
 *  Exécuté par lots depuis le navigateur avec le client Supabase authentifié
 *  (RLS : les tables `imports` / `import_rows` sont réservées aux managers). */
import { supabase } from "@/integrations/supabase/client";
import { buildHeaderIndex, isValidVin, mapRow, type RawRow } from "./mapping";

export type IngestCounters = {
  processed: number;
  customersCreated: number;
  customersUpdated: number;
  vehiclesCreated: number;
  vehiclesUpdated: number;
  relationsCreated: number;
  contactsImported: number;
  addressesImported: number;
  mileagesImported: number;
  duplicatesAvoided: number;
  anomalies: number;
};

export function emptyCounters(): IngestCounters {
  return {
    processed: 0,
    customersCreated: 0,
    customersUpdated: 0,
    vehiclesCreated: 0,
    vehiclesUpdated: 0,
    relationsCreated: 0,
    contactsImported: 0,
    addressesImported: 0,
    mileagesImported: 0,
    duplicatesAvoided: 0,
    anomalies: 0,
  };
}

const uuid = () => crypto.randomUUID();

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export const BATCH_SIZE = 200;

export async function ingestBatch(opts: {
  importId: string;
  siteId: string | null;
  headers: string[];
  rows: RawRow[];
  startRowNumber: number;
  counters: IngestCounters;
}): Promise<void> {
  const { importId, siteId, headers, rows, startRowNumber, counters } = opts;
  const index = buildHeaderIndex(headers);
  const mapped = rows.map((r, i) => ({ rowNumber: startRowNumber + i, raw: r, m: mapRow(r, index) }));

  // 1. Conservation intégrale des lignes source
  await supabase.from("import_rows").insert(
    mapped.map((x) => ({
      import_id: importId,
      row_number: x.rowNumber,
      source_vehicle_id: x.m.sourceVehicleId || null,
      source_customer_id: x.m.sourceCustomerId || null,
      raw_data: x.raw as never,
      processing_status: x.m.errors.length ? "anomaly" : "ok",
      processing_errors: x.m.errors.length ? x.m.errors : null,
    })) as never,
  );
  counters.anomalies += mapped.filter((x) => x.m.errors.length).length;

  // 2. Résolution des clients existants
  const custSourceIds = [...new Set(mapped.map((x) => x.m.sourceCustomerId).filter(Boolean))];
  const emails = [...new Set(mapped.flatMap((x) => x.m.contacts.filter((c) => c.type === "EMAIL").map((c) => c.normalized_value)))];
  const phones = [...new Set(mapped.flatMap((x) => x.m.contacts.filter((c) => c.type !== "EMAIL").map((c) => c.normalized_value)))];

  const bySource = new Map<string, string>();
  const byContact = new Map<string, string>();
  if (custSourceIds.length) {
    for (const part of chunk(custSourceIds, 300)) {
      const { data } = await supabase
        .from("customers")
        .select("id, source_customer_id")
        .eq("source_system", "winmotor")
        .in("source_customer_id", part);
      for (const c of data ?? []) if (c.source_customer_id) bySource.set(c.source_customer_id, c.id);
    }
  }
  for (const part of chunk([...emails, ...phones], 300)) {
    if (!part.length) continue;
    const { data } = await supabase
      .from("customer_contacts")
      .select("customer_id, normalized_value")
      .in("normalized_value", part);
    for (const c of data ?? []) if (!byContact.has(c.normalized_value ?? "")) byContact.set(c.normalized_value ?? "", c.customer_id);
  }

  // 3. Résolution des véhicules existants
  const vehSourceIds = [...new Set(mapped.map((x) => x.m.sourceVehicleId).filter(Boolean))];
  const vins = [...new Set(mapped.map((x) => String(x.m.vehicle["vin_normalized"] ?? "")).filter((v) => v && isValidVin(v)))];
  const regs = [...new Set(mapped.map((x) => String(x.m.vehicle["registration_normalized"] ?? "")).filter(Boolean))];

  const vBySource = new Map<string, { id: string; last_mileage: number | null }>();
  const vByVin = new Map<string, { id: string; last_mileage: number | null }>();
  const vByReg = new Map<string, { id: string; last_mileage: number | null }>();
  const sel = "id, source_vehicle_id, vin_normalized, registration_normalized, last_mileage";
  for (const part of chunk(vehSourceIds, 300)) {
    const { data } = await supabase.from("ref_vehicles").select(sel).eq("source_system", "winmotor").in("source_vehicle_id", part);
    for (const v of data ?? []) if (v.source_vehicle_id) vBySource.set(v.source_vehicle_id, v);
  }
  for (const part of chunk(vins, 300)) {
    const { data } = await supabase.from("ref_vehicles").select(sel).in("vin_normalized", part);
    for (const v of data ?? []) if (v.vin_normalized) vByVin.set(v.vin_normalized, v);
  }
  for (const part of chunk(regs, 300)) {
    const { data } = await supabase.from("ref_vehicles").select(sel).in("registration_normalized", part);
    for (const v of data ?? []) if (v.registration_normalized) vByReg.set(v.registration_normalized, v);
  }

  // 4. Construction des enregistrements
  const customerRows: Record<string, unknown>[] = [];
  const vehicleRows: Record<string, unknown>[] = [];
  const contactRows: Record<string, unknown>[] = [];
  const addressRows: Record<string, unknown>[] = [];
  const consentRows: Record<string, unknown>[] = [];
  const relationRows: Record<string, unknown>[] = [];
  const mileageRows: Record<string, unknown>[] = [];
  const seenCustomers = new Map<string, string>();
  const seenVehicles = new Map<string, string>();
  const newCustomerIds = new Set<string>();

  for (const { m } of mapped) {
    // --- client
    let customerId: string | null = null;
    if (m.customer) {
      const key =
        m.sourceCustomerId ||
        m.contacts[0]?.normalized_value ||
        [m.customer["last_name_normalized"], m.customer["first_name_normalized"], m.customer["company_normalized"]].join("|");
      const cached = seenCustomers.get(key);
      if (cached) {
        customerId = cached;
        counters.duplicatesAvoided++;
      } else {
        const existing =
          (m.sourceCustomerId ? bySource.get(m.sourceCustomerId) : undefined) ??
          m.contacts.map((c) => byContact.get(c.normalized_value)).find(Boolean);
        customerId = existing ?? uuid();
        if (existing) counters.customersUpdated++;
        else {
          counters.customersCreated++;
          newCustomerIds.add(customerId);
        }
        seenCustomers.set(key, customerId);
        customerRows.push({ id: customerId, site_id: siteId, source_system: "winmotor", import_id: importId, ...m.customer });
        for (const c of m.contacts) {
          contactRows.push({
            customer_id: customerId,
            type: c.type,
            value: c.value,
            normalized_value: c.normalized_value,
            source: "WINMOTOR",
            source_import_id: importId,
            is_primary: c.is_primary,
          });
        }
        if (m.address && !existing) {
          addressRows.push({ customer_id: customerId, ...m.address, source: "WINMOTOR", source_import_id: importId });
        }
        for (const cs of m.consents) {
          consentRows.push({ customer_id: customerId, ...cs, source: "WINMOTOR", source_import_id: importId });
        }
      }
    }

    // --- véhicule
    const vin = String(m.vehicle["vin_normalized"] ?? "");
    const reg = String(m.vehicle["registration_normalized"] ?? "");
    const vkey = m.sourceVehicleId || vin || reg;
    if (!vkey) continue;
    const cachedV = seenVehicles.get(vkey);
    let vehicleId: string;
    if (cachedV) {
      vehicleId = cachedV;
      counters.duplicatesAvoided++;
    } else {
      const existing =
        (m.sourceVehicleId ? vBySource.get(m.sourceVehicleId) : undefined) ??
        (vin && isValidVin(vin) ? vByVin.get(vin) : undefined) ??
        (reg ? vByReg.get(reg) : undefined);
      vehicleId = existing?.id ?? uuid();
      if (existing) counters.vehiclesUpdated++;
      else counters.vehiclesCreated++;
      seenVehicles.set(vkey, vehicleId);

      const veh = { ...m.vehicle } as Record<string, unknown>;
      // Le kilométrage ne régresse jamais : on garde la valeur opérationnelle la plus élevée.
      const known = existing?.last_mileage ?? null;
      const incoming = veh["last_mileage"] as number | null;
      if (known !== null && (incoming === null || incoming < known)) {
        veh["last_mileage"] = known;
        delete veh["last_mileage_at"];
        if (incoming !== null && incoming < known) counters.anomalies++;
      }
      vehicleRows.push({ id: vehicleId, site_id: siteId, source_system: "winmotor", import_id: importId, ...veh });

      if (m.mileage) {
        mileageRows.push({
          vehicle_id: vehicleId,
          mileage: m.mileage.mileage,
          measured_at: m.mileage.measured_at,
          source: "WINMOTOR_IMPORT",
          import_id: importId,
        });
      }
    }

    if (customerId) {
      relationRows.push({
        customer_id: customerId,
        vehicle_id: vehicleId,
        relationship_type: "OWNER",
        active: true,
        source: "WINMOTOR",
        import_id: importId,
      });
    }
  }

  // 5. Écriture
  for (const part of chunk(customerRows, 200)) {
    const { error } = await supabase.from("customers").upsert(part as never, { onConflict: "id" });
    if (error) throw error;
  }
  for (const part of chunk(vehicleRows, 200)) {
    const { error } = await supabase.from("ref_vehicles").upsert(part as never, { onConflict: "id" });
    if (error) throw error;
  }
  for (const part of chunk(contactRows, 300)) {
    const { error } = await supabase
      .from("customer_contacts")
      .upsert(part as never, { onConflict: "customer_id,type,normalized_value", ignoreDuplicates: true });
    if (!error) counters.contactsImported += part.length;
  }
  for (const part of chunk(addressRows, 300)) {
    const { error } = await supabase.from("customer_addresses").insert(part as never);
    if (!error) counters.addressesImported += part.length;
  }
  for (const part of chunk(consentRows, 300)) {
    await supabase.from("customer_consents").upsert(part as never, { onConflict: "customer_id,channel" });
  }
  for (const part of chunk(relationRows, 300)) {
    const { error } = await supabase
      .from("customer_vehicle_relations")
      .upsert(part as never, { onConflict: "customer_id,vehicle_id,relationship_type", ignoreDuplicates: true });
    if (!error) counters.relationsCreated += part.length;
  }
  if (mileageRows.length) {
    const vehIds = [...new Set(mileageRows.map((r) => r["vehicle_id"] as string))];
    const existingKeys = new Set<string>();
    for (const part of chunk(vehIds, 300)) {
      const { data } = await supabase
        .from("vehicle_mileage_history")
        .select("vehicle_id, mileage")
        .eq("source", "WINMOTOR_IMPORT")
        .in("vehicle_id", part);
      for (const r of data ?? []) existingKeys.add(`${r.vehicle_id}:${r.mileage}`);
    }
    const fresh = mileageRows.filter((r) => !existingKeys.has(`${r["vehicle_id"]}:${r["mileage"]}`));
    for (const part of chunk(fresh, 300)) {
      const { error } = await supabase.from("vehicle_mileage_history").insert(part as never);
      if (!error) counters.mileagesImported += part.length;
    }
    counters.duplicatesAvoided += mileageRows.length - fresh.length;
  }

  counters.processed += rows.length;
}
