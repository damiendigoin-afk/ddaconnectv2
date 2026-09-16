-- activity_months
drop policy if exists "activity_months read" on public.activity_months;
drop policy if exists "activity_months insert" on public.activity_months;
drop policy if exists "activity_months update" on public.activity_months;
drop policy if exists "activity_months delete" on public.activity_months;
create policy "activity_months read" on public.activity_months for select to authenticated using (public.is_active_user(auth.uid()));
create policy "activity_months insert" on public.activity_months for insert to authenticated with check (public.is_active_user(auth.uid()));
create policy "activity_months update" on public.activity_months for update to authenticated using (public.is_active_user(auth.uid())) with check (public.is_active_user(auth.uid()));
create policy "activity_months delete" on public.activity_months for delete to authenticated using (public.has_role(auth.uid(), 'manager'::app_role));

-- activity_values
drop policy if exists "activity_values read" on public.activity_values;
drop policy if exists "activity_values insert" on public.activity_values;
drop policy if exists "activity_values update" on public.activity_values;
drop policy if exists "activity_values delete" on public.activity_values;
create policy "activity_values read" on public.activity_values for select to authenticated using (public.is_active_user(auth.uid()));
create policy "activity_values insert" on public.activity_values for insert to authenticated with check (public.is_active_user(auth.uid()));
create policy "activity_values update" on public.activity_values for update to authenticated using (public.is_active_user(auth.uid())) with check (public.is_active_user(auth.uid()));
create policy "activity_values delete" on public.activity_values for delete to authenticated using (public.has_role(auth.uid(), 'manager'::app_role));

-- activity_imports
drop policy if exists "activity_imports read" on public.activity_imports;
drop policy if exists "activity_imports write" on public.activity_imports;
drop policy if exists "activity_imports update" on public.activity_imports;
create policy "activity_imports read" on public.activity_imports for select to authenticated using (public.is_active_user(auth.uid()));
create policy "activity_imports write" on public.activity_imports for insert to authenticated with check (public.is_active_user(auth.uid()));
create policy "activity_imports update" on public.activity_imports for update to authenticated using (public.is_active_user(auth.uid())) with check (public.is_active_user(auth.uid()));

-- ad_assets
drop policy if exists "ad_assets_read" on public.ad_assets;
drop policy if exists "ad_assets_insert" on public.ad_assets;
drop policy if exists "ad_assets_update" on public.ad_assets;
create policy "ad_assets_read" on public.ad_assets for select to authenticated using (public.is_active_user(auth.uid()));
create policy "ad_assets_insert" on public.ad_assets for insert to authenticated with check (public.is_active_user(auth.uid()));
create policy "ad_assets_update" on public.ad_assets for update to authenticated using (public.is_active_user(auth.uid())) with check (public.is_active_user(auth.uid()));

-- winmotor_journals
drop policy if exists "winmotor_journals_read" on public.winmotor_journals;
create policy "winmotor_journals_read" on public.winmotor_journals for select to authenticated using (public.is_active_user(auth.uid()));
