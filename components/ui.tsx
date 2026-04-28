import Link from "next/link";
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

export function KpiCard({ label, value }: { label: string; value: number | string }) {
  return (
    <Card>
      <div className="text-sm text-slate-500">{label}</div>
      <div className="mt-2 text-3xl font-semibold text-vam-ink">{value}</div>
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
      className="inline-flex rounded-md border border-vam-line px-2.5 py-1 text-xs font-medium text-vam-green hover:bg-vam-mint"
    >
      {label}
    </a>
  );
}

export function InternalLinkButton({ href, label }: { href: unknown; label: string }) {
  const resolvedHref = String(href ?? "").trim();
  if (!resolvedHref) return <span>-</span>;
  return (
    <Link href={resolvedHref} className="inline-flex rounded-md border border-vam-line px-2.5 py-1 text-xs font-medium text-vam-green hover:bg-vam-mint">
      {label}
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

export function SimpleTable<T>({
  rows,
  columns,
  getHref
}: {
  rows: T[];
  columns: Array<{
    key: string;
    label: string;
    render?: (row: T) => React.ReactNode;
    externalHrefKey?: string;
    externalLabel?: string;
    internalHrefKey?: string;
    internalHrefPrefix?: string;
    internalLabel?: string;
    displayKey?: string;
  }>;
  getHref?: (row: T) => string;
}) {
  if (!rows.length) return <EmptyState />;
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
              const content = columns.map((column) => (
                <td key={column.key} className="max-w-xs break-words px-4 py-3 text-slate-700">
                  {column.render ? (
                    column.render(row)
                  ) : column.externalHrefKey ? (
                    <ExternalLinkButton href={(row as any)[column.externalHrefKey]} label={column.externalLabel ?? "Xem"} />
                  ) : column.internalHrefKey ? (
                    <InternalLinkButton
                      href={(row as any)[column.internalHrefKey] ? `${column.internalHrefPrefix ?? ""}${(row as any)[column.internalHrefKey]}` : ""}
                      label={column.internalLabel ?? "Xem"}
                    />
                  ) : (
                    displayText((row as any)[column.displayKey ?? column.key])
                  )}
                </td>
              ));
              const href = getHref?.(row);
              if (href) {
                return (
                  <tr key={href} className="hover:bg-vam-mint/50">
                    {columns.map((column) => (
                      <td key={column.key} className="max-w-xs break-words px-4 py-3 text-slate-700">
                        {column.render ? (
                          column.render(row)
                        ) : column.externalHrefKey ? (
                          <ExternalLinkButton href={(row as any)[column.externalHrefKey]} label={column.externalLabel ?? "Xem"} />
                        ) : column.internalHrefKey ? (
                          <InternalLinkButton
                            href={(row as any)[column.internalHrefKey] ? `${column.internalHrefPrefix ?? ""}${(row as any)[column.internalHrefKey]}` : ""}
                            label={column.internalLabel ?? "Xem"}
                          />
                        ) : (
                          <Link href={href} className="block">
                            {displayText((row as any)[column.displayKey ?? column.key])}
                          </Link>
                        )}
                      </td>
                    ))}
                  </tr>
                );
              }
              return <tr key={index}>{content}</tr>;
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function FilterBar({ children }: { children: React.ReactNode }) {
  return <div className="mb-4 grid gap-3 rounded-lg border border-vam-line bg-white p-4 sm:grid-cols-3">{children}</div>;
}
