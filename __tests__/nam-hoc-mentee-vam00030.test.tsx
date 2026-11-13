/**
 * VAM00030: BTC sửa, cập nhật, bổ sung "Năm học" trên form sửa hồ sơ mentee, và giá trị đó hiện ở danh sách /mentees.
 *
 * "Năm học" là sinh viên đang học năm thứ mấy (mã "1".."4", "graduated" của câu "Năm học hiện tại" trong đơn
 * ứng tuyển), lưu ở cột có sẵn `mentee_profiles.year_of_study`. Trước đây form có ô này nhưng giá trị chỉ vào
 * audit log, mở form luôn thấy trống.
 *
 * Bản giả Supabase ghi lại MỌI lệnh ghi (update/insert) để khẳng định chính lệnh ghi, kể cả ca "không ghi gì".
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;
type Write = { table: string; op: "update" | "insert"; payload: Row };

const state = vi.hoisted(() => ({
  role: "admin" as string,
  operate: true,
  db: {} as Record<string, Array<Record<string, unknown>>>,
  writes: [] as Array<{ table: string; op: "update" | "insert"; payload: Record<string, unknown> }>
}));

function fakeClient() {
  return {
    from(table: string) {
      const filters: Array<[string, unknown]> = [];
      let op: "select" | "update" | "insert" = "select";
      let payload: Row = {};
      const rows = () => (state.db[table] ??= []);
      const matching = () => rows().find((row) => filters.every(([col, val]) => row[col] === val)) ?? null;
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: (col: string, val: unknown) => {
          filters.push([col, val]);
          return builder;
        },
        ilike: (col: string, val: unknown) => {
          filters.push([col, val]);
          return builder;
        },
        limit: () => builder,
        update: (p: Row) => {
          op = "update";
          payload = p;
          state.writes.push({ table, op, payload: p });
          return builder;
        },
        insert: (p: Row) => {
          op = "insert";
          payload = p;
          state.writes.push({ table, op, payload: p });
          return builder;
        },
        maybeSingle: async () => {
          if (op === "insert") {
            const row = { id: `00000000-0000-4000-8000-0000000009${String(rows().length).padStart(2, "0")}`, ...payload };
            rows().push(row);
            return { data: row, error: null };
          }
          const row = matching();
          if (op === "update" && row) Object.assign(row, payload);
          return { data: row ? { ...row } : null, error: null };
        },
        then: (resolve: (value: unknown) => unknown) => resolve({ data: null, error: null })
      };
      return builder;
    }
  };
}

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("react-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-dom")>()),
  useFormState: (action: unknown, initial: unknown) => [initial, action],
  useFormStatus: () => ({ pending: false })
}));
vi.mock("@/lib/admin-auth", () => ({ getCurrentAdminUser: async () => ({ id: "admin-1", role: state.role }) }));
vi.mock("@/lib/program-scope", () => ({
  getAdminScopeContext: async () => ({ adminUser: { id: "admin-1", role: state.role }, isSuperAdmin: false }),
  canOperateAnyScope: () => state.operate,
  getScopeFilter: async () => undefined,
  getAllowedProgramIds: async () => []
}));
vi.mock("@/lib/data", () => ({ getScopedPersonIds: async () => ({ personIds: null, error: null }) }));
vi.mock("@/lib/supabase-server", () => ({
  getSupabaseServiceRoleClient: () => fakeClient(),
  getSupabaseServiceRoleEnvStatus: () => ({ sameAsAnonKey: false })
}));

import { createMenteeAction, updateMenteeAction } from "@/app/actions/people";
import { EditMenteeForm } from "@/app/mentees/[id]/edit/edit-mentee-form";
import { CreateMenteeForm } from "@/app/mentees/create/create-mentee-form";
import { displayYearOfStudy } from "@/lib/member-code-core";
import { MENTEE_YEAR_OF_STUDY_OPTIONS, parseYearOfStudy, yearOfStudyFormOptions } from "@/lib/mentee-year-of-study-core";
import { MENTEE_PROFILE_COLUMNS, cellValue } from "@/lib/participant-export-core";
import type { MenteeProfile, Person } from "@/lib/types";

const source = (file: string) => readFileSync(path.resolve(file), "utf8");
const PROFILE_ID = "00000000-0000-4000-8000-000000000101";
const PERSON_ID = "00000000-0000-4000-8000-000000000201";
const initial = { ok: false, message: null };

function seed(yearOfStudy: string | null = null) {
  state.db = {
    mentee_profiles: [
      {
        id: PROFILE_ID,
        person_id: PERSON_ID,
        mentee_code: "UEHEM12001",
        school_code: "UEH",
        school_raw: "Truong A",
        major: "Marketing",
        class_cohort: "K48",
        mssv: "MSSV-GIA",
        year_of_study: yearOfStudy
      }
    ],
    people: [{ id: PERSON_ID, full_name: "Mentee Thu", email_primary: "mentee.thu@example.test", phone_primary: null, gender: null }],
    admin_audit_log: []
  };
}

const profile = () => state.db.mentee_profiles[0];
const writesTo = (table: string) => state.writes.filter((write: Write) => write.table === table);

function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

/** Đúng những ô form sửa thật gửi lên, lấy giá trị đang lưu như khi BTC mở form rồi chỉ đổi năm học. */
function fullEditForm(yearOfStudy: string) {
  return form({
    mentee_profile_id: PROFILE_ID,
    person_id: PERSON_ID,
    full_name: "Mentee Thu",
    email: "mentee.thu@example.test",
    phone: "",
    gender: "",
    school_code: "UEH",
    school_raw: "Truong A",
    major: "Marketing",
    class_cohort: "K48",
    mssv: "MSSV-GIA",
    year_of_study: yearOfStudy,
    career_interests: ""
  });
}

