/**
 * Báo lỗi — luồng hỏi lại người gửi ↔ người gửi bổ sung. Ảnh là link xem ký sẵn 1 giờ do máy chủ cấp
 * (thẻ <img> thường, tải thẳng từ kho Supabase — không qua bộ tối ưu ảnh của Next).
 */
import type { TraoDoiBaoLoi } from "@/lib/bao-loi-action-types";
import { formatDateTime } from "@/lib/utils";

/** phiaToi = "tra_loi" ở trang người gửi (lượt của mình nằm bên phải), "hoi" ở trang quản trị. */
export function LuongTraoDoi({ ds, phiaToi }: { ds: TraoDoiBaoLoi[]; phiaToi: "hoi" | "tra_loi" }) {
  if (!ds.length) return null;
  return (
    <div className="flex flex-col gap-2">
      {ds.map((x) => {
        const cuaToi = x.ben === phiaToi;
        return (
          <div
            key={x.id}
            className={`max-w-[88%] rounded-xl border px-3 py-2 text-sm ${cuaToi ? "self-end border-blue-200 bg-blue-50" : "self-start border-orange-200 bg-orange-50"}`}
          >
            <div className="mb-0.5 text-xs text-slate-500">
              <b className={x.ben === "hoi" ? "text-orange-700" : "text-blue-700"}>
                {x.ben === "hoi" ? `${x.ten ?? "Ban xử lý"} hỏi` : `${x.ten ?? "Người gửi"} bổ sung`}
              </b>{" "}
              · {formatDateTime(x.taoLuc)}
            </div>
            {x.noiDung && <div className="whitespace-pre-wrap">{x.noiDung}</div>}
            {x.anh.length > 0 && <LuoiAnh anh={x.anh} />}
          </div>
        );
      })}
    </div>
  );
}

export function LuoiAnh({ anh }: { anh: string[] }) {
  return (
    <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
      {anh.map((u, i) =>
        u ? (
          <a key={i} href={u} target="_blank" rel="noreferrer" title="Mở hình cỡ thật">
            {/* eslint-disable-next-line @next/next/no-img-element -- link ký sẵn của kho riêng; không đi qua bộ tối ưu ảnh */}
            <img src={u} alt={`Hình ${i + 1}`} className="h-24 w-full rounded border border-slate-200 object-cover object-top" />
          </a>
        ) : (
          <div key={i} className="flex h-24 items-center justify-center rounded border border-dashed border-slate-300 text-xs text-slate-400">
            Hình {i + 1} không mở được
          </div>
        )
      )}
    </div>
  );
}
