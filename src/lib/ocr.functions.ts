import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { askVision, parseJsonBlock } from "./ocr.server";
import { learnSupplierProfile, readDocument } from "./doc-pipeline.server";
import { plausibleMileage, type DocKind } from "./doc-rules";
import { mergeIdentifierPass, needsIdentifierPass, normalizePurchaseExtract, parseIdentifierPass } from "./purchase-extract";

const fileInput = z.object({
  dataUrl: z.string().min(10),
  filename: z.string().optional(),
  /** Texte OCR local / natif PDF (première passe sans IA, calculée dans le navigateur). */
  text: z.string().max(40000).optional(),
});

/**
 * Pipeline commun : OCR/règles d'abord, IA texte puis vision en ultime recours.
 * Renvoie le même contrat que l'ancien askVision (contenu JSON) pour ne pas toucher aux écrans.
 */
async function viaPipeline(
  kind: DocKind,
  prompt: string,
  data: z.infer<typeof fileInput>,
  feature: string,
  visionExtra?: Record<string, unknown>,
) {
  const r = await readDocument({ feature, kind, prompt, text: data.text, dataUrl: data.dataUrl, filename: data.filename, visionExtra });
  const any = Object.values(r.fields).some((v) => v != null && v !== "" && !(Array.isArray(v) && !v.length) && !(typeof v === "object" && !Array.isArray(v) && !Object.keys(v as object).length));
  if (!any) {
    return { ok: false as const, error: "Lecture automatique sans résultat : complétez les informations manuellement.", route: r.route, content: "", missing: r.missing };
  }
  return { ok: true as const, content: JSON.stringify(r.fields), route: r.route, error: "", missing: r.missing };
}

export const ocrRepairOrder = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => fileInput.parse(data))
  .handler(async ({ data }) => {
    const prompt = `Tu analyses un ordre de réparation d'un garage automobile français.
Extrais uniquement ce que tu lis réellement. Réponds STRICTEMENT en JSON avec cette forme :
{"client":{"account_number":null,"last_name":null,"first_name":null,"address":null,"address_extra":null,"postal_code":null,"city":null,"phone":null,"mobile":null,"email":null},
"vehicle":{"plate":null,"vin":null,"brand":null,"model":null,"mileage":null,"first_registration":null},
"order":{"or_number":null,"or_date":null,"client_remarks":null,"requested_work":null,"entry_at":null,"delivery_at":null},
"uncertain":["liste des chemins de champs peu lisibles, ex: vehicle.vin"]}
Dates au format ISO (YYYY-MM-DD ou YYYY-MM-DDTHH:mm). mileage = entier sans espace. Mets null si absent.
IMPORTANT pour "client_remarks" et "requested_work" : ces zones contiennent souvent PLUSIEURS lignes
ou plusieurs demandes distinctes (listes, tirets, numérotation, phrases successives, texte manuscrit).
Restitue l'INTÉGRALITÉ du texte lu, sans résumer ni fusionner, une demande par ligne, séparées par des
retours à la ligne "\\n". Conserve l'ordre du document. N'invente rien.
L'en-tête du garage émetteur (raison sociale, « Agent Renault », adresse, téléphone, logo) et le bloc « votre conseiller / accueilli par » ne sont JAMAIS le client ni le véhicule. Modèle = valeur du libellé « modèle véhicule » uniquement. « Mr NOM PRENOM » : last_name = NOM, first_name = PRENOM.
Distingue strictement : vehicle.plate = immatriculation française au format AA-123-AA (2 lettres, 3 chiffres, 2 lettres) ou ancien format 123-ABC-45 — recopie-la caractère par caractère, sans ajouter de lettre ; si tu n'es pas sûr, mets null et ajoute "vehicle.plate" dans uncertain.
vehicle.brand = constructeur (RENAULT, DACIA…) ; vehicle.model = nom commercial contenant des lettres (ex. CLIO V, CAPTUR) ; client.account_number = n° de compte / n° client (chiffres) ; order.or_number = n° d'OR / dossier.
Sur les OR en tableau (libellés « Immat. Marque Modèle N° compte » sur une ligne, valeurs sur la ligne dessous), associe chaque valeur à sa colonne. Ne mets JAMAIS le n° de compte, le n° d'OR, un téléphone ou un code postal dans vehicle.model.`;
    const result = await viaPipeline("repair_order", prompt, data, "ocr_or");
    if (!result.ok) return { ok: false as const, error: result.error, json: "" };
    const parsed = parseJsonBlock(result.content);
    if (!parsed) return { ok: false as const, error: "Document illisible.", json: "" };
    return { ok: true as const, error: "", json: JSON.stringify(parsed) };
  });

