"use client";

/**
 * Mail › chọn tệp đính kèm từ thiết bị (VAM00037): nhiều tệp, xem danh sách, bỏ từng tệp trước khi gửi.
 *
 * Tệp KHÔNG đi qua máy chủ VAM: taiTepLen() xin máy chủ link tải lên ký sẵn (đúng thư mục của người
 * đang đăng nhập ở mùa này, kho riêng 'mail-dinh-kem') rồi trình duyệt PUT thẳng lên Supabase Storage.
 * Form gửi chỉ mang ĐƯỜNG DẪN + tên (ô ẩn MAIL_DINH_KEM_FIELD); máy chủ kiểm lại với kho trước khi
 * gửi. Xem lib/mail-dinh-kem-core.ts và __tests__/image-optimizer-attack-surface.test.ts mục 3e.
 *
 * Dùng chung cho mọi form gửi của trang Mail: component giữ danh sách qua `files` / `onChange` của
 * cha, và mỗi form tự đặt <MailAttachmentsField files={…} /> bên trong để mang danh sách đi.
 */
import { useRef, useState } from "react";
import { removeMailAttachmentAction, requestMailAttachmentUploadAction } from "@/app/actions/bulk-mail";
import {
  MAIL_DINH_KEM_ACCEPT,
  MAIL_DINH_KEM_FIELD,
  MAIL_DINH_KEM_GIOI_HAN_TEXT,
  SO_TEP_TOI_DA,
  TONG_DUNG_LUONG_TOI_DA,
  dinhDangDungLuong,
  kiemThemTep,
  tenTepAnToan
} from "@/lib/mail-dinh-kem-core";

/** Một tệp đã nằm trong kho, sẵn sàng đính kèm. */
export type MailAttachment = { path: string; name: string; size: number };

/** Ô ẩn mang danh sách tệp đi cùng một form gửi. Không có tệp → ô rỗng, máy chủ gửi như trước. */
export function MailAttachmentsField({ files }: { files: MailAttachment[] }) {
  return (
    <input
      type="hidden"
      name={MAIL_DINH_KEM_FIELD}
      value={files.length ? JSON.stringify(files.map((file) => ({ path: file.path, name: file.name }))) : ""}
    />
  );
}

/** Xin link rồi đẩy thẳng từng tệp lên kho. Tệp nào hỏng thì báo riêng tệp đó, các tệp khác vẫn vào. */
async function taiTepLen(
  chosen: File[],
  current: MailAttachment[]
): Promise<{ uploaded: MailAttachment[]; problems: string[] }> {
  const links = await requestMailAttachmentUploadAction({
    files: chosen.map((file) => ({ name: file.name, size: file.size })),
    current: current.map((file) => ({ size: file.size }))
  });
  if (!links.ok) return { uploaded: [], problems: [links.message] };

  const apikey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
  const queue = [...chosen];
  const uploaded: MailAttachment[] = [];
  const problems = [...links.problems];
  for (const link of links.links) {
    const at = queue.findIndex((file) => tenTepAnToan(file.name) === link.name && file.size === link.size);
    if (at < 0) continue;
    const [file] = queue.splice(at, 1);
    try {
      const res = await fetch(link.signedUrl, {
        method: "PUT",
        headers: { "content-type": link.mime, "x-upsert": "false", ...(apikey ? { apikey } : {}) },
        body: file
      });
      if (!res.ok) throw new Error(String(res.status));
      uploaded.push({ path: link.path, name: link.name, size: link.size });
    } catch {
      problems.push(`${link.name}: chưa tải lên được — kiểm tra mạng rồi chọn lại tệp này.`);
    }
  }
  return { uploaded, problems };
}

