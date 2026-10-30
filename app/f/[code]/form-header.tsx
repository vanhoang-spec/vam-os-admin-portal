import { formatDateTime } from "@/lib/utils";

/** Phần đầu của form công khai — dùng chung với bản xem thử của ban tổ chức. */
export function FormHeader({ title, description, closesAt, themeColor = null }: { title: string; description: string; closesAt: string | null; themeColor?: string | null }) {
  return (
    <header className="rounded-lg border border-vam-line bg-white px-4 py-5" data-testid="form-header" style={themeColor ? { borderTop: `4px solid ${themeColor}` } : undefined}>
      <h1 className="text-2xl font-semibold text-vam-ink">{title}</h1>
      {description ? <p className="mt-2 whitespace-pre-line text-sm text-slate-700">{description}</p> : null}
      {closesAt ? <p className="mt-3 text-sm text-slate-600">Hạn gửi: {formatDateTime(closesAt)} (giờ Việt Nam)</p> : null}
      <p className="mt-3 text-xs text-slate-500">
        Mục có dấu <span className="text-red-600">*</span> là bắt buộc.
      </p>
    </header>
  );
}
