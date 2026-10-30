import type { LogoPosition } from "@/lib/custom-form-core";
import { formatDateTime } from "@/lib/utils";

const LOGO_ALIGN: Record<LogoPosition, string> = { left: "justify-start", center: "justify-center", right: "justify-end" };

/** Phần đầu của form công khai — dùng chung với bản xem thử của ban tổ chức. */
export function FormHeader({
  title,
  description,
  closesAt,
  themeColor = null,
  bannerUrl = "",
  logoUrl = "",
  logoPosition = "left"
}: {
  title: string;
  description: string;
  closesAt: string | null;
  themeColor?: string | null;
  bannerUrl?: string;
  logoUrl?: string;
  logoPosition?: LogoPosition;
}) {
  return (
    <header className="overflow-hidden rounded-lg border border-vam-line bg-white" data-testid="form-header" style={themeColor ? { borderTop: `4px solid ${themeColor}` } : undefined}>
      {bannerUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- ảnh tải thẳng từ kho, không qua bộ tối ưu ảnh (image-optimizer-attack-surface mục 3d)
        <img src={bannerUrl} alt="" data-testid="form-banner" className="max-h-64 w-full object-cover" />
      ) : null}
      <div className="px-4 py-5">
      {logoUrl ? (
        <div className={`mb-3 flex ${LOGO_ALIGN[logoPosition]}`} data-testid="form-logo-row">
          {/* eslint-disable-next-line @next/next/no-img-element -- như banner */}
          <img src={logoUrl} alt="Logo đơn vị tổ chức" data-testid="form-logo" className="h-14 w-auto max-w-[60%] object-contain" />
        </div>
      ) : null}
      <h1 className="text-2xl font-semibold text-vam-ink">{title}</h1>
      {description ? <p className="mt-2 whitespace-pre-line text-sm text-slate-700">{description}</p> : null}
      {closesAt ? <p className="mt-3 text-sm text-slate-600">Hạn gửi: {formatDateTime(closesAt)} (giờ Việt Nam)</p> : null}
      <p className="mt-3 text-xs text-slate-500">
        Mục có dấu <span className="text-red-600">*</span> là bắt buộc.
      </p>
      </div>
    </header>
  );
}
