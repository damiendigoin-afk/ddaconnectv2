/** Édition contrôlée de la fiche client (identité, coordonnées, adresse), sauvegarde ciblée + audit. */
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Pencil } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { logChanges } from "@/lib/audit";
import { useAuth } from "@/lib/auth";
import { linkErrorMessage } from "@/lib/bodyshop-link";
import { initialCustomerForm, saveCustomer, type AddressRow, type ContactRow, type CustomerForm } from "@/lib/customer-edit";

export function CustomerInlineEditor({ customer, contacts, address }: { customer: Record<string, unknown> & { id: string }; contacts: ContactRow[]; address: AddressRow | undefined }) {
  const { user, displayName } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [before, setBefore] = useState<CustomerForm>(() => initialCustomerForm(customer, contacts, address));
  const [form, setForm] = useState<CustomerForm>(before);
  const [saving, setSaving] = useState(false);

  function start() {
    const b = initialCustomerForm(customer, contacts, address);
    setBefore(b);
    setForm(b);
    setOpen(true);
  }

  async function save() {
    if (saving) return;
    setSaving(true);
    try {
      await saveCustomer(supabase as never, customer.id, contacts, address, before, form);
      await logChanges({ entity: "client", entityId: customer.id, before, after: form, userId: user?.id ?? null, userName: displayName || null });
      await qc.invalidateQueries({ queryKey: ["customer", customer.id] });
      toast.success("Fiche client mise à jour");
      setOpen(false);
    } catch (e) {
      toast.error(linkErrorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  if (!open)
    return (
      <button onClick={start} className="flex items-center gap-1 rounded-lg border-2 border-border px-3 py-2 text-xs font-bold uppercase">
        <Pencil className="h-4 w-4" /> Modifier la fiche
      </button>
    );

  const f = (k: keyof CustomerForm, label: string) => (
    <label className="block text-[11px] uppercase text-muted-foreground">
      {label}
      <input value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} placeholder="—" className="mt-0.5 w-full rounded-lg border-2 border-border bg-card px-2 py-1.5 text-sm normal-case text-foreground" />
    </label>
  );
  return (
    <section className="card-surface space-y-2 p-4">
      <h2 className="text-xs font-bold uppercase text-muted-foreground">Modifier la fiche client</h2>
      <div className="grid grid-cols-2 gap-2">
        <label className="block text-[11px] uppercase text-muted-foreground">
          Type
          <select value={form.customer_type} onChange={(e) => setForm({ ...form, customer_type: e.target.value })} className="mt-0.5 w-full rounded-lg border-2 border-border bg-card px-2 py-1.5 text-sm normal-case text-foreground">
            <option value="individual">Particulier</option>
            <option value="company">Entreprise</option>
          </select>
        </label>
        {f("civility", "Civilité")}
        {f("last_name", "Nom")}
        {f("first_name", "Prénom")}
        {f("company_name", "Société")}
        {f("mobile", "Mobile")}
        {f("phone", "Téléphone fixe")}
        {f("email", "E-mail")}
        {f("address_line_1", "Adresse")}
        {f("postal_code", "Code postal")}
        {f("city", "Ville")}
      </div>
      <div className="flex gap-2">
        <button onClick={() => setOpen(false)} className="flex-1 rounded-lg border-2 border-border px-3 py-2 text-sm font-bold">Annuler</button>
        <button disabled={saving} onClick={() => void save()} className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-brand px-3 py-2 text-sm font-bold text-brand-foreground disabled:opacity-50">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Enregistrer
        </button>
      </div>
    </section>
  );
}