export const ocrPlate = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => fileInput.parse(data))
  .handler(async ({ data }) => {
    const prompt = `Lis la plaque d'immatriculation visible sur cette photo.
Réponds STRICTEMENT en JSON : {"plate":"AB-123-CD","confidence":0.0}
Si aucune plaque lisible : {"plate":null,"confidence":0}`;
    const result = await viaPipeline("plate", prompt, data, "ocr_plaque");
    if (!result.ok) return { ok: false as const, error: result.error, plate: "" };
    const parsed = parseJsonBlock(result.content);
    const plate = typeof parsed?.["plate"] === "string" ? (parsed["plate"] as string) : "";
    if (!plate) return { ok: false as const, error: "Plaque non détectée.", plate: "" };
    return { ok: true as const, error: "", plate };
  });

export const ocrOdometer = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => fileInput.parse(data))
  .handler(async ({ data }) => {
    const prompt = `Lis le kilométrage total affiché sur ce compteur de véhicule (pas le trip / journalier).
Réponds STRICTEMENT en JSON : {"mileage":78452,"unit":"km"}
Si illisible : {"mileage":null,"unit":null}`;
    const result = await viaPipeline("odometer", prompt, data, "ocr_compteur");
    if (!result.ok) return { ok: false as const, error: result.error, mileage: 0 };
    const parsed = parseJsonBlock(result.content);
    const mileage = plausibleMileage(parsed?.["mileage"]) ?? 0;
    if (!mileage) return { ok: false as const, error: "Kilométrage non détecté.", mileage: 0 };
    return { ok: true as const, error: "", mileage };
  });

export const ocrTechnicalControl = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => fileInput.parse(data))
  .handler(async ({ data }) => {
    const prompt = `Lis la vignette ou le procès-verbal de contrôle technique français visible.
Réponds STRICTEMENT en JSON :
{"ct_due_date":null,"pollution_due_date":null,"vehicle_kind":"vp","confidence":0.0}
ct_due_date = prochaine échéance du contrôle technique au format YYYY-MM-DD.
pollution_due_date = prochaine échéance du contrôle complémentaire pollution, uniquement si elle est réellement indiquée.
vehicle_kind = "vu" pour un véhicule utilitaire soumis au contrôle complémentaire pollution, sinon "vp".
Ne confonds pas date du contrôle réalisé et date limite du prochain contrôle. Mets null si illisible. N'invente rien.`;
    const result = await viaPipeline("technical_control", prompt, data, "ocr_ct");
    if (!result.ok) return { ok: false as const, error: result.error, json: "" };
    const parsed = parseJsonBlock(result.content);
    if (!parsed) return { ok: false as const, error: "Dates du contrôle technique illisibles.", json: "" };
    return { ok: true as const, error: "", json: JSON.stringify(parsed) };
  });
/** Lecture d'une carte grise française (certificat d'immatriculation). */
export const ocrRegistrationCard = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => fileInput.parse(data))
  .handler(async ({ data }) => {
    const prompt = `Tu lis un certificat d'immatriculation français (carte grise).
Réponds STRICTEMENT en JSON :
{"plate":null,"vin":null,"brand":null,"model":null,"version":null,"energy":null,
"first_registration":null,"owner_name":null,"color":null}
plate = champ A (format AB-123-CD), vin = champ E, brand = champ D.1, model = champ D.2 ou D.3,
first_registration = champ B au format ISO YYYY-MM-DD, energy = champ P.3, owner_name = champs C.1/C.4.1.
Mets null pour tout champ non lisible. N'invente rien.`;
    const result = await viaPipeline("registration", prompt, data, "ocr_carte_grise");
    if (!result.ok) return { ok: false as const, error: result.error, json: "" };
    const parsed = parseJsonBlock(result.content);
    if (!parsed) return { ok: false as const, error: "Carte grise illisible.", json: "" };
    return { ok: true as const, error: "", json: JSON.stringify(parsed) };
  });

/**
 * Lecture générique d'un document métier (plaque, carte grise, OR, avis de sinistre,
 * rapport d'expertise, constat, facture…) pour identifier un véhicule / client / dossier.
 */
