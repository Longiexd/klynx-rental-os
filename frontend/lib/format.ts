// ============================================================
// FORMAT HELPERS
//
// Shared date / currency / name formatting used across the app.
// Every page previously reimplemented these independently —
// consolidated here so a formatting fix only needs to happen once.
// ============================================================

export function parseDate(value?: string | null): Date | null {
  if (!value) return null;

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return null;

  return date;
}

export function formatDate(value?: string | null): string {
  const date = parseDate(value);

  if (!date) return "—";

  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function formatDateShort(value?: string | null): string {
  const date = parseDate(value);

  if (!date) return "—";

  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
  });
}

export function formatDateTime(value?: string | null): string {
  const date = parseDate(value);

  if (!date) return "—";

  return `${formatDate(value)} · ${date.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}

export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function formatCurrency(
  value?: number | null,
  currency: string = "TND"
): string {
  const amount = Number(value) || 0;

  return `${amount.toLocaleString("en-US", {
    maximumFractionDigits: 0,
  })} ${currency}`;
}

export function getInitials(name?: string | null): string {
  if (!name) return "?";

  const parts = name.trim().split(/\s+/).filter(Boolean);

  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();

  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
