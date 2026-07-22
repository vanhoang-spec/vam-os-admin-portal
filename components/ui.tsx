import Link from "next/link";
import { Eye } from "lucide-react";
import { cn, displayText, externalUrl } from "@/lib/utils";

export function PageHeader({ title, description }: { title: string; description?: string }) {
  return (
    <div className="mb-6">
      <h1 className="text-2xl font-semibold tracking-normal text-vam-ink">{title}</h1>
      {description ? <p className="mt-1 text-sm text-slate-500">{description}</p> : null}
    </div>
  );
}

export function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return <section className={cn("rounded-lg border border-vam-line bg-white p-4 shadow-soft", className)}>{children}</section>;
}

export function KpiCard({
  label,
  value,
  tone = "default",
  helper
}: {
  label: string;
  value: number | string;
  tone?: "default" | "success" | "warning" | "danger";
  helper?: string;
}) {
  const displayValue = typeof value === "number"
    ? new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 }).format(value)
    : value;
  const valueClass =
    tone === "success" ? "text-green-700"
    : tone === "warning" ? "text-amber-700"
    : tone === "danger" ? "text-red-700"
    : "text-vam-ink";
  return (
    <Card>
      <div className="text-sm text-slate-500">{label}</div>
      <div className={cn("mt-2 text-3xl font-semibold", valueClass)}>{displayValue}</div>
      {helper ? <div className="mt-1.5 text-xs text-slate-400">{helper}</div> : null}
    </Card>
  );
}

export function ExternalLinkButton({ href, label }: { href: unknown; label: string }) {
  const normalizedHref = externalUrl(href);
  if (!normalizedHref) return <span>-</span>;
  return (
    <a
      href={normalizedHref}
      target="_blank"
      rel="noopener noreferrer"
      title={label}
      className="inline-flex items-center gap-1 rounded-md border border-vam-line px-2.5 py-1 text-xs font-medium text-vam-green hover:bg-vam-mint"
    >
      <Eye className="h-3.5 w-3.5" aria-hidden="true" />
      <span>Xem</span>
    </a>
  );
}

export function InternalLinkButton({ href, label }: { href: unknown; label: string }) {
  const resolvedHref = String(href ?? "").trim();
  if (!resolvedHref) return <span>-</span>;
  return (
    <Link href={resolvedHref} title={label} className="inline-flex items-center gap-1 rounded-md border border-vam-line px-2.5 py-1 text-xs font-medium text-vam-green hover:bg-vam-mint">
      <Eye className="h-3.5 w-3.5" aria-hidden="true" />
      <span>Xem</span>
    </Link>
  );
}

export function ErrorBox({ message }: { message?: string | null }) {
  if (!message) return null;
  return <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{message}</div>;
}

export function EmptyState({ message = "Chưa có dữ liệu để hiển thị." }: { message?: string }) {
  return <div className="rounded-md border border-dashed border-vam-line bg-white px-4 py-8 text-center text-sm text-slate-500">{message}</div>;
}

export function DetailGrid({ rows }: { rows: Array<[string, unknown]> }) {
  return (
    <dl className="grid gap-3 sm:grid-cols-2">
      {rows.map(([label, value]) => (
        <div key={label} className="rounded-md border border-vam-line bg-slate-50 px-3 py-2">
          <dt className="text-xs font-medium uppercase text-slate-500">{label}</dt>
          <dd className="mt-1 break-words text-sm text-vam-ink">{displayText(value)}</dd>
        </div>
      ))}
    </dl>
  );
}

type SimpleTableColumn<T> = {
  key: string;
  label: string;
  render?: (row: T) => React.ReactNode;
  externalHrefKey?: string;
  externalLabel?: string;
  internalHrefKey?: string;
  internalHrefPrefix?: string;
  internalLabel?: string;
  displayKey?: string;
  secondaryKey?: string;
  secondaryLabel?: string;
  nowrap?: boolean;
  badge?: boolean;
  truncate?: boolean;
};

function shouldTruncateColumn(column: SimpleTableColumn<any>) {
  if (typeof column.truncate === "boolean") return column.truncate;
  return /email|note|notes|url|link|text|title|reason|source|quality|channel/i.test(`${column.key} ${column.displayKey ?? ""}`);
}

export function TruncatedText({ value, truncate, className }: { value: unknown; truncate?: boolean; className?: string }) {
  const content = displayText(value);
  return (
    <span title={content !== "-" ? content : undefined} className={cn("block", truncate ? "max-w-[18rem] truncate" : undefined, className)}>
      {content}
    </span>
  );
}

