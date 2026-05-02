"use client";

import { useMemo, useState } from "react";

export type CatalogOption = {
  id: string;
  code: string;
  name: string;
  is_active?: boolean | null;
};

export function CatalogMultiSelect({
  name,
  label,
  options,
  initialSelectedIds = [],
  emptyMessage,
  helperText
}: {
  name: string;
  label: string;
  options: CatalogOption[];
  initialSelectedIds?: string[];
  emptyMessage?: string;
  helperText?: string;
}) {
  const [selected, setSelected] = useState<string[]>(initialSelectedIds);
  const [query, setQuery] = useState("");

  const sorted = useMemo(
    () => options.slice().sort((a, b) => a.name.localeCompare(b.name, "vi")),
    [options]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter((option) => `${option.name} ${option.code}`.toLowerCase().includes(q));
  }, [sorted, query]);

  function toggle(id: string) {
    setSelected((prev) => {
      if (prev.includes(id)) return prev.filter((value) => value !== id);
      return [...prev, id];
    });
  }

  function moveToFront(id: string) {
    setSelected((prev) => (prev[0] === id ? prev : [id, ...prev.filter((value) => value !== id)]));
  }

  function clearAll() {
    setSelected([]);
  }

  const optionsById = useMemo(() => new Map(options.map((option) => [option.id, option])), [options]);
  const selectedOptions = selected.map((id) => optionsById.get(id)).filter(Boolean) as CatalogOption[];

  return (
    <div className="rounded-md border border-vam-line bg-white px-3 py-3">
      {selected.map((id) => (
        <input key={id} type="hidden" name={name} value={id} />
      ))}
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-xs font-medium uppercase text-slate-500">{label}</span>
        {selected.length ? (
          <button type="button" onClick={clearAll} className="text-xs font-medium text-slate-500 hover:text-vam-ink">
            Xoá tất cả
          </button>
        ) : null}
      </div>
      {selectedOptions.length ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {selectedOptions.map((option, index) => (
            <span
              key={option.id}
              className={
                index === 0
                  ? "inline-flex items-center gap-1 rounded bg-vam-mint px-2 py-0.5 text-xs font-medium text-vam-green"
                  : "inline-flex items-center gap-1 rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700"
              }
            >
              {index === 0 ? <span className="text-[10px] uppercase tracking-wide text-vam-green">Chính</span> : null}
              {option.name}
              {index !== 0 ? (
                <button
                  type="button"
                  onClick={() => moveToFront(option.id)}
                  title="Đặt làm giá trị chính"
                  className="rounded text-[10px] font-medium text-slate-500 hover:text-vam-green"
                >
                  ↑
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => toggle(option.id)}
                title="Bỏ chọn"
                className="rounded text-[10px] font-medium text-slate-500 hover:text-red-600"
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      ) : null}
      <input
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Tìm trong danh mục..."
        className="mt-2 w-full rounded-md border border-vam-line bg-white px-2 py-1 text-xs text-vam-ink outline-none focus:border-vam-green focus:ring-2 focus:ring-vam-mint"
      />
      <div className="mt-2 max-h-56 overflow-auto rounded-md border border-vam-line bg-slate-50 p-2">
        {filtered.length === 0 ? (
          <p className="px-2 py-2 text-xs text-slate-500">{emptyMessage ?? "Không có lựa chọn phù hợp."}</p>
        ) : (
          <ul className="grid gap-1 sm:grid-cols-2">
            {filtered.map((option) => {
              const checked = selected.includes(option.id);
              return (
                <li key={option.id}>
                  <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm text-vam-ink hover:bg-white">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-vam-line"
                      checked={checked}
                      onChange={() => toggle(option.id)}
                    />
                    <span className="flex-1">
                      <span className="font-medium">{option.name}</span>
                      <span className="ml-1 text-xs text-slate-500">({option.code})</span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {helperText ? <p className="mt-2 text-[11px] text-slate-500">{helperText}</p> : null}
    </div>
  );
}
