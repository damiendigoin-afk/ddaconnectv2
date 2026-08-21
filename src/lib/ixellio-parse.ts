/**
 * Parseur HTML IXELLIO (pur, sans I/O, testable).
 *
 * La page de résultat IXELLIO est une page JSP Spring : les informations
 * véhicule sont exposées sous forme de couples libellé/valeur structurés
 * (tableaux <tr><td>, listes <dl>, blocs <span class="libelle|valeur">,
 * ou champs <input readonly>). Le parseur extrait donc explicitement ces
 * couples puis les rattache à un champ canonique via une table de libellés.
 * Le fallback texte n'est utilisé que pour le VIN.
 */

export type IxellioVehicle = {
  marque?: string;
  modele?: string;
  version?: string;
  vin?: string;
  cnit?: string;
  typeMine?: string;
  tvv?: string;
  codeMoteur?: string;
  cylindree?: string;
  carburant?: string;
  boite?: string;
  codeBoite?: string;
  dateMec?: string;
  puissanceFiscale?: string;
  puissanceCh?: string;
  puissanceKw?: string;
  portes?: string;
  places?: string;
  carrosserie?: string;
  genre?: string;
  couleur?: string;
  poids?: string;
  ptac?: string;
  masseVide?: string;
  co2?: string;
};

export type IxellioParseResult = {
  vehicle: IxellioVehicle;
  /** Noms de champs détectés (jamais les valeurs) — diagnostic non sensible. */
  detectedFields: (keyof IxellioVehicle)[];
  fieldCount: number;
  /** Nombre de couples libellé/valeur trouvés dans le DOM (structure reconnue ou non). */
  pairCount: number;
  /** La page est une liste de versions à choisir, pas une fiche véhicule. */
  isVersionList: boolean;
  versionCount: number;
};

/* ------------------------------------------------------------------ */
/* Utilitaires HTML                                                     */
/* ------------------------------------------------------------------ */

const ENTITIES: Record<string, string> = {
  nbsp: " ",
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  eacute: "é",
  egrave: "è",
  ecirc: "ê",
  agrave: "à",
  ccedil: "ç",
  ugrave: "ù",
  icirc: "î",
  ocirc: "ô",
  deg: "°",
};

export function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(Number.parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number.parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (m, n: string) => ENTITIES[n.toLowerCase()] ?? m);
}

