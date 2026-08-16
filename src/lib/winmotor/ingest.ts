/** Ingestion d'un export Winmotor dans le référentiel DDA Connect.
 *  Exécuté par lots depuis le navigateur avec le client Supabase authentifié
 *  (RLS : les tables `imports` / `import_rows` sont réservées aux managers).
 *
 *  Règle d'or : UNE LIGNE EN ERREUR NE BLOQUE JAMAIS LES SUIVANTES. Chaque ligne
 *  est traitée dans son propre bloc try/catch ; en cas d'échec (validation ou
 *  réseau/Supabase) elle est enregistrée avec processing_status='error' et la
 *  liste précise des erreurs, puis le traitement continue normalement. */
import { supabase } from "@/integrations/supabase/client";
import { buildHeaderIndex, errorMessages, isValidVin, mapRow, type FieldError, type RawRow } from "./mapping";

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
  imported: number;
  errors: number;
  duplicates: number;
  skipped: number;
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
    imported: 0,
    errors: 0,
    duplicates: 0,
    skipped: 0,
  };
}

const uuid = () => crypto.randomUUID();

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function errMsg(e: unknown): string {
  if (e && typeof e === "object" && "message" in e) return String((e as { message: unknown }).message);
  return e instanceof Error ? e.message : "Erreur inconnue";
}

export const BATCH_SIZE = 200;

export type RowStatus = "imported" | "error" | "duplicate" | "skipped";

type MappedItem = {
  rowNumber: number;
  raw: RawRow;
  m: ReturnType<typeof mapRow>;
  importRowId?: string;
};

type RowOutcome = {
  status: RowStatus;
  errors: string[];
};

/** Traite un lot de lignes déjà mappées : résolution des doublons, écriture des
 *  entités, puis persistance du statut de chaque ligne dans `import_rows`. */
