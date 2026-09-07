import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/apply-gate", () => ({ evaluateApplyGate: vi.fn() }));

let store: Store;
let inserts: Array<{ table: string; rows: any[] }>;
let tableErrors: Record<string, { message: string } | undefined>;

vi.mock("@/lib/supabase-server", () => ({
  getSupabaseServiceRoleClient: () => makeClient(),
  getSupabaseServiceRoleEnvStatus: () => ({ sameAsAnonKey: false })
}));

import { submitPilotApplication } from "@/lib/applications-create";
import { S12_BINDING } from "@/lib/application-form-controls";
import { evaluateApplyGate } from "@/lib/apply-gate";

/**
 * P1-A BACKFILL IDENTITY RESOLUTION
 *
 * The Production incident this pins: a Season 11 Mentee re-applied for Season 12
 * as a Mentee with a NEW email and her ORIGINAL phone, and the submission was
 * accepted. Her canonical identity lives only in backfilled `people` ->
 * `mentee_profiles` -> `person_season_memberships` rows; she has no historical
 * application. Identity resolution therefore found nobody, every Mentee
 * participation guard sits behind `if (person)`, and the row was inserted with
 * `person_id = NULL`.
 *
 * ---------------------------------------------------------------------------
 * WHY THE FAKE IS SHAPED LIKE THIS
 * ---------------------------------------------------------------------------
 * A mock that answers by call order cannot prove this fix: the whole defect was
 * that a query was never asked of the right TABLE. So this fake is a small
 * relational store that applies `eq`, `in`, `ilike`, `order` and `limit` for
 * real, against whichever table the code actually selects from, and records
 * every insert. A guard that reads the wrong table simply finds nothing here,
 * exactly as it did in Production.
 */

type Store = Record<string, any[]>;

