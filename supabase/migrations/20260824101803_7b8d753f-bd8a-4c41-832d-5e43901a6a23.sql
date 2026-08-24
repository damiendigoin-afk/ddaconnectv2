DROP POLICY IF EXISTS open_vehicle_inspections ON public.vehicle_inspections;

CREATE POLICY vehicle_inspections_select ON public.vehicle_inspections
FOR SELECT TO authenticated
USING (public.is_active_user(auth.uid()));

CREATE POLICY vehicle_inspections_insert ON public.vehicle_inspections
FOR INSERT TO authenticated
WITH CHECK (public.is_active_user(auth.uid()));

CREATE POLICY vehicle_inspections_update ON public.vehicle_inspections
FOR UPDATE TO authenticated
USING (public.is_active_user(auth.uid()))
WITH CHECK (public.is_active_user(auth.uid()));

-- Suppression définitive d'un Tour clôturé : managers uniquement.
CREATE POLICY vehicle_inspections_delete ON public.vehicle_inspections
FOR DELETE TO authenticated
USING (
  public.is_active_user(auth.uid())
  AND (status <> 'completed' OR public.has_role(auth.uid(), 'manager'))
);