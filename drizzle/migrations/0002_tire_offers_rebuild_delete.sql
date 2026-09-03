-- Reconstruction du chiffrage pneus : un utilisateur actif doit pouvoir purger
-- les anciennes offres de son tour, sinon les propositions s'empilent.
drop policy if exists "tire_quote_offers_delete" on public.tire_quote_offers;

create policy "tire_quote_offers_delete_active"
on public.tire_quote_offers
for delete
to authenticated
using (public.is_active_user(auth.uid()));