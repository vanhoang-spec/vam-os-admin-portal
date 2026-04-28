"use client";

import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

function sanitizeMonthParam(value: string | null) {
  const match = String(value ?? "").trim().match(/^(\d{4}-(0[1-9]|1[0-2]))/);
  return match?.[1] ?? null;
}

export function MonthSelector({ months, selectedMonth }: { months: string[]; selectedMonth: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const currentMonthParam = searchParams.get("month");
  const selectedMonthIsInOptions = months.includes(selectedMonth);

  useEffect(() => {
    const sanitizedMonth = sanitizeMonthParam(currentMonthParam);
    if (sanitizedMonth !== selectedMonth) {
      router.replace(`${pathname}?month=${encodeURIComponent(selectedMonth)}`, { scroll: false });
    }
  }, [currentMonthParam, pathname, router, selectedMonth]);

  return (
    <label className="block">
      <span className="text-xs font-medium uppercase text-slate-500">Tháng vận hành</span>
      <select
        value={selectedMonth}
        onChange={(event) => router.push(`/operations?month=${encodeURIComponent(event.target.value)}`)}
        className="mt-1 w-full rounded-md border border-vam-line bg-white px-3 py-2 text-sm text-vam-ink outline-none focus:border-vam-green focus:ring-2 focus:ring-vam-mint"
      >
        {months.map((month) => (
          <option key={month} value={month}>
            {month}
          </option>
        ))}
        {!selectedMonthIsInOptions ? (
          <optgroup label="Tháng cần rà soát">
            <option value={selectedMonth}>{selectedMonth}</option>
          </optgroup>
        ) : null}
      </select>
    </label>
  );
}