function yearSelect(markup: string) {
  const start = markup.indexOf('<select name="year_of_study"');
  expect(start).toBeGreaterThanOrEqual(0);
  return markup.slice(start, markup.indexOf("</select>", start));
}

function selectedValue(selectMarkup: string) {
  const match = /<option value="([^"]*)" selected="">/.exec(selectMarkup);
  return match ? match[1] : null;
}

function renderEdit() {
  return renderToStaticMarkup(
    <EditMenteeForm mentee={{ ...profile() } as MenteeProfile} person={state.db.people[0] as unknown as Person} />
  );
}

beforeEach(() => {
  state.role = "admin";
  state.operate = true;
  state.writes = [];
  seed();
});

describe("kiểm năm học ở máy chủ (phần thuần)", () => {
  it("dùng đúng bộ mã của đơn ứng tuyển", () => {
    expect(MENTEE_YEAR_OF_STUDY_OPTIONS.map((option) => option.value)).toEqual(["1", "2", "3", "4", "graduated"]);
  });
  it("nhận mã hợp lệ, trống là null, chặn giá trị lạ", () => {
    expect(parseYearOfStudy("3")).toEqual({ ok: true, value: "3" });
    expect(parseYearOfStudy(" graduated ")).toEqual({ ok: true, value: "graduated" });
    expect(parseYearOfStudy("")).toEqual({ ok: true, value: null });
    expect(parseYearOfStudy("   ")).toEqual({ ok: true, value: null });
    expect(parseYearOfStudy(undefined)).toEqual({ ok: true, value: null });
    for (const bad of ["5", "0", "Năm 3", "2024-2025", "<b>3</b>"]) expect(parseYearOfStudy(bad).ok).toBe(false);
  });
  it("giá trị cũ ngoài danh sách chỉ được giữ nguyên, không được đổi sang giá trị lạ khác", () => {
    expect(parseYearOfStudy("Year 2", "Year 2")).toEqual({ ok: true, value: "Year 2" });
    expect(parseYearOfStudy("Year 3", "Year 2").ok).toBe(false);
    expect(yearOfStudyFormOptions("Year 2").at(-1)).toEqual({ value: "Year 2", label: "Year 2 (giá trị cũ)" });
    expect(yearOfStudyFormOptions("3")).toHaveLength(MENTEE_YEAR_OF_STUDY_OPTIONS.length);
  });
});

