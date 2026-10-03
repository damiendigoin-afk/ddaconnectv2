/** Branchement serveur du pipeline commun : budget/réglage, journal, IA texte puis vision, mémoire fournisseurs. */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

import { fingerprint, journalLocal, readBudget, runPaidAi, type PaidAiResult } from "./ai-usage.server";
import { detectMedia, runDocPipeline, type PipelineResult } from "./doc-pipeline";
import { headerTokens, type DocKind, type Fields, type SupplierHint } from "./doc-rules";
import { askVision, parseJsonBlock, VISION_MODEL } from "./ocr.server";
import { normSupplierName, supplierAliases } from "./supplier-identify";

export type ReadDocInput = {
  feature: string;
  kind: DocKind;
  /** Prompt historique (schéma JSON attendu). */
  prompt: string;
  text?: string | null | undefined;
  dataUrl?: string | null;
  filename?: string | undefined;
  visionExtra?: Record<string, unknown> | undefined;
  /** Banc de test : nouvelle analyse sans cache, métriques remontées (jamais utilisé par le métier). */
  bench?: { bypassCache: boolean; onAi: (route: "ai_text_fallback" | "ai_vision_fallback", r: PaidAiResult) => void };
};

async function supplierHints(): Promise<SupplierHint[]> {
  const [{ data: sup }, { data: prof }] = await Promise.all([
    supabaseAdmin.from("suppliers").select("name, notes").limit(2000),
    supabaseAdmin.from("supplier_doc_profiles").select("supplier_name, header_tokens").limit(2000),
  ]);
  const map = new Map<string, SupplierHint>();
  for (const s of sup ?? []) if (s.name) map.set(normSupplierName(s.name), { name: s.name, aliases: supplierAliases(s.notes) });
  for (const p of prof ?? []) {
    const k = normSupplierName(p.supplier_name);
    map.set(k, { ...(map.get(k) ?? { name: p.supplier_name }), header_tokens: p.header_tokens });
  }
  return [...map.values()];
}

/** Capitalise la structure d'un document fournisseur pour que les suivants passent sans IA. */
export async function learnSupplierProfile(supplier: string | null | undefined, text: string | null | undefined, route: string) {
  const name = (supplier ?? "").trim();
  if (!name || !text || text.length < 60) return;
  const key = normSupplierName(name);
  try {
    const { data: cur } = await supabaseAdmin.from("supplier_doc_profiles").select("uses, rules_success, header_tokens").eq("supplier_key", key).maybeSingle();
    const toks = [...new Set([...(cur?.header_tokens ?? []), ...headerTokens(text)])].slice(0, 30);
    await supabaseAdmin.from("supplier_doc_profiles").upsert(
      {
        supplier_key: key,
        supplier_name: name,
        header_tokens: toks,
        uses: (cur?.uses ?? 0) + 1,
        rules_success: (cur?.rules_success ?? 0) + (route === "ocr_rules" ? 1 : 0),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "supplier_key" },
    );
  } catch (e) {
    console.error("supplier profile learn failed", e);
  }
}

export async function readDocument(input: ReadDocInput): Promise<PipelineResult> {
  const text = (input.text ?? "").slice(0, 20000);
  const ctx = input.kind === "purchase" ? { suppliers: await supplierHints() } : {};
  const fp = await fingerprint(input.feature, text || input.dataUrl?.slice(0, 5000) || "");
  return runDocPipeline(
    { kind: input.kind, text, hasImage: !!input.dataUrl, media: detectMedia(input.dataUrl, text), ctx },
    {
      fallbackEnabled: async () => (await readBudget()).fallbackAiEnabled,
      logLocal: (route, missing) =>
        journalLocal({ feature: input.feature, fingerprint: fp, route, success: route === "ocr_rules", blocked_reason: route === "manual" ? `repli_ia_desactive:${missing.join(",")}` : null }),
      aiText: async (missing) => {
        const res = await runPaidAi({
          feature: input.feature,
          route: "ai_text_fallback",
          fingerprintSeed: `${input.prompt}\u0000${text}`,
          model: VISION_MODEL,
          ...(input.bench?.bypassCache ? { bypassCache: true } : {}),
          body: {
            messages: [
              {
                role: "user",
                content: `${input.prompt}\n\nTu ne reçois PAS l'image : uniquement le texte OCR ci-dessous (peut contenir des erreurs de lecture).
Champs manquants à trouver en priorité : ${missing.join(", ")}. N'invente rien : null si absent du texte.\n\n--- TEXTE OCR ---\n${text}`,
              },
            ],
          },
        });
        input.bench?.onAi("ai_text_fallback", res);
        return res.ok ? parseJsonBlock(res.content) : null;
      },
      aiVision: async (_missing, essential) => {
        if (!input.dataUrl) return null;
        const res = await askVision(input.prompt, input.dataUrl, input.filename, input.feature, input.visionExtra ?? {}, essential, input.bench ? { bypassCache: input.bench.bypassCache, onResult: (r) => input.bench!.onAi("ai_vision_fallback", r) } : {});
        return res.ok ? parseJsonBlock(res.content) : null;
      },
    },
  );
}

export type { Fields };
