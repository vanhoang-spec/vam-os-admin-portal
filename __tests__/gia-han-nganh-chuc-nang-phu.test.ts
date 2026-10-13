/**
 * Form gia hạn mentor — phần máy chủ của hai góp ý BTC 11/10/2026:
 * mentor chọn thêm được nhiều lĩnh vực (ngành / chức năng phụ), và số năm kinh nghiệm
 * không dừng ở 20.
 *
 * Ô trên màn hình chỉ là gợi ý; cái đến từ biểu mẫu là thứ người gửi tự đặt được
 * (CLAUDE.md). Nên luật của ô mới — lựa chọn phải có thật, tối đa 3, "Khác" phải ghi rõ —
 * được soi ở đúng cổng ghi: validateRenewalAcceptance, hàm chạy trước khi gọi vam071.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { ACTIVE_READING_KEYS, CONFIRMATION_PHRASES, requiredCheckboxAcknowledgements } from "@/lib/application-commitments";
import { hashRenewalInviteToken, mintRenewalInviteToken } from "@/lib/renewal-invite-token";
import { renewalPayloadFromFormData, submitRenewalAccepted, validateRenewalAcceptance } from "@/lib/renewal-runtime";
import { RENEWAL_MAX_EXPERIENCE_YEARS, RENEWAL_PROFILE_REVIEW_CONFIRMATION_FIELD } from "@/lib/renewal-types";

function acceptedForm(extra: Array<[string, string]> = [], overrides: Record<string, string> = {}) {
  const form = new FormData();
  form.set("participation_confirmed", "yes");
  form.set(RENEWAL_PROFILE_REVIEW_CONFIRMATION_FIELD, "yes");
  form.set("consent_data_storage", "yes");
  form.set("company_current", "Acme");
  form.set("title_current", "Director");
  form.set("function_primary", "strategy_consulting");
  form.set("industry_primary", "education");
  form.set("mentor_total_work_years", "12");
  form.set("mentor_people_management_years", "5");
  form.set("mentoring_capacity_total", "2");
  form.set("university", "UEH");
  form.set("programs_willing_to_join", "UEHM");
  for (const entry of requiredCheckboxAcknowledgements("mentor")) form.set(entry.key, "true");
  form.set(ACTIVE_READING_KEYS.mentor, CONFIRMATION_PHRASES.mentor);
  for (const [key, value] of Object.entries(overrides)) form.set(key, value);
  // append, không set: nhóm ô tick gửi nhiều giá trị dưới cùng một tên.
  for (const [key, value] of extra) form.append(key, value);
  return form;
}

const secondary = (...values: string[]): Array<[string, string]> =>
  values.map((value) => ["secondary_industries_functions", value]);

function accepted(form: FormData) {
  const result = validateRenewalAcceptance(form);
  if (!result.ok) throw new Error(`Đáng lẽ được nhận: ${result.message}`);
  return result.payload;
}

describe("ngành / chức năng phụ trên form gia hạn", () => {
  it("không chọn gì: payload giữ nguyên hình dạng cũ, không thêm khoá nào", () => {
    const payload = accepted(acceptedForm());

    expect(payload).not.toHaveProperty("secondary_industries_functions");
    expect(payload).not.toHaveProperty("secondary_industries_functions_other");
    // Cùng một form, có và không có ô mới, phải cho ra đúng một payload.
    expect(payload).toEqual(accepted(acceptedForm(secondary())));
  });

  it("chọn ba lĩnh vực, lẫn ngành và chức năng: lưu đủ, đúng thứ tự đã chọn", () => {
    const payload = accepted(acceptedForm(secondary("fmcg", "marketing", "data_analytics")));

    expect(payload.secondary_industries_functions).toEqual(["fmcg", "marketing", "data_analytics"]);
    expect(payload).not.toHaveProperty("secondary_industries_functions_other");
    // Ô mới không đụng vào ngành và chức năng CHÍNH — Vòng 2 xếp nhóm theo hai ô đó.
    expect(payload.industry_primary).toBe("education");
    expect(payload.function_primary).toBe("strategy_consulting");
  });

  it("một lựa chọn gửi lặp chỉ lưu một lần", () => {
    const payload = accepted(acceptedForm(secondary("fmcg", "fmcg", "marketing")));
    expect(payload.secondary_industries_functions).toEqual(["fmcg", "marketing"]);
  });

  it("lựa chọn thứ tư bị từ chối, nói rõ mục nào", () => {
    expect(validateRenewalAcceptance(acceptedForm(secondary("fmcg", "marketing", "data_analytics", "tech")))).toEqual({
      ok: false,
      message: "Ngành / chức năng phụ: Bạn chỉ có thể chọn tối đa 3 lựa chọn."
    });
  });

  it("giá trị không có trong danh sách bị từ chối — ô tick trên màn hình không phải phép kiểm", () => {
    expect(validateRenewalAcceptance(acceptedForm(secondary("fmcg", "Chief Happiness Officer")))).toEqual({
      ok: false,
      message: "Vui lòng chọn ngành/chức năng phụ hợp lệ."
    });
  });

  it("chọn 'Khác' mà không ghi rõ thì bị từ chối", () => {
    expect(validateRenewalAcceptance(acceptedForm(secondary("other")))).toEqual({
      ok: false,
      message: "Ngành / chức năng phụ: Vui lòng ghi rõ kỹ năng/lĩnh vực khác."
    });
    expect(
      validateRenewalAcceptance(acceptedForm([...secondary("other"), ["secondary_industries_functions_other", "   "]])).ok
    ).toBe(false);
  });

  it("chọn 'Khác' và ghi rõ: lưu cả lựa chọn lẫn nội dung, đã cắt khoảng trắng thừa", () => {
    const payload = accepted(
      acceptedForm([...secondary("marketing", "other"), ["secondary_industries_functions_other", "  Thương mại điện tử  "]])
    );

    expect(payload.secondary_industries_functions).toEqual(["marketing", "other"]);
    expect(payload.secondary_industries_functions_other).toBe("Thương mại điện tử");
  });

  it("chữ 'Khác' còn sót lại khi không chọn 'Khác' thì không lưu", () => {
    const withSelection = accepted(
      acceptedForm([...secondary("marketing"), ["secondary_industries_functions_other", "Chữ cũ còn sót"]])
    );
    expect(withSelection.secondary_industries_functions).toEqual(["marketing"]);
    expect(withSelection).not.toHaveProperty("secondary_industries_functions_other");

    const withoutSelection = accepted(acceptedForm([["secondary_industries_functions_other", "Chữ cũ còn sót"]]));
    expect(withoutSelection).not.toHaveProperty("secondary_industries_functions");
    expect(withoutSelection).not.toHaveProperty("secondary_industries_functions_other");
  });

  it("payload thô (trước cổng kiểm) cũng chỉ mang khoá này khi có lựa chọn", () => {
    expect(renewalPayloadFromFormData(acceptedForm())).not.toHaveProperty("secondary_industries_functions");
    expect(renewalPayloadFromFormData(acceptedForm(secondary("tech"))).secondary_industries_functions).toEqual(["tech"]);
  });

  it("lĩnh vực đã chọn đi tới vam071 nguyên vẹn; bị từ chối thì không gọi vam071", async () => {
    const { token } = mintRenewalInviteToken();
    const invite = {
      id: "00000000-0000-4000-8000-000000000001",
      token_hash: hashRenewalInviteToken(token),
      person_id: "00000000-0000-4000-8000-000000000002",
      program_id: "00000000-0000-4000-8000-000000000003",
      season_id: "00000000-0000-4000-8000-000000000004",
      role: "mentor",
      expires_at: "2099-01-01T00:00:00.000Z",
      revoked_at: null,
      submitted_at: null,
      outcome: null,
      application_id: null
    };
    const rpc = vi.fn(async (_name: string, _params: Record<string, any>) => ({
      data: [{ outcome_status: "accepted" }],
      error: null
    }));
    const chain: Record<string, any> = {};
    for (const method of ["select", "eq", "order", "limit", "in", "gt", "range"]) chain[method] = vi.fn(() => chain);
    chain.maybeSingle = vi.fn(async () => ({ data: invite, error: null }));
    const client = { from: vi.fn(() => chain), rpc } as any;

    const refused = await submitRenewalAccepted(token, acceptedForm(secondary("fmcg", "marketing", "data_analytics", "tech")), client);
    expect(refused.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();

    const sent = await submitRenewalAccepted(token, acceptedForm(secondary("fmcg", "marketing")), client);
    expect(sent.ok).toBe(true);
    const submitCalls = rpc.mock.calls.filter(([name]) => name === "vam071_submit_renewal_accepted");
    expect(submitCalls).toHaveLength(1);
    expect(submitCalls[0][1].p_raw_payload.secondary_industries_functions).toEqual(["fmcg", "marketing"]);
  });
});

describe("số năm kinh nghiệm không dừng ở 20", () => {
  it.each(["21", "35", "50", String(RENEWAL_MAX_EXPERIENCE_YEARS)])("máy chủ nhận %s năm kinh nghiệm", (years) => {
    const payload = accepted(acceptedForm([], { mentor_total_work_years: years }));
    expect(payload.mentor_total_work_years).toBe(Number(years));
  });

  it("số năm quản lý cũng nhận trên 20, miễn không vượt số năm làm việc", () => {
    const payload = accepted(acceptedForm([], { mentor_total_work_years: "40", mentor_people_management_years: "28" }));
    expect(payload.mentor_people_management_years).toBe(28);
    expect(
      validateRenewalAcceptance(acceptedForm([], { mentor_total_work_years: "25", mentor_people_management_years: "26" })).ok
    ).toBe(false);
  });

  it("vẫn chặn số vô lý", () => {
    for (const years of [String(RENEWAL_MAX_EXPERIENCE_YEARS + 1), "-1", "2.5"]) {
      expect(validateRenewalAcceptance(acceptedForm([], { mentor_total_work_years: years })).ok).toBe(false);
    }
  });
});