export function MailAttachmentPicker({
  files,
  onChange,
  onBusyChange,
  idPrefix = "mail-dinh-kem"
}: {
  files: MailAttachment[];
  onChange: (files: MailAttachment[]) => void;
  /** Báo cho cha biết đang tải lên, để tắt nút gửi: gửi lúc tệp chưa lên xong là thư thiếu tệp. */
  onBusyChange?: (busy: boolean) => void;
  idPrefix?: string;
}) {
  const [busy, setBusy] = useState(0);
  const busyCount = useRef(0);
  const [problems, setProblems] = useState<string[]>([]);
  // Danh sách mới nhất cho các lần tải chồng nhau: `files` của lần dựng trước có thể đã cũ.
  const latest = useRef(files);
  latest.current = files;

  const total = files.reduce((sum, file) => sum + file.size, 0);
  const full = files.length >= SO_TEP_TOI_DA;

  async function addFiles(list: FileList | null) {
    const chosen = Array.from(list ?? []);
    if (!chosen.length) return;
    const checked = kiemThemTep(
      latest.current,
      chosen.map((file) => ({ name: file.name, size: file.size }))
    );
    setProblems(checked.problems);
    if (!checked.accepted.length) return;

    const accepted = chosen.filter((file) =>
      checked.accepted.some((ok) => ok.name === tenTepAnToan(file.name) && ok.size === file.size)
    );
    busyCount.current += 1;
    setBusy(busyCount.current);
    onBusyChange?.(true);
    try {
      const result = await taiTepLen(accepted, latest.current);
      if (result.uploaded.length) {
        const next = [...latest.current, ...result.uploaded];
        latest.current = next;
        onChange(next);
      }
      setProblems([...checked.problems, ...result.problems]);
    } catch {
      setProblems([...checked.problems, "Chưa tải được tệp lên — bạn thử lại nhé."]);
    } finally {
      busyCount.current -= 1;
      setBusy(busyCount.current);
      if (busyCount.current === 0) onBusyChange?.(false);
    }
  }

  function removeFile(path: string) {
    const next = latest.current.filter((file) => file.path !== path);
    latest.current = next;
    onChange(next);
    setProblems([]);
    // Dọn kho cho gọn; xoá không được thì tệp chỉ nằm lại trong kho riêng, không ai nhận nó.
    void removeMailAttachmentAction(path).catch(() => undefined);
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border border-vam-line bg-slate-50 p-3" data-testid="mail-attachments">
      <div className="flex flex-wrap items-center gap-3">
        <label
          htmlFor={`${idPrefix}-input`}
          className={`rounded-md border border-vam-line bg-white px-3 py-1.5 text-sm font-medium text-vam-ink ${
            full || busy ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:bg-slate-100"
          }`}
        >
          {busy ? "Đang tải tệp lên…" : "Đính kèm tệp từ máy"}
        </label>
        <input
          id={`${idPrefix}-input`}
          type="file"
          multiple
          accept={MAIL_DINH_KEM_ACCEPT}
          disabled={full || busy > 0}
          className="sr-only"
          onChange={(event) => {
            const list = event.target.files;
            void addFiles(list).finally(() => {
              event.target.value = "";
            });
          }}
        />
        <span className="text-xs tabular-nums text-slate-600" data-testid="mail-attachments-total">
          {files.length}/{SO_TEP_TOI_DA} tệp · {dinhDangDungLuong(total)}/{dinhDangDungLuong(TONG_DUNG_LUONG_TOI_DA)}
        </span>
      </div>
      <p className="text-xs text-slate-500">
        {MAIL_DINH_KEM_GIOI_HAN_TEXT} Mỗi người nhận — kể cả khi gửi hàng loạt — nhận đủ các tệp dưới đây.
      </p>

      {files.length ? (
        <ul className="flex flex-col gap-1" data-testid="mail-attachments-list">
          {files.map((file) => (
            <li
              key={file.path}
              className="flex items-center justify-between gap-3 rounded-md border border-vam-line bg-white px-3 py-1.5 text-sm"
            >
              <span className="min-w-0 truncate text-vam-ink" title={file.name}>
                {file.name}
              </span>
              <span className="flex shrink-0 items-center gap-3">
                <span className="text-xs tabular-nums text-slate-500">{dinhDangDungLuong(file.size)}</span>
                <button
                  type="button"
                  onClick={() => removeFile(file.path)}
                  disabled={busy > 0}
                  aria-label={`Bỏ tệp ${file.name}`}
                  className="text-xs font-medium text-red-700 hover:underline disabled:opacity-60"
                >
                  Bỏ
                </button>
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {problems.length ? (
        <ul role="alert" className="flex flex-col gap-0.5 text-xs text-red-800" data-testid="mail-attachments-problems">
          {problems.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
