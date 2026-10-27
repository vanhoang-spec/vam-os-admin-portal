"use client";

/**
 * Báo lỗi — trang của người gửi: /bao-loi (form gửi mới, link gửi qua Zalo) và /bao-loi?ticket=VAM00012
 * (xem báo lỗi của chính mình + câu hỏi ban xử lý hỏi lại, trả lời bằng chữ + hình). Thư "cần bạn bổ
 * sung" và pop-up "Trả lời ngay" mở thẳng trang này.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { boSungBaoLoiAction } from "@/app/actions/bao-loi";
import type { BaoLoiChiTiet } from "@/lib/bao-loi-action-types";
import { SO_ANH_TOI_DA, TEN_LOAI_BAO_LOI, TEN_TRANG_THAI_BAO_LOI, TRANG_THAI_DONG } from "@/lib/bao-loi-core";
import { formatDate } from "@/lib/utils";
import { FormBaoLoi } from "@/components/bao-loi/form-bao-loi";
import { taiAnhLen, useChonAnh } from "@/components/bao-loi/chon-anh";
import { LuoiAnh, LuongTraoDoi } from "@/components/bao-loi/luong-trao-doi";

export function TrangGuiBaoLoi() {
  const router = useRouter();
  return <FormBaoLoi trongTrang trang="/bao-loi" dong={() => router.push("/")} />;
}

export function TicketCuaToi({ ma, x }: { ma: string; x: BaoLoiChiTiet | null }) {
  const router = useRouter();
  const [loi, setLoi] = useState("");
  const [noiDung, setNoiDung] = useState("");
  const [dangGui, setDangGui] = useState(false);
  const [xong, setXong] = useState(false);
  const chon = useChonAnh(setLoi, "bl-bs-anh");

  const khung = "mx-auto flex w-full max-w-2xl flex-col gap-3 rounded-2xl border border-vam-line bg-white p-5 text-[15px] text-vam-ink shadow-soft";
  if (!x) {
    return (
      <div className={khung}>
        <h2 className="text-xl font-extrabold text-orange-700">Báo lỗi {ma}</h2>
        <p>Không tìm thấy báo lỗi này, hoặc báo lỗi không phải do bạn gửi.</p>
        <div className="flex justify-end">
          <button type="button" onClick={() => router.push("/bao-loi")} className="rounded-full border border-vam-line px-4 py-1.5 font-bold text-slate-700">
            Gửi báo lỗi mới
          </button>
        </div>
      </div>
    );
  }

  async function gui() {
    if (!x) return;
    setLoi("");
    if (!noiDung.trim() && chon.anh.length === 0) return setLoi("Bạn ghi câu trả lời hoặc thêm hình nhé.");
    setDangGui(true);
    try {
      const duongDan = await taiAnhLen(chon.anh.map((a) => a.blob));
      const kq = await boSungBaoLoiAction(x.id, { noiDung, anh: duongDan });
      if (!kq.ok) {
        setLoi(kq.error);
        return;
      }
      setNoiDung("");
      chon.xoaHet();
      setXong(true);
      router.refresh();
    } catch (e) {
      setLoi((e as Error).message || "Chưa gửi được — bạn thử lại nhé.");
    } finally {
      setDangGui(false);
    }
  }

  const daDong = TRANG_THAI_DONG.includes(x.trangThai);
  const choBoSung = x.trangThai === "cho_bo_sung";
  return (
    <div className={khung} onPaste={daDong ? undefined : chon.dan}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm text-slate-500">
            {x.ma} · {TEN_LOAI_BAO_LOI[x.loai] ?? x.loai} · gửi {formatDate(x.taoLuc)}
          </div>
          <h2 className="text-xl font-extrabold text-orange-700">{x.tieuDe}</h2>
          <div className="text-sm font-bold text-slate-600">{TEN_TRANG_THAI_BAO_LOI[x.trangThai]}</div>
        </div>
        <button type="button" onClick={() => router.push("/")} className="shrink-0 whitespace-nowrap rounded-full border border-vam-line px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50">
          Về trang chủ
        </button>
      </div>

      <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm">
        <div className="mb-1 text-xs font-bold text-slate-500">Bạn đã mô tả</div>
        <div className="whitespace-pre-wrap">{x.noiDung || <span className="text-slate-400">(không ghi mô tả)</span>}</div>
        {x.anh.length > 0 && <LuoiAnh anh={x.anh} />}
      </div>

      <LuongTraoDoi ds={x.traoDoi} phiaToi="tra_loi" />
      {x.traLoi && (
        <div className="rounded-lg bg-green-50 p-3 text-green-800">
          <b>Trả lời của ban xử lý</b>
          <div className="mt-1 whitespace-pre-wrap">{x.traLoi}</div>
        </div>
      )}
      {xong && (
        <div role="status" className="rounded-lg bg-green-50 p-3 text-green-800">
          Đã gửi phần bổ sung. Cảm ơn bạn — ban xử lý sẽ xem tiếp.
        </div>
      )}

      {daDong ? (
        <p className="text-sm text-slate-500">Báo lỗi này đã đóng — nếu vẫn còn lỗi, bạn gửi một báo lỗi mới nhé.</p>
      ) : (
        <>
          <label className="flex flex-col gap-1 text-sm font-bold text-slate-700">
            {choBoSung ? "Trả lời câu hỏi của ban xử lý" : "Bổ sung thêm thông tin"}
            <small className="font-medium text-slate-500">Ghi càng cụ thể càng tốt: trang nào, bấm vào đâu, thấy gì. Có thể dán hình bằng Ctrl + V.</small>
            <textarea id="bl-bo-sung" value={noiDung} maxLength={4000} rows={4} onChange={(e) => setNoiDung(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 font-medium" />
          </label>
          <div className="flex flex-col gap-2 text-sm font-bold text-slate-700">
            <span>
              Hình chụp màn hình <small className="font-medium text-slate-500">(tối đa {SO_ANH_TOI_DA} hình, không bắt buộc)</small>
            </span>
            {chon.luoi}
          </div>
          {loi && (
            <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">
              {loi}
            </div>
          )}
          <div className="flex justify-end">
            <button
              id="bl-gui-bo-sung"
              type="button"
              onClick={() => void gui()}
              disabled={dangGui || chon.dangNen > 0}
              className="rounded-full bg-orange-500 px-5 py-2 font-bold text-white hover:bg-orange-600 disabled:opacity-50"
            >
              {dangGui ? "Đang gửi…" : chon.dangNen ? "Đang xử lý hình…" : "Gửi bổ sung"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