export function stripTags(html: string): string {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function norm(label: string): string {
  return stripTags(label)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function cleanValue(v: string): string {
  return stripTags(v).replace(/^[:\-–\s]+/, "").trim();
}

/* ------------------------------------------------------------------ */
/* Extraction des couples libellé / valeur                              */
/* ------------------------------------------------------------------ */

export type Pair = { label: string; value: string };

function pushPair(out: Pair[], label: string, value: string) {
  const l = norm(label);
  const v = cleanValue(value);
  if (!l || !v || v === "-" || l === norm(v)) return;
  if (l.length > 60 || v.length > 120) return;
  out.push({ label: l, value: v });
}

/** Tableaux : chaque <tr> est découpé en cellules et lu en couples (libellé, valeur). */
function fromTables(html: string, out: Pair[]) {
  const rowRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let row: RegExpExecArray | null;
  while ((row = rowRe.exec(html))) {
    const cells: string[] = [];
    const cellRe = /<(t[hd])\b[^>]*>([\s\S]*?)<\/\1>/gi;
    let c: RegExpExecArray | null;
    while ((c = cellRe.exec(row[1] ?? ""))) cells.push(c[2] ?? "");
    if (cells.length < 2) continue;
    for (let i = 0; i + 1 < cells.length; i += 2) pushPair(out, cells[i]!, cells[i + 1]!);
  }
}

/** Listes de définition <dt>/<dd>. */
function fromDefinitionLists(html: string, out: Pair[]) {
  const re = /<dt\b[^>]*>([\s\S]*?)<\/dt>\s*<dd\b[^>]*>([\s\S]*?)<\/dd>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) pushPair(out, m[1] ?? "", m[2] ?? "");
}

/** Blocs libellé/valeur : <span class="libelle">…</span><span class="valeur">…</span>. */
function fromLabelledBlocks(html: string, out: Pair[]) {
  const re =
    /<(span|div|p|label|strong|b)\b[^>]*(?:class|id)\s*=\s*["'][^"']*(?:libelle|libell|label|intitule|cle|key|titre)[^"']*["'][^>]*>([\s\S]*?)<\/\1>\s*(?:<[^>]+>\s*)*?<(span|div|p|td|strong|b)\b[^>]*>([\s\S]*?)<\/\3>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) pushPair(out, m[2] ?? "", m[4] ?? "");
}

/** <label for="x">Libellé</label> … <input id="x" value="…"> ou élément suivant. */
function fromLabelTags(html: string, out: Pair[]) {
  const re = /<label\b[^>]*>([\s\S]*?)<\/label>\s*(?:<[^>]+>\s*)*?(?:<input\b[^>]*>|<(span|div|td|strong|b)\b[^>]*>([\s\S]*?)<\/\2>)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const chunk = m[0];
    const inputVal = /<input\b[^>]*\bvalue\s*=\s*["']([^"']*)["']/i.exec(chunk)?.[1];
    pushPair(out, m[1] ?? "", inputVal ?? m[3] ?? "");
  }
}

/** Champs de formulaire porteurs de la donnée (name/id explicites). */
function fromInputs(html: string, out: Pair[]) {
  const re = /<input\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const tag = m[0];
    if (/type\s*=\s*["']?(hidden|submit|button|checkbox|radio|password)/i.test(tag)) continue;
    const name = /(?:name|id)\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
    const value = /\bvalue\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1];
    if (!name || !value) continue;
    pushPair(out, name.replace(/[._-]+/g, " "), value);
  }
}

/** Fallback texte : « Libellé : valeur » sur une même ligne visuelle. */
function fromFlatText(html: string, out: Pair[]) {
  const text = stripTags(html);
  const re = /([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ0-9'’()./\s]{2,40}?)\s*:\s*([^:]{1,60}?)(?=\s{2,}|\s[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ0-9'’()./\s]{2,40}\s*:|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) pushPair(out, m[1] ?? "", m[2] ?? "");
}

export function extractPairs(html: string): Pair[] {
  const out: Pair[] = [];
  fromTables(html, out);
  fromDefinitionLists(html, out);
  fromLabelledBlocks(html, out);
  fromLabelTags(html, out);
  fromInputs(html, out);
  fromFlatText(html, out);
  return out;
}

/* ------------------------------------------------------------------ */
/* Table de libellés → champ canonique                                  */
/* ------------------------------------------------------------------ */

type Rule = { field: keyof IxellioVehicle; labels: RegExp; validate?: (v: string) => boolean };

const isNumeric = (v: string) => /\d/.test(v);

const RULES: Rule[] = [
  { field: "vin", labels: /^(vin|n° ?vin|numero vin|numero de serie|num serie|serie vin|vf|identification vin)$/ },
  { field: "marque", labels: /^(marque|constructeur|marque vehicule)$/ },
  { field: "modele", labels: /^(modele|modele vehicule|type commercial|denomination commerciale)$/ },
  { field: "version", labels: /^(version|finition|variante version|version vehicule)$/ },
  { field: "cnit", labels: /^(cnit|code cnit|d 2 1|d2 1|code national d identification|type variante version cnit)$/ },
  { field: "typeMine", labels: /^(type mine|type mines|d 2|d2|type reception|numero de reception)$/ },
  { field: "tvv", labels: /^(tvv|type variante version|d 2 tvv)$/ },
  { field: "codeMoteur", labels: /^(code moteur|type moteur|moteur code|reference moteur)$/ },
  { field: "cylindree", labels: /^(cylindree|cylindree cm3|cm3|p 1)$/, validate: isNumeric },
  { field: "carburant", labels: /^(carburant|energie|type d energie|p 3)$/ },
  { field: "codeBoite", labels: /^(code boite|code boite de vitesses|reference boite|type de boite code)$/ },
  { field: "boite", labels: /^(boite|boite de vitesses|boite vitesses|transmission|type de boite|bv)$/ },
  { field: "dateMec", labels: /^(date de 1re mise en circulation|date de 1ere mise en circulation|1re mise en circulation|1ere mise en circulation|date mec|mise en circulation|date de mise en circulation|b|date 1ere mec)$/ },
  { field: "puissanceFiscale", labels: /^(puissance fiscale|puiss fiscale|cv fiscaux|cv|p 6|puissance administrative)$/, validate: isNumeric },
  { field: "puissanceCh", labels: /^(puissance ch|puissance en ch|puissance reelle|puissance din|ch|chevaux)$/, validate: isNumeric },
  { field: "puissanceKw", labels: /^(puissance kw|puissance en kw|puiss kw|kw|p 2|puissance nette maximale)$/, validate: isNumeric },
  { field: "portes", labels: /^(portes|nombre de portes|nb portes|nb de portes)$/, validate: isNumeric },
  { field: "places", labels: /^(places|nombre de places|nb places|places assises|s 1)$/, validate: isNumeric },
  { field: "carrosserie", labels: /^(carrosserie|type de carrosserie|j 1|carrosserie ce)$/ },
  { field: "genre", labels: /^(genre|genre national|j|categorie|categorie vehicule)$/ },
  { field: "couleur", labels: /^(couleur|teinte|couleur vehicule|coloris)$/ },
  { field: "ptac", labels: /^(ptac|poids total autorise|poids total autorise en charge|ptc|f 2|masse en charge maxi)$/, validate: isNumeric },
  { field: "masseVide", labels: /^(masse a vide|poids a vide|masse en service|g|masse vide)$/, validate: isNumeric },
  { field: "poids", labels: /^(poids|masse|masse du vehicule|f 1)$/, validate: isNumeric },
  { field: "co2", labels: /^(co2|emission co2|emissions co2|emissions de co2|co2 g km|v 7)$/, validate: isNumeric },
];

const VIN_RE = /\b[A-HJ-NPR-Z0-9]{17}\b/;

function matchField(label: string, value: string): keyof IxellioVehicle | null {
  for (const r of RULES) {
    if (!r.labels.test(label)) continue;
    if (r.validate && !r.validate(value)) continue;
    return r.field;
  }
  return null;
}

/** Détecte une page intermédiaire proposant plusieurs versions à choisir. */
export function detectVersionList(html: string): { isVersionList: boolean; versionCount: number } {
  const choices =
    html.match(/href\s*=\s*["'][^"']*(?:method=(?:select|choose|choix|detail)[^"']*)["']/gi) ?? [];
  const radios = html.match(/<input\b[^>]*type\s*=\s*["']?radio["']?[^>]*>/gi) ?? [];
  const count = Math.max(choices.length, radios.length);
  const listHint = /(choisis|choisir|s[ée]lectionn|plusieurs versions|liste des versions)/i.test(
    stripTags(html),
  );
  return { isVersionList: count > 1 && listHint, versionCount: count };
}

/** Parseur principal : structure DOM d'abord, VIN en fallback. */
export function parseIxellioHtml(html: string): IxellioParseResult {
  const pairs = extractPairs(html);
  const vehicle: IxellioVehicle = {};

  for (const { label, value } of pairs) {
    const field = matchField(label, value);
    if (!field) continue;
    if (vehicle[field]) continue; // première occurrence = fiche principale
    if (field === "dateMec") {
      const d = /\d{2}[/-]\d{2}[/-]\d{2,4}/.exec(value)?.[0];
      if (!d) continue;
      vehicle.dateMec = d;
      continue;
    }
    if (field === "vin") {
      const vin = VIN_RE.exec(value.toUpperCase())?.[0];
      if (!vin) continue;
      vehicle.vin = vin;
      continue;
    }
    vehicle[field] = value;
  }

  // Fallback VIN sur le texte brut uniquement.
  if (!vehicle.vin) {
    const vin = VIN_RE.exec(stripTags(html).toUpperCase())?.[0];
    if (vin) vehicle.vin = vin;
  }

  const detectedFields = (Object.keys(vehicle) as (keyof IxellioVehicle)[]).filter((k) => vehicle[k]);
  const list = detectVersionList(html);

  return {
    vehicle,
    detectedFields,
    fieldCount: detectedFields.length,
    pairCount: pairs.length,
    isVersionList: list.isVersionList,
    versionCount: list.versionCount,
  };
}
