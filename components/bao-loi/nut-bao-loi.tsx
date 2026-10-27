"use client";

/**
 * Báo lỗi — nút cam "Báo lỗi" góc dưới trái vùng nội dung cho mọi tài khoản ban tổ chức (gắn một lần
 * trong AppShell), và pop-up lúc mở VAM OS: báo lỗi đang chờ mình bổ sung (hiện TRƯỚC, nút "Trả lời
 * ngay" mở /bao-loi?ticket=…) rồi trả lời mới chưa xem. Ẩn khi đang toàn màn hình (trình chiếu) và ở
 * chính trang /bao-loi (trang đó đã là form).
 */
import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { baoLoiCanXemAction, daXemTraLoiAction } from "@/app/actions/bao-loi";
import type { BaoLoiCanXem } from "@/lib/bao-loi-action-types";
import { TEN_TRANG_THAI_BAO_LOI } from "@/lib/bao-loi-core";
import { formatDate } from "@/lib/utils";
import { FormBaoLoi } from "@/components/bao-loi/form-bao-loi";

function useToanManHinh() {
  const [co, setCo] = useState(false);
  useEffect(() => {
    const doi = () => setCo(!!document.fullscreenElement);
    doi();
    document.addEventListener("fullscreenchange", doi);
    return () => document.removeEventListener("fullscreenchange", doi);
  }, []);
  return co;
}

export function NutBaoLoi() {
  const pathname = usePathname() ?? "/";
  const search = useSearchParams();
  const toanManHinh = useToanManHinh();
  const [mo, setMo] = useState<string | null>(null);

  if (pathname === "/bao-loi") return null;
  const trangHienTai = `${pathname}${search?.toString() ? `?${search.toString()}` : ""}`;
  return (
    <>
      {!toanManHinh && (
        <button
          type="button"
          onClick={() => setMo(trangHienTai)}
          aria-haspopup="dialog"
          title="Gặp trục trặc hoặc có góp ý? Báo cho ban xử lý"
          className="fixed bottom-3 left-3 z-[45] inline-flex min-h-10 items-center gap-1.5 rounded-full border-2 border-white bg-orange-500 py-1.5 pl-2.5 pr-3.5 text-sm font-bold text-white shadow-lg hover:bg-orange-600 print:hidden lg:left-[19.5rem]"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
            <path fill="currentColor" d="M12 2 1 21h22L12 2Zm0 5.5 7.5 12.5h-15L12 7.5Zm-1 3.5v4h2v-4h-2Zm0 5.5V18h2v-1.5h-2Z" />
          </svg>
          Báo lỗi
        </button>
      )}
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
