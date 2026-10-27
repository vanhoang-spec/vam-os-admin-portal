"use client";

/**
 * Báo lỗi — ô chọn hình chụp màn hình dùng chung cho hộp gửi báo lỗi và ô trả lời bổ sung: chọn tệp /
 * kéo thả / dán Ctrl+V, tối đa 5 hình, nén JPEG ngay trên trình duyệt (cạnh dài ≤ 2000 px).
 *
 * Ảnh KHÔNG đi qua máy chủ VAM: taiAnhLen() xin máy chủ link tải lên ký sẵn (đúng thư mục của người
 * đang đăng nhập, kho riêng 'bao-loi') rồi trình duyệt PUT thẳng lên Supabase Storage. Xem
 * __tests__/image-optimizer-attack-surface.test.ts mục 3c.
 */
import { useEffect, useRef, useState } from "react";
import { xinLinkTaiAnhAction } from "@/app/actions/bao-loi";
import { SO_ANH_TOI_DA } from "@/lib/bao-loi-core";

export const BAO_LOI_ANH_ACCEPT = "image/png,image/jpeg,image/webp";

type Anh = { blob: Blob; url: string };

/** Nén ảnh chụp màn hình: cạnh dài tối đa 2000 px, JPEG ~0,85. Ảnh không đọc được thì ném lỗi. */
async function nenAnh(tep: Blob, canhToiDa = 2000): Promise<Blob> {
  const anh = await new Promise<HTMLImageElement>((ok, hong) => {
    const url = URL.createObjectURL(tep);
    const i = new Image();
    i.onload = () => {
      URL.revokeObjectURL(url);
      ok(i);
    };
    i.onerror = () => {
      URL.revokeObjectURL(url);
      hong(new Error("Không đọc được hình này — bạn chọn hình PNG / JPG nhé."));
    };
    i.src = url;
  });
  const tiLe = Math.min(1, canhToiDa / Math.max(anh.naturalWidth, anh.naturalHeight));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(anh.naturalWidth * tiLe));
  c.height = Math.max(1, Math.round(anh.naturalHeight * tiLe));
  const g = c.getContext("2d");
  if (!g) throw new Error("Trình duyệt không xử lý được hình — bạn thử trình duyệt khác nhé.");
  g.fillStyle = "#fff";
  g.fillRect(0, 0, c.width, c.height);
  g.drawImage(anh, 0, 0, c.width, c.height);
  for (const q of [0.85, 0.7, 0.55]) {
    const b = await new Promise<Blob | null>((ok) => c.toBlob(ok, "image/jpeg", q));
    if (b && b.size <= 4.5 * 1024 * 1024) return b;
  }
  throw new Error("Hình quá lớn — bạn chụp lại hoặc cắt bớt nhé.");
}

/** Xin link tải lên rồi đẩy thẳng từng ảnh lên kho riêng. Trả đường dẫn trong kho để gửi kèm báo lỗi. */
export async function taiAnhLen(blobs: Blob[]): Promise<string[]> {
  if (blobs.length === 0) return [];
  const links = await xinLinkTaiAnhAction(blobs.length);
  if (!links.ok || links.value.length !== blobs.length) {
    throw new Error(links.ok ? "Chưa tải được hình lên — bạn thử lại nhé." : links.error);
  }
  const apikey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
  for (let i = 0; i < blobs.length; i += 1) {
    const res = await fetch(links.value[i].signedUrl, {
      method: "PUT",
      headers: { "content-type": "image/jpeg", "x-upsert": "false", ...(apikey ? { apikey } : {}) },
      body: blobs[i]
    });
    if (!res.ok) throw new Error("Chưa tải được hình lên — bạn kiểm tra mạng rồi gửi lại nhé.");
  }
  return links.value.map((l) => l.path);
}

