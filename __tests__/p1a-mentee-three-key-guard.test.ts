/**
 * P1-A — MENTEE 3-KEY INTAKE GUARD (EMAIL **or** PHONE **or** MSSV)
 *
 * Owner policy, locked after the Season 12 Production incident: for PUBLIC
 * Mentee intake, ANY ONE of email / phone / student id that proves the
 * applicant is an existing or prior Mentee blocks the application. This is an
 * ELIGIBILITY rule, not an identity-merge rule — the three signals do NOT have
 * to agree on one person before the submission is refused.
 *
 * The incident these tests exist for: a Season 11 Mentee submitted a brand new
 * Season 12 Mentee application. Her canonical identity is backfilled data —
 * `people` -> `mentee_profiles` -> `person_season_memberships` with NO
 * historical `applications` row behind it — so the email lookup found nobody
 * (she had changed email), the applications phone lookup had nothing to bridge
 * to her person, and every participation guard sat behind `if (existingPerson)`
 * and was skipped. The row was inserted with `person_id = NULL`.
 *
 * These tests run against the shared `fake-postgrest` double, which enforces
 * SELECT projection: a field the runtime does not project is `undefined` here,
 * exactly as PostgREST would leave it. That is deliberate — a guard that reads
 * a column it forgot to ask for must fail in this file, not in Production.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/apply-gate", () => ({
  evaluateApplyGate: vi.fn(async () => ({ status: "open", state: "open" }))
}));
vi.mock("@/lib/supabase-server", () => ({
  getSupabaseServiceRoleClient: vi.fn(),
  getSupabaseServiceRoleEnvStatus: vi.fn(() => ({ sameAsAnonKey: false }))
}));

import { submitPilotApplication } from "@/lib/applications-create";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import { createFakeDb, fakeClient, insertsFor, type FakeDb, type RecordedRequest } from "./support/fake-postgrest";

// ── The real Production incident, verbatim in shape ──────────────────────────
const S11_PERSON = "2ac19e41-e248-4a6b-9179-87f27aacb89d";
const OLD_EMAIL = "hanhcao.31241026657@st.ueh.edu.vn";
const NEW_EMAIL = "myhanhtc0512@gmail.com";
const PHONE = "0345466453";
const MSSV = "31241026657";

// Deliberately unrelated values, for the "only one key matches" rows.
const OTHER_EMAIL = "someone.else@example.com";
const OTHER_PHONE = "0912000111";
const OTHER_MSSV = "31241099999";

const SEASON_S12 = "season-12";

type Seed = {
  people?: any[];
  mentee_profiles?: any[];
  mentor_profiles?: any[];
  person_season_memberships?: any[];
  matches?: any[];
  applications?: any[];
};

let db: FakeDb;

function seed(rows: Seed = {}) {
  db = createFakeDb();
  db.tables.seasons = [{ id: SEASON_S12, code: "UEHM-S12" }];
  db.tables.intake_batches = [{ id: "batch-1", season_id: SEASON_S12, code: "UEHM-S12-B1" }];
  db.tables.people = rows.people ?? [];
  db.tables.mentee_profiles = rows.mentee_profiles ?? [];
  db.tables.mentor_profiles = rows.mentor_profiles ?? [];
  db.tables.person_season_memberships = rows.person_season_memberships ?? [];
  db.tables.matches = rows.matches ?? [];
  db.tables.applications = rows.applications ?? [];
  db.tables.application_answers = [];
  vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(fakeClient(db) as never);
  return db;
}

/**
 * The canonical Season 11 Mentee as she actually exists in Production:
 * backfilled identity, completed membership, and no application row at all.
 * `overrides` moves exactly one identifier so a test can isolate one key.
 */
function priorMenteeFixture(overrides: { email?: string; phone?: string; mssv?: string } = {}): Seed {
  return {
    people: [
      {
        id: S11_PERSON,
        email_primary: overrides.email ?? OLD_EMAIL,
        phone_primary: overrides.phone ?? PHONE,
        full_name: "Cao Thi My Hanh"
      }
    ],
    mentee_profiles: [{ id: "mentee-profile-s11", person_id: S11_PERSON, mssv: overrides.mssv ?? MSSV }],
    person_season_memberships: [
      { id: "psm-s11", person_id: S11_PERSON, season_id: "season-11", role: "mentee", status: "completed" }
    ]
  };
}

function menteeInput(overrides: Record<string, any> = {}) {
  const { mssv, ...rest } = overrides;
  return {
    role: "mentee" as const,
    seasonCode: "UEHM-S12",
    intakeBatchCode: "UEHM-S12-B1",
    fullName: "Cao Thị Mỹ Hạnh",
    emailPrimary: NEW_EMAIL,
    phonePrimary: PHONE,
    consentDataStorage: true,
    rawPayload: { mssv: mssv === undefined ? MSSV : mssv },
    ...rest
  };
}

/** The invariant every refusal in this file has to satisfy. */
function expectNoWrites() {
  expect(insertsFor(db, "applications")).toEqual([]);
  expect(insertsFor(db, "application_answers")).toEqual([]);
  expect(db.tables.applications.filter((row) => row.source === "vam_os_form")).toEqual([]);
}

/** Identifies the safety lookup a recorded request belongs to, for error injection. */
const isPhonePeopleLookup = (request: RecordedRequest) =>
  request.table === "people" && request.columns.includes("phone_primary");
const isMssvProfileLookup = (request: RecordedRequest) =>
  request.table === "mentee_profiles" && request.columns.includes("mssv");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("P1-A Mentee 3-key intake guard", () => {
  // ── §12 — the real Production incident ────────────────────────────────────
  it("blocks the real Production case: new email, original phone, original MSSV", async () => {
    seed(priorMenteeFixture());

    const result = await submitPilotApplication(menteeInput());

    expect(result.ok).toBe(false);
    expectNoWrites();
  });

  // ── §13 — the 1-of-3 matrix ───────────────────────────────────────────────
  it("A. blocks when ONLY the email matches a prior Mentee", async () => {
    seed(priorMenteeFixture({ phone: OTHER_PHONE, mssv: OTHER_MSSV }));

    const result = await submitPilotApplication(menteeInput({ emailPrimary: OLD_EMAIL }));

    expect(result.ok).toBe(false);
    expectNoWrites();
  });

  it("B. blocks when ONLY the phone matches a prior Mentee", async () => {
    seed(priorMenteeFixture({ email: OTHER_EMAIL, mssv: OTHER_MSSV }));

    const result = await submitPilotApplication(menteeInput());

    expect(result.ok).toBe(false);
    expectNoWrites();
  });

  it("C. blocks when ONLY the MSSV matches a prior Mentee", async () => {
    seed(priorMenteeFixture({ email: OTHER_EMAIL, phone: OTHER_PHONE }));

    const result = await submitPilotApplication(menteeInput());

    expect(result.ok).toBe(false);
    expectNoWrites();
  });

  it("D. allows a genuinely new applicant: no identifier matches anything", async () => {
    seed(priorMenteeFixture({ email: OTHER_EMAIL, phone: OTHER_PHONE, mssv: OTHER_MSSV }));

    const result = await submitPilotApplication(menteeInput());

    expect(result).toMatchObject({ ok: true });
    expect(insertsFor(db, "applications")).toHaveLength(1);
  });

  it("E. blocks when two of three match, and when all three match", async () => {
    seed(priorMenteeFixture({ mssv: OTHER_MSSV }));
    const twoOfThree = await submitPilotApplication(menteeInput({ emailPrimary: OLD_EMAIL }));
    expect(twoOfThree.ok).toBe(false);
    expectNoWrites();

    seed(priorMenteeFixture());
    const threeOfThree = await submitPilotApplication(menteeInput({ emailPrimary: OLD_EMAIL }));
    expect(threeOfThree.ok).toBe(false);
    expectNoWrites();
  });

  // ── §10 — conflicting identifiers must still block, never merge ───────────
  it("blocks when email points at one prior Mentee and phone at another", async () => {
    const other = "11111111-1111-4111-8111-111111111111";
    seed({
      people: [
        { id: S11_PERSON, email_primary: OLD_EMAIL, phone_primary: OTHER_PHONE },
        { id: other, email_primary: OTHER_EMAIL, phone_primary: PHONE }
      ],
      mentee_profiles: [
        { id: "mp-a", person_id: S11_PERSON, mssv: OTHER_MSSV },
        { id: "mp-b", person_id: other, mssv: "31241088888" }
      ],
      person_season_memberships: [
        { id: "psm-a", person_id: S11_PERSON, season_id: "season-11", role: "mentee", status: "completed" },
        { id: "psm-b", person_id: other, season_id: "season-11", role: "mentee", status: "completed" }
      ]
    });

    const result = await submitPilotApplication(menteeInput({ emailPrimary: OLD_EMAIL, mssv: null }));

    expect(result.ok).toBe(false);
    expectNoWrites();
  });

  // ── §14 — same-season S12 duplicate matrix ────────────────────────────────
  const s12Application = (overrides: Record<string, any>) => ({
    id: "s12-existing",
    season_id: SEASON_S12,
    role_applied: "mentee",
    status: "submitted",
    person_id: null,
    email_primary: OTHER_EMAIL,
    phone_primary: OTHER_PHONE,
    raw_payload: { mssv: OTHER_MSSV },
    ...overrides
  });

  it("1. blocks a same-season duplicate on email alone", async () => {
    seed({ applications: [s12Application({ email_primary: NEW_EMAIL })] });

    const result = await submitPilotApplication(menteeInput());

    expect(result.ok).toBe(false);
    expectNoWrites();
  });

  it("2. blocks a same-season duplicate on phone alone", async () => {
    seed({ applications: [s12Application({ phone_primary: PHONE })] });

    const result = await submitPilotApplication(menteeInput());

    expect(result.ok).toBe(false);
    expectNoWrites();
  });

  it("3. blocks a same-season duplicate on MSSV alone", async () => {
    seed({ applications: [s12Application({ raw_payload: { mssv: MSSV } })] });

    const result = await submitPilotApplication(menteeInput());

    expect(result.ok).toBe(false);
    expectNoWrites();
  });

  it("4. does not block when no identifier matches the existing S12 application", async () => {
    seed({ applications: [s12Application({})] });

    const result = await submitPilotApplication(menteeInput());

    expect(result).toMatchObject({ ok: true });
    expect(insertsFor(db, "applications")).toHaveLength(1);
  });

  // ── §15 — phone format regression, under the CURRENT normalisePhone ───────
  //
  // `normalisePhone` deletes whitespace and rewrites the +84/84 country prefix.
  // The stored form that the previously rejected candidate missed is the first
  // row: a `%345466453%` ILIKE never sees " 0345 466 453 ", because the stored
  // digits are separated. Every form below is one `normalisePhone` ALREADY
  // calls equal — this hotfix widens no phone policy, it only stops the
  // database candidate query from hiding rows the contract already matches.
  it.each([
    ["stored with interior + surrounding whitespace", " 0345 466 453 "],
    ["stored canonical", "0345466453"],
    ["stored spaced", "0345 466 453"],
    ["stored +84", "+84345466453"],
    ["stored 84", "84345466453"]
  ])("blocks a prior Mentee whose phone is %s", async (_label, storedPhone) => {
    seed(priorMenteeFixture({ email: OTHER_EMAIL, phone: storedPhone, mssv: OTHER_MSSV }));

    const result = await submitPilotApplication(menteeInput());

    expect(result.ok).toBe(false);
    expectNoWrites();
  });

  // ── §16 — MSSV normalisation stays narrow ─────────────────────────────────
  it.each([
    ["canonical", "31241026657"],
    ["surrounding whitespace", "  31241026657  "],
    ["interior whitespace", "3124 1026 657"]
  ])("blocks a prior Mentee whose stored MSSV is %s", async (_label, storedMssv) => {
    seed(priorMenteeFixture({ email: OTHER_EMAIL, phone: OTHER_PHONE, mssv: storedMssv }));

    const result = await submitPilotApplication(menteeInput());

    expect(result.ok).toBe(false);
    expectNoWrites();
  });

  it("does not fuzzy-match a different MSSV that merely shares digits", async () => {
    // "3124102665" is the submitted id with its last character removed: a
    // substring/subsequence query finds it, canonical equality must not.
    seed(priorMenteeFixture({ email: OTHER_EMAIL, phone: OTHER_PHONE, mssv: "3124102665" }));

    const result = await submitPilotApplication(menteeInput());

    expect(result).toMatchObject({ ok: true });
  });

  it("reads the historical mssv_raw column when the canonical mssv is absent", async () => {
    const fixture = priorMenteeFixture({ email: OTHER_EMAIL, phone: OTHER_PHONE });
    fixture.mentee_profiles = [{ id: "mentee-profile-s11", person_id: S11_PERSON, mssv: null, mssv_raw: MSSV }];
    seed(fixture);

    const result = await submitPilotApplication(menteeInput());

    expect(result.ok).toBe(false);
    expectNoWrites();
  });

  it("still admits new applicants where mssv_raw does not exist as a column", async () => {
    // `mssv_raw` is a Production-only column. Everywhere else PostgREST answers
    // 42703, and that must degrade to "no historical raw value here" rather
    // than refusing every Mentee in the environment.
    seed(priorMenteeFixture({ email: OTHER_EMAIL, phone: OTHER_PHONE, mssv: OTHER_MSSV }));
    db.injectError = (request) =>
      request.table === "mentee_profiles" && request.columns.includes("mssv_raw")
        ? { code: "42703", message: "column mentee_profiles.mssv_raw does not exist" }
        : null;

    const result = await submitPilotApplication(menteeInput());

    expect(result).toMatchObject({ ok: true });
  });

  // ── §9 — nêu TRƯỜNG đã trùng, nhưng không tiết lộ gì hơn thế ──────────────
  //
  // Bài này trước đây khẳng định điều ngược lại: thông điệp không được nêu
  // trường nào trùng. Chủ chương trình đảo chính sách ngày 08/09/2026, sau khi
  // sự mơ hồ đó tự chứng minh cái giá của nó — người nộp đơn không biết phải
  // sửa gì nên đoán. Một mentee đổi email nhiều lần trong khi thứ trùng là
  // MSSV; một mentor bỏ cuộc sau bảy lần thử; ngay cả người vận hành đọc báo
  // cáo sự cố cũng đoán sai trường.
  //
  // Nhưng chỉ NỬA ĐẦU của tính chất cũ bị đảo. Nêu tên một trường là một
  // chuyện; để lộ giá trị của người khác, hay bất cứ gì về hồ sơ của họ, vẫn
  // là chuyện không được phép. Nửa sau đó là thứ bài này canh từ giờ.
  it("names the field that matched, and discloses nothing beyond it", async () => {
    seed(priorMenteeFixture({ email: OTHER_EMAIL, mssv: OTHER_MSSV }));

    const result = await submitPilotApplication(menteeInput());

    expect(result.ok).toBe(false);
    if (!result.ok) {
      // Phải nói rõ trường nào, nếu không người nộp đơn lại phải đoán.
      expect(result.message).toMatch(/Email|Số điện thoại|Mã số sinh viên/);

      // Không giá trị nào — của người nộp lẫn của người đã có trong hệ thống.
      expect(result.message).not.toContain(PHONE);
      expect(result.message).not.toContain(MSSV);
      expect(result.message).not.toContain(OLD_EMAIL);
      expect(result.message).not.toContain(OTHER_EMAIL);
      expect(result.message).not.toContain(OTHER_MSSV);

      // Không hé lộ gì về hồ sơ đã có: mùa nào, trạng thái nào.
      //
      // Cố ý KHÔNG chặn chữ "mentor"/"mentee" ở đây: thông điệp kết bằng
      // "liên hệ Core Team UEH Mentoring", và tên chương trình chứa sẵn chuỗi
      // đó. Chặn theo chuỗi con sẽ bắt nhầm chính tên thương hiệu.
      expect(result.message).not.toMatch(/\bSeason\b|\bS11\b|\bS12\b|đã duyệt|thành viên/i);
    }
  });

  // ── §18 — every new safety lookup fails closed ────────────────────────────
  it("fails closed when the phone candidate lookup errors", async () => {
    seed(priorMenteeFixture({ email: OTHER_EMAIL, phone: OTHER_PHONE, mssv: OTHER_MSSV }));
    db.injectError = (request) => (isPhonePeopleLookup(request) ? { code: "57014", message: "canceling statement" } : null);

    const result = await submitPilotApplication(menteeInput());

    expect(result).toMatchObject({ ok: false, code: "db" });
    expectNoWrites();
  });

  it("fails closed when the MSSV lookup errors", async () => {
    seed(priorMenteeFixture({ email: OTHER_EMAIL, phone: OTHER_PHONE, mssv: OTHER_MSSV }));
    db.injectError = (request) => (isMssvProfileLookup(request) ? { code: "57014", message: "canceling statement" } : null);

    const result = await submitPilotApplication(menteeInput());

    expect(result).toMatchObject({ ok: false, code: "db" });
    expectNoWrites();
  });

  it("fails closed rather than truncating an oversized phone candidate window", async () => {
    seed({
      people: Array.from({ length: 26 }).map((_, index) => ({
        id: `person-${index}`,
        email_primary: `crowd${index}@example.com`,
        phone_primary: PHONE
      }))
    });

    const result = await submitPilotApplication(menteeInput({ mssv: null }));

    expect(result).toMatchObject({ ok: false, code: "db" });
    expectNoWrites();
  });

  // ── §21/§22 — write invariants ────────────────────────────────────────────
  it("writes answers for an allowed applicant and touches no identity table", async () => {
    seed({});

    const result = await submitPilotApplication(
      menteeInput({
        answers: [{ questionKey: "commitment", questionLabel: "Cam kết", valueText: "yes" }]
      })
    );

    expect(result).toMatchObject({ ok: true });
    expect(insertsFor(db, "applications")).toHaveLength(1);
    expect(insertsFor(db, "application_answers")).toHaveLength(1);
    for (const table of ["people", "mentee_profiles", "mentor_profiles", "person_season_memberships", "matches"]) {
      expect(db.writes.filter((write) => write.table === table)).toEqual([]);
    }
  });

  it("links no person_id on a phone-only signal it allowed through", async () => {
    // A phone that belongs to a person with NO Mentee history is not evidence,
    // and it is also not an identity: inferring `person_id` from a shared
    // handset would be exactly the auto-merge this hotfix must not perform.
    seed({ people: [{ id: "mentor-person", email_primary: OTHER_EMAIL, phone_primary: PHONE }] });

    const result = await submitPilotApplication(menteeInput({ mssv: null }));

    expect(result).toMatchObject({ ok: true });
    expect(insertsFor(db, "applications")[0].rows[0].person_id).toBeNull();
  });

  // ── §17 — the Mentor boundary is untouched ────────────────────────────────
  describe("Mentor boundary", () => {
    const mentorInput = (overrides: Record<string, any> = {}) => ({
      ...menteeInput(overrides),
      role: "mentor" as const
    });

    it("A. lets a former Mentee apply as Mentor with the same historical email", async () => {
      seed(priorMenteeFixture());

      const result = await submitPilotApplication(mentorInput({ emailPrimary: OLD_EMAIL }));

      expect(result).toMatchObject({ ok: true });
    });

    it("B. lets a former Mentee apply as Mentor on the same phone with a changed email", async () => {
      seed(priorMenteeFixture());

      const result = await submitPilotApplication(mentorInput());

      expect(result).toMatchObject({ ok: true });
    });

    it("C. still routes a returning Mentor to renewal", async () => {
      seed({
        people: [{ id: "mentor-person", email_primary: OLD_EMAIL, phone_primary: PHONE }],
        mentor_profiles: [{ id: "mentor-profile", person_id: "mentor-person" }]
      });

      const result = await submitPilotApplication(mentorInput({ emailPrimary: OLD_EMAIL }));

      expect(result).toMatchObject({ ok: false, reason: "returning_mentor" });
      expectNoWrites();
    });

    it("D. never runs the Mentee MSSV guard on a Mentor submission", async () => {
      seed(priorMenteeFixture({ email: OTHER_EMAIL, phone: OTHER_PHONE }));

      const result = await submitPilotApplication(mentorInput());

      expect(result).toMatchObject({ ok: true });
      expect(db.requests.filter((request) => request.table === "mentee_profiles")).toEqual([]);
    });
  });
});