export const ocrAnyDocument = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => fileInput.parse(data))
  .handler(async ({ data }) => {
    const prompt = `Tu analyses un document d'atelier automobile français (photo de plaque, carte grise,
ordre de réparation, avis de sinistre, rapport d'expertise, constat, devis, facture, BL, courrier…).
Extrais uniquement ce que tu lis réellement. Réponds STRICTEMENT en JSON :
{"doc_kind":null,"plate":null,"vin":null,"or_number":null,"claim_number":null,"mission_number":null,
"customer_name":null,"customer_phone":null,"customer_email":null,"brand":null,"model":null,
"first_registration":null,"mileage":null,"insurer":null,"expert":null,"amount_ht":null,"document_date":null,
"summary":null}
doc_kind parmi : plaque, carte_grise, or, avis_sinistre, rapport_expertise, constat, devis, facture, bl, courrier, autre.
plate au format AB-123-CD. Dates ISO YYYY-MM-DD. mileage entier. Mets null si absent. N'invente rien.`;
    const result = await viaPipeline("any_document", prompt, data, "ocr_document");
    if (!result.ok) return { ok: false as const, error: result.error, json: "" };
    const parsed = parseJsonBlock(result.content);
    if (!parsed) return { ok: false as const, error: "Document illisible.", json: "" };
    return { ok: true as const, error: "", json: JSON.stringify(parsed) };
  });

/**
 * Lecture d'un rapport Winmotor « Ratios de productivité et de rentabilité ».
 * La période est lue DANS le document (titre), jamais déduite du nom de fichier.
 */
export const ocrProductivityReport = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => fileInput.parse(data))
  .handler(async ({ data }) => {
    const prompt = `Tu analyses un rapport Winmotor français intitulé
"Ratios de productivité et de rentabilité entre le JJ/MM/AAAA au JJ/MM/AAAA".
Réponds STRICTEMENT en JSON :
{"site":null,"period_start":null,"period_end":null,
"rows":[{"name":"CORDONNIER JULIEN","hours_purchased":112,"hours_spent":112.50,"hours_billed":131.24,"productivity":1.17,"profitability":1.17}],
"totals":{"hours_purchased":null,"hours_spent":null,"hours_billed":null,"productivity":null,"profitability":null}}
Règles impératives :
- period_start et period_end au format ISO YYYY-MM-DD, lus dans le TITRE du document (source de vérité).
- site = raison sociale de l'établissement figurant sur le rapport.
- rows = une ligne par productif (salarié), dans l'ordre du document, en excluant la ligne de total.
- Les nombres utilisent la virgule décimale dans le document : convertis en point (112,50 -> 112.50).
- Une valeur absente, vide ou "-" doit valoir null, JAMAIS 0.
- N'invente aucun productif et ne recalcule aucun ratio : recopie les valeurs du rapport.`;
    const result = await viaPipeline("none", prompt, data, "ocr_productivite");
    if (!result.ok) return { ok: false as const, error: result.error, json: "" };
    const parsed = parseJsonBlock(result.content);
    if (!parsed) return { ok: false as const, error: "Rapport Winmotor illisible.", json: "" };
    return { ok: true as const, error: "", json: JSON.stringify(parsed) };
  });

/**
 * Lecture d'un ticket de testeur de batterie (Midtronics, Bosch, GYS…).
 * Aucune valeur n'est déduite : ce qui n'est pas lisible reste null.
 */
export const ocrBatteryTest = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => fileInput.parse(data))
  .handler(async ({ data }) => {
    const prompt = `Tu lis le ticket ou l'écran d'un testeur de batterie automobile.
Réponds STRICTEMENT en JSON :
{"verdict":"bonne|a_surveiller|a_remplacer|null","voltage":null,"cca_measured":null,"cca_rated":null,"soh_pct":null,"soc_pct":null}
verdict : "bonne" (GOOD / BON), "a_surveiller" (GOOD-RECHARGE / RECHARGE / MARGINAL), "a_remplacer" (REPLACE / BAD / REMPLACER).
Nombres uniquement, sans unité. Mets null pour toute valeur non lisible. N'invente rien.`;
    const result = await viaPipeline("battery", prompt, data, "ocr_batterie");
    if (!result.ok) return { ok: false as const, error: result.error, json: "" };
    const parsed = parseJsonBlock(result.content);
    if (!parsed) return { ok: false as const, error: "Ticket batterie illisible.", json: "" };
    return { ok: true as const, error: "", json: JSON.stringify(parsed) };
  });

