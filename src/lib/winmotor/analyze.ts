import { buildHeaderIndex, errorMessages, mapRow, type RawRow } from "./mapping";

export type Analysis = {
  fileName: string;
  totalRows: number;
  totalColumns: number;
  customers: number;
  vehicles: number;
  vins: number;
  emails: number;
  phones: number;
  registrations: number;
  mileages: number;
  duplicateVehicles: number;
  duplicateCustomers: number;
  anomalies: number;
  anomalySamples: { row: number; errors: string[] }[];
  encoding: string;
  delimiter: string;
};

export function analyze(
  fileName: string,
  headers: string[],
  rows: RawRow[],
  encoding: string,
  delimiter: string,
): Analysis {
  const index = buildHeaderIndex(headers);
  const vehKeys = new Set<string>();
  const custKeys = new Set<string>();
  let dupV = 0;
  let dupC = 0;
  let vins = 0;
  let emails = 0;
  let phones = 0;
  let regs = 0;
  let mileages = 0;
  let anomalies = 0;
  const samples: { row: number; errors: string[] }[] = [];

  rows.forEach((row, i) => {
    const m = mapRow(row, index);
    const vk = m.sourceVehicleId || (m.vehicle["vin_normalized"] as string) || (m.vehicle["registration_normalized"] as string) || "";
    if (vk) {
      if (vehKeys.has(vk)) dupV++;
      else vehKeys.add(vk);
    }
    const ck =
      m.sourceCustomerId ||
      [m.customer?.["last_name_normalized"], m.customer?.["first_name_normalized"], m.customer?.["company_normalized"]]
        .filter(Boolean)
        .join("|");
    if (m.customer && ck) {
      if (custKeys.has(ck)) dupC++;
      else custKeys.add(ck);
    }
    if (m.vehicle["vin_normalized"]) vins++;
    if (m.vehicle["registration_normalized"]) regs++;
    if (m.mileage) mileages++;
    emails += m.contacts.filter((c) => c.type === "EMAIL").length;
    phones += m.contacts.filter((c) => c.type !== "EMAIL").length;
    if (m.errors.length) {
      anomalies++;
      if (samples.length < 20) samples.push({ row: i + 2, errors: errorMessages(m.errors) });
    }
  });

  return {
    fileName,
    totalRows: rows.length,
    totalColumns: headers.length,
    customers: custKeys.size,
    vehicles: vehKeys.size,
    vins,
    emails,
    phones,
    registrations: regs,
    mileages,
    duplicateVehicles: dupV,
    duplicateCustomers: dupC,
    anomalies,
    anomalySamples: samples,
    encoding,
    delimiter,
  };
}
