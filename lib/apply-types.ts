/**
 * Shared types and initial state for the /apply/* pilot intake forms.
 *
 * Lives in lib/ (not app/actions/) so it can be imported by both
 * "use client" components and "use server" action files without
 * violating Next.js's rule that a "use server" file may only export
 * async functions.
 */

/**
 * Refusals the form explains with its own guidance rather than a generic
 * failure banner. Mirrors `ApplicationSubmissionReason`; kept here because this
 * module is the one both the "use client" forms and the "use server" action can
 * import.
 */
export type ApplyErrorKind = "returning_mentor";

export type ApplyActionState = {
  ok: boolean;
  message: string | null;
  applicationId?: string;
  fieldErrors?: Array<{ name: string; label: string }>;
  errorKind?: ApplyErrorKind;
};

/**
 * Season 12 renewal is reachable only through a per-Mentor token
 * (`/renew/[token]`). There is no safe generic public renewal URL to link to,
 * so the call to action names the channel instead of inventing a link.
 */
export const RETURNING_MENTOR_GUIDANCE = {
  heading: "Bạn đã có hồ sơ Mentor trong hệ thống",
  body:
    "Email bạn dùng để nộp đơn đã gắn với một hồ sơ Mentor của các mùa trước. Vì vậy đơn này không được gửi qua biểu mẫu Mentor mới. Việc tiếp tục đồng hành ở Mùa 12 được xử lý qua luồng xác nhận/gia hạn Mentor dành riêng cho bạn.",
  cta:
    "Vui lòng sử dụng đường link xác nhận Mùa 12 được Core Team gửi riêng hoặc liên hệ Core Team để nhận lại link."
} as const;

export const initialApplyActionState: ApplyActionState = {
  ok: false,
  message: null
};

/**
 * The hidden form field that relays a pilot token from the page render into
 * the submission Server Action, so both resolve the identical gate.
 *
 * Lives here rather than in lib/apply-gate.ts because the form components are
 * "use client" and apply-gate.ts is `server-only`. The name is prefixed so it
 * cannot collide with a Form Spec field, and the server reads it explicitly —
 * it is never swept into raw_payload or an answer row.
 */
export const APPLY_TOKEN_FIELD = "__apply_token";
