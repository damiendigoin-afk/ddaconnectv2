# WinMotor rules (src/lib/winmotor)
- WinMotor invoices: imported only via SECURITY DEFINER RPCs wm_* (site chosen explicitly, OR identity = site + or_number, or_sale_final once per link). Why: WinMotor primacy, idempotent re-imports, traceable stock.
