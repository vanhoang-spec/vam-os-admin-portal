"use client";

import { useState } from "react";
import { confirmationMatches } from "@/lib/application-commitments";

/**
 * Ô "nhập lại câu xác nhận", có báo ngay tại chỗ khi gõ chưa khớp.
 *
 * ---------------------------------------------------------------------------
 * VÌ SAO CÓ FILE NÀY
 * ---------------------------------------------------------------------------
 * 24/09/2026 một mentor gọi điện: gõ sai câu xác nhận thì phải điền lại toàn
 * bộ form gia hạn. Bản vá trước đã giữ lại những ô đã điền
 * (lib/keep-form-values.ts), nhưng người dùng VẪN phải bấm gửi rồi mới biết
 * mình gõ sai — và vẫn không biết sai ở đâu.
 *
 * Ô này là ô DUY NHẤT trong biểu mẫu mà trình duyệt không kiểm được: `required`
 * chỉ đòi không rỗng, còn phép so từng chữ nằm ở máy chủ. Mọi ô khác sai thì
 * trình duyệt chặn ngay tại chỗ. Nên đây cũng là ô duy nhất từng đẩy người dùng
 * qua một vòng gửi-rồi-bị-từ-chối.
 *
 * ---------------------------------------------------------------------------
 * DÙNG CHUNG MỘT PHÉP SO VỚI MÁY CHỦ
 * ---------------------------------------------------------------------------
 * `confirmationMatches` ở đây là ĐÚNG hàm mà lib/renewal-runtime.ts gọi khi
 * ghi. Hai phép so riêng cho cùng một câu là hai cơ hội để màn hình nói "khớp
 * rồi" trong khi máy chủ nói không — và người dùng không còn cách nào thoát ra.
 *
 * ---------------------------------------------------------------------------
 * ĐÂY KHÔNG PHẢI MỘT CỔNG
 * ---------------------------------------------------------------------------
 * Phép kiểm phía máy chủ giữ nguyên, không đổi một dòng. Thứ ở đây chỉ để người
 * dùng biết sớm; ai tắt JavaScript hay gửi thẳng request vẫn bị máy chủ chặn
 * đúng như cũ. Cái đến từ biểu mẫu là thứ người gửi tự đặt được (CLAUDE.md).
 */
export function ConfirmationPhraseField({
  name,
  phrase,
  className,
  describedById = "xac-nhan-doc-hieu-trang-thai"
}: {
  name: string;
  phrase: string;
  className: string;
  describedById?: string;
}) {
  const [typed, setTyped] = useState("");

  const daGo = typed.trim().length > 0;
  const khop = daGo && confirmationMatches(typed, phrase);
  const lech = daGo && !khop;

  return (
    <>
      <input
        className={className}
        name={name}
        value={typed}
        onChange={(event) => setTyped(event.target.value)}
        aria-invalid={lech}
        aria-describedby={describedById}
        required
        /**
         * Chặn gửi ngay tại trình duyệt khi chưa khớp: người dùng sửa tại chỗ
         * thay vì đi một vòng qua máy chủ. An toàn vì lời chặn dùng cùng một
         * hàm với máy chủ, nên không thể có cảnh màn hình chặn một câu mà máy
         * chủ sẽ chấp nhận.
         */
        onInvalid={(event) => {
          event.currentTarget.setCustomValidity(
            daGo ? "Câu nhập lại chưa khớp với câu ở trên." : ""
          );
        }}
        ref={(node) => {
          if (!node) return;
          node.setCustomValidity(lech ? "Câu nhập lại chưa khớp với câu ở trên." : "");
        }}
      />

      {/*
        role="status" chứ không phải "alert": thông báo này đổi theo từng phím
        gõ, và một vùng "alert" sẽ ngắt lời trình đọc màn hình liên tục.
      */}
      <p
        id={describedById}
        role="status"
        className={
          khop
            ? "mt-2 text-sm font-medium text-vam-green"
            : lech
              ? "mt-2 text-sm text-amber-800"
              : "mt-2 text-xs text-slate-500"
        }
      >
        {khop
          ? "Đã khớp."
          : lech
            ? "Chưa khớp — anh/chị kiểm lại dấu tiếng Việt và các chữ trong câu ở trên. Không cần đúng hoa thường hay dấu câu."
            : "Không cần đúng hoa thường hay dấu câu; dấu tiếng Việt thì cần đúng."}
      </p>
    </>
  );
}