/** PostgREST ilike -> RegExp, honouring the backslash escaping `escapeIlikePattern` emits. */
function ilikeToRegExp(pattern: string): RegExp {
  let source = "";
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (char === "\\") {
      const next = pattern[index + 1];
      if (next !== undefined) {
        source += next.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        index += 1;
        continue;
      }
    }
    if (char === "%") {
      source += ".*";
      continue;
    }
    if (char === "_") {
      source += ".";
      continue;
    }
    source += char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${source}$`, "i");
}

function makeClient() {
  function from(table: string) {
    const preds: Array<(row: any) => boolean> = [];
    let orderKey: string | null = null;
    let limitN = Infinity;
    let insertedRows: any[] | null = null;
    let mode: "select" | "insert" | "delete" = "select";

    function rows() {
      const all = (store[table] ?? []).filter((row) => preds.every((pred) => pred(row)));
      const ordered = orderKey
        ? [...all].sort((a, b) => String(a[orderKey!] ?? "").localeCompare(String(b[orderKey!] ?? "")))
        : all;
      return ordered.slice(0, limitN === Infinity ? undefined : limitN);
    }

    function settle() {
      const error = tableErrors[table];
      if (error) return { data: null, error };
      if (mode === "insert") return { data: insertedRows, error: null };
      if (mode === "delete") return { data: null, error: null };
      return { data: rows(), error: null };
    }

    const query: any = {
      select: () => query,
      eq: (column: string, value: any) => {
        preds.push((row) => row[column] === value);
        return query;
      },
      neq: (column: string, value: any) => {
        preds.push((row) => row[column] !== value);
        return query;
      },
      in: (column: string, values: any[]) => {
        preds.push((row) => values.includes(row[column]));
        return query;
      },
      ilike: (column: string, pattern: string) => {
        const regex = ilikeToRegExp(pattern);
        preds.push((row) => regex.test(String(row[column] ?? "")));
        return query;
      },
      order: (column: string) => {
        orderKey = column;
        return query;
      },
      limit: (n: number) => {
        limitN = n;
        return query;
      },
      insert: (payload: any) => {
        mode = "insert";
        const list = Array.isArray(payload) ? payload : [payload];
        insertedRows = list.map((row, index) => ({ id: `inserted-${table}-${index}`, ...row }));
        inserts.push({ table, rows: list });
        store[table] = [...(store[table] ?? []), ...insertedRows];
        return query;
      },
      delete: () => {
        mode = "delete";
        return query;
      },
      maybeSingle: () => {
        const result = settle();
        if (result.error) return Promise.resolve({ data: null, error: result.error });
        const data = Array.isArray(result.data) ? result.data[0] ?? null : result.data ?? null;
        return Promise.resolve({ data, error: null });
      },
      then: (resolve: any, reject: any) => Promise.resolve(settle()).then(resolve, reject)
    };

    return query;
  }

  return { from };
}

// ---------------------------------------------------------------------------
// Fixture — the real Production shapes, anonymised only in the identifiers
// ---------------------------------------------------------------------------

const SEASON_S12 = "season-s12";
const SEASON_S11 = "season-s11";
const BATCH_S12 = "batch-s12-b1";

const OLD_EMAIL = "hanhcao.old@st.ueh.edu.vn";
const NEW_EMAIL = "myhanh.new@gmail.com";
const SHARED_PHONE = "0345466453";
const PRIOR_MENTEE_PERSON = "person-prior-mentee";

function baseStore(): Store {
  return {
    seasons: [
      { id: SEASON_S12, code: S12_BINDING.seasonCode },
      { id: SEASON_S11, code: "UEHM-S11" }
    ],
    intake_batches: [{ id: BATCH_S12, season_id: SEASON_S12, code: S12_BINDING.intakeBatchCode }],
    applications: [],
    people: [],
    mentor_profiles: [],
    mentee_profiles: [],
    person_season_memberships: [],
    matches: [],
    application_answers: []
  };
}

/**
 * The Season 11 Mentee exactly as Production holds her: canonical person plus
 * backfilled profile and membership, and NO application row anywhere.
 */
function seedBackfilledPriorMentee(options: { withProfile?: boolean; phone?: string } = {}) {
  store.people.push({
    id: PRIOR_MENTEE_PERSON,
    full_name: "Cao Thị Mỹ Hạnh",
    email_primary: OLD_EMAIL,
    phone_primary: options.phone ?? SHARED_PHONE
  });
  store.person_season_memberships.push({
    id: "psm-s11",
    person_id: PRIOR_MENTEE_PERSON,
    season_id: SEASON_S11,
    role: "mentee",
    status: "completed"
  });
  if (options.withProfile !== false) {
    store.mentee_profiles.push({ id: "mentee-profile-s11", person_id: PRIOR_MENTEE_PERSON });
  }
}

const baseInput = {
  role: "mentee" as const,
  seasonCode: S12_BINDING.seasonCode,
  intakeBatchCode: S12_BINDING.intakeBatchCode,
  fullName: "Cao Thị Mỹ Hạnh",
  emailPrimary: NEW_EMAIL,
  phonePrimary: SHARED_PHONE,
  consentDataStorage: true,
  rawPayload: {}
};

function applicationInserts() {
  return inserts.filter((entry) => entry.table === "applications");
}

const ON_SYSTEM = "Hồ sơ của bạn đã có trên hệ thống VAM OS";
const IDENTITY_REVIEW = "Thông tin bạn nhập trùng với một hồ sơ";

beforeEach(() => {
  vi.clearAllMocks();
  store = baseStore();
  inserts = [];
  tableErrors = {};
  vi.mocked(evaluateApplyGate).mockResolvedValue({ status: "open" } as any);
});

// ---------------------------------------------------------------------------
// The Production case
// ---------------------------------------------------------------------------

describe("the Production incident: changed email, same phone, backfill-only history", () => {
  it("blocks a prior Mentee whose identity exists only as backfilled people data", async () => {
    seedBackfilledPriorMentee();

    const result = await submitPilotApplication(baseInput);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain(ON_SYSTEM);
    expect(applicationInserts()).toHaveLength(0);
  });

  it("blocks on the membership alone, with no mentee_profile to help", async () => {
    seedBackfilledPriorMentee({ withProfile: false });

    const result = await submitPilotApplication(baseInput);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain(ON_SYSTEM);
    expect(applicationInserts()).toHaveLength(0);
  });

  it("reaches the person through `people`, not through a historical application", async () => {
    seedBackfilledPriorMentee();
    // Nothing in `applications` can bridge to her — this is the whole point.
    expect(store.applications).toHaveLength(0);

    const result = await submitPilotApplication(baseInput);

    expect(result.ok).toBe(false);
    expect(applicationInserts()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Regression matrix
// ---------------------------------------------------------------------------

describe("P1-A mentee intake matrix", () => {
  it("1. brand-new person -> allow", async () => {
    const result = await submitPilotApplication(baseInput);
    expect(result.ok).toBe(true);
    expect(applicationInserts()).toHaveLength(1);
    // A genuinely new applicant is never attributed to somebody else's person.
    expect(applicationInserts()[0].rows[0].person_id).toBeNull();
  });

  it("2. exact same-season duplicate -> block", async () => {
    store.applications.push({
      id: "existing-app",
      season_id: SEASON_S12,
      role_applied: "mentee",
      email_primary: NEW_EMAIL,
      phone_primary: SHARED_PHONE
    });

    const result = await submitPilotApplication(baseInput);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("duplicate");
    expect(applicationInserts()).toHaveLength(0);
  });

  it("3. prior Mentee found by the same email -> block", async () => {
    seedBackfilledPriorMentee();

    const result = await submitPilotApplication({ ...baseInput, emailPrimary: OLD_EMAIL });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain(ON_SYSTEM);
    expect(applicationInserts()).toHaveLength(0);
  });

  it("4. prior Mentee found only by canonical phone -> block", async () => {
    seedBackfilledPriorMentee();
    // Email resolves nobody; phone is the only bridge.
    expect(store.people.some((person) => person.email_primary === NEW_EMAIL)).toBe(false);

    const result = await submitPilotApplication(baseInput);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain(ON_SYSTEM);
    expect(applicationInserts()).toHaveLength(0);
  });

  it("5. phone resolves multiple people -> fail closed for identity review", async () => {
    store.people.push(
      { id: "person-a", full_name: "A", email_primary: "a@example.com", phone_primary: SHARED_PHONE },
      { id: "person-b", full_name: "B", email_primary: "b@example.com", phone_primary: SHARED_PHONE }
    );

    const result = await submitPilotApplication(baseInput);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain(IDENTITY_REVIEW);
    expect(applicationInserts()).toHaveLength(0);
  });

  it("6. email resolves person A while phone resolves person B -> fail closed", async () => {
    store.people.push(
      { id: "person-a", full_name: "A", email_primary: NEW_EMAIL, phone_primary: "0900000000" },
      { id: "person-b", full_name: "B", email_primary: "b@example.com", phone_primary: SHARED_PHONE }
    );

    const result = await submitPilotApplication(baseInput);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain(IDENTITY_REVIEW);
    expect(applicationInserts()).toHaveLength(0);
  });

  it("6b. one person holding both signals is not treated as a conflict", async () => {
    store.people.push({
      id: "person-a",
      full_name: "A",
      email_primary: NEW_EMAIL,
      phone_primary: SHARED_PHONE
    });

    // No mentee history at all, so this person may still apply.
    const result = await submitPilotApplication(baseInput);

    expect(result.ok).toBe(true);
    expect(applicationInserts()).toHaveLength(1);
  });

  it("7. a database error during canonical phone resolution fails closed", async () => {
    seedBackfilledPriorMentee();
    tableErrors.people = { message: "connection reset" };

    const result = await submitPilotApplication(baseInput);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("db");
    expect(applicationInserts()).toHaveLength(0);
  });

  it("7b. a database error on the membership lookup still fails closed", async () => {
    seedBackfilledPriorMentee();
    tableErrors.person_season_memberships = { message: "timeout" };

    const result = await submitPilotApplication(baseInput);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("db");
    expect(applicationInserts()).toHaveLength(0);
  });

  it("9. phone formatting variants resolve to the same canonical identity", async () => {
    seedBackfilledPriorMentee();

    for (const variant of ["+84345466453", " 0345 466 453 ", "0345466453"]) {
      inserts = [];
      const result = await submitPilotApplication({ ...baseInput, phonePrimary: variant });
      expect(result.ok, `variant ${variant} should be blocked`).toBe(false);
      expect(applicationInserts()).toHaveLength(0);
    }
  });

  it("does not block a different phone that merely shares a suffix window", async () => {
    seedBackfilledPriorMentee();

    // Same trailing digits are what the `%suffix%` window selects on; canonical
    // equality is what decides, so a longer foreign number must not match.
    const result = await submitPilotApplication({ ...baseInput, phonePrimary: "0999345466453" });

    expect(result.ok).toBe(true);
    expect(applicationInserts()).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Mentor policy must not move
// ---------------------------------------------------------------------------

describe("mentor policy is unchanged", () => {
  const mentorInput = { ...baseInput, role: "mentor" as const };

  it("8. a former Mentee applying as Mentor is still allowed", async () => {
    seedBackfilledPriorMentee();

    const result = await submitPilotApplication(mentorInput);

    expect(result.ok).toBe(true);
    expect(applicationInserts()).toHaveLength(1);
  });

  it("a returning Mentor found by canonical phone is routed to renewal", async () => {
    store.people.push({
      id: "person-mentor",
      full_name: "Mentor Cũ",
      email_primary: "mentor.old@example.com",
      phone_primary: SHARED_PHONE
    });
    store.mentor_profiles.push({ id: "mentor-profile", person_id: "person-mentor" });

    const result = await submitPilotApplication(mentorInput);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("returning_mentor");
      expect(result.message).toContain("gia hạn Mentor Season 12");
    }
    expect(applicationInserts()).toHaveLength(0);
  });

  it("a returning Mentor found by email is still routed to renewal", async () => {
    store.people.push({
      id: "person-mentor",
      full_name: "Mentor Cũ",
      email_primary: NEW_EMAIL,
      phone_primary: "0900000000"
    });
    store.person_season_memberships.push({
      id: "psm-mentor",
      person_id: "person-mentor",
      season_id: SEASON_S11,
      role: "mentor",
      status: "completed"
    });

    const result = await submitPilotApplication(mentorInput);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("returning_mentor");
    expect(applicationInserts()).toHaveLength(0);
  });

  it("a brand-new Mentor is still allowed", async () => {
    const result = await submitPilotApplication(mentorInput);
    expect(result.ok).toBe(true);
    expect(applicationInserts()).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// No identity is written by intake
// ---------------------------------------------------------------------------

describe("intake writes no identity", () => {
  it("never inserts or updates people, profiles, memberships or matches", async () => {
    seedBackfilledPriorMentee();
    await submitPilotApplication(baseInput);
    await submitPilotApplication({ ...baseInput, emailPrimary: "brand.new@example.com", phonePrimary: "0911222333" });

    const touched = inserts.map((entry) => entry.table);
    expect(touched).not.toContain("people");
    expect(touched).not.toContain("mentee_profiles");
    expect(touched).not.toContain("mentor_profiles");
    expect(touched).not.toContain("person_season_memberships");
    expect(touched).not.toContain("matches");
  });

  it("does not attribute an accepted application to a phone-matched person", async () => {
    // A person with no participation history: the submission is allowed, and
    // must not silently inherit that person's identity on a phone match alone.
    store.people.push({
      id: "person-shared-handset",
      full_name: "Người khác",
      email_primary: "someone.else@example.com",
      phone_primary: SHARED_PHONE
    });

    const result = await submitPilotApplication(baseInput);

    expect(result.ok).toBe(true);
    expect(applicationInserts()[0].rows[0].person_id).toBeNull();
  });
});
