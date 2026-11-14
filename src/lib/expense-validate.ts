/**
 * Contrôles déterministes des notes de frais, après règles OCR et/ou lecture IA.
 * Aucune correction de date ni invention de TVA : une incohérence reste visible et exige
 * une correction ou une confirmation explicite selon sa gravité.
 */

export const EXPENSE_ORDINARY_VAT_RATES = [2.1, 5.5, 10, 20] as const;

export type ExpenseIssueSeverity = "correction" | "confirmation";
export type ExpenseValidationMode = "scan" | "submit" | "manager";
export type ExpenseIssue = {
  field: string;
  code: string;
  message: string;
  severity: ExpenseIssueSeverity;
};

export type ExpenseValidationOptions = {
  today?: string;
  mode?: ExpenseValidationMode;
  zeroVatJustification?: string | null;
};

export type ExpenseValidationResult = {
  ok: boolean;
  issues: ExpenseIssue[];
  reviewFields: string[];
  requiresCorrection: boolean;
  requiresConfirmation: boolean;
};

const blank = (v: unknown) => v == null || (typeof v === "string" && !v.trim());
const has = (v: unknown) => !blank(v);

export function expenseNumber(v: unknown): number | null {
  if (blank(v)) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const normalized = v.trim().replace(/[\s\u00a0€%]/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", ".");
  if (!normalized) return null;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

export function isRealCalendarDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

function shiftDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function shiftMonths(date: string, months: number): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return d.toISOString().slice(0, 10);
}

export function expenseVatRates(value: Record<string, unknown>): number[] {
  const rates: number[] = [];
  if (Array.isArray(value["vat_rates"])) {
    for (const raw of value["vat_rates"]) {
      const rate = expenseNumber(raw);
      if (rate != null) rates.push(rate);
    }
  }
  if (Array.isArray(value["vat_lines"])) {
    for (const raw of value["vat_lines"]) {
      if (!raw || typeof raw !== "object") continue;
      const rate = expenseNumber((raw as Record<string, unknown>)["rate"] ?? (raw as Record<string, unknown>)["vat_rate"]);
      if (rate != null) rates.push(rate);
    }
  }
  return [...new Set(rates)];
}

export function hasMultipleExpenseVatRates(value: Record<string, unknown>): boolean {
  return expenseVatRates(value).length > 1;
}

const calculatedVat = (value: Record<string, unknown>) =>
  value["vat_amount_source"] === "calculated" || value["vat_amount_estimated"] === true;

export function validateExpenseExtract(
  value: Record<string, unknown>,
  options: ExpenseValidationOptions = {},
): ExpenseValidationResult {
  const issues: ExpenseIssue[] = [];
  const add = (field: string, code: string, message: string, severity: ExpenseIssueSeverity = "confirmation") => {
    if (!issues.some((issue) => issue.field === field && issue.code === code)) issues.push({ field, code, message, severity });
  };
  const mode = options.mode ?? "scan";
  const today = isRealCalendarDate(options.today) ? options.today : new Date().toISOString().slice(0, 10);
  const date = value["date"] ?? value["spent_on"];

  if (has(date)) {
    if (!isRealCalendarDate(date)) {
      add("date", "invalid_date", "Date civile invalide : corrigez-la sans déduire une autre date.", "correction");
    } else {
      const iso = date.trim();
      if (iso > shiftDays(today, 1)) {
        add(
          "date",
          "future_date",
          "Date future de plus d’un jour : vérifiez le ticket et confirmez ou corrigez.",
          mode === "manager" ? "correction" : "confirmation",
        );
      }
      if (iso < shiftMonths(today, -18)) {
        add("date", "old_date", "Date de plus de 18 mois : confirmez ce voyage historique ou corrigez l’année lue.");
      }
    }
  }

  const ttc = expenseNumber(value["amount_ttc"]);
  if (has(value["amount_ttc"]) && ttc == null) add("amount_ttc", "invalid_ttc", "Montant TTC non numérique.", "correction");
  if (ttc != null && ttc <= 0) add("amount_ttc", "nonpositive_ttc", "Le montant TTC doit être supérieur à zéro.", "correction");

  const vat = expenseNumber(value["vat_amount"]);
  if (has(value["vat_amount"]) && vat == null) add("vat_amount", "invalid_vat", "Montant de TVA non numérique.", "correction");
  if (vat != null && vat < 0) add("vat_amount", "negative_vat", "La TVA ne peut pas être négative.", "correction");
  if (vat != null && ttc != null && ttc > 0) {
    const maximum = (ttc * 20) / 120 + 0.02;
    if (vat > maximum) {
      add("vat_amount", "vat_above_maximum", `TVA supérieure au maximum plausible de ${maximum.toFixed(2)} € pour ce TTC.`, "correction");
    }
  }

  const rate = expenseNumber(value["vat_rate"]);
  if (has(value["vat_rate"]) && rate == null) add("vat_rate", "invalid_rate", "Taux de TVA non numérique.", "correction");
  const zeroReason = String(value["vat_exemption_reason"] ?? options.zeroVatJustification ?? "").trim();
  if (rate != null) {
    if (rate === 0) {
      if (!zeroReason) add("vat_rate", "unjustified_zero_rate", "Taux 0 % / exonération : ajoutez une justification explicite.", "correction");
    } else if (!(EXPENSE_ORDINARY_VAT_RATES as readonly number[]).includes(rate)) {
      add(
        "vat_rate",
        rate === 26 ? "rate_26" : "unsupported_rate",
        rate === 26 ? "Taux de 26 % non accepté : distinguez le montant de TVA du taux." : "Taux non accepté : utilisez 2,1, 5,5, 10 ou 20 %, ou justifiez une exonération.",
        "correction",
      );
    }
  }

  const rates = expenseVatRates(value);
  const multiRate = rates.length > 1;
  if (multiRate && rate != null) {
    add("vat_rate", "single_rate_on_multi", "Ticket multi-taux : aucun taux unique ne peut être retenu.", "correction");
  }
  if (multiRate && vat != null && calculatedVat(value)) {
    add("vat_amount", "calculated_vat_on_multi", "Ticket multi-taux : une TVA théorique ne remplace pas la TVA réelle du ticket.", "correction");
  }
  if (!multiRate && vat != null && calculatedVat(value)) {
    add("vat_amount", "calculated_vat", "TVA calculée d’après le TTC et le taux : vérifiez-la sur le ticket.");
  }

  if (!multiRate && ttc != null && ttc > 0 && vat != null && rate != null && rate > 0 && (EXPENSE_ORDINARY_VAT_RATES as readonly number[]).includes(rate)) {
    const expected = (ttc * rate) / (100 + rate);
    if (Math.abs(vat - expected) > 0.03) {
      add("vat_amount", "vat_rate_mismatch", `TVA lue ${vat.toFixed(2)} € ; cohérence TTC/taux attendue autour de ${expected.toFixed(2)} €. La valeur du ticket est conservée.`);
    }
  }

  const ht = expenseNumber(value["amount_ht"]);
  if (has(value["amount_ht"]) && ht == null) add("amount_ht", "invalid_ht", "Montant HT non numérique : vérifiez-le sur le ticket.");
  if (ht != null && vat != null && ttc != null && Math.abs(ht + vat - ttc) > 0.04) {
    add("amount_ht", "ht_vat_ttc_mismatch", "HT + TVA ne correspond pas au TTC : vérifiez les trois montants.");
  }

  const quantity = expenseNumber(value["quantity_litres"]);
  if (has(value["quantity_litres"]) && quantity == null) add("quantity_litres", "invalid_quantity", "Quantité en litres non numérique : vérifiez l’unité sur le ticket.");
  if (quantity != null && (quantity <= 0 || quantity > 999)) {
    add("quantity_litres", "implausible_quantity", "Quantité en litres non plausible : vérifiez l’unité sur le ticket.");
  }
  if (quantity != null && ((rate != null && Math.abs(quantity - rate) < 0.005) || (ttc != null && Math.abs(quantity - ttc) < 0.005) || (vat != null && Math.abs(quantity - vat) < 0.005))) {
    add("quantity_litres", "quantity_confused", "La quantité reprend un taux ou un montant : vérifiez qu’il s’agit bien de litres.");
  }

  const litrePrice = expenseNumber(value["unit_price_litre"]);
  if (has(value["unit_price_litre"]) && litrePrice == null) add("unit_price_litre", "invalid_litre_price", "Prix au litre non numérique : vérifiez l’unité sur le ticket.");
  if (litrePrice != null && (litrePrice <= 0 || litrePrice > 20)) {
    add("unit_price_litre", "implausible_litre_price", "Prix au litre non plausible : vérifiez l’unité.");
  }
  if (quantity != null && quantity > 0 && litrePrice != null && litrePrice > 0 && ttc != null && Math.abs(quantity * litrePrice - ttc) > 0.05) {
    add("quantity_litres", "fuel_total_mismatch", "Quantité × prix au litre ne correspond pas au TTC : vérifiez les valeurs lues.");
  }

  const time = value["transaction_time"];
  if (has(time) && (typeof time !== "string" || !/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(time.trim()))) {
    add("transaction_time", "invalid_time", "Heure de transaction invalide : vérifiez-la sur le ticket.");
  }

  const merchant = value["merchant"];
  if (typeof merchant === "string" && merchant.trim()) {
    const compact = merchant.replace(/\s/g, "");
    if (/^(?:\+?\d[\d .-]{8,}|\d{14})$/.test(compact) || (/^\d{9,14}$/.test(compact) && !/[A-Za-zÀ-ÿ]/.test(merchant))) {
      add("merchant", "merchant_identifier", "Le commerçant ressemble à un téléphone ou SIRET, pas à une enseigne.");
    }
  }

  return {
    ok: issues.length === 0,
    issues,
    reviewFields: [...new Set(issues.map((issue) => issue.field))],
    requiresCorrection: issues.some((issue) => issue.severity === "correction"),
    requiresConfirmation: issues.length > 0,
  };
}

export function expenseSubmissionGuard(
  value: Record<string, unknown>,
  options: ExpenseValidationOptions & { confirmed?: boolean } = {},
): ExpenseValidationResult & { allowed: boolean; error: string } {
  const result = validateExpenseExtract(value, { ...options, mode: options.mode ?? "submit" });
  const allowed = !result.requiresCorrection && (!result.requiresConfirmation || options.confirmed === true);
  const error = result.requiresCorrection
    ? "Vérification requise : corrigez les champs signalés avant l’envoi."
    : result.requiresConfirmation && !options.confirmed
      ? "Vérification requise : contrôlez les champs signalés puis confirmez explicitement."
      : "";
  return { ...result, allowed, error };
}

/** Sanitize avant/après fusion : retire seulement les valeurs structurellement invalides. */
export function sanitizeExpenseFields(input: Record<string, unknown>): { fields: Record<string, unknown>; rejected: string[] } {
  const fields = { ...input };
  const detected = validateExpenseExtract(input).issues;
  const rejected: string[] = [];
  const reject = (key: string) => {
    fields[key] = null;
    if (!rejected.includes(key)) rejected.push(key);
  };

  for (const key of ["amount_ttc", "vat_amount", "vat_rate", "amount_ht", "quantity_litres", "unit_price_litre"]) {
    if (has(fields[key]) && expenseNumber(fields[key]) == null) reject(key);
  }
  const date = fields["date"] ?? fields["spent_on"];
  if (has(date) && !isRealCalendarDate(date)) reject(fields["date"] !== undefined ? "date" : "spent_on");

  const rate = expenseNumber(fields["vat_rate"]);
  if (rate != null && rate !== 0 && !(EXPENSE_ORDINARY_VAT_RATES as readonly number[]).includes(rate)) reject("vat_rate");
  const ttc = expenseNumber(fields["amount_ttc"]);
  const vat = expenseNumber(fields["vat_amount"]);
  if (vat != null && (vat < 0 || (ttc != null && ttc > 0 && vat > (ttc * 20) / 120 + 0.02))) reject("vat_amount");
  if (hasMultipleExpenseVatRates(fields)) {
    if (rate != null) reject("vat_rate");
    if (vat != null && calculatedVat(fields)) reject("vat_amount");
  }
  // Seules les alertes dont la valeur a été retirée doivent traverser la fusion :
  // les autres sont recalculées sur la valeur finale, sans conserver une alerte OCR corrigée par la vision.
  const retained = detected.filter((issue) => rejected.includes(issue.field));
  fields["verification_required"] = retained.length > 0;
  fields["review_fields"] = [...new Set(retained.map((issue) => issue.field))];
  fields["expense_issues"] = retained;
  return { fields, rejected };
}

/** Normalise la sortie finale et conserve les alertes même si une valeur parasite a été retirée. */
export function normalizeExpenseExtract(
  input: Record<string, unknown>,
  options: ExpenseValidationOptions = {},
): Record<string, unknown> {
  const before = validateExpenseExtract(input, options);
  const prior = Array.isArray(input["expense_issues"])
    ? input["expense_issues"].filter((issue): issue is ExpenseIssue => Boolean(issue && typeof issue === "object" && typeof (issue as ExpenseIssue).code === "string" && typeof (issue as ExpenseIssue).message === "string"))
    : [];
  const { fields } = sanitizeExpenseFields(input);
  const after = validateExpenseExtract(fields, options);
  const issues = [...prior, ...before.issues];
  for (const issue of after.issues) {
    if (!issues.some((current) => current.field === issue.field && current.code === issue.code)) issues.push(issue);
  }
  return {
    ...fields,
    verification_required: issues.length > 0,
    review_fields: [...new Set(issues.map((issue) => issue.field))],
    expense_issues: issues,
  };
}
