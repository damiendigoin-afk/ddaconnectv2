import { cn } from "@/lib/utils";

export type PointStatus = "unset" | "ok" | "watch" | "defect";

const OPTIONS: { value: Exclude<PointStatus, "unset">; label: string; cls: string }[] = [
  {
    value: "ok",
    label: "OK",
    cls: "data-[on=true]:bg-status-ok data-[on=true]:text-white data-[on=true]:border-status-ok",
  },
  {
    value: "watch",
    label: "À surveiller",
    cls: "data-[on=true]:bg-status-watch data-[on=true]:text-primary data-[on=true]:border-status-watch",
  },
  {
    value: "defect",
    label: "Défaut",
    cls: "data-[on=true]:bg-status-defect data-[on=true]:text-white data-[on=true]:border-status-defect",
  },
];

export function StatusPicker({
  value,
  onChange,
  compact,
}: {
  value: PointStatus;
  onChange: (v: PointStatus) => void;
  compact?: boolean;
}) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          data-on={value === o.value}
          onClick={() => onChange(value === o.value ? "unset" : o.value)}
          className={cn(
            "rounded-lg border-2 border-border bg-card font-semibold transition-colors",
            compact ? "px-2 py-2 text-xs" : "px-2 py-3 text-sm",
            o.cls,
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    ok: "bg-status-ok-soft text-status-ok",
    watch: "bg-status-watch-soft text-status-watch",
    defect: "bg-status-defect-soft text-status-defect",
    unset: "bg-status-unset-soft text-status-unset",
  };
  const labels: Record<string, string> = {
    ok: "OK",
    watch: "À surveiller",
    defect: "Défaut",
    unset: "Non renseigné",
  };
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-md px-2 py-0.5 text-xs font-bold",
        map[status] ?? map["unset"],
      )}
    >
      {labels[status] ?? status}
    </span>
  );
}