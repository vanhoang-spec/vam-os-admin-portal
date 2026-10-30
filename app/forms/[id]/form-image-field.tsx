"use client";

/**
 * Ô chọn banner / logo của form (VAM00009 mục 4.1). Ảnh KHÔNG đi qua máy chủ VAM: trình duyệt thu nhỏ ảnh,
 * xin link tải lên ký sẵn rồi PUT thẳng lên kho riêng 'form-anh'. Xem
 * __tests__/image-optimizer-attack-surface.test.ts mục 3d.
 *
 * Banner lưu JPEG cho nhẹ. Logo lưu PNG: logo thường có nền trong suốt, JPEG sẽ biến nền đó thành màu đặc.
 * Chọn xong ảnh chỉ mới nằm trong kho; phải bấm "Lưu form" thì form mới dùng ảnh đó.
 */
import { useState } from "react";
import type { CustomFormImageKind } from "@/lib/custom-form-core";
import { requestFormImageUploadAction } from "../actions";

export const FORM_IMAGE_ACCEPT = "image/png,image/jpeg,image/webp";
const MAX_SIDE: Record<CustomFormImageKind, number> = { banner: 1600, logo: 600 };
const MAX_BYTES = 4.5 * 1024 * 1024;

async function shrink(file: Blob, kind: CustomFormImageKind): Promise<{ blob: Blob; type: string }> {
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const element = new Image();
    element.onload = () => {
      URL.revokeObjectURL(url);
      resolve(element);
    };
    element.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Không đọc được ảnh này — chọn ảnh PNG hoặc JPG."));
    };
    element.src = url;
  });
  const ratio = Math.min(1, MAX_SIDE[kind] / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Trình duyệt không xử lý được ảnh — thử trình duyệt khác.");
  const type = kind === "logo" ? "image/png" : "image/jpeg";
  if (kind === "banner") {
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
  }
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.85));
  if (!blob || blob.size > MAX_BYTES) throw new Error("Ảnh quá lớn — chọn ảnh nhỏ hơn.");
  return { blob, type };
}

export function FormImageField({
  formId,
  kind,
  label,
  hint,
  url,
  onChange
}: {
  formId: string;
  kind: CustomFormImageKind;
  label: string;
  hint: string;
  /** Link xem của ảnh đang dùng; rỗng = chưa có ảnh. */
  url: string;
  onChange: (path: string, previewUrl: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const { blob, type } = await shrink(file, kind);
      const link = await requestFormImageUploadAction(formId, kind);
      if (!link.ok) throw new Error(link.message);
      const apikey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
      const response = await fetch(link.signedUrl, {
        method: "PUT",
        headers: { "content-type": type, "x-upsert": "false", ...(apikey ? { apikey } : {}) },
        body: blob
      });
      if (!response.ok) throw new Error("Chưa tải được ảnh lên — kiểm tra mạng rồi thử lại.");
      onChange(link.path, URL.createObjectURL(blob));
    } catch (e) {
      setError((e as Error).message || "Chưa tải được ảnh lên — thử lại.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-1 text-sm" data-testid={`form-image-${kind}`}>
      <span className="font-medium">{label}</span>
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element -- ảnh tải thẳng từ kho, không qua bộ tối ưu ảnh (mục 3d)
        <img src={url} alt="" className={kind === "banner" ? "max-h-32 w-full rounded-md object-cover" : "h-16 w-auto self-start object-contain"} />
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <label className="cursor-pointer rounded-md border border-vam-line bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50">
          {busy ? "Đang tải lên…" : url ? "Đổi ảnh" : "Chọn ảnh"}
          <input
            type="file"
            accept={FORM_IMAGE_ACCEPT}
            className="sr-only"
            aria-label={label}
            disabled={busy}
            onChange={(e) => {
              void pick(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </label>
        {url ? (
          <button type="button" className="rounded-md border border-vam-line bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50" onClick={() => onChange("", "")}>
            Bỏ ảnh
          </button>
        ) : null}
      </div>
      <span className="text-xs text-slate-600">{hint}</span>
      {error ? <span role="alert" className="text-xs text-red-600">{error}</span> : null}
    </div>
  );
}