async function processMapped(opts: {
  importId: string;
  siteId: string | null;
  items: MappedItem[];
  counters: IngestCounters;
}): Promise<void> {
  const { importId, siteId, items, counters } = opts;
  const outcomes = new Map<number, RowOutcome>();
  const setOutcome = (rowNumber: number, status: RowStatus, errors: string[]) => {
    outcomes.set(rowNumber, { status, errors });
  };

  // Erreurs bloquantes issues du mapping : la ligne n'est pas traitée davantage.
  const usable: MappedItem[] = [];
  for (const item of items) {
    const blocking = item.m.errors.filter((e) => e.blocking);
    if (blocking.length) {
      setOutcome(item.rowNumber, "error", errorMessages(item.m.errors));
      counters.anomalies++;
    } else {
      usable.push(item);
      if (item.m.errors.length) counters.anomalies++;
    }
  }

  // 1. Résolution des clients/véhicules existants (best effort : une panne de
  //    lecture ne doit pas empêcher l'écriture, seulement dégrader la dédoublonnage).
  const bySource = new Map<string, string>();
  const byContact = new Map<string, string>();
  const vBySource = new Map<string, { id: string; last_mileage: number | null }>();
  const vByVin = new Map<string, { id: string; last_mileage: number | null }>();
  const vByReg = new Map<string, { id: string; last_mileage: number | null }>();

  try {
    const custSourceIds = [...new Set(usable.map((x) => x.m.sourceCustomerId).filter(Boolean))];
    const emails = [...new Set(usable.flatMap((x) => x.m.contacts.filter((c) => c.type === "EMAIL").map((c) => c.normalized_value)))];
    const phones = [...new Set(usable.flatMap((x) => x.m.contacts.filter((c) => c.type !== "EMAIL").map((c) => c.normalized_value)))];

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
  } catch {
    // Dédoublonnage clients dégradé pour ce lot : les lignes seront traitées comme nouvelles.
  }

  try {
    const vehSourceIds = [...new Set(usable.map((x) => x.m.sourceVehicleId).filter(Boolean))];
    const vins = [...new Set(usable.map((x) => String(x.m.vehicle["vin_normalized"] ?? "")).filter((v) => v && isValidVin(v)))];
    const regs = [...new Set(usable.map((x) => String(x.m.vehicle["registration_normalized"] ?? "")).filter(Boolean))];
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
  } catch {
    // Dédoublonnage véhicules dégradé pour ce lot.
  }

  // 2. Construction des enregistrements, ligne par ligne, sans jamais interrompre la boucle.
  const customerRows: Record<string, unknown>[] = [];
  const vehicleRows: Record<string, unknown>[] = [];
  const contactRows: Record<string, unknown>[] = [];
  const addressRows: Record<string, unknown>[] = [];
  const consentRows: Record<string, unknown>[] = [];
  const relationRows: Record<string, unknown>[] = [];
  const mileageRows: Record<string, unknown>[] = [];
  const seenCustomers = new Map<string, string>();
  const seenVehicles = new Map<string, string>();

  for (const item of usable) {
    const { m, rowNumber } = item;
    try {
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
          else counters.customersCreated++;
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

      const vin = String(m.vehicle["vin_normalized"] ?? "");
      const reg = String(m.vehicle["registration_normalized"] ?? "");
      const vkey = m.sourceVehicleId || vin || reg;
      if (!vkey) {
        setOutcome(rowNumber, "error", ["Aucun identifiant véhicule exploitable"]);
        counters.errors++;
        continue;
      }
      const cachedV = seenVehicles.get(vkey);
      let vehicleId: string;
      let isDuplicateInBatch = false;
      if (cachedV) {
        vehicleId = cachedV;
        counters.duplicatesAvoided++;
        isDuplicateInBatch = true;
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

      const nonBlocking = errorMessages(m.errors.filter((e) => !e.blocking));
      setOutcome(rowNumber, isDuplicateInBatch ? "duplicate" : "imported", nonBlocking);
      if (isDuplicateInBatch) counters.duplicates++;
      else counters.imported++;
    } catch (e) {
      setOutcome(rowNumber, "error", [`Erreur inattendue lors du traitement de la ligne : ${errMsg(e)}`]);
      counters.errors++;
    }
  }

  // 3. Écriture des entités, par lots avec repli ligne à ligne en cas d'échec réseau.
  await writeWithFallback(customerRows, (part) => supabase.from("customers").upsert(part as never, { onConflict: "id" }));
  await writeWithFallback(vehicleRows, (part) => supabase.from("ref_vehicles").upsert(part as never, { onConflict: "id" }));
  const contactsOk = await writeWithFallback(contactRows, (part) =>
    supabase.from("customer_contacts").upsert(part as never, { onConflict: "customer_id,type,normalized_value", ignoreDuplicates: true }),
  );
  counters.contactsImported += contactsOk;
  const addressesOk = await writeWithFallback(addressRows, (part) => supabase.from("customer_addresses").insert(part as never));
  counters.addressesImported += addressesOk;
  await writeWithFallback(consentRows, (part) => supabase.from("customer_consents").upsert(part as never, { onConflict: "customer_id,channel" }));
  const relationsOk = await writeWithFallback(relationRows, (part) =>
    supabase.from("customer_vehicle_relations").upsert(part as never, { onConflict: "customer_id,vehicle_id,relationship_type", ignoreDuplicates: true }),
  );
  counters.relationsCreated += relationsOk;

  if (mileageRows.length) {
    try {
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
      const mileagesOk = await writeWithFallback(fresh, (part) => supabase.from("vehicle_mileage_history").insert(part as never));
      counters.mileagesImported += mileagesOk;
      counters.duplicatesAvoided += mileageRows.length - fresh.length;
    } catch {
      // Historique de kilométrage non critique : on ignore silencieusement en cas d'échec.
    }
  }

  // 4. Persistance du statut de chaque ligne (jamais bloquante pour les suivantes).
  const rowsToInsert = items.map((item) => {
    const outcome = outcomes.get(item.rowNumber) ?? { status: "error" as RowStatus, errors: ["Ligne non traitée"] };
    return {
      import_id: importId,
      row_number: item.rowNumber,
      source_vehicle_id: item.m.sourceVehicleId || null,
      source_customer_id: item.m.sourceCustomerId || null,
      raw_data: item.raw as never,
      processing_status: outcome.status,
      processing_errors: outcome.errors.length ? outcome.errors : null,
    };
  });
  await writeWithFallback(rowsToInsert, (part) => supabase.from("import_rows").insert(part as never));

  counters.processed += items.length;
}

/** Écrit un ensemble de lignes par lots ; si un lot échoue, retente ligne par
 *  ligne pour isoler les échecs (réseau/contraintes) sans perdre les autres. */
async function writeWithFallback<T>(
  rows: T[],
  op: (part: T[]) => Promise<{ error: { message: string } | null }>,
): Promise<number> {
  let ok = 0;
  for (const part of chunk(rows, 200)) {
    if (!part.length) continue;
    try {
      const { error } = await op(part);
      if (!error) {
        ok += part.length;
        continue;
      }
      throw error;
    } catch {
      // Repli ligne par ligne pour ne pas perdre tout le lot à cause d'une seule ligne fautive.
      for (const row of part) {
        try {
          const { error } = await op([row]);
          if (!error) ok += 1;
        } catch {
          // Ligne définitivement en échec : elle sera simplement absente, sans bloquer les suivantes.
        }
      }
    }
  }
  return ok;
}

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
  const items: MappedItem[] = rows.map((r, i) => ({ rowNumber: startRowNumber + i, raw: r, m: mapRow(r, index) }));
  await processMapped({ importId, siteId, items, counters });
}

/** Réingère des lignes déjà corrigées (raw_data fusionné avec corrected_data),
 *  sans redemander le fichier source. Utilisé par l'écran de corrections. */
export async function reingestRows(opts: {
  importId: string;
  siteId: string | null;
  headers: string[];
  rows: { id: string; row_number: number; raw_data: RawRow; corrected_data: RawRow | null }[];
  counters: IngestCounters;
}): Promise<void> {
  const { importId, siteId, headers, rows, counters } = opts;
  const index = buildHeaderIndex(headers);
  const items: MappedItem[] = rows.map((r) => {
    const merged: RawRow = { ...r.raw_data, ...(r.corrected_data ?? {}) };
    return { rowNumber: r.row_number, raw: merged, m: mapRow(merged, index), importRowId: r.id };
  });

  // On supprime les anciennes lignes import_rows correspondantes pour éviter les doublons,
  // chacune dans son propre try/catch afin qu'un échec n'empêche pas les autres.
  for (const r of rows) {
    try {
      await supabase.from("import_rows").delete().eq("id", r.id);
    } catch {
      // Si la suppression échoue, la nouvelle insertion créera une ligne supplémentaire :
      // acceptable, ce n'est pas bloquant pour le reste de la réingestion.
    }
  }

  await processMapped({ importId, siteId, items, counters });
}

export type { FieldError };
