"use client";

/**
 * Quản trị → Báo lỗi (27/10/2026): danh sách báo lỗi / góp ý, tần suất 7/30 ngày theo ngày · loại ·
 * trang, bộ lọc, và hộp xử lý (đổi trạng thái, trả lời người gửi, ghi chú nội bộ, hỏi lại người gửi).
 * Mở thẳng một báo lỗi bằng ?ticket=VAM00012 (báo cáo rà 17:00 dùng link này).
 */
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { capNhatBaoLoiAction, hoiLaiBaoLoiAction } from "@/app/actions/bao-loi";
import type { BaoLoiChiTiet, BaoLoiDong } from "@/lib/bao-loi-action-types";
import {
  LOAI_BAO_LOI,
  TEN_LOAI_BAO_LOI,
  TEN_TRANG_THAI_BAO_LOI,
  TRANG_THAI_DONG,
  TRANG_THAI_MO,
  gonTrang,
  type LoaiBaoLoi,
  type TrangThaiBaoLoi
} from "@/lib/bao-loi-core";
import { roleLabel } from "@/lib/auth-constants";
import { formatDate, formatDateTime } from "@/lib/utils";
import { LuoiAnh, LuongTraoDoi } from "@/components/bao-loi/luong-trao-doi";

const MAU: Record<TrangThaiBaoLoi, string> = {
  moi: "bg-orange-100 text-orange-800",
  dang_xu_ly: "bg-blue-100 text-blue-800",
  can_chu: "bg-red-100 text-red-800",
  cho_bo_sung: "bg-cyan-100 text-cyan-800",
  da_xu_ly: "bg-green-100 text-green-800",
  khong_tai_hien: "bg-slate-100 text-slate-700",
  khong_phai_loi: "bg-slate-100 text-slate-700",
  trung: "bg-violet-100 text-violet-800"
};
const NGAY = 86_400_000;

