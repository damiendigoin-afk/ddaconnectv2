import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { askVision, parseJsonBlock } from "./ocr.server";
import { OR_SCAN_MODEL } from "./or-scan-model";
import { learnSupplierProfile, readDocument } from "./doc-pipeline.server";
import { needsLinesRecheck, pickRecheck, reviewReasons } from "./purchase-validate";
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
  model?: string,
) {
  const r = await readDocument({ feature, kind, prompt, text: data.text, dataUrl: data.dataUrl, filename: data.filename, visionExtra, model });
  const any = Object.values(r.fields).some((v) => v != null && v !== "" && !(Array.isArray(v) && !v.length) && !(typeof v === "object" && !Array.isArray(v) && !Object.keys(v as object).length));
  // Photo dont la vision a échoué : on continue quand même (relecture ciblée puis « Lecture à vérifier »).
  if (!any && !r.visionFailed) {
    return { ok: false as const, error: "Lecture automatique sans résultat : complétez les informations manuellement.", route: r.route, content: "", missing: r.missing };
  }
  return { ok: true as const, content: JSON.stringify(r.fields), route: r.route, error: "", missing: r.missing, visionFirst: !!r.visionFirst, visionFailed: !!r.visionFailed };
}

/**
 * Consignes de lecture visuelle communes aux documents d'achat (vision d'abord sur photo/scan).
 * Génériques : aucune règle propre à un fournisseur.
 */
