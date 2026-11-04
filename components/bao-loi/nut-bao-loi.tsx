"use client";

/**
 * Báo lỗi — hộp "Báo lỗi" (FormBaoLoi) và pop-up lúc mở VAM OS: báo lỗi đang chờ mình bổ sung (hiện TRƯỚC, nút
 * "Trả lời ngay" mở /bao-loi?ticket=…) rồi trả lời mới chưa xem. Gắn một lần cuối AppShell cho mọi tài khoản ban tổ chức.
 *
 * Nút bấm KHÔNG còn ở đây: từ 04/11/2026 nó nằm trên thanh trên cùng, cạnh nút Hướng dẫn sử dụng
 * (nut-bao-loi-tren-thanh.tsx), vì nút nổi góc dưới trái che nội dung và chỗ bấm của trang (VAM00013). Nút bắn sự kiện
 * MO_FORM_BAO_LOI, hộp mở ở đây (lib/bao-loi-su-kien.ts giải thích vì sao hộp không nằm trong thanh trên cùng).
 * Ẩn ở chính trang /bao-loi (trang đó đã là form). Pop-up trả lời / cần bổ sung hiện ở mọi cỡ màn hình vì đó là việc
 * người ta đang chờ.
 */
import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { baoLoiCanXemAction, daXemTraLoiAction } from "@/app/actions/bao-loi";
import type { BaoLoiCanXem } from "@/lib/bao-loi-action-types";
import { TEN_TRANG_THAI_BAO_LOI } from "@/lib/bao-loi-core";
import { MO_FORM_BAO_LOI } from "@/lib/bao-loi-su-kien";
import { formatDate } from "@/lib/utils";
import { FormBaoLoi } from "@/components/bao-loi/form-bao-loi";

export function NutBaoLoi() {
  const pathname = usePathname() ?? "/";
  const search = useSearchParams();
  const [mo, setMo] = useState<string | null>(null);
  const trangHienTai = `${pathname}${search?.toString() ? `?${search.toString()}` : ""}`;
  // Hộp ghi lại đúng trang đang mở lúc bấm nút, không phải trang lúc nghe sự kiện lần đầu.
  const trangRef = useRef(trangHienTai);
  trangRef.current = trangHienTai;

  useEffect(() => {
    const moHop = () => setMo(trangRef.current);
    window.addEventListener(MO_FORM_BAO_LOI, moHop);
    return () => window.removeEventListener(MO_FORM_BAO_LOI, moHop);
  }, []);

  if (pathname === "/bao-loi") return null;
  return (
    <>
      {mo && <FormBaoLoi trang={mo} dong={() => setMo(null)} />}
      <PopupBaoLoi />
    </>
  );
}

function PopupBaoLoi() {
  const router = useRouter();
  const [ds, setDs] = useState<BaoLoiCanXem>({ traLoi: [], canBoSung: [] });
  useEffect(() => {
    let huy = false;
    const hen = window.setTimeout(() => {
      baoLoiCanXemAction()
        .then((r) => !huy && setDs(r))
        .catch(() => undefined);
    }, 1500);
    return () => {
      huy = true;
      window.clearTimeout(hen);
    };
  }, []);

  const khung = "fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-slate-900/55 px-3 py-[4vh]";
  const hop = "flex w-full max-w-xl flex-col gap-3 rounded-2xl bg-white p-5 text-vam-ink shadow-2xl";

  if (ds.canBoSung.length > 0) {
    return (
      <div className={khung} role="dialog" aria-modal="true" aria-labelledby="bl-can-bo-sung">
        <div className={hop}>
          <div>
            <h2 id="bl-can-bo-sung" className="text-xl font-extrabold text-orange-700">
              Ban xử lý cần bạn bổ sung báo lỗi
            </h2>
            <p className="text-sm text-slate-500">Để sửa đúng, ban xử lý cần thêm thông tin — bạn trả lời giúp nhé (có thể kèm hình).</p>
          </div>
          {ds.canBoSung.map((x) => (
            <div key={x.id} className="rounded-xl border border-vam-line bg-slate-50 px-4 py-3">
              <div className="text-sm text-slate-500">
                {x.ma} · <strong>{x.tieuDe}</strong>
              </div>
              <p className="mt-1 whitespace-pre-wrap">{x.cauHoi}</p>
              <div className="mt-2 flex justify-end">
                <button
                  type="button"
                  onClick={() => {
                    setDs({ traLoi: [], canBoSung: [] });
                    router.push(`/bao-loi?ticket=${encodeURIComponent(x.ma)}`);
                  }}
                  className="rounded-full bg-orange-500 px-4 py-1.5 text-sm font-bold text-white hover:bg-orange-600"
                >
                  Trả lời ngay
                </button>
              </div>
            </div>
          ))}
          <div className="flex justify-end">
            <button type="button" onClick={() => setDs((d) => ({ ...d, canBoSung: [] }))} className="rounded-full border border-vam-line px-4 py-1.5 font-bold text-slate-700">
              Để sau
            </button>
          </div>
        </div>
      </div>
    );
  }
  if (ds.traLoi.length === 0) return null;
  return (
    <div className={khung} role="dialog" aria-modal="true" aria-labelledby="bl-da-tra-loi">
      <div className={hop}>
        <div>
          <h2 id="bl-da-tra-loi" className="text-xl font-extrabold text-green-700">
            {ds.traLoi.length > 1 ? "Các báo lỗi của bạn đã có trả lời" : "Báo lỗi của bạn đã có trả lời"}
          </h2>
          <p className="text-sm text-slate-500">Cảm ơn bạn đã giúp VAM OS tốt hơn!</p>
        </div>
        {ds.traLoi.map((x) => (
          <div key={x.id} className="rounded-xl border border-vam-line bg-slate-50 px-4 py-3">
            <div className="text-sm text-slate-500">
              {x.ma} · gửi {formatDate(x.taoLuc)} · <strong>{TEN_TRANG_THAI_BAO_LOI[x.trangThai]}</strong>
            </div>
            <div className="font-bold">{x.tieuDe}</div>
            <p className="mt-1 whitespace-pre-wrap">{x.traLoi}</p>
          </div>
        ))}
        <div className="flex justify-end">
          <button
            type="button"
            autoFocus
            onClick={() => {
              void daXemTraLoiAction(ds.traLoi.map((x) => x.id));
              setDs((d) => ({ ...d, traLoi: [] }));
            }}
            className="rounded-full bg-orange-500 px-5 py-2 font-bold text-white hover:bg-orange-600"
          >
            Đã hiểu
          </button>
        </div>
      </div>
    </div>
  );
}