export function SimpleTable<T>({
  rows,
  columns,
  getHref
}: {
  rows: T[];
  columns: Array<SimpleTableColumn<T>>;
  getHref?: (row: T) => string;
}) {
  if (!rows.length) return <EmptyState />;
  const renderCell = (row: T, column: SimpleTableColumn<T>, href?: string) => {
    if (column.render) return column.render(row);
    if (column.externalHrefKey) return <ExternalLinkButton href={(row as any)[column.externalHrefKey]} label={column.externalLabel ?? "Xem"} />;
    if (column.internalHrefKey) {
      return (
        <InternalLinkButton
          href={(row as any)[column.internalHrefKey] ? `${column.internalHrefPrefix ?? ""}${(row as any)[column.internalHrefKey]}` : ""}
          label={column.internalLabel ?? "Xem"}
        />
      );
    }
    if (column.badge) {
      return (
        <span className="inline-flex rounded-md border border-vam-line bg-slate-50 px-2 py-1 text-xs font-medium text-vam-ink">
          {displayText((row as any)[column.displayKey ?? column.key])}
        </span>
      );
    }
    const truncate = shouldTruncateColumn(column);
    if (column.secondaryKey) {
      const primary = (row as any)[column.displayKey ?? column.key];
      const secondary = (row as any)[column.secondaryKey];
      const content = (
        <>
          <TruncatedText value={primary} truncate={truncate} className={cn("font-medium text-vam-ink", column.nowrap ? "whitespace-nowrap" : undefined)} />
          <div className="mt-1 text-xs text-slate-500">
            {column.secondaryLabel ? `${column.secondaryLabel}: ` : ""}
            <TruncatedText value={secondary} truncate={truncate} />
          </div>
        </>
      );
      return href ? <Link href={href} className="block">{content}</Link> : <div>{content}</div>;
    }
    const value = (row as any)[column.displayKey ?? column.key];
    if (href) {
      return (
        <Link href={href} className="block">
          <TruncatedText value={value} truncate={truncate} className={column.nowrap ? "whitespace-nowrap" : undefined} />
        </Link>
      );
    }
    return <TruncatedText value={value} truncate={truncate} className={column.nowrap ? "whitespace-nowrap" : undefined} />;
  };
  return (
    <div className="overflow-hidden rounded-lg border border-vam-line bg-white">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-vam-line text-sm">
          <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500">
            <tr>
              {columns.map((column) => (
                <th key={column.key} className="px-4 py-3">{column.label}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-vam-line">
            {rows.map((row, index) => {
              const href = getHref?.(row);
              if (href) {
                return (
                  <tr key={href} className="hover:bg-vam-mint/50">
                    {columns.map((column) => (
                      <td key={column.key} className="max-w-xs break-words px-4 py-3 text-slate-700">
                        {renderCell(row, column, href)}
                      </td>
                    ))}
                  </tr>
                );
              }
              return (
                <tr key={index}>
                  {columns.map((column) => (
                    <td key={column.key} className="max-w-xs break-words px-4 py-3 text-slate-700">
                      {renderCell(row, column)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function ProgressiveTable<T>({
  rows,
  columns,
  getHref,
  initialCount = 20,
  summaryLabel
}: {
  rows: T[];
  columns: Array<SimpleTableColumn<T>>;
  getHref?: (row: T) => string;
  initialCount?: number;
  summaryLabel?: string;
}) {
  if (rows.length <= initialCount) return <SimpleTable rows={rows} columns={columns} getHref={getHref} />;
  const firstRows = rows.slice(0, initialCount);
  const remainingRows = rows.slice(initialCount);
  return (
    <div className="grid gap-3">
      <SimpleTable rows={firstRows} columns={columns} getHref={getHref} />
      <details className="rounded-lg border border-dashed border-vam-line bg-white px-4 py-3">
        <summary className="cursor-pointer text-sm font-medium text-vam-green">
          {summaryLabel ?? `Xem thêm ${remainingRows.length} dòng`}
        </summary>
        <div className="mt-3">
          <SimpleTable rows={remainingRows} columns={columns} getHref={getHref} />
        </div>
      </details>
    </div>
  );
}

export function FilterBar({ children }: { children: React.ReactNode }) {
  return <div className="mb-4 grid gap-3 rounded-lg border border-vam-line bg-white p-4 sm:grid-cols-3">{children}</div>;
}