/**
 * Lecture d'un bon de livraison ou d'une facture fournisseur (photo, scan ou PDF).
 * OCR tolérant : ce qui n'est pas lisible reste null, y compris les lignes.
 * Les annotations manuscrites sont capturées telles quelles, sans interprétation.
 */
export const ocrSupplierInvoice = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => fileInput.parse(data))
  .handler(async ({ data }) => {
    const prompt = `Tu lis un bon de livraison ou une facture d'un fournisseur de pièces automobiles (France).
Le document peut être une photo imparfaite, froissée, annotée à la main.
Réponds STRICTEMENT en JSON :
{"doc_kind":"bl|facture|null","supplier":null,"supplier_info":null,"invoice_number":null,"invoice_date":null,"delivery_note_number":null,
"customer_or_site":null,"order_reference":null,"plate":null,"currency":"EUR",
"lines":[{"reference":null,"label":null,"quantity":null,"unit_price":null,"discount_pct":null,"amount":null}],
"total_ht":null,"vat_amount":null,"total_ttc":null,"handwritten_notes":null}
Dates ISO YYYY-MM-DD. Nombres décimaux avec un point, sans symbole ni unité.
- supplier_info : coordonnées de l'ÉMETTEUR uniquement, telles qu'imprimées (en-tête/pied de page) : {"address","postal_code","city","phone","email","website","siret","vat_number"} ; champ absent = omis ; null si rien.
handwritten_notes : recopie littérale UNIQUEMENT du texte manuscrit réellement lisible (ex : "Pas BL retour / Frs à remb", "retour"). Jamais la description d'un symbole, d'une coche, d'un trait, d'une couleur, d'un cercle, d'un tampon ou d'une signature (ex interdit : "cochée au stylo noir") ; sinon null.
Mets null pour tout ce qui n'est pas lisible. N'invente aucune ligne, aucun montant.`;
    const result = await viaPipeline("purchase", prompt, data, "supplier_invoice");
    if (result.ok) void learnSupplierProfile((parseJsonBlock(result.content)?.["supplier"] as string) ?? null, data.text, result.route);
    if (!result.ok) return { ok: false as const, error: result.error, json: "" };
    const parsed = parseJsonBlock(result.content);
    if (!parsed) return { ok: false as const, error: "Document fournisseur illisible : saisissez les informations manuellement.", json: "" };
    return { ok: true as const, error: "", json: JSON.stringify(parsed) };
  });

/**
 * Lecture générique d'un document d'achat pièces (bon de commande, confirmation, BL, facture,
 * capture d'écran de site fournisseur…). Aucun modèle par fournisseur : ce qui n'est pas lu reste null.
 */