function Nhan({ tt }: { tt: TrangThaiBaoLoi }) {
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${MAU[tt]}`}>{TEN_TRANG_THAI_BAO_LOI[tt]}</span>;
}

export function QuanTriBaoLoi({ ds, chon, maMo }: { ds: BaoLoiDong[]; chon: BaoLoiChiTiet | null; maMo: string | null }) {
  const router = useRouter();
  const [tt, setTt] = useState<"mo" | "tat_ca" | TrangThaiBaoLoi>("mo");
  const [loai, setLoai] = useState<LoaiBaoLoi | "">("");
  const [q, setQ] = useState("");
  const [ky, setKy] = useState(7);
  const [thongBao, setThongBao] = useState("");

  const moTicket = (ma: string | null) => router.push(ma ? `/admin/bao-loi?ticket=${encodeURIComponent(ma)}` : "/admin/bao-loi", { scroll: false });

  const hien = useMemo(() => {
    const k = q.trim().toLowerCase();
    return ds.filter(
      (x) =>
        (tt === "tat_ca" || (tt === "mo" ? TRANG_THAI_MO.includes(x.trangThai) : x.trangThai === tt)) &&
        (!loai || x.loai === loai) &&
        (!k || [x.ma, x.tieuDe, x.tenGui, x.trang].some((v) => (v ?? "").toLowerCase().includes(k)))
    );
  }, [ds, tt, loai, q]);

  const tanSuat = useMemo(() => {
    const tu = Date.now() - ky * NGAY;
    const trongKy = ds.filter((x) => new Date(x.taoLuc).getTime() >= tu);
    const dem = (f: (x: BaoLoiDong) => string) => {
      const m = new Map<string, number>();
      for (const x of trongKy) m.set(f(x), (m.get(f(x)) ?? 0) + 1);
      return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
    };
    const soCot = Math.min(ky, 14);
    const theoNgay = Array.from({ length: soCot }, (_, i) => {
      const d = new Date(Date.now() - (soCot - 1 - i) * NGAY);
      const khoa = formatDate(d.toISOString());
      return { khoa, nhan: khoa.slice(0, 5), n: trongKy.filter((x) => formatDate(x.taoLuc) === khoa).length };
    });
    return { tong: trongKy.length, theoLoai: dem((x) => x.loai), theoTrang: dem((x) => gonTrang(x.trang)).slice(0, 8), theoNgay };
  }, [ds, ky]);
  const maxNgay = Math.max(1, ...tanSuat.theoNgay.map((d) => d.n));
  const dem = (s: TrangThaiBaoLoi) => ds.filter((x) => x.trangThai === s).length;

  return (
    <div className="grid gap-4">
      <p className="text-sm text-slate-600">
        {dem("moi")} mới · {dem("dang_xu_ly")} đang xử lý · {dem("can_chu")} chờ chủ chương trình · {dem("cho_bo_sung")} chờ người gửi bổ sung · {ds.length} tất cả
      </p>
      {thongBao && <div className="rounded-lg bg-green-50 px-4 py-2 text-sm text-green-800">{thongBao}</div>}

      <section className="rounded-lg border border-vam-line bg-white p-4 shadow-soft">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <b className="text-sm text-vam-ink">
            Tần suất {ky} ngày qua: {tanSuat.tong} lần báo
          </b>
          <select value={ky} onChange={(e) => setKy(Number(e.target.value))} aria-label="Khoảng thời gian" className="rounded-md border border-vam-line px-2 py-1 text-sm">
            <option value={7}>7 ngày</option>
            <option value={30}>30 ngày</option>
          </select>
        </div>
        <div className="mt-3 flex h-28 items-end gap-1.5" aria-label="Số lần báo theo ngày">
          {tanSuat.theoNgay.map((d) => (
            <div key={d.khoa} className="flex h-full flex-1 flex-col items-center justify-end gap-1" title={`${d.khoa}: ${d.n}`}>
              <span className="text-[11px] font-semibold text-slate-600">{d.n || ""}</span>
              <span className="w-full max-w-[28px] rounded-t bg-orange-400" style={{ height: `${(d.n / maxNgay) * 70}%`, minHeight: d.n ? 4 : 0 }} />
              <span className="text-[10px] text-slate-400">{d.nhan}</span>
            </div>
          ))}
        </div>
        <div className="mt-3 grid gap-4 md:grid-cols-2">
          <div>
            <div className="mb-1 text-xs font-bold uppercase text-slate-500">Theo loại</div>
            {tanSuat.theoLoai.length === 0 && <div className="text-sm text-slate-400">—</div>}
            {tanSuat.theoLoai.map(([k, n]) => (
              <button key={k} type="button" onClick={() => setLoai(loai === k ? "" : (k as LoaiBaoLoi))} className={`flex w-full items-center justify-between rounded px-2 py-1 text-left text-sm hover:bg-slate-100 ${loai === k ? "bg-orange-50 font-semibold" : ""}`}>
                <span>{TEN_LOAI_BAO_LOI[k as LoaiBaoLoi] ?? k}</span>
                <b>{n}</b>
              </button>
            ))}
          </div>
          <div>
            <div className="mb-1 text-xs font-bold uppercase text-slate-500">Theo trang</div>
            {tanSuat.theoTrang.length === 0 && <div className="text-sm text-slate-400">—</div>}
            {tanSuat.theoTrang.map(([k, n]) => (
              <button key={k} type="button" onClick={() => setQ(q === k ? "" : k)} className={`flex w-full items-center justify-between rounded px-2 py-1 text-left text-sm hover:bg-slate-100 ${q === k ? "bg-orange-50 font-semibold" : ""}`}>
                <span className="font-mono text-xs">{k}</span>
                <b>{n}</b>
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="flex flex-wrap gap-2 rounded-lg border border-vam-line bg-white p-3 shadow-soft">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm mã / tiêu đề / người gửi / trang…" className="w-72 max-w-full rounded-md border border-vam-line px-3 py-1.5 text-sm" />
        <select value={tt} onChange={(e) => setTt(e.target.value as typeof tt)} className="rounded-md border border-vam-line px-2 py-1.5 text-sm">
          <option value="mo">Đang mở (mới, đang xử lý, chờ chủ, chờ bổ sung)</option>
          <option value="tat_ca">Tất cả trạng thái</option>
          {(Object.keys(TEN_TRANG_THAI_BAO_LOI) as TrangThaiBaoLoi[]).map((k) => (
            <option key={k} value={k}>
              {TEN_TRANG_THAI_BAO_LOI[k]}
            </option>
          ))}
        </select>
        <select value={loai} onChange={(e) => setLoai(e.target.value as LoaiBaoLoi | "")} className="rounded-md border border-vam-line px-2 py-1.5 text-sm">
          <option value="">Tất cả loại</option>
          {LOAI_BAO_LOI.map((l) => (
            <option key={l.id} value={l.id}>
              {l.ten}
            </option>
          ))}
        </select>
      </section>

      <div className="vam-table-frame overflow-x-auto rounded-lg border border-vam-line bg-white">
        <table className="min-w-[900px] w-full divide-y divide-vam-line text-sm" data-testid="bao-loi-list">
          <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2">Mã</th>
              <th className="px-3 py-2">Gửi lúc</th>
              <th className="px-3 py-2">Người gửi</th>
              <th className="px-3 py-2">Loại</th>
              <th className="px-3 py-2">Tiêu đề</th>
              <th className="px-3 py-2">Trang</th>
              <th className="px-3 py-2">Hình</th>
              <th className="px-3 py-2">Trạng thái</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-vam-line">
            {hien.map((x) => (
              <tr key={x.id} className="cursor-pointer hover:bg-slate-50" onClick={() => moTicket(x.ma)}>
                <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">{x.ma}</td>
                <td className="whitespace-nowrap px-3 py-2">{formatDateTime(x.taoLuc)}</td>
                <td className="whitespace-nowrap px-3 py-2">
                  {x.tenGui ?? "(tài khoản đã xoá)"}
                  <div className="text-xs text-slate-400">{roleLabel(x.vai)}</div>
                </td>
                <td className="whitespace-nowrap px-3 py-2">{TEN_LOAI_BAO_LOI[x.loai] ?? x.loai}</td>
                <td className="px-3 py-2">
                  <span className="font-semibold text-vam-ink">{x.tieuDe}</span>
                  {x.trungVoiMa && <div className="text-xs text-slate-400">trùng {x.trungVoiMa}</div>}
                </td>
                <td className="max-w-[220px] break-all px-3 py-2 font-mono text-xs">{gonTrang(x.trang)}</td>
                <td className="px-3 py-2">{x.soAnh || "—"}</td>
                <td className="whitespace-nowrap px-3 py-2">
                  <Nhan tt={x.trangThai} />
                  {x.luotCuoi === "tra_loi" && TRANG_THAI_MO.includes(x.trangThai) && <div className="text-xs font-semibold text-blue-700">người gửi vừa bổ sung</div>}
                  {x.traLoi && <div className="text-xs text-slate-400">{x.daXemLuc ? "người gửi đã xem trả lời" : "chưa xem trả lời"}</div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {hien.length === 0 && <div className="p-8 text-center text-sm text-slate-400">Không có báo lỗi nào</div>}
      </div>

      {maMo && !chon && (
        <HopNen dong={() => moTicket(null)} tieuDe={maMo}>
          <p className="text-sm text-slate-600">Không tìm thấy báo lỗi này.</p>
        </HopNen>
      )}
      {chon && (
        <HopXuLy
          key={`${chon.id}-${chon.traoDoi.length}-${chon.trangThai}`}
          x={chon}
          dong={() => moTicket(null)}
          xong={(tb) => {
            setThongBao(tb);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function HopNen({ tieuDe, dong, children }: { tieuDe: React.ReactNode; dong: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4" onClick={dong}>
      <div className="mt-6 w-full max-w-4xl rounded-xl border border-vam-line bg-white p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-start justify-between gap-3">
          <h3 className="text-lg font-bold text-vam-ink">{tieuDe}</h3>
          <button type="button" onClick={dong} aria-label="Đóng" className="rounded-md px-2 py-1 text-slate-400 hover:bg-slate-100">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function HopXuLy({ x, dong, xong }: { x: BaoLoiChiTiet; dong: () => void; xong: (tb: string) => void }) {
  const [tt, setTt] = useState<TrangThaiBaoLoi>(x.trangThai);
  const [traLoi, setTraLoi] = useState(x.traLoi ?? "");
  const [ghiChu, setGhiChu] = useState(x.ghiChuNoiBo ?? "");
  const [trung, setTrung] = useState(x.trungVoiMa ?? "");
  const [cauHoi, setCauHoi] = useState("");
  const [loi, setLoi] = useState("");
  const [dang, setDang] = useState(false);

  const doi = tt !== x.trangThai || traLoi.trim() !== (x.traLoi ?? "") || ghiChu !== (x.ghiChuNoiBo ?? "") || trung !== (x.trungVoiMa ?? "");

  async function luu() {
    setLoi("");
    if (tt === "trung" && !trung.trim()) return setLoi("Trạng thái “Trùng” cần mã báo lỗi gốc (VD: VAM00012).");
    setDang(true);
    try {
      const kq = await capNhatBaoLoiAction({
        id: x.id,
        trangThai: tt,
        traLoi: traLoi.trim() === (x.traLoi ?? "") ? null : traLoi,
        ghiChu: ghiChu === (x.ghiChuNoiBo ?? "") ? null : ghiChu,
        trungVoi: tt === "trung" ? trung : x.trungVoiMa ? "" : null
      });
      if (!kq.ok) return setLoi(kq.error);
      const coTraLoiMoi = !!traLoi.trim() && traLoi.trim() !== (x.traLoi ?? "");
      xong(coTraLoiMoi ? `Đã lưu ${x.ma}. Người gửi sẽ thấy trả lời khi mở VAM OS.` : `Đã lưu ${x.ma}.`);
    } finally {
      setDang(false);
    }
  }

  async function hoi() {
    setLoi("");
    if (cauHoi.trim().length < 3) return setLoi("Bạn ghi câu hỏi cho người gửi nhé (ít nhất 3 chữ).");
    setDang(true);
    try {
      const kq = await hoiLaiBaoLoiAction(x.id, cauHoi);
      if (!kq.ok) return setLoi(kq.error);
      setCauHoi("");
      xong(
        kq.value.thu
          ? `Đã gửi câu hỏi cho người gửi ${x.ma} — họ nhận thư và thấy pop-up khi mở VAM OS.`
          : `Đã ghi câu hỏi cho ${x.ma} — chưa gửi được thư, người gửi vẫn thấy pop-up khi mở VAM OS.`
      );
    } finally {
      setDang(false);
    }
  }

  const tb = x.thietBi as Record<string, string | number | boolean | undefined>;
  const thongTin: [string, React.ReactNode][] = [
    ["Người gửi", [x.tenGui ?? "(tài khoản đã xoá)", roleLabel(x.vai)].filter(Boolean).join(" · ")],
    ["Email", x.emailGui ?? "—"],
    ["Loại", TEN_LOAI_BAO_LOI[x.loai] ?? x.loai],
    ["Gửi lúc", formatDateTime(x.taoLuc)],
    [
      "Trang",
      x.trang ? (
        <a className="font-mono text-xs text-vam-green underline" href={x.trang} target="_blank" rel="noreferrer">
          {x.trang}
        </a>
      ) : (
        "—"
      )
    ],
    ["Máy", <span key="may" className="text-xs">{[tb.khung && `khung ${tb.khung}`, tb.man_hinh && `màn ${tb.man_hinh}`, tb.ua].filter(Boolean).join(" · ") || "—"}</span>],
    ["Xử lý bởi", x.xuLyBoi ? `${x.xuLyBoi}${x.commitSua ? ` · commit ${x.commitSua}` : ""}` : "—"]
  ];
  const daDong = TRANG_THAI_DONG.includes(x.trangThai);

  return (
    <HopNen
      dong={dong}
      tieuDe={
        <span>
          <span className="font-mono text-sm text-slate-500">{x.ma}</span> · {x.tieuDe}
        </span>
      }
    >
      <div className="mb-3">
        <Nhan tt={x.trangThai} />
      </div>
      <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[140px_1fr]">
        {thongTin.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="font-semibold text-slate-500">{k}</dt>
            <dd className="break-words">{v}</dd>
          </div>
        ))}
      </dl>
      <h4 className="mb-1 mt-4 font-bold text-slate-700">Mô tả</h4>
      <p className="whitespace-pre-wrap text-sm">{x.noiDung || <span className="text-slate-400">(không ghi mô tả)</span>}</p>
      <h4 className="mb-1 mt-4 font-bold text-slate-700">Hình chụp màn hình</h4>
      {x.anh.length ? <LuoiAnh anh={x.anh} /> : <p className="text-sm text-slate-400">Không gửi hình.</p>}

      {x.traoDoi.length > 0 && (
        <>
          <h4 className="mb-2 mt-4 font-bold text-slate-700">Hỏi lại người gửi</h4>
          <LuongTraoDoi ds={x.traoDoi} phiaToi="hoi" />
        </>
      )}

      {loi && <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{loi}</div>}

      {!daDong && (
        <div className="mt-4 rounded-lg border border-orange-200 bg-orange-50 p-3">
          <span className="mb-1 block text-xs font-semibold uppercase text-slate-500">Hỏi lại người gửi (mô tả chưa rõ)</span>
          <textarea
            rows={2}
            maxLength={4000}
            value={cauHoi}
            onChange={(e) => setCauHoi(e.target.value)}
            placeholder="VD: Bạn đang ở trang nào, chọn mùa nào và chụp màn hình lúc bấm “Xuất Excel” giúp nhé?"
            className="w-full rounded-md border border-vam-line px-3 py-2 text-sm"
          />
          <div className="mt-2 flex items-center justify-between gap-2">
            <span className="text-xs text-slate-500">Người gửi nhận thư + pop-up trên VAM OS, trả lời bằng chữ + hình. Báo lỗi chuyển sang “Chờ người gửi bổ sung”.</span>
            <button type="button" disabled={dang || cauHoi.trim().length < 3} onClick={() => void hoi()} className="shrink-0 rounded-md bg-vam-green px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
              Gửi câu hỏi
            </button>
          </div>
        </div>
      )}

      <h4 className="mb-2 mt-4 font-bold text-slate-700">Xử lý</h4>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="text-sm">
          <span className="mb-1 block text-xs font-semibold uppercase text-slate-500">Trạng thái</span>
          <select value={tt} onChange={(e) => setTt(e.target.value as TrangThaiBaoLoi)} className="w-full rounded-md border border-vam-line px-2 py-1.5">
            {(Object.keys(TEN_TRANG_THAI_BAO_LOI) as TrangThaiBaoLoi[]).map((k) => (
              <option key={k} value={k}>
                {TEN_TRANG_THAI_BAO_LOI[k]}
              </option>
            ))}
          </select>
        </label>
        {tt === "trung" && (
          <label className="text-sm">
            <span className="mb-1 block text-xs font-semibold uppercase text-slate-500">Trùng với báo lỗi</span>
            <input value={trung} placeholder="VAM00012" onChange={(e) => setTrung(e.target.value)} className="w-full rounded-md border border-vam-line px-2 py-1.5 font-mono" />
          </label>
        )}
        <label className="text-sm md:col-span-2">
          <span className="mb-1 block text-xs font-semibold uppercase text-slate-500">Trả lời người gửi (hiện trong pop-up lần mở VAM OS sau)</span>
          <textarea rows={3} maxLength={2000} value={traLoi} onChange={(e) => setTraLoi(e.target.value)} className="w-full rounded-md border border-vam-line px-3 py-2" />
        </label>
        <label className="text-sm md:col-span-2">
          <span className="mb-1 block text-xs font-semibold uppercase text-slate-500">Ghi chú nội bộ (người gửi không thấy)</span>
          <textarea rows={3} maxLength={8000} value={ghiChu} onChange={(e) => setGhiChu(e.target.value)} className="w-full rounded-md border border-vam-line px-3 py-2" />
        </label>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={dong} className="rounded-md border border-vam-line px-4 py-2 text-sm font-semibold text-slate-700">
          Huỷ
        </button>
        <button type="button" disabled={dang || !doi} onClick={() => void luu()} className="rounded-md bg-vam-green px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
          {dang ? "Đang lưu…" : "Lưu"}
        </button>
      </div>
    </HopNen>
  );
}
