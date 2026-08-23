-- 1. Interventions DDA vs OR WinMotor
ALTER TABLE public.repair_orders
  ADD COLUMN IF NOT EXISTS record_type text NOT NULL DEFAULT 'intervention',
  ADD COLUMN IF NOT EXISTS or_source text,
  ADD COLUMN IF NOT EXISTS or_linked_at timestamptz;

ALTER TABLE public.repair_orders DROP CONSTRAINT IF EXISTS repair_orders_record_type_check;
ALTER TABLE public.repair_orders
  ADD CONSTRAINT repair_orders_record_type_check CHECK (record_type IN ('intervention','or_winmotor'));

UPDATE public.repair_orders
   SET record_type = CASE WHEN COALESCE(NULLIF(btrim(or_number), ''), NULL) IS NOT NULL THEN 'or_winmotor' ELSE 'intervention' END,
       or_status = CASE WHEN COALESCE(NULLIF(btrim(or_number), ''), NULL) IS NOT NULL THEN 'or_complet' ELSE 'sans_or' END;

UPDATE public.repair_orders
   SET internal_ref = public.next_dda_order_ref()
 WHERE internal_ref IS NULL;

CREATE INDEX IF NOT EXISTS idx_repair_orders_record_type ON public.repair_orders (record_type);

-- 2. Tâches rattachées à une intervention
CREATE TABLE IF NOT EXISTS public.intervention_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  intervention_id uuid NOT NULL REFERENCES public.repair_orders(id) ON DELETE CASCADE,
  label text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'a_faire',
  priority text NOT NULL DEFAULT 'normale',
  assignee_id uuid,
  assignee_name text,
  due_at timestamptz,
  position integer NOT NULL DEFAULT 0,
  created_by uuid,
  created_by_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.intervention_tasks TO authenticated;
GRANT ALL ON public.intervention_tasks TO service_role;
ALTER TABLE public.intervention_tasks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS intervention_tasks_active ON public.intervention_tasks;
CREATE POLICY intervention_tasks_active ON public.intervention_tasks FOR ALL TO authenticated
  USING (public.is_active_user(auth.uid())) WITH CHECK (public.is_active_user(auth.uid()));
DROP TRIGGER IF EXISTS trg_intervention_tasks_updated ON public.intervention_tasks;
CREATE TRIGGER trg_intervention_tasks_updated BEFORE UPDATE ON public.intervention_tasks
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE INDEX IF NOT EXISTS idx_intervention_tasks_intervention ON public.intervention_tasks (intervention_id);

-- 3. Correspondances externes (WinMotor) — jamais générées par DDA
CREATE TABLE IF NOT EXISTS public.external_refs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  system text NOT NULL DEFAULT 'winmotor',
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  external_id text NOT NULL,
  match_status text NOT NULL DEFAULT 'suggested',
  match_score numeric,
  match_criteria jsonb NOT NULL DEFAULT '[]'::jsonb,
  import_id uuid,
  confirmed_by uuid,
  confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT external_refs_entity_type_check CHECK (entity_type IN ('customer','vehicle','order','client','ref_vehicle')),
  CONSTRAINT external_refs_status_check CHECK (match_status IN ('suggested','confirmed','rejected'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_external_refs_pair
  ON public.external_refs (system, entity_type, entity_id, external_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_external_refs_confirmed
  ON public.external_refs (system, entity_type, external_id) WHERE match_status = 'confirmed';
CREATE INDEX IF NOT EXISTS idx_external_refs_entity ON public.external_refs (entity_type, entity_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.external_refs TO authenticated;
GRANT ALL ON public.external_refs TO service_role;
ALTER TABLE public.external_refs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS external_refs_active ON public.external_refs;
CREATE POLICY external_refs_active ON public.external_refs FOR ALL TO authenticated
  USING (public.is_active_user(auth.uid())) WITH CHECK (public.is_active_user(auth.uid()));
DROP TRIGGER IF EXISTS trg_external_refs_updated ON public.external_refs;
CREATE TRIGGER trg_external_refs_updated BEFORE UPDATE ON public.external_refs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 4. Reprise des identifiants WinMotor déjà connus comme correspondances confirmées
INSERT INTO public.external_refs (system, entity_type, entity_id, external_id, match_status, match_criteria, confirmed_at)
SELECT 'winmotor', 'customer', c.id, c.source_customer_id, 'confirmed', '["winmotor_id"]'::jsonb, now()
  FROM public.customers c
 WHERE c.source_system = 'winmotor' AND NULLIF(btrim(c.source_customer_id), '') IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO public.external_refs (system, entity_type, entity_id, external_id, match_status, match_criteria, confirmed_at)
SELECT 'winmotor', 'ref_vehicle', v.id, v.source_vehicle_id, 'confirmed', '["winmotor_id"]'::jsonb, now()
  FROM public.ref_vehicles v
 WHERE v.source_system = 'winmotor' AND NULLIF(btrim(v.source_vehicle_id), '') IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO public.external_refs (system, entity_type, entity_id, external_id, match_status, match_criteria, confirmed_at)
SELECT 'winmotor', 'order', o.id, btrim(o.or_number), 'confirmed', '["winmotor_or_number"]'::jsonb, now()
  FROM public.repair_orders o
 WHERE NULLIF(btrim(o.or_number), '') IS NOT NULL
ON CONFLICT DO NOTHING;