"use client";

import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { FilterBar, SimpleTable } from "@/components/ui";
import { includesQuery } from "@/lib/utils";

type Option = { label: string; value: string };
type Column = {
  key: string;
  label: string;
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
type SortOption = {
  label: string;
  key: string;
  direction?: "asc" | "desc";
  type?: "number" | "text";
  emptyLast?: boolean;
  secondaryKey?: string;
};

function isEmptySortValue(value: unknown) {
  const normalized = String(value ?? "").trim();
  return !normalized || normalized === "-";
}

export function FilterableTable<T>({
  rows,
  columns,
  searchPlaceholder,
  searchKeys,
  filters = [],
  sortOptions = [],
  getHref,
  defaultPageSize = 25
}: {
  rows: T[];
  columns: Column[];
  searchPlaceholder: string;
  searchKeys: string[];
  filters?: Array<{ key: string; label: string; valueKey: string; options?: Option[]; defaultValue?: string }>;
  sortOptions?: SortOption[];
  getHref?: { prefix: string; key: string };
  defaultPageSize?: number;
}) {
  const searchParams = useSearchParams();
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [sortKey, setSortKey] = useState(sortOptions[0]?.label ?? "");
  const [filterValues, setFilterValues] = useState<Record<string, string>>(
    Object.fromEntries(filters.map((filter) => [filter.key, searchParams.get(filter.key) ?? filter.defaultValue ?? ""]))
  );

  const resolvedFilters = useMemo(
    () =>
      filters.map((filter) => ({
        ...filter,
        options:
          filter.options ??
          Array.from(new Set(rows.map((row) => String((row as any)[filter.valueKey] ?? "")).filter(Boolean)))
            .sort()
            .map((value) => ({ label: value, value }))
      })),
    [filters, rows]
  );

  const sortedRows = useMemo(() => {
    const filtered = rows.filter((row) => {
      if (!includesQuery(searchKeys.map((key) => (row as any)[key]), query)) return false;
      return resolvedFilters.every((filter) => {
        const selected = filterValues[filter.key];
        if (!selected) return true;
        return String((row as any)[filter.valueKey] ?? "") === selected;
      });
    });
    const selectedSort = sortOptions.find((option) => option.label === sortKey);
    if (!selectedSort) return filtered;
    return [...filtered].sort((a, b) => {
      const aValue = (a as any)[selectedSort.key];
      const bValue = (b as any)[selectedSort.key];
      if (selectedSort.emptyLast) {
        const aEmpty = isEmptySortValue(aValue);
        const bEmpty = isEmptySortValue(bValue);
        if (aEmpty !== bEmpty) return aEmpty ? 1 : -1;
      }
      if (selectedSort.type === "number") {
        const aNumber = Number(aValue ?? 0);
        const bNumber = Number(bValue ?? 0);
        const numberResult = selectedSort.direction === "desc" ? bNumber - aNumber : aNumber - bNumber;
        if (numberResult !== 0 || !selectedSort.secondaryKey) return numberResult;
        return String((a as any)[selectedSort.secondaryKey] ?? "").localeCompare(String((b as any)[selectedSort.secondaryKey] ?? ""), "vi", { sensitivity: "base" });
      }
      const result = String(aValue ?? "").localeCompare(String(bValue ?? ""), "vi", { sensitivity: "base" });
      const textResult = selectedSort.direction === "desc" ? -result : result;
      if (textResult !== 0 || !selectedSort.secondaryKey) return textResult;
      return String((a as any)[selectedSort.secondaryKey] ?? "").localeCompare(String((b as any)[selectedSort.secondaryKey] ?? ""), "vi", { sensitivity: "base" });
    });
  }, [rows, query, filterValues, resolvedFilters, searchKeys, sortKey, sortOptions]);

  useEffect(() => {
    setPage(1);
  }, [query, filterValues, sortKey]);

  const totalPages = Math.max(1, Math.ceil(sortedRows.length / defaultPageSize));
  const pageRows = sortedRows.slice((page - 1) * defaultPageSize, page * defaultPageSize);

  return (
    <>
      <FilterBar>
        <label className="relative sm:col-span-1">
          <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={searchPlaceholder}
            className="h-10 w-full rounded-md border border-vam-line bg-white pl-9 pr-3 text-sm"
          />
        </label>
        {resolvedFilters.map((filter) => (
          <label key={filter.key}>
            <select
              value={filterValues[filter.key] ?? ""}
              onChange={(event) => setFilterValues((current) => ({ ...current, [filter.key]: event.target.value }))}
              className="h-10 w-full rounded-md border border-vam-line bg-white px-3 text-sm"
            >
              <option value="">{filter.label}: Tất cả</option>
              {filter.options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        ))}
        {sortOptions.length ? (
          <label>
            <select
              value={sortKey}
              onChange={(event) => setSortKey(event.target.value)}
              className="h-10 w-full rounded-md border border-vam-line bg-white px-3 text-sm"
            >
              {sortOptions.map((option) => (
                <option key={option.label} value={option.label}>
                  Sắp xếp: {option.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </FilterBar>
      <div className="mb-3 text-sm text-slate-500">
        Hiển thị {pageRows.length} / {sortedRows.length} dòng
      </div>
      <SimpleTable
        rows={pageRows}
        columns={columns}
        getHref={
          getHref
            ? (row) => {
                const value = (row as any)[getHref.key];
                return value ? `${getHref.prefix}${value}` : "";
              }
            : undefined
        }
      />
      <div className="mt-4 flex items-center justify-between text-sm text-slate-600">
        <button
          type="button"
          onClick={() => setPage((current) => Math.max(1, current - 1))}
          disabled={page === 1}
          className="rounded-md border border-vam-line bg-white px-3 py-2 disabled:opacity-50"
        >
          Trước
        </button>
        <span>
          Trang {page} / {totalPages}
        </span>
        <button
          type="button"
          onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
          disabled={page === totalPages}
          className="rounded-md border border-vam-line bg-white px-3 py-2 disabled:opacity-50"
        >
          Sau
        </button>
      </div>
    </>
  );
}