const PURCHASE_VISION_RULES = `LECTURE VISUELLE DES COLONNES (obligatoire) :
- supplier = raison sociale imprimée en EN-TÊTE (souvent en haut à gauche, près du logo) ; supplier_info = adresse, CP, ville, site web, TVA intracom, SIRET de l'émetteur (en-tête ou pied de page).
- delivery_note_number : numéro qui suit « (Duplicata de) bon de livraison n° X du JJ/MM/AAAA » ; document_date = la date de CE libellé.
  Une ligne du tableau « ** BL 123456 DU JJ/MM/AAAA ** » est une référence BL source : mets-la dans secondary_refs, JAMAIS dans delivery_note_number, et ce n'est JAMAIS une ligne article.
- Pour chaque ligne article : reference (code pièce, sans espaces, distinct de la désignation : ne retire ni n'absorbe aucune lettre de la désignation), label, quantity (colonne Qté),
  gross_unit_price (tarif / prix brut HT unitaire si visible), discount_pct (remise %), amount (montant NET HT de la ligne), unit_price (= amount / quantity), vat_pct (taux TVA de la ligne), amount_ttc (si visible).
- La colonne TVA (ex. 20) n'est JAMAIS la quantité. Ne concatène JAMAIS la remise et un montant (45,00 % puis 109,88 => discount_pct 45, amount 109.88).
- total_ht, vat_amount, total_ttc : bloc des montants en bas (« Montant HT », « TVA », « Net à payer / TTC »), jamais le total hors remise.
- or_number / plate : uniquement s'ils sont imprimés ; n'invente jamais d'OR ni d'immatriculation.
- FACTURE : invoice_number = numéro qui suit « (Duplicata) Facture n° X du JJ/MM/AAAA » ; document_date = la date de CE libellé.
  Jamais une date de paiement, d'échéance, de règlement ni « L.C.R. » comme document_date ; jamais une date (ex. 10/2026) comme numéro.
- supplier = nom COMPLET de l'établissement émetteur tel qu'imprimé (ex. enseigne + ville), jamais réduit au nom du groupe.
- Chaque ligne porte line_kind : "part" (pièce), "fee" (PORT, frais de port, emballage, transport : garde-la avec son montant, elle compte dans les totaux), "info" (ligne d'information).
  variant_code = code complément imprimé à côté de la référence (ex. « MX3 ») ; il n'est JAMAIS collé à la référence.
- Ajoute "secondary_refs":[] au JSON. null pour tout champ illisible.`;

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
ZONAGE STRICT pour "requested_work" : uniquement le texte écrit DANS la zone « Travaux à effectuer » / « Travaux demandés » (juste sous ou à droite de ce libellé, jusqu'au prochain titre de zone). Si cette zone est vide, requested_work = null. N'y recopie JAMAIS le slogan ou le branding Renault (« Renault care service », « longue vie aux voitures à vivre »), « votre conseiller », « accueilli par », le nom ou la civilité du client, une adresse, un code postal, une ville, un téléphone, un e-mail, l'en-tête du garage ni un libellé imprimé. Aucune inférence ni fallback sur le reste de la page.
L'en-tête du garage émetteur (raison sociale, « Agent Renault », adresse, téléphone, logo) et le bloc « votre conseiller / accueilli par » ne sont JAMAIS le client ni le véhicule. Modèle = valeur du libellé « modèle véhicule » uniquement. « Mr NOM PRENOM » : last_name = NOM, first_name = PRENOM.
Distingue strictement : vehicle.plate = immatriculation française au format AA-123-AA (2 lettres, 3 chiffres, 2 lettres) ou ancien format 123-ABC-45 — recopie-la caractère par caractère, sans ajouter de lettre ; si tu n'es pas sûr, mets null et ajoute "vehicle.plate" dans uncertain.
vehicle.brand = constructeur (RENAULT, DACIA…) ; vehicle.model = nom commercial contenant des lettres (ex. CLIO V, CAPTUR) ; client.account_number = n° de compte / n° client (chiffres) ; order.or_number = n° d'OR / dossier.
Sur les OR en tableau Renault/WinMotor (libellés « Immat. Marque Modèle N° compte », parfois lus « Merque » / « Modile », puis valeurs sur la ligne dessous), associe chaque valeur à sa colonne sémantique, jamais par simple proximité. Ne mets JAMAIS le n° de compte, le n° d'OR, un téléphone ou un code postal dans vehicle.model.
Pour order.client_remarks, lis uniquement le bloc immédiatement sous « Remarques du client » jusqu'au prochain titre de zone. Ne mélange jamais travaux prévus, mentions légales, dessin carrosserie ou texte voisin. Si le bloc est incohérent, renvoie null.
Bloc client (structure imposée) : la PREMIÈRE ligne est « Civilité NOM PRÉNOM » (ex. « Mme VIELESCOT MARIE-ANNAELLE » => last_name "VIELESCOT", first_name "MARIE-ANNAELLE") ; les lignes suivantes sont l'adresse (rue ou lieu-dit comme « LE BOURG »), puis « CP VILLE ». Ne mets JAMAIS une ligne d'adresse (LE BOURG, RUE, ROUTE, CHEMIN, LIEU-DIT, IMPASSE…) dans first_name, et ne mets jamais nom + prénom ensemble dans last_name.
client.email : recopie visuellement l'adresse exacte, caractère par caractère, en conservant toute ponctuation visible (points, tirets, underscores). Si un caractère est douteux, mets null et ajoute "client.email" dans uncertain.
La raison sociale du garage (SAS CASTILLON VEYSSIERE, SAS DAMIEN DIGOIN AUTOMOBILE…) n'est JAMAIS une partie du nom ou du prénom du client. Nom composé tout en capitales (« Mme SALAZAR BLANCHEZ CECILE ») : le dernier mot est le prénom, les précédents le nom ; en cas de doute ajoute "client.last_name" dans uncertain.
client.address ne contient QUE la rue : jamais « restitution prévue le … », une date, « date d'entrée », ni un libellé de la colonne garage alignée sur la même ligne (ces valeurs vont dans order.delivery_at / entry_at).
entry_at / delivery_at / or_date : recopie la date et l'heure telles qu'imprimées (heure locale française, sans conversion de fuseau) ; restitution sans heure = date seule.
vehicle.mileage est souvent manuscrit : ne le renseigne que s'il est clairement lisible, sinon null et "vehicle.mileage" dans uncertain. Ignore le schéma de carrosserie et ses annotations.`;
    const result = await viaPipeline("repair_order", prompt, data, "ocr_or", undefined, OR_SCAN_MODEL);
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
Mets null pour tout ce qui n'est pas lisible. N'invente aucune ligne, aucun montant.
${PURCHASE_VISION_RULES}`;
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
- Annotation « Commande *gp747ta // tclass // 50912 » : un segment en forme d'immatriculation (même compacte/minuscule) => plate « GP-747-TA » (plate_printed=true) ;
  un segment de 5-6 chiffres => or_number ; le texte intermédiaire (modèle, « tclass ») n'est ni OR ni order_reference. « BL 432112 » et « Client 03337 » ne sont JAMAIS l'OR.
  Sans segment numérique (ex. « Commande *dg893tk // berlingo ») : or_number = null, n'invente jamais d'OR. Ligne « Réf Désignation Qté Brut Remise% Net » : unit_price = NET (ex. 746,96 −23 % => 575,16), jamais le brut ni la remise.
- Colonnes « Brut / Remise % / Net » : unit_price = prix NET unitaire (ex. brut 101,67, remise 30,00 %, net 71,17 => 71.17) ; jamais le taux de remise ni un montant comme référence.
  Référence espacée (« A 420 420 62 00 ») => recopiée sans espaces.
- isolated_number : nombre imprimé SEUL, sans libellé, sur une ligne sous la désignation de l'article (souvent 5 chiffres = dossier atelier). null sinon.
- lines : une entrée par article (« Réf », « Désignation », « Qté »). unit_price = prix d'achat NET unitaire HT ;
  client_price = « Prix client », « Prix public », prix catalogue (ne pas le mettre dans unit_price) ; amount = montant net HT de la ligne.
- plate au format AB-123-CD et plate_printed=true UNIQUEMENT si une immatriculation est réellement imprimée ; sinon plate=null.
- customer_or_site : nom/adresse du client livré ou facturé (garage destinataire).
- delay : délai / date de livraison tel qu'écrit. Dates ISO YYYY-MM-DD. Nombres avec un point décimal.
Mets null pour tout ce qui n'est pas lisible. N'invente aucune ligne, aucun prix, aucune référence.
${PURCHASE_VISION_RULES}
Réponds directement avec le JSON compact, sans explication ni raisonnement.`;
    // Lecture rapide : raisonnement minimal (la sortie était gonflée de 2 à 3,5k jetons de réflexion pour ~500 caractères utiles).
    const result = await viaPipeline("purchase", prompt, data, "supplier_invoice", {
      reasoning_effort: "low",
      max_tokens: 4000,
    });
    if (!result.ok) return { ok: false as const, error: result.error, json: "" };
    const parsed = parseJsonBlock(result.content);
    if (!parsed) return { ok: false as const, error: "Document illisible : complétez à la main.", json: "" };
    let norm = normalizePurchaseExtract(parsed);
    void learnSupplierProfile(norm.supplier ?? null, data.text, result.route);
    // Passe ciblée vision uniquement si la voie vision a déjà été nécessaire (jamais « par confort »).
    // Vision d'abord : OR/immat déjà demandés dans la passe unique, pas de seconde vision systématique.
    if (result.route === "ai_vision_fallback" && !result.visionFirst && needsIdentifierPass(norm)) {
      // Second passage court et ciblé : uniquement les repères atelier souvent manqués (« Mes références »…).
      const second = await askVision(IDENT_PROMPT, data.dataUrl, data.filename, "supplier_invoice_ids", { reasoning_effort: "low", max_tokens: 400 });
      const p2 = second.ok ? parseJsonBlock(second.content) : null;
      if (p2) norm = mergeIdentifierPass(norm, parseIdentifierPass(p2));
    }
    // Relecture ciblée unique (lignes + totaux) : vision nulle, contrôles en échec, total HT absent ou lignes insuffisantes.
    let recheckUsed = false;
    if (result.visionFirst && data.dataUrl && needsLinesRecheck(norm, !!result.visionFailed)) {
      const re = await askVision(LINES_RECHECK_PROMPT, data.dataUrl, data.filename, "supplier_invoice_recheck", { reasoning_effort: "low", max_tokens: 2500 });
      const p3 = re.ok ? parseJsonBlock(re.content) : null;
      const picked = pickRecheck(norm, p3 ? normalizePurchaseExtract({ ...norm, ...p3, control_alerts: [] }) : null);
      if (picked.used) { recheckUsed = true; norm = normalizePurchaseExtract(picked.value); }
    }
    // Fail-closed sur photo : vision en échec ou contrôles toujours en échec => « Lecture à vérifier », sans rattachement auto.
    if (result.visionFirst) {
      const reasons = reviewReasons(norm, { visionFailed: !!result.visionFailed });
      const prov = norm.read_provenance ?? { source: result.visionFailed ? "ocr_rules" : "vision" };
      norm = normalizePurchaseExtract({
        ...norm,
        ...(reasons.length ? { requires_review: true, review_reasons: reasons, supplier_id: null } : {}),
        read_provenance: { ...prov, vision_initial: result.visionFailed ? "failed" : "ok", recheck_used: recheckUsed, fallback_rules_fields: prov.fallback_rules_fields ?? prov.completed ?? [], requires_review: reasons.length > 0 },
      });
      if (reasons.length) return { ok: true as const, error: "", json: JSON.stringify(norm) };
    }
    if (result.missing.length) {
      return { ok: false as const, error: `Lecture incomplète (${result.missing.join(", ")}).`, json: JSON.stringify(norm) };
    }
    return { ok: true as const, error: "", json: JSON.stringify(norm) };
  });

const LINES_RECHECK_PROMPT = `Relis UNIQUEMENT le tableau des articles et le bloc des montants de ce document d'achat (France).
Réponds STRICTEMENT en JSON compact : {"lines":[{"line_kind":"part","reference":null,"variant_code":null,"label":null,"quantity":null,"gross_unit_price":null,"discount_pct":null,"amount":null,"unit_price":null,"vat_pct":null,"amount_ttc":null}],"total_ht":null,"vat_amount":null,"total_ttc":null}
Lis colonne par colonne : Qté, tarif HT, remise %, montant HT, TVA %, TTC. La TVA n'est JAMAIS la quantité ; ne concatène jamais remise et montant ;
référence et désignation séparées sans perdre de lettre. Les lignes « ** BL … DU … ** » ne sont pas des articles. PORT / frais de port = line_kind "fee" (avec son montant). null si illisible.`;

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
