"use client";

type CsvRow = Record<string, unknown>;

function csvValue(value: unknown) {
  const text = String(value ?? "").replace(/\r?\n/g, " ").trim();
  return `"${text.replace(/"/g, '""')}"`;
}

function toCsv(rows: CsvRow[]) {
  const headers = Array.from(rows.reduce((keys, row) => {
    Object.keys(row).forEach((key) => keys.add(key));
    return keys;
  }, new Set<string>()));
  return [headers, ...rows.map((row) => headers.map((key) => row[key]))]
    .map((line) => line.map(csvValue).join(","))
    .join("\n");
}

export function CsvExportButton({ rows, filename, label }: { rows: CsvRow[]; filename: string; label: string }) {
  return (
    <button
      type="button"
      disabled={!rows.length}
      onClick={() => {
        const blob = new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = filename;
        link.click();
        URL.revokeObjectURL(url);
      }}
      className="rounded-md border border-vam-line px-3 py-2 text-sm font-medium text-vam-green hover:bg-vam-mint disabled:cursor-not-allowed disabled:opacity-50"
    >
      {label}
    </button>
  );
}