export const ocrPurchaseDocument = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => fileInput.parse(data))
  .handler(async ({ data }) => {
    const prompt = `Tu lis un document d'achat de pièces automobiles (France) : bon de commande, confirmation de commande,
capture d'écran d'un site fournisseur, bon de livraison (BL) ou facture. Formats et mises en page variés, photo possible.
Réponds STRICTEMENT en JSON :
{"doc_kind":"commande|bl|facture|autre|null","supplier":null,"supplier_info":null,"document_number":null,"document_date":null,
"order_reference":null,"delivery_note_number":null,"invoice_number":null,"or_number":null,"plate":null,"plate_printed":false,
"customer_or_site":null,
"lines":[{"reference":null,"label":null,"quantity":null,"unit_price":null,"client_price":null,"amount":null,"delay":null,"isolated_number":null}],
"total_ht":null,"vat_amount":null,"total_ttc":null,"handwritten_notes":null}
- supplier : le vendeur qui émet le document (libellés possibles : « Distributeur », « Fournisseur », « Vendeur », en-tête/logo émetteur). JAMAIS le client/garage destinataire.
- supplier_info : coordonnées de l'ÉMETTEUR uniquement, telles qu'imprimées (en-tête/pied de page) : {"address","postal_code","city","phone","email","website","siret","vat_number"} ; champ absent = omis ; null si rien.
- order_reference : numéro de commande fournisseur (« Commande n° », « N° de commande »).
- or_number : numéro d'OR / dossier atelier (« Repère commande », « Votre référence », « Réf. client », « N° OR »), chiffres uniquement.
  Ne pas confondre avec « N° client » ni « Compte de facturation ». Si ce repère (« Mes références », « Véhicule »…) est une
  IMMATRICULATION (ex. HG 732 GH), la mettre dans plate avec plate_printed=true et laisser or_number à null.
- isolated_number : nombre imprimé SEUL, sans libellé, sur une ligne sous la désignation de l'article (souvent 5 chiffres = dossier atelier). null sinon.
- lines : une entrée par article (« Réf », « Désignation », « Qté »). unit_price = prix d'achat NET unitaire HT ;
  client_price = « Prix client », « Prix public », prix catalogue (ne pas le mettre dans unit_price) ; amount = montant net HT de la ligne.
- plate au format AB-123-CD et plate_printed=true UNIQUEMENT si une immatriculation est réellement imprimée ; sinon plate=null.
- customer_or_site : nom/adresse du client livré ou facturé (garage destinataire).
- delay : délai / date de livraison tel qu'écrit. Dates ISO YYYY-MM-DD. Nombres avec un point décimal.
Mets null pour tout ce qui n'est pas lisible. N'invente aucune ligne, aucun prix, aucune référence.
Réponds directement avec le JSON compact, sans explication ni raisonnement.`;
    // Lecture rapide : raisonnement minimal (la sortie était gonflée de 2 à 3,5k jetons de réflexion pour ~500 caractères utiles).
    const result = await viaPipeline("purchase", prompt, data, "supplier_invoice", {
      reasoning_effort: "low",
      max_tokens: 3000,
    });
    if (!result.ok) return { ok: false as const, error: result.error, json: "" };
    const parsed = parseJsonBlock(result.content);
    if (!parsed) return { ok: false as const, error: "Document illisible : complétez à la main.", json: "" };
    let norm = normalizePurchaseExtract(parsed);
    void learnSupplierProfile(norm.supplier ?? null, data.text, result.route);
    // Passe ciblée vision uniquement si la voie vision a déjà été nécessaire (jamais « par confort »).
    if (result.route === "ai_vision_fallback" && needsIdentifierPass(norm)) {
      // Second passage court et ciblé : uniquement les repères atelier souvent manqués (« Mes références »…).
      const second = await askVision(IDENT_PROMPT, data.dataUrl, data.filename, "supplier_invoice_ids", { reasoning_effort: "low", max_tokens: 400 });
      const p2 = second.ok ? parseJsonBlock(second.content) : null;
      if (p2) norm = mergeIdentifierPass(norm, parseIdentifierPass(p2));
    }
    if (result.missing.length) {
      return { ok: false as const, error: `Lecture incomplète (${result.missing.join(", ")}).`, json: JSON.stringify(norm) };
    }
    return { ok: true as const, error: "", json: JSON.stringify(norm) };
  });

const IDENT_PROMPT = `Document d'achat de pièces automobiles (France). Lis UNIQUEMENT les identifiants atelier dans les zones
« Mes références », « Repère », « Repère commande », « Votre référence », « Réf client », « Véhicule », et les petites lignes
isolées proches des désignations d'articles. Réponds STRICTEMENT en JSON compact :
{"plate":null,"or_number":null,"order_reference":null,"evidence":null}
- plate : immatriculation française (ex. HG 732 GH, HG-732-GH, HG732GH) telle que lue ; jamais une dimension de pneu.
- or_number : numéro de dossier/OR atelier (chiffres) ; si le repère est une immatriculation, le mettre dans plate et or_number=null.
- order_reference : n° de commande fournisseur (« Commande n° »).
- evidence : le libellé et le texte lus, très court.
N'invente rien, null si absent.`;

/** Scan atelier : photo d'une plaque OU d'un OR papier — renvoie {or_number, plate}. */
export const ocrOrOrPlate = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => fileInput.parse(data))
  .handler(async ({ data }) => {
    const prompt = `Photo d'une plaque d'immatriculation OU d'un ordre de réparation (OR) papier d'un garage français.
Réponds STRICTEMENT en JSON compact : {"or_number":null,"plate":null}
- or_number : numéro d'OR / dossier imprimé (« OR n° », « Ordre de réparation », « Dossier »), chiffres uniquement ; null si c'est une simple plaque.
- plate : immatriculation lue (ex. AB-123-CD). N'invente rien, null si absent.`;
    const result = await viaPipeline("or_or_plate", prompt, data, "ocr_or_plaque");
    if (!result.ok) return { ok: false as const, error: result.error, or_number: null, plate: null };
    const p = parseIdentifierPass(parseJsonBlock(result.content));
    if (!p.or_number && !p.plate) return { ok: false as const, error: "Ni OR ni plaque détectés.", or_number: null, plate: null };
    return { ok: true as const, error: "", or_number: p.or_number, plate: p.plate };
  });
