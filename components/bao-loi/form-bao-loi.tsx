"use client";

/**
 * Báo lỗi — hộp gửi: loại vấn đề (có "Đề xuất cải thiện"), tiêu đề, mô tả, tối đa 5 hình chụp màn hình.
 * Kèm tự động: trang đang mở + thông tin máy (không có dữ liệu cá nhân).
 * `trongTrang` = hiện ngay trong trang /bao-loi (link gửi qua Zalo), không có nền mờ.
 */
import { useEffect, useState } from "react";
import { guiBaoLoiAction } from "@/app/actions/bao-loi";
import { LOAI_BAO_LOI, SO_ANH_TOI_DA, type LoaiBaoLoi } from "@/lib/bao-loi-core";
import { taiAnhLen, useChonAnh } from "@/components/bao-loi/chon-anh";

function thietBi() {
  return {
    ua: navigator.userAgent.slice(0, 300),
    man_hinh: `${screen.width}×${screen.height}`,
    khung: `${window.innerWidth}×${window.innerHeight}`,
    dpr: window.devicePixelRatio,
    ngoai_tuyen: !navigator.onLine,
    luc: new Date().toISOString()
  };
}

export function FormBaoLoi({ trang, dong, trongTrang }: { trang: string; dong: () => void; trongTrang?: boolean }) {
  const [loai, setLoai] = useState<LoaiBaoLoi | "">("");
  const [tieuDe, setTieuDe] = useState("");
  const [noiDung, setNoiDung] = useState("");
  const [loi, setLoi] = useState("");
  const [dangGui, setDangGui] = useState(false);
  const [ma, setMa] = useState<string | null>(null);
  const { anh, dangNen, dan, luoi } = useChonAnh(setLoi);

  useEffect(() => {
    if (trongTrang) return;
    const phim = (e: KeyboardEvent) => e.key === "Escape" && !dangGui && dong();
    window.addEventListener("keydown", phim);
    return () => window.removeEventListener("keydown", phim);
  }, [dong, dangGui, trongTrang]);

  async function gui() {
    setLoi("");
    if (!loai) return setLoi("Bạn chọn loại vấn đề nhé.");
    if (tieuDe.trim().length < 3) return setLoi("Bạn ghi tiêu đề ngắn gọn cho lỗi nhé (ít nhất 3 chữ).");
    setDangGui(true);
    try {
      const duongDan = await taiAnhLen(anh.map((a) => a.blob));
      const kq = await guiBaoLoiAction({ loai, tieuDe, noiDung, trang, anh: duongDan, thietBi: thietBi() });
      if (kq.ok) setMa(kq.value.ma);
      else setLoi(kq.error);
    } catch (e) {
      setLoi((e as Error).message || "Chưa gửi được — bạn thử lại nhé.");
    } finally {
      setDangGui(false);
    }
  }

  const coNhap = !ma && (tieuDe.trim() !== "" || noiDung.trim() !== "" || anh.length > 0 || loai !== "");

  const hop = (
    <div
      role="dialog"
      aria-modal={!trongTrang}
      aria-labelledby="bl-tieu-de"
      onClick={(e) => e.stopPropagation()}
      onPaste={dan}
      className="flex w-full max-w-2xl flex-col gap-3 rounded-2xl bg-white p-5 text-left text-[15px] text-vam-ink shadow-2xl"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id="bl-tieu-de" className="text-xl font-extrabold text-orange-700">
            Báo lỗi / góp ý cho VAM OS
          </h2>
          <p className="mt-0.5 text-sm text-slate-500">
            Gặp trục trặc, hoặc thấy điểm nào cần làm tốt hơn — bạn mô tả và gửi hình chụp màn hình, ban xử lý sẽ xem và trả lời bạn.
          </p>
        </div>
        <button type="button" onClick={dong} disabled={dangGui} className="shrink-0 whitespace-nowrap rounded-full border border-vam-line px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
          {trongTrang ? "Về trang chủ" : "Đóng"}
        </button>
      </div>

      {ma ? (
        <>
          <div role="status" className="rounded-lg bg-green-50 p-4 text-green-800">
            <strong className="text-lg">Đã gửi! Mã báo lỗi của bạn: {ma}</strong>
            <div className="mt-1">Có trả lời, lần sau mở VAM OS bạn sẽ thấy thông báo. Cảm ơn bạn!</div>
          </div>
          <div className="flex justify-end">
            <button type="button" onClick={dong} autoFocus className="rounded-full bg-orange-500 px-5 py-2 font-bold text-white hover:bg-orange-600">
              Xong
            </button>
          </div>
        </>
      ) : (
        <>
          <label className="flex flex-col gap-1 text-sm font-bold text-slate-700">
            Vấn đề là gì?
            <select id="bl-loai" value={loai} onChange={(e) => setLoai(e.target.value as LoaiBaoLoi)} className="rounded-lg border border-slate-300 px-3 py-2 font-medium">
              <option value="">— Chọn loại vấn đề —</option>
              {LOAI_BAO_LOI.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.ten}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm font-bold text-slate-700">
            Tiêu đề
            <input
              id="bl-tieu-de-nhap"
              value={tieuDe}
              maxLength={120}
              placeholder="VD: Không xuất được file Excel danh sách mentee"
              onChange={(e) => setTieuDe(e.target.value)}
              className="rounded-lg border border-slate-300 px-3 py-2 font-medium"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm font-bold text-slate-700">
            Mô tả
            <small className="font-medium text-slate-500">
              Bạn đang làm gì, bấm vào đâu, thấy gì sai, đúng ra phải thế nào? Góp ý cải thiện thì ghi điều bạn mong muốn và vì sao.
            </small>
            <textarea id="bl-noi-dung" value={noiDung} maxLength={4000} rows={4} onChange={(e) => setNoiDung(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 font-medium" />
          </label>
          <div className="flex flex-col gap-2 text-sm font-bold text-slate-700">
            <span>
              Hình chụp màn hình <small className="font-medium text-slate-500">(tối đa {SO_ANH_TOI_DA} hình, không bắt buộc)</small>
            </span>
            {luoi}
            <p className="rounded-lg bg-slate-100 px-3 py-2 text-xs font-medium text-slate-600">
              Cách chụp full màn hình — máy tính: bấm Windows + Shift + S (hoặc phím PrtSc) rồi bấm Ctrl + V trong hộp này. Điện thoại: bấm cùng lúc nút nguồn + giảm âm lượng, rồi chọn hình vừa chụp.
            </p>
          </div>
          <p className="text-xs text-slate-500">Kèm tự động: trang bạn đang mở và loại máy (không có thông tin cá nhân).</p>
          {loi && (
            <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">
              {loi}
            </div>
          )}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={dong} disabled={dangGui} className="rounded-full border border-vam-line px-5 py-2 font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
              Huỷ
            </button>
            <button
              id="bl-gui"
              type="button"
              onClick={() => void gui()}
              disabled={dangGui || dangNen > 0}
              className="rounded-full bg-orange-500 px-5 py-2 font-bold text-white hover:bg-orange-600 disabled:opacity-50"
            >
              {dangGui ? "Đang gửi…" : dangNen ? "Đang xử lý hình…" : "Gửi báo lỗi"}
            </button>
          </div>
        </>
      )}
    </div>
  );

  if (trongTrang) return <div className="flex justify-center">{hop}</div>;
  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-slate-900/55 px-3 py-[4vh]" onClick={() => !dangGui && !coNhap && dong()}>
      {hop}
    </div>
  );
}
