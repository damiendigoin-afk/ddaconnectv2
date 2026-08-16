import type { ReactNode } from "react";

export function Badge({ children, tone = "bg-secondary text-foreground" }: { children: ReactNode; tone?: string }) {
  return (
    <span className={`inline-block rounded-md px-2 py-1 text-[11px] font-bold uppercase tracking-wide ${tone}`}>
      {children}
    </span>
  );
}

export function Section({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between px-1 pt-4">
        <h2 className="text-sm font-extrabold uppercase tracking-wide">{title}</h2>
        {right}
      </div>
      {children}
    </section>
  );
}

export function Field({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-muted-foreground">{label}</span>
      <input
        type={type}
        value={value}
        placeholder={placeholder ?? ""}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border-2 border-border bg-card px-3 py-3 text-base outline-none focus:border-brand"
      />
    </label>
  );
}

export function Area({ label, value, onChange, rows = 3 }: { label: string; value: string; onChange: (v: string) => void; rows?: number }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-muted-foreground">{label}</span>
      <textarea
        rows={rows}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border-2 border-border bg-card px-3 py-3 text-base outline-none focus:border-brand"
      />
    </label>
  );
}

export function Select({
  label,
  value,
  onChange,
  options,
  allowEmpty = true,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: readonly { key: string; label: string }[];
  allowEmpty?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-muted-foreground">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border-2 border-border bg-card px-3 py-3 text-base outline-none focus:border-brand"
      >
        {allowEmpty ? <option value="">—</option> : null}
        {options.map((o) => (
          <option key={o.key} value={o.key}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function Counter({
  label,
  value,
  active,
  onClick,
}: {
  label: string;
  value: number | string;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-xl border-2 px-3 py-3 text-left transition ${
        active ? "border-brand bg-brand/10" : "border-border bg-card"
      }`}
    >
      <div className="text-2xl font-extrabold leading-none">{value}</div>
      <div className="mt-1 text-[11px] font-bold uppercase leading-tight text-muted-foreground">{label}</div>
    </button>
  );
}
