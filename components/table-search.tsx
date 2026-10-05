"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { parseTableQuery, prepareRowText, rowMatchesQuery, tableSearchTerms } from "@/lib/table-search-core";

/**
 * Ô tìm kiếm cho một (hoặc vài) bảng dữ liệu bên trong nó (BTC 05/10/2026).
 *
 * Lọc trên chính các dòng đã hiện, không đòi trang đổi cách lấy dữ liệu: phần lớn
 * bảng của CRM là component server, cột dựng bằng hàm, không đưa xuống trình duyệt
 * được. Đọc chữ của dòng thì bảng nào bọc vào cũng tìm được ngay, và tìm đúng cái
 * người dùng đang nhìn thấy.
 *
 * Không đọc chữ trong nút và ô chọn: nút "Hủy match" ở mọi dòng thì gõ "huy" khớp
 * cả bảng, và một ô chọn trạng thái mang tên MỌI trạng thái trong danh sách của nó.
 * Dòng cần thêm chữ không hiện ra (email đầy đủ, mã nội bộ) thì đặt data-search;
 * phần nào không muốn bị tìm thì đặt data-search-skip.
 */
const SKIP = "button, select, option, textarea, script, style, [data-search-skip]";

function rowText(row: HTMLTableRowElement): string {
  const parts: string[] = [];
  const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) =>
      node.parentElement?.closest(SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
  });
  for (let node = walker.nextNode(); node; node = walker.nextNode()) parts.push(node.textContent ?? "");
  const extra = row.getAttribute("data-search");
  if (extra) parts.push(extra);
  return parts.join(" ");
}

/** Dòng dữ liệu của bảng ngoài cùng — bảng lồng trong một ô không bị lọc riêng. */
function dataRows(container: HTMLElement): HTMLTableRowElement[] {
  return Array.from(container.querySelectorAll<HTMLTableRowElement>("tbody tr")).filter(
    (row) => !row.closest("table")?.parentElement?.closest("table")
  );
}

export function TableSearch({
  children,
  placeholder = "Tìm tên, email, SĐT, mã, trạng thái… không cần dấu",
  className
}: {
  children: React.ReactNode;
  placeholder?: string;
  className?: string;
}) {
  const [query, setQuery] = useState("");
  const [counts, setCounts] = useState({ shown: 0, total: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  const apply = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const parsed = parseTableQuery(query);
    const terms = parsed.terms;
    let shown = 0;
    let total = 0;
    for (const row of dataRows(container)) {
      // Dòng nhóm/tiêu đề phụ giữa bảng: luôn giữ, không đếm.
      if (row.hasAttribute("data-search-keep")) continue;
      total += 1;
      const match = terms.length === 0 || rowMatchesQuery(prepareRowText(rowText(row)), parsed);
      if (match) {
        shown += 1;
        row.removeAttribute("data-search-hidden");
      } else {
        row.setAttribute("data-search-hidden", "");
      }
    }
    // Phần "Xem thêm N dòng" đang gập: đang tìm thì mở ra, kẻo dòng khớp nằm khuất
    // trong đó và người dùng tưởng không có. Xoá ô tìm thì gập lại đúng những phần
    // chính ô này đã mở.
    for (const details of Array.from(container.querySelectorAll("details"))) {
      if (terms.length && !details.open) {
        details.open = true;
        details.setAttribute("data-search-opened", "");
      } else if (!terms.length && details.hasAttribute("data-search-opened")) {
        details.open = false;
        details.removeAttribute("data-search-opened");
      }
    }
    setCounts((current) => (current.shown === shown && current.total === total ? current : { shown, total }));
  }, [query]);

  useEffect(() => {
    apply();
  }, [apply]);

  useEffect(() => {
    // Trang tự làm mới, bấm "Xem thêm", hay dữ liệu về sau: dòng mới phải đi qua
    // bộ lọc đang gõ. Chỉ theo dõi thêm/bớt nút và chữ — thuộc tính data-search-hidden
    // do chính hàm lọc đặt nên không gọi lại chính nó.
    const container = containerRef.current;
    if (!container) return;
    const observer = new MutationObserver(() => apply());
    observer.observe(container, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [apply]);

  const searching = tableSearchTerms(query).length > 0;

  return (
    <div className={className ?? "grid gap-3"}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <label className="relative block w-full max-w-xl">
          <span className="sr-only">Tìm trong bảng</span>
          <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") setQuery("");
            }}
            placeholder={placeholder}
            className="w-full rounded-md border border-vam-line bg-white py-2 pl-9 pr-9 text-base sm:text-sm"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Xoá ô tìm"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:text-vam-ink"
            >
              <X aria-hidden className="h-4 w-4" />
            </button>
          ) : null}
        </label>
        <p role="status" aria-live="polite" className="text-xs text-slate-500">
          {searching ? `Đang hiện ${counts.shown}/${counts.total} dòng` : ""}
        </p>
      </div>
      {searching && counts.shown === 0 ? (
        <p className="rounded-md border border-dashed border-vam-line bg-white px-3 py-2 text-sm text-slate-500">
          Không có dòng nào khớp «{query.trim()}».
        </p>
      ) : null}
      <div ref={containerRef}>{children}</div>
    </div>
  );
}
