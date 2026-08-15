const GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";

type Block =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } }
  | { type: "file"; file: { filename: string; file_data: string } };

export async function askVision(prompt: string, dataUrl: string, filename?: string) {
  const apiKey = process.env["LOVABLE_API_KEY"];
  if (!apiKey) {
    return { ok: false as const, error: "Analyse automatique non configurée." };
  }

  const isPdf = dataUrl.startsWith("data:application/pdf");
  const blocks: Block[] = [{ type: "text", text: prompt }];
  if (isPdf) {
    blocks.push({
      type: "file",
      file: { filename: filename || "document.pdf", file_data: dataUrl },
    });
  } else {
    blocks.push({ type: "image_url", image_url: { url: dataUrl } });
  }

  const res = await fetch(GATEWAY, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: "google/gemini-3.5-flash",
      messages: [{ role: "user", content: blocks }],
    }),
  });

  if (!res.ok) {
    const detail = await res.text();
    console.error("AI gateway error", res.status, detail);
    if (res.status === 429) return { ok: false as const, error: "Trop de demandes, réessayez dans un instant." };
    if (res.status === 402) return { ok: false as const, error: "Crédits d'analyse épuisés." };
    return { ok: false as const, error: "L'analyse automatique a échoué." };
  }

  const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const content = json.choices?.[0]?.message?.content ?? "";
  return { ok: true as const, content };
}

export function parseJsonBlock(content: string): Record<string, unknown> | null {
  const cleaned = content
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}