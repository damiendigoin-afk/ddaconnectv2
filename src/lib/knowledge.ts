import { supabase } from "@/integrations/supabase/client";

export type Article = {
  id: string;
  title: string;
  category: string;
  body: string;
  tags: string[];
  pinned: boolean;
  author_name: string | null;
  updated_at: string;
};

export const KB_CATEGORIES = [
  { key: "general", label: "Général" },
  { key: "atelier", label: "Atelier" },
  { key: "carrosserie", label: "Carrosserie" },
  { key: "magasin", label: "Magasin" },
  { key: "administratif", label: "Administratif" },
  { key: "outils", label: "Outils & logiciels" },
] as const;

export async function listArticles(): Promise<Article[]> {
  const { data, error } = await supabase
    .from("knowledge_articles")
    .select("id, title, category, body, tags, pinned, author_name, updated_at")
    .order("pinned", { ascending: false })
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as Article[];
}

export async function saveArticle(input: Partial<Article> & { id?: string }) {
  if (input.id) {
    const { id, ...rest } = input;
    const { error } = await supabase.from("knowledge_articles").update(rest as never).eq("id", id);
    if (error) throw error;
    return;
  }
  const { error } = await supabase.from("knowledge_articles").insert(input as never);
  if (error) throw error;
}

export async function deleteArticle(id: string) {
  const { error } = await supabase.from("knowledge_articles").delete().eq("id", id);
  if (error) throw error;
}