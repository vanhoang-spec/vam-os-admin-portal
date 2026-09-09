"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { formatClock } from "@/lib/utils";

/** Bao lâu tự đọc lại một lần, tính bằng mili giây. */
const INTERVAL_MS = 15_000;

/**
 * Giữ các con số của trang sự kiện luôn mới trong lúc buổi đang diễn ra.
 *
 * ---------------------------------------------------------------------------
 * VÌ SAO ĐỌC LẠI THEO CHU KỲ CHỨ KHÔNG PHẢI SUPABASE REALTIME
 * ---------------------------------------------------------------------------
 * Realtime của Supabase chạy từ trình duyệt bằng khoá `anon`, và nó chỉ đẩy về
 * những dòng mà RLS cho phép khoá đó đọc. `event_registrations`, `event_scans`
 * và `event_supporters` đều là bảng server-only: bật RLS, KHÔNG policy nào,
 * mọi quyền của `anon` đã bị thu hồi.
 *
 * Muốn realtime thật thì phải viết policy cho `anon` đọc được dữ liệu đăng ký
 * của người tham dự. Đó là cái giá quá đắt cho một con số đếm — nó mở danh
 * sách người tham dự ra cho một khoá nằm sẵn trong mã nguồn trình duyệt.
 *
 * Đọc lại theo chu kỳ đi qua đúng đường đã có: server component, service_role,
 * cùng những cổng quyền đang gác mọi thứ khác trên trang này.
 *
 * ---------------------------------------------------------------------------
 * BA ĐIỀU NÓ TỰ DỪNG
 * ---------------------------------------------------------------------------
 * Tab bị ẩn thì ngưng — không ai đang nhìn, và một tab quên đóng trong ngăn
 * bàn không nên gọi máy chủ bốn lần mỗi phút suốt đêm. Người dùng tắt thì
 * ngưng. Rời trang thì ngưng.
 */
export function LiveRefresh() {
  const router = useRouter();
  const [live, setLive] = useState(true);
  const [lastAt, setLastAt] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!live) return;

    function tick() {
      // `document.hidden` chứ không phải một sự kiện focus: tab ẩn sau tab
      // khác cũng là tab không ai nhìn.
      if (typeof document !== "undefined" && document.hidden) return;
      router.refresh();
      setLastAt(formatClock(new Date().toISOString()));
    }

    timerRef.current = setInterval(tick, INTERVAL_MS);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
    };
  }, [live, router]);

  return (
    <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={live}
          onChange={(event) => setLive(event.target.checked)}
          className="h-4 w-4 rounded border-slate-300 text-vam-green focus:ring-vam-green"
        />
        Tự cập nhật mỗi {INTERVAL_MS / 1000} giây
      </label>

      <button
        type="button"
        onClick={() => {
          router.refresh();
          setLastAt(null);
        }}
        className="rounded-md border border-vam-line bg-white px-2 py-1 font-medium text-vam-ink hover:bg-slate-50"
      >
        Cập nhật ngay
      </button>

      {live ? (
        <span aria-live="polite">
          {lastAt ? `Đọc lại lúc ${lastAt}` : "Đang theo dõi"}
        </span>
      ) : (
        <span>Đã tắt tự cập nhật</span>
      )}
    </div>
  );
}