/** idO = tiền tố id cho ô chọn tệp (hộp gửi dùng 'bl-anh', ô bổ sung dùng 'bl-bs-anh'). */
export function useChonAnh(setLoi: (s: string) => void, idO = "bl-anh") {
  const [anh, setAnh] = useState<Anh[]>([]);
  const [dangNen, setDangNen] = useState(0);
  const [keo, setKeo] = useState(false);
  const anhRef = useRef(anh);
  anhRef.current = anh;

  useEffect(() => () => anhRef.current.forEach((a) => URL.revokeObjectURL(a.url)), []);

  async function themTep(tep: File[]) {
    const hinh = tep.filter((f) => f.type.startsWith("image/"));
    if (tep.length && !hinh.length) {
      setLoi("Chỉ nhận tệp hình (PNG, JPG…).");
      return;
    }
    const conCho = SO_ANH_TOI_DA - anhRef.current.length - dangNen;
    if (conCho <= 0) {
      setLoi(`Tối đa ${SO_ANH_TOI_DA} hình.`);
      return;
    }
    setLoi(hinh.length > conCho ? `Tối đa ${SO_ANH_TOI_DA} hình — đã lấy ${conCho} hình đầu.` : "");
    const lay = hinh.slice(0, conCho);
    setDangNen((n) => n + lay.length);
    for (const f of lay) {
      try {
        const b = await nenAnh(f);
        setAnh((ds) => (ds.length >= SO_ANH_TOI_DA ? ds : [...ds, { blob: b, url: URL.createObjectURL(b) }]));
      } catch (e) {
        setLoi((e as Error).message);
      } finally {
        setDangNen((n) => n - 1);
      }
    }
  }

  function boAnh(i: number) {
    setAnh((ds) => {
      URL.revokeObjectURL(ds[i].url);
      return ds.filter((_, j) => j !== i);
    });
  }

  /** Gắn vào onPaste của khung chứa: dán hình (Ctrl+V sau khi chụp màn hình) ở bất kỳ đâu trong khung. */
  function dan(e: React.ClipboardEvent) {
    const tep = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith("image/"));
    if (tep.length) {
      e.preventDefault();
      void themTep(tep);
    }
  }

  function xoaHet() {
    anhRef.current.forEach((a) => URL.revokeObjectURL(a.url));
    setAnh([]);
  }

  const soO = Math.min(SO_ANH_TOI_DA, anh.length + dangNen + 1);
  const luoi = (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {anh.map((a, i) => (
        <div key={a.url} className="relative overflow-hidden rounded-lg border border-vam-line bg-slate-50">
          {/* eslint-disable-next-line @next/next/no-img-element -- ảnh xem trước cục bộ (blob:), không qua bộ tối ưu ảnh */}
          <img src={a.url} alt={`Hình chụp màn hình lỗi ${i + 1}`} className="h-28 w-full object-cover object-top" />
          <span className="block px-2 py-1 text-xs font-semibold text-slate-600">Hình chụp màn hình lỗi {i + 1}</span>
          <button
            type="button"
            onClick={() => boAnh(i)}
            aria-label={`Bỏ hình ${i + 1}`}
            className="absolute right-1.5 top-1.5 rounded-full bg-slate-900/75 px-2 py-0.5 text-xs font-bold text-white"
          >
            Bỏ
          </button>
        </div>
      ))}
      {Array.from({ length: dangNen }, (_, i) => (
        <div key={`nen-${i}`} className="flex h-28 items-center justify-center rounded-lg border-2 border-dashed border-orange-300 bg-orange-50 text-xs font-semibold text-orange-800" aria-live="polite">
          Đang xử lý hình…
        </div>
      ))}
      {soO > anh.length + dangNen && (
        <label
          className={`relative flex min-h-[7rem] cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed p-2 text-center text-xs font-semibold text-orange-800 ${keo ? "border-orange-500 bg-orange-100" : "border-orange-300 bg-orange-50 hover:border-orange-500"}`}
          onDragOver={(e) => {
            e.preventDefault();
            setKeo(true);
          }}
          onDragLeave={() => setKeo(false)}
          onDrop={(e) => {
            e.preventDefault();
            setKeo(false);
            void themTep(Array.from(e.dataTransfer.files));
          }}
        >
          <span className="text-2xl leading-none" aria-hidden="true">＋</span>
          <span>
            Hình chụp màn hình lỗi {anh.length + dangNen + 1}
            <br />
            (chụp full màn hình)
          </span>
          <span className="font-medium text-orange-700">Bấm để chọn hình hoặc dán Ctrl + V</span>
          <input
            id={`${idO}-${anh.length + dangNen + 1}`}
            type="file"
            accept={BAO_LOI_ANH_ACCEPT}
            multiple
            className="absolute inset-0 cursor-pointer opacity-0"
            onChange={(e) => {
              void themTep(Array.from(e.target.files ?? []));
              e.target.value = "";
            }}
          />
        </label>
      )}
    </div>
  );

  return { anh, dangNen, dan, luoi, xoaHet };
}
