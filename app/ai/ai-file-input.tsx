import { AI_UPLOAD_ACCEPT } from "@/lib/ai/upload-core";

/**
 * Ô chọn file DUY NHẤT của Công cụ AI.
 *
 * `__tests__/image-optimizer-attack-surface.test.ts` liệt kê đích danh mọi file trong
 * app có `type="file"`, và khoá rằng ô này dùng đúng `AI_UPLOAD_ACCEPT` — danh sách
 * không có đuôi ảnh nào. `accept` chỉ là gợi ý cho hộp chọn file: server vẫn tự kiểm
 * byte đầu của từng file (lib/ai/upload-core.ts).
 */
export function AiFileInput({
  id,
  name,
  label,
  hint,
  multiple = false
}: {
  id: string;
  name: string;
  label: string;
  hint: string;
  multiple?: boolean;
}) {
  return (
    <div>
      <label htmlFor={id} className="text-sm font-medium text-vam-ink">
        {label}
      </label>
      <input
        id={id}
        name={name}
        type="file"
        multiple={multiple}
        accept={AI_UPLOAD_ACCEPT}
        className="mt-1 block w-full rounded-md border border-vam-line bg-white p-2 text-sm text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-vam-mint file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-vam-green"
      />
      <p className="mt-1 text-xs text-slate-500">{hint}</p>
    </div>
  );
}