describe("form sửa hồ sơ mentee: lưu và đọc năm học", () => {
  it("lưu năm học vào mentee_profiles.year_of_study, mở lại form thấy đúng giá trị", async () => {
    const result = await updateMenteeAction(initial, fullEditForm("3"));
    expect(result.ok).toBe(true);

    const updates = writesTo("mentee_profiles");
    expect(updates).toHaveLength(1);
    expect(updates[0].payload.year_of_study).toBe("3");
    expect(profile().year_of_study).toBe("3");

    expect(selectedValue(yearSelect(renderEdit()))).toBe("3");
  });

  it("mở form với năm học đang lưu thì ô chọn sẵn giá trị đó, không phải ô trống", () => {
    seed("graduated");
    expect(selectedValue(yearSelect(renderEdit()))).toBe("graduated");
  });

  it("chưa có năm học thì ô chọn ở Chưa rõ", () => {
    expect(selectedValue(yearSelect(renderEdit()))).toBe("");
  });

  it("ô năm học là ô chọn đủ năm 1 đến 4 và Đã tốt nghiệp", () => {
    const select = yearSelect(renderEdit());
    for (const option of MENTEE_YEAR_OF_STUDY_OPTIONS) expect(select).toContain(`<option value="${option.value}">${option.label}</option>`);
  });

  it("ô trống lưu null, không lưu chuỗi rỗng", async () => {
    seed("2");
    expect((await updateMenteeAction(initial, fullEditForm(""))).ok).toBe(true);
    expect(writesTo("mentee_profiles")[0].payload).toHaveProperty("year_of_study", null);
    expect(profile().year_of_study).toBeNull();
  });

  it("giá trị sai bị từ chối và không có lệnh ghi nào, kể cả phần người", async () => {
    seed("2");
    const data = fullEditForm("7");
    data.set("full_name", "Ten Moi");
    const result = await updateMenteeAction(initial, data);
    expect(result.ok).toBe(false);
    expect(result.message).toContain("Năm học không hợp lệ");
    expect(state.writes).toEqual([]);
    expect(profile().year_of_study).toBe("2");
  });

  it("hồ sơ cũ có giá trị ngoài danh sách: form hiện giá trị đó, bấm Lưu không bị chặn và không mất giá trị", async () => {
    seed("Year 2");
    const select = yearSelect(renderEdit());
    expect(selectedValue(select)).toBe("Year 2");
    expect(select).toContain("Year 2 (giá trị cũ)");

    expect((await updateMenteeAction(initial, fullEditForm("Year 2"))).ok).toBe(true);
    expect(profile().year_of_study).toBe("Year 2");
  });
});

