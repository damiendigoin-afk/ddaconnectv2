-- Scan OR WinMotor : en-têtes garage tronqués, brouillons de capture.
CREATE OR REPLACE FUNCTION public.phone_near(_a text, _b text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT length(_a) = 10 AND length(_b) = 10
    AND (SELECT count(*) FROM generate_series(1, 10) i WHERE substr(_a, i, 1) <> substr(_b, i, 1)) <= 1
$$;

CREATE OR REPLACE FUNCTION public.is_garage_contact(_kind text, _v text, _site uuid DEFAULT NULL) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE n text; d text; s record; p text;
BEGIN
  IF coalesce(btrim(_v),'') = '' THEN RETURN false; END IF;
  IF _kind = 'email' THEN
    n := lower(btrim(_v)); d := split_part(n, '@', 2);
    IF d IN ('dda-lalinde.fr','garagecastillon.fr') THEN RETURN true; END IF;
    RETURN EXISTS (SELECT 1 FROM sites WHERE lower(email_from_address) = n
      OR (split_part(lower(email_from_address),'@',2) = d AND d !~ '^(gmail|hotmail|outlook|yahoo|orange|free|sfr|wanadoo|laposte|icloud)\.'));
  ELSIF _kind = 'phone' THEN
    n := regexp_replace(_v, '\D', '', 'g'); IF n ~ '^33\d{9}$' THEN n := '0'||substr(n,3); END IF;
    IF length(n) < 9 THEN RETURN false; END IF;
    FOREACH p IN ARRAY ARRAY['0553247718','0553292023'] LOOP
      IF n = p OR public.phone_near(n, p) THEN RETURN true; END IF;
    END LOOP;
    RETURN EXISTS (SELECT 1 FROM sites WHERE coalesce(phone,'') <> ''
      AND (regexp_replace(phone,'\D','','g') = n OR public.phone_near(n, regexp_replace(phone,'\D','','g'))));
  ELSIF _kind = 'address' THEN
    n := norm_contact(_v);
    RETURN n IN ('27 avenue eugene leroy','1340 route de beynac') OR EXISTS (SELECT 1 FROM sites WHERE coalesce(address,'') <> '' AND norm_contact(address) = n);
  ELSIF _kind = 'name' THEN
    n := norm_contact(_v);
    IF n = '' THEN RETURN false; END IF;
    IF n IN ('dda','sas dda') OR n LIKE '%damien digoin automobile%' OR n LIKE '%garage castillon veyssiere%' THEN RETURN true; END IF;
    IF n ~ '^(sas damien|damien digoin|digoin automobile|sas castillon|garage castillon|castillon veyssi|sas sastillon|sastillon veyssi)'
       OR n LIKE '%damien digoin%' OR n LIKE '%castillon veyssi%' OR n LIKE '%garage castillon%' OR n LIKE '%digoin automobile%' THEN RETURN true; END IF;
    FOR s IN SELECT legal_name, name FROM sites LOOP
      IF length(norm_contact(s.legal_name)) >= 10 AND n LIKE '%'||norm_contact(s.legal_name)||'%' THEN RETURN true; END IF;
      IF length(norm_contact(s.name)) >= 10 AND n LIKE '%'||norm_contact(s.name)||'%' THEN RETURN true; END IF;
    END LOOP;
  END IF;
  RETURN false;
END $$;

CREATE TABLE IF NOT EXISTS public.or_client_captures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  repair_order_id uuid NOT NULL REFERENCES public.repair_orders(id) ON DELETE CASCADE,
  site_id uuid,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  reason text NOT NULL DEFAULT 'identite_absente',
  status text NOT NULL DEFAULT 'pending',
  resolved_client_id uuid,
  resolved_customer_id uuid,
  created_by uuid,
  created_by_name text,
  resolved_by uuid,
  resolved_by_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS or_client_captures_pending_uniq ON public.or_client_captures (repair_order_id, md5(data::text)) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS or_client_captures_or_idx ON public.or_client_captures (repair_order_id);
GRANT SELECT ON public.or_client_captures TO authenticated;
GRANT ALL ON public.or_client_captures TO service_role;
ALTER TABLE public.or_client_captures ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Captures visibles sur ses sites" ON public.or_client_captures FOR SELECT TO authenticated
  USING (public.is_active_user(auth.uid()) AND site_id IS NOT NULL AND public.user_can_access_site(auth.uid(), site_id));

GRANT EXECUTE ON FUNCTION public.phone_near(text, text) TO authenticated, service_role;