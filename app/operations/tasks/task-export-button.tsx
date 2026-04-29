"use client";

import type { WorkflowQueueItem } from "@/lib/types";

function csvValue(value: unknown) {
  const text = String(value ?? "").replace(/\r?\n/g, " ").trim();
  return `"${text.replace(/"/g, '""')}"`;
}

function toCsv(rows: WorkflowQueueItem[]) {
  const headers = [
    "id",
    "action_type",
    "title",
    "status",
    "priority",
    "owner",
    "due_date",
    "mentee",
    "mentor",
    "updated_at"
  ];
  const body = rows.map((row) => [
    row.id,
    row.action_type,
    row.title,
    row.status,
    row.priority,
    row.owner_name,
    row.due_date,
    row.mentee_name,
    row.mentor_name,
    row.updated_at
  ]);
  return [headers, ...body].map((line) => line.map(csvValue).join(",")).join("\n");
}

export function TaskExportButton({ rows, filename }: { rows: WorkflowQueueItem[]; filename: string }) {
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
      Export CSV
    </button>
  );
}