describe("đường ghi hẹp", () => {
  it("lần gửi chỉ có năm học chỉ ghi đúng năm học, không đụng trường khác hay bảng people", async () => {
    const result = await updateMenteeAction(initial, form({ mentee_profile_id: PROFILE_ID, person_id: PERSON_ID, year_of_study: "2" }));
    expect(result.ok).toBe(true);
    expect(writesTo("mentee_profiles").map((write) => write.payload)).toEqual([{ year_of_study: "2" }]);
    expect(writesTo("people")).toEqual([]);
    expect(profile()).toMatchObject({ school_code: "UEH", school_raw: "Truong A", major: "Marketing", class_cohort: "K48", mssv: "MSSV-GIA" });
  });

  it("lần gửi không có ô năm học thì không ghi năm học", async () => {
    seed("4");
    const data = fullEditForm("4");
    data.delete("year_of_study");
    data.set("major", "Tai chinh");
    expect((await updateMenteeAction(initial, data)).ok).toBe(true);
    const payload = writesTo("mentee_profiles")[0].payload;
    expect(payload).not.toHaveProperty("year_of_study");
    expect(payload.major).toBe("Tai chinh");
    expect(profile().year_of_study).toBe("4");
  });

  it("form đầy đủ vẫn ghi đủ các trường hồ sơ như trước", async () => {
    expect((await updateMenteeAction(initial, fullEditForm("1"))).ok).toBe(true);
    expect(writesTo("mentee_profiles")[0].payload).toEqual({
      school_code: "UEH",
      school_raw: "Truong A",
      major: "Marketing",
      class_cohort: "K48",
      mssv: "MSSV-GIA",
      year_of_study: "1"
    });
  });

  it("năm học không còn bị ghi vào audit như một trường thiếu chỗ lưu", async () => {
    await updateMenteeAction(initial, fullEditForm("3"));
    const audit = writesTo("admin_audit_log")[0].payload;
    expect(JSON.stringify(audit.details ?? null)).not.toContain("year_of_study");
  });
});

describe("quyền sửa giống các trường hồ sơ khác", () => {
  it("vai trò không được sửa hồ sơ gửi thẳng form cũng không ghi được", async () => {
    state.role = "viewer";
    expect((await updateMenteeAction(initial, fullEditForm("3"))).ok).toBe(false);
    expect(state.writes).toEqual([]);
  });
  it("không có phạm vi vận hành cũng vậy", async () => {
    state.operate = false;
    expect((await updateMenteeAction(initial, fullEditForm("3"))).ok).toBe(false);
    expect(state.writes).toEqual([]);
  });
});

describe("tạo mentee mới", () => {
  const createForm = (yearOfStudy: string) =>
    form({ full_name: "Mentee Moi", email: "mentee.moi@example.test", class_cohort: "", year_of_study: yearOfStudy });

  it("lưu năm học vào cột riêng, không lấp vào Khoá", async () => {
    expect((await createMenteeAction(initial, createForm("2"))).ok).toBe(true);
    const insert = writesTo("mentee_profiles")[0].payload;
    expect(insert.year_of_study).toBe("2");
    expect(insert.class_cohort).toBeNull();
  });
  it("giá trị sai bị từ chối trước khi tạo người", async () => {
    expect((await createMenteeAction(initial, createForm("2024-2025"))).ok).toBe(false);
    expect(state.writes).toEqual([]);
  });
  it("form tạo dùng ô chọn cùng bộ mã", () => {
    const select = yearSelect(renderToStaticMarkup(<CreateMenteeForm people={[]} />));
    for (const option of MENTEE_YEAR_OF_STUDY_OPTIONS) expect(select).toContain(`value="${option.value}"`);
  });
});

describe("danh sách Mentee thuộc Cộng đồng VAM và file Excel đọc đúng giá trị đã lưu", () => {
  it("giá trị form lưu hiện ra thành chữ dễ đọc", () => {
    expect(MENTEE_YEAR_OF_STUDY_OPTIONS.map((option) => displayYearOfStudy(option.value))).toEqual(
      MENTEE_YEAR_OF_STUDY_OPTIONS.map((option) => option.label)
    );
  });
  it("trang /mentees có cột Năm học đọc từ mentee_profiles.year_of_study", () => {
    const code = source("app/mentees/page.tsx");
    expect(code).toContain("year_of_study_display: displayYearOfStudy(mentee.year_of_study)");
    expect(code).toContain('{ key: "year_of_study", label: "Năm học", displayKey: "year_of_study_display" }');
  });
  it("file Excel hồ sơ Mentee có cột Năm học", () => {
    expect(MENTEE_PROFILE_COLUMNS.some((column) => column.key === "year_of_study" && column.header === "Năm học")).toBe(true);
    expect(cellValue("year_of_study", "3")).toBe("Năm 3");
  });
});
