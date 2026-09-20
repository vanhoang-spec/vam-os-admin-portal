"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { deletePersonAction, personDeleteReportAction } from "@/app/actions/person-delete";
import type { PersonDeleteReport } from "@/lib/person-delete";

const inputClass =
  "mt-1 w-full rounded-md border border-red-200 bg-white px-3 py-2 text-sm text-vam-ink outline-none focus:border-red-400 focus:ring-2 focus:ring-red-100";

/**
 * Xoá hẳn một người khỏi hệ thống.
 *
 * ---------------------------------------------------------------------------
 * BẢN KÊ ĐỌC TỪ MÁY CHỦ, KHÔNG DỰNG Ở TRÌNH DUYỆT
 * ---------------------------------------------------------------------------
 * Màn hình này nói "xoá đi thì mất những gì". Con số đó phải đến từ đúng hàm mà
 * database dùng khi quyết định cho xoá hay không — nếu trình duyệt tự đếm lấy,
 * sẽ có ngày nó nói "xoá được" trong khi database từ chối, hoặc tệ hơn: nói mất
 * 3 thứ trong khi thật ra mất 7.
 *
 * Bản kê chỉ nạp khi người dùng bấm mở khung. Trang hồ sơ là trang mở hằng ngày,
 * và không việc gì phải chạy một phép đếm nặng trên mọi lượt xem chỉ để phục vụ
 * một thao tác hiếm.
 */
export function PersonDeletePanel({ personId, fullName }: { personId: string; fullName: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [report, setReport] = useState<PersonDeleteReport | null>(null);
  const [allowed, setAllowed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [typedName, setTypedName] = useState("");
  const [reason, setReason] = useState("");
  const [pending, startTransition] = useTransition();

  function openPanel() {
    setOpen(true);
    setError(null);
    startTransition(async () => {
      const loaded = await personDeleteReportAction(personId);
      if (!loaded.ok || !loaded.report) {
        setError(loaded.message ?? "Không đọc được bản kê.");
        return;
      }
      setReport(loaded.report);
      setAllowed(loaded.allowed === true);
    });
  }

  function submit() {
    setResult(null);
    startTransition(async () => {
      const outcome = await deletePersonAction({ personId, reason, confirmName: typedName });
      setResult(outcome);
      if (outcome.ok) router.push("/people");
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={openPanel}
        className="inline-flex items-center gap-2 rounded-md border border-red-200 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50"
      >
        <Trash2 className="h-4 w-4" aria-hidden />
        Xoá khỏi hệ thống
      </button>
    );
  }

  return (
    <div className="rounded-md border border-red-200 bg-red-50 p-4">
      <h3 className="text-sm font-semibold text-red-900">Xoá hẳn hồ sơ này khỏi hệ thống</h3>
      <p className="mt-1 text-xs text-red-800">
        Không hoàn lại được. Chỉ dùng cho hồ sơ trùng, hồ sơ nhập sai hoặc hồ sơ thử nghiệm. Cho một người nghỉ mùa
        này thì dùng <strong>Chuyển sang Không tham dự</strong> hoặc <strong>Huỷ tư cách</strong> ở khung Trạng thái
        tham gia phía trên.
      </p>

      {pending && !report ? <p className="mt-3 text-sm text-red-800">Đang đọc bản kê…</p> : null}
      {error ? <p className="mt-3 text-sm text-red-700">{error}</p> : null}

      {report ? (
        <div className="mt-3 grid gap-3">
          {!allowed ? (
            <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              Bạn không có quyền xoá hồ sơ này. Mentor do Admin hoặc Core team xoá; mentee thì Support team cũng
              xoá được.
            </p>
          ) : null}

          {report.blockers.length ? (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <p className="font-medium">Hồ sơ này chưa xoá được vì còn dữ liệu chương trình:</p>
              <ul className="mt-1 list-disc pl-5">
                {report.blockers.map((entry) => (
                  <li key={entry.key}>
                    {entry.total} {entry.label}
                  </li>
                ))}
              </ul>
              <p className="mt-2">
                Đây là dữ liệu thật của chương trình. Muốn cho người này ngưng tham gia thì dùng Huỷ tư cách.
              </p>
            </div>
          ) : (
            <div className="rounded-md border border-red-200 bg-white px-3 py-2 text-sm text-slate-700">
              <p className="font-medium text-red-900">Xoá đi sẽ mất theo:</p>
              {report.removes.length ? (
                <ul className="mt-1 list-disc pl-5">
                  {report.removes.map((entry) => (
                    <li key={entry.key}>
                      {entry.total} {entry.label}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1">Hồ sơ trống — không có dữ liệu đi kèm.</p>
              )}
              {report.orphans.length ? (
                <p className="mt-2 text-amber-800">
                  Còn lại nhưng mất liên kết:{" "}
                  {report.orphans.map((entry) => `${entry.total} ${entry.label}`).join(", ")}.
                </p>
              ) : null}
            </div>
          )}

          {allowed && report.canDelete ? (
            <>
              <label className="block text-xs font-medium text-red-900">
                Gõ lại họ tên để xác nhận: <span className="font-semibold">{fullName}</span>
                <input
                  value={typedName}
                  onChange={(event) => setTypedName(event.target.value)}
                  autoComplete="off"
                  className={inputClass}
                />
              </label>
              <label className="block text-xs font-medium text-red-900">
                Lý do xoá
                <input
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  autoComplete="off"
                  className={inputClass}
                />
              </label>
            </>
          ) : null}

          {result ? (
            <p
              className={
                result.ok
                  ? "rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800"
                  : "rounded-md border border-red-200 bg-white px-3 py-2 text-sm text-red-700"
              }
            >
              {result.message}
            </p>
          ) : null}

          <div className="flex flex-wrap gap-2">
            {allowed && report.canDelete ? (
              <button
                type="button"
                onClick={submit}
                disabled={pending || !typedName.trim() || !reason.trim()}
                className="inline-flex rounded-md bg-red-700 px-3 py-2 text-sm font-semibold text-white hover:bg-red-800 disabled:opacity-50"
              >
                {pending ? "Đang xoá…" : "Xoá hẳn khỏi hệ thống"}
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="inline-flex rounded-md border border-vam-line bg-white px-3 py-2 text-sm font-medium text-vam-ink hover:bg-slate-50"
            >
              Đóng
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
