/** Mapping du format d'export Winmotor vers le référentiel DDA Connect.
 *  Partagé client/serveur : aucune dépendance navigateur ou serveur ici. */

export type RawRow = Record<string, string>;

export function normHeader(h: string): string {
  return h
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

/** Recherche une colonne : correspondance exacte normalisée d'abord, puis "contient". */
export function pick(row: RawRow, index: Record<string, string>, aliases: string[]): string {
  for (const a of aliases) {
    const key = index[normHeader(a)];
    if (key !== undefined) {
      const v = (row[key] ?? "").trim();
      if (v) return v;
    }
  }
  for (const a of aliases) {
    const target = normHeader(a);
    for (const [nk, key] of Object.entries(index)) {
      if (nk.includes(target)) {
        const v = (row[key] ?? "").trim();
        if (v) return v;
      }
    }
  }
  return "";
}

export function buildHeaderIndex(headers: string[]): Record<string, string> {
  const idx: Record<string, string> = {};
  for (const h of headers) {
    const n = normHeader(h);
    if (n && idx[n] === undefined) idx[n] = h;
  }
  return idx;
}

export function normalizeRegistration(v: string): string {
  return (v || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function formatRegistration(v: string): string {
  const n = normalizeRegistration(v);
  const m = /^([A-Z]{2})(\d{3})([A-Z]{2})$/.exec(n);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const old = /^(\d{1,4})([A-Z]{2,3})(\d{2,3})$/.exec(n);
  if (old) return `${old[1]}-${old[2]}-${old[3]}`;
  return n;
}

export function normalizeVin(v: string): string {
  const n = (v || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return n.length >= 11 ? n : "";
}

export function isValidVin(v: string): boolean {
  const n = normalizeVin(v);
  return n.length === 17 && !/[IOQ]/.test(n);
}

export function normalizePhone(v: string): string {
  let d = (v || "").replace(/[^\d+]/g, "");
  if (d.startsWith("+33")) d = `0${d.slice(3)}`;
  else if (d.startsWith("0033")) d = `0${d.slice(4)}`;
  d = d.replace(/\D/g, "");
  return d.length >= 6 ? d : "";
}

export function normalizeEmail(v: string): string {
  const e = (v || "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : "";
}

export function normalizeName(v: string): string {
  return (v || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

/** Dates Winmotor : JJ/MM/AAAA, AAAA-MM-JJ, JJ.MM.AA, ou série Excel. */
export function parseDate(v: string): string | null {
  const s = (v || "").trim();
  if (!s || /^0+$/.test(s)) return null;
  let m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(s);
  if (m) {
    let y = Number(m[3]);
    if (y < 100) y += y < 50 ? 2000 : 1900;
    return iso(y, Number(m[2]), Number(m[1]));
  }
  m = /^(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})/.exec(s);
  if (m) return iso(Number(m[1]), Number(m[2]), Number(m[3]));
  if (/^\d{8}$/.test(s)) return iso(Number(s.slice(0, 4)), Number(s.slice(4, 6)), Number(s.slice(6, 8)));
  if (/^\d{5}$/.test(s)) {
    const d = new Date(Date.UTC(1899, 11, 30) + Number(s) * 86400000);
    return d.toISOString().slice(0, 10);
  }
  return null;
}

function iso(y: number, mo: number, d: number): string | null {
  if (!y || !mo || !d || mo > 12 || d > 31 || y < 1900 || y > 2100) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function parseInt0(v: string): number | null {
  const n = Number((v || "").replace(/[^\d-]/g, ""));
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

export type FieldError = {
  /** Nom du champ concerné (clé technique, ex. "vin", "registration"). */
  field: string;
  /** Message en français, précis, mentionnant le champ et la valeur d'origine. */
  message: string;
  /** Erreur bloquante (empêche l'import de la ligne) ou simple alerte. */
  blocking: boolean;
};

export type MappedRow = {
  sourceVehicleId: string;
  sourceCustomerId: string;
  vehicle: Record<string, unknown>;
  customer: Record<string, unknown> | null;
  contacts: { type: string; value: string; normalized_value: string; is_primary: boolean }[];
  address: Record<string, unknown> | null;
  consents: { channel: string; allowed: boolean | null; raw_value: string }[];
  mileage: { mileage: number; measured_at: string | null } | null;
  errors: FieldError[];
};

/** Erreurs bloquantes uniquement (empêchent l'import de la ligne). */
export function blockingErrors(errors: FieldError[]): FieldError[] {
  return errors.filter((e) => e.blocking);
}

/** Messages simples (rétro-compatibilité affichage). */
export function errorMessages(errors: FieldError[]): string[] {
  return errors.map((e) => e.message);
}

const YES = /^(1|O|OUI|Y|YES|TRUE|VRAI|X)$/i;
const NO = /^(0|N|NON|NO|FALSE|FAUX)$/i;

function consent(v: string): boolean | null {
  if (!v) return null;
  if (YES.test(v.trim())) return true;
  if (NO.test(v.trim())) return false;
  return null;
}

export function mapRow(row: RawRow, index: Record<string, string>): MappedRow {
  const p = (aliases: string[]) => pick(row, index, aliases);
  const errors: FieldError[] = [];

  const sourceVehicleId = p(["Numero du vehicule", "Numero vehicule", "No vehicule", "Cle vehicule", "Id vehicule"]);
  const sourceCustomerId = p(["Numero du client", "Numero client", "Compte client", "No client", "Code client", "Cle client"]);

  const regRaw = p(["Immatriculation", "Immat", "Plaque", "Numero immatriculation"]);
  const registration_normalized = normalizeRegistration(regRaw);
  const vinRaw = p(["Numero de serie", "VIN", "Numero serie", "No de serie", "Chassis"]);
  const vin_normalized = normalizeVin(vinRaw);

  if (!registration_normalized && !vin_normalized && !sourceVehicleId) {
    errors.push({
      field: "registration",
      message: "Aucun identifiant véhicule (immatriculation, VIN ou numéro de véhicule)",
      blocking: true,
    });
  }
  if (vinRaw && !vin_normalized) {
    errors.push({ field: "vin", message: `VIN illisible : « ${vinRaw} »`, blocking: false });
  } else if (vinRaw && vin_normalized && !isValidVin(vin_normalized)) {
    errors.push({
      field: "vin",
      message: `VIN invalide (17 caractères attendus) : ${vin_normalized}`,
      blocking: false,
    });
  }

  const lastMileage = parseInt0(p(["Dernier kilometrage", "Kilometrage", "Km", "Kilometrage actuel", "Dernier km"]));
  const lastMileageAt = parseDate(p(["Date dernier kilometrage", "Date kilometrage", "Date du kilometrage"]));
  const lastVisit = parseDate(p(["Date derniere visite", "Derniere visite", "Date dernier passage", "Date de derniere facture"]));

  const vehicle = {
    source_vehicle_id: sourceVehicleId || null,
    registration_display: regRaw ? formatRegistration(regRaw) : null,
    registration_normalized: registration_normalized || null,
    previous_registration: p(["Ancienne immatriculation", "Immatriculation precedente", "Ancienne immat"]) || null,
    vin: vinRaw || null,
    vin_normalized: vin_normalized || null,
    brand: p(["Marque", "Constructeur"]) || null,
    range_name: p(["Gamme"]) || null,
    model: p(["Modele"]) || null,
    version: p(["Version"]) || null,
    variant: p(["Variante"]) || null,
    trim_level: p(["Finition"]) || null,
    vehicle_type: p(["Type de vehicule", "Type vehicule", "Genre"]) || null,
    body_type: p(["Carrosserie"]) || null,
    color: p(["Couleur", "Teinte"]) || null,
    energy: p(["Energie", "Carburant"]) || null,
    power_hp: p(["Puissance fiscale", "Puissance CV", "Puissance"]) || null,
    power_kw: p(["Puissance kw", "Puissance reelle"]) || null,
    engine_size: p(["Cylindree"]) || null,
    gearbox: p(["Boite de vitesses", "Boite", "Transmission"]) || null,
    doors: parseInt0(p(["Nombre de portes", "Nb portes", "Portes"])),
    seats: parseInt0(p(["Nombre de places", "Nb places", "Places"])),
    engine_code: p(["Code moteur", "Type moteur"]) || null,
    gearbox_code: p(["Code boite", "Type boite"]) || null,
    type_mine: p(["Type mine"]) || null,
    cnit: p(["CNIT"]) || null,
    d2_code: p(["D2"]) || null,
    tvv: p(["TVV"]) || null,
    first_registration_date: parseDate(p(["Date de mise en circulation", "Mise en circulation", "Date MEC", "MEC", "1ere mise en circulation"])),
    purchase_date: parseDate(p(["Date d achat", "Date achat"])),
    delivery_date: parseDate(p(["Date de livraison", "Date livraison"])),
    sale_date: parseDate(p(["Date de vente", "Date vente"])),
    last_ct_date: parseDate(p(["Date dernier controle technique", "Dernier controle technique", "Date CT"])),
    next_ct_date: parseDate(p(["Date prochain controle technique", "Prochain controle technique", "Echeance CT", "Prochain CT"])),
    last_mileage: lastMileage,
    last_mileage_at: lastMileageAt ? `${lastMileageAt}T00:00:00Z` : null,
    last_visit_at: lastVisit ? `${lastVisit}T00:00:00Z` : null,
    next_service_at: parseDate(p(["Prochaine echeance entretien", "Date prochain entretien", "Prochain entretien"])),
  };

  const lastName = p(["Nom du client", "Nom client", "Nom"]);
  const firstName = p(["Prenom du client", "Prenom client", "Prenom"]);
  const company = p(["Raison sociale", "Societe", "Nom societe", "Denomination"]);
  const hasCustomer = Boolean(sourceCustomerId || lastName || company);

  const customer = hasCustomer
    ? {
        source_customer_id: sourceCustomerId || null,
        customer_type: company ? "company" : "individual",
        civility: p(["Civilite", "Titre"]) || null,
        last_name: lastName || null,
        first_name: firstName || null,
        company_name: company || null,
        siret: p(["SIRET"]) || null,
        siren: p(["SIREN"]) || null,
        vat_number: p(["Numero TVA", "TVA intracommunautaire", "TVA"]) || null,
        last_name_normalized: normalizeName(lastName) || null,
        first_name_normalized: normalizeName(firstName) || null,
        company_normalized: normalizeName(company) || null,
      }
    : null;

  const contacts: MappedRow["contacts"] = [];
  const addContact = (type: string, value: string, primary: boolean) => {
    if (!value) return;
    const nv = type === "EMAIL" ? normalizeEmail(value) : normalizePhone(value);
    if (!nv) return;
    if (contacts.some((c) => c.type === type && c.normalized_value === nv)) return;
    contacts.push({ type, value, normalized_value: nv, is_primary: primary && !contacts.some((c) => c.type === type) });
  };
  addContact("EMAIL", p(["Email", "E-mail", "Adresse email", "Mail"]), true);
  addContact("EMAIL", p(["Email 2", "Second email", "Email secondaire", "Email professionnel"]), false);
  addContact("MOBILE", p(["Portable", "Mobile", "Telephone portable", "Tel portable", "GSM"]), true);
  addContact("PHONE", p(["Telephone", "Tel", "Telephone domicile", "Tel domicile", "Telephone fixe"]), true);
  addContact("WORK_PHONE", p(["Telephone professionnel", "Tel bureau", "Telephone bureau", "Tel professionnel"]), true);
  addContact("OTHER", p(["Fax", "Autre telephone", "Telephone 2"]), false);

  const a1 = p(["Adresse", "Adresse 1", "Rue"]);
  const address =
    a1 || p(["Code postal", "CP"]) || p(["Ville"])
      ? {
          address_line_1: a1 || null,
          address_line_2: p(["Complement d adresse", "Adresse 2", "Complement"]) || null,
          address_line_3: p(["Adresse 3", "Lieu dit"]) || null,
          postal_code: p(["Code postal", "CP"]) || null,
          city: p(["Ville", "Commune"]) || null,
          country: p(["Pays"]) || null,
        }
      : null;

  const consents = [
    { channel: "EMAIL", raw: p(["Autorisation email", "Accord email", "Opt in email", "Email autorise"]) },
    { channel: "SMS", raw: p(["Autorisation sms", "Accord sms", "Opt in sms", "SMS autorise"]) },
    { channel: "PHONE", raw: p(["Autorisation telephone", "Accord telephone", "Telephone autorise"]) },
    { channel: "MAIL", raw: p(["Autorisation courrier", "Accord courrier", "Courrier autorise"]) },
    { channel: "MARKETING", raw: p(["Marketing", "Publipostage", "Accord commercial", "RGPD"]) },
  ]
    .filter((c) => c.raw)
    .map((c) => ({ channel: c.channel, allowed: consent(c.raw), raw_value: c.raw }));

  return {
    sourceVehicleId,
    sourceCustomerId,
    vehicle,
    customer,
    contacts,
    address,
    consents,
    mileage: lastMileage ? { mileage: lastMileage, measured_at: lastMileageAt ? `${lastMileageAt}T00:00:00Z` : null } : null,
    errors,
  };
}
