/**
 * Trang /forms/[id]/doi-chieu (Support team 25/10/2026): số đúng, ba nhóm đúng chỗ, link tải CSV
 * mang đúng vai, và đọc hỏng thì chỉ hiện hộp lỗi — không hiện con số nào.
 */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ check: null as any }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/form-roster-check", () => ({
  checkFormRoster: vi.fn(async () => h.check),
  parseRosterRole: (v: unknown) => (v === "mentor" ? "mentor" : "mentee")
}));

import Page from "@/app/forms/[id]/doi-chieu/page";
import { checkFormRoster } from "@/lib/form-roster-check";

const FORM_ID = "09c8eea0-e238-4f5c-9e54-925952ad6020";
const person = (personId: string, name: string, email: string) => ({ personId, name, emails: [email], phones: ["0912345678"], roles: ["mentee"] });

beforeEach(() => {
  vi.clearAllMocks();
  h.check = {
    ok: true,
    data: {
      form: { id: FORM_ID, title: "Training mentee", publicCode: "2411bbb8defd" },
      seasonCode: "UEHM-S12",
      result: {
        role: "mentee",
        rosterSize: 4,
        submitted: [
          { person: person("p1", "Nguyễn Văn An", "an@gmail.com"), matchedBy: "email", submissions: [{ responseId: "r1", createdAt: "2026-10-25T01:00:00Z" }] },
          { person: person("p2", "Trần Lương Yến Vy", "vy@gmail.com"), matchedBy: "name", submissions: [{ responseId: "r2", createdAt: "2026-10-25T02:00:00Z" }] }
        ],
        notSubmitted: [person("p3", "Lê Văn Chưa", "chua@gmail.com"), person("p4", "Phạm Cũng Chưa", "cungchua@gmail.com")],
        outsiders: [
          { submission: { responseId: "r9", createdAt: "2026-10-25T03:00:00Z", name: "loan", emails: ["loan@yahoo.com"], phones: [] }, note: "Email/SĐT trùng mentor Đặng Phạm Minh Loan — không phải mentee" }
        ]
      }
    }
  };
});

const render = async (search: Record<string, string> = {}) =>
  renderToStaticMarkup(await Page({ params: Promise.resolve({ id: FORM_ID }), searchParams: Promise.resolve(search) }));
const section = (html: string, testId: string) => {
  const start = html.indexOf(`data-testid="${testId}"`);
  const end = html.indexOf("</section>", start);
  return html.slice(start, end);
};

describe("trang đối chiếu", () => {
  it("bốn con số; mỗi người nằm đúng nhóm của mình", async () => {
    const html = await render();
    expect(section(html, "roster-check-kpis").length).toBeGreaterThan(0);
    const kpis = html.slice(html.indexOf('data-testid="roster-check-kpis"'), html.indexOf('data-testid="roster-not-submitted"'));
    expect(kpis).toContain("Mentee chính thức");
    expect(kpis).toContain(">4<");
    expect(kpis).toContain("50% danh sách");
    expect(section(html, "roster-not-submitted")).toContain("Lê Văn Chưa");
    expect(section(html, "roster-not-submitted")).not.toContain("Nguyễn Văn An");
    expect(section(html, "roster-submitted")).toContain("Nguyễn Văn An");
    expect(section(html, "roster-submitted")).toContain("Họ tên — cần xem lại");
    expect(section(html, "roster-outsiders")).toContain("không phải mentee");
    expect(section(html, "roster-outsiders")).not.toContain("Lê Văn Chưa");
  });

  it("link tải CSV và nút chuyển vai mang đúng vai đang xem", async () => {
    vi.mocked(checkFormRoster).mockImplementation(async (_id, input) => ({ ...h.check, data: { ...h.check.data, result: { ...h.check.data.result, role: input.role } } }));
    const html = await render({ doi_tuong: "mentor" });
    expect(vi.mocked(checkFormRoster)).toHaveBeenCalledWith(FORM_ID, { role: "mentor", season: undefined });
    expect(html).toContain(`href="/api/exports/custom-form/${FORM_ID}/doi-chieu?doi_tuong=mentor"`);
    expect(html).toMatch(/aria-current="page"[^>]*>Mentor</);
  });

  it("đọc hỏng → chỉ hộp lỗi, không con số nào", async () => {
    h.check = { ok: false, message: "Không đọc được đầy đủ dữ liệu để đối chiếu." };
    const html = await render();
    expect(html).toContain("Không đọc được đầy đủ dữ liệu để đối chiếu.");
    expect(html).not.toContain("roster-check-kpis");
    expect(html).not.toContain("Chưa nộp");
  });
});
