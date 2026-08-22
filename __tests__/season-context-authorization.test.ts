/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { render } from "@testing-library/react";
import { createFakeDb, fakeClient } from "./support/fake-postgrest";

(globalThis as typeof globalThis & { React: typeof React }).React = React;
vi.mock("server-only", () => ({}));
vi.mock("react", async () => ({ ...(await vi.importActual<typeof import("react")>("react")), cache: (fn: unknown) => fn }));
vi.mock("react-dom", async () => ({
  ...(await vi.importActual<typeof import("react-dom")>("react-dom")),
  useFormState: (_action: unknown, initialState: unknown) => [initialState, vi.fn()]
}));
vi.mock("next/link", () => ({ default: ({ children, href }: any) => React.createElement("a", { href }, children) }));
vi.mock("next/headers", () => ({ cookies: vi.fn(() => ({ get: vi.fn() })) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: null, supabaseUrl: "https://x.test", supabaseAnonKey: "anon" }));
vi.mock("@/lib/supabase-server", () => ({
  getSupabaseServiceRoleClient: vi.fn(),
  getSupabaseServerClient: vi.fn()
}));
vi.mock("@/lib/admin-auth", () => ({ getCurrentAdminUser: vi.fn() }));

import OperationsTasksPage from "@/app/operations/tasks/page";
import { createActionItemAction, generateMonthlyFollowupAction } from "@/app/actions/workflow";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { getSupabaseServerClient, getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import {
  resolveCurrentProgramSeasonOptions,
  resolveSeasonSelection,
  SeasonAccessDeniedError,
  SeasonContextError,
  SEASON_CONTEXT_ERROR_MESSAGE
} from "@/lib/season-context";

const currentProgramSeasons = [
  { id: "uehm-s12", code: "UEHM-S12", name: "S12", programId: "uehm" },
  { id: "uehm-s11", code: "UEHM-S11", name: "S11", programId: "uehm" }
];

const UEHM_PROGRAM_ID = "33333333-3333-4333-8333-333333333333";
const HAM_PROGRAM_ID = "44444444-4444-4444-8444-444444444444";
const UEHM_S11_ID = "11111111-1111-4111-8111-111111111111";
const UEHM_S12_ID = "12121212-1212-4121-8121-121212121212";
const UEHM_S10_ID = "10101010-1010-4101-8101-101010101010";
const HAM_S6_ID = "66666666-6666-4666-8666-666666666666";
const AUTH_USER_ID = "auth-operations";

const db = createFakeDb();
let rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];

function workflowPayload() {
  return {
    summary: {
      openActionCount: 0,
      overdueActionCount: 0,
      followUpOpenCount: 0,
      followUpResolvedCount: 0,
      dataIssueOpenCount: 0,
      correctionsThisMonth: 0
    },
    followUpQueue: [],
    dataIssuesQueue: [],
    correctionLog: [],
    myTasks: [],
    owners: []
  };
}

function createActionForm(seasonCode?: string) {
  const formData = new FormData();
  if (seasonCode !== undefined) formData.set("season_code", seasonCode);
  formData.set("title", "Verify season integrity");
  formData.set("action_type", "manual_task");
  return formData;
}

function generateFollowupForm(seasonCode?: string) {
  const formData = new FormData();
  if (seasonCode !== undefined) formData.set("season_code", seasonCode);
  formData.set("selected_month", "2026-07");
  return formData;
}

function mutationCalls() {
  return rpcCalls.filter((call) => ["create_action_item", "generate_monthly_followup_actions"].includes(call.name));
}

beforeEach(() => {
  vi.clearAllMocks();
  db.reset();
  rpcCalls = [];
  db.tables.programs = [
    { id: UEHM_PROGRAM_ID, code: "UEHM", name: "UEH Mentoring", is_active: true },
    { id: HAM_PROGRAM_ID, code: "HAM", name: "Hanoi Mentoring", is_active: true }
  ];
  db.tables.seasons = [
    { id: UEHM_S12_ID, code: "UEHM-S12", name: "UEH Mentoring Season 12", program_id: UEHM_PROGRAM_ID },
    { id: UEHM_S11_ID, code: "UEHM-S11", name: "UEH Mentoring Season 11", program_id: UEHM_PROGRAM_ID },
    { id: UEHM_S10_ID, code: "UEHM-S10", name: "UEH Mentoring Season 10", program_id: UEHM_PROGRAM_ID },
    { id: HAM_S6_ID, code: "HAM-S6", name: "Hanoi Mentoring Season 6", program_id: HAM_PROGRAM_ID }
  ];
  db.tables.intake_batches = [];
  db.tables.admin_scope_access = [
    { id: "grant-s11", user_id: AUTH_USER_ID, program_id: null, season_id: UEHM_S11_ID, role: "operations", status: "active" },
    { id: "grant-s12", user_id: AUTH_USER_ID, program_id: null, season_id: UEHM_S12_ID, role: "operations", status: "active" }
  ];

  const client = fakeClient(db, {
    rpc: (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      if (name === "get_operations_workflow_data") return { data: workflowPayload(), error: null };
      if (name === "create_action_item") return { data: { id: "action-1" }, error: null };
      if (name === "generate_monthly_followup_actions") {
        return { data: { createdCount: 1, skippedDuplicateCount: 0 }, error: null };
      }
      return { data: null, error: { code: "PGRST202", message: "not found" } };
    }
  });
  vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(client as any);
  vi.mocked(getSupabaseServerClient).mockResolvedValue(client as any);
  vi.mocked(getCurrentAdminUser).mockResolvedValue({
    id: "admin-operations",
    role: "admin",
    status: "active",
    auth_user_id: AUTH_USER_ID,
    email: "operations@example.test"
  } as any);
});

describe("season authorization and oracle resistance", () => {
  it("anchors options to the operating season's program before considering a requested season", () => {
    const catalog = {
      programs: [
        { id: "uehm", code: "UEHM", name: "UEH Mentoring", isActive: true },
        { id: "ham", code: "HAM", name: "Hanoi Mentoring", isActive: true }
      ],
      seasons: [
        ...currentProgramSeasons,
        { id: "ham-s6", code: "HAM-S6", name: "HAM S6", programId: "ham" }
      ],
      intakeBatches: []
    };
    const result = resolveCurrentProgramSeasonOptions({
      catalog,
      accessibleSeasons: catalog.seasons,
      operatingSeasonCode: "UEHM-S12"
    });
    expect(result.currentProgramId).toBe("uehm");
    expect(result.seasons.map((season) => season.code)).toEqual(["UEHM-S12", "UEHM-S11"]);
  });

  it("does not let super-admin-style options from another program select that program", () => {
    expect(() => resolveSeasonSelection({
      explicitSeason: "HAM-S6",
      cookieSeason: null,
      defaultSeasonCode: "UEHM-S12",
      authorizedCurrentProgramSeasons: currentProgramSeasons
    })).toThrowError(SEASON_CONTEXT_ERROR_MESSAGE);
  });

  it("uses identical generic semantics for malformed, nonexistent and unauthorized explicit values", () => {
    const supplied = ["../UEHM-S11", "UEHM-S404", "UEHM-S11"];
    const optionSets = [currentProgramSeasons, currentProgramSeasons, [currentProgramSeasons[0]]];
    const messages = supplied.map((explicitSeason, index) => {
      try {
        resolveSeasonSelection({ explicitSeason, cookieSeason: null, defaultSeasonCode: "UEHM-S12", authorizedCurrentProgramSeasons: optionSets[index] });
        return "unexpected success";
      } catch (error) {
        return (error as Error).message;
      }
    });
    expect(new Set(messages)).toEqual(new Set([SEASON_CONTEXT_ERROR_MESSAGE]));
    for (const value of supplied) expect(messages.join(" ")).not.toContain(value);
  });

  it("distinguishes no authorized current-program season from an explicit unauthorized request", () => {
    expect(() => resolveSeasonSelection({
      cookieSeason: null,
      defaultSeasonCode: "UEHM-S12",
      authorizedCurrentProgramSeasons: []
    })).toThrow(SeasonAccessDeniedError);

    expect(() => resolveSeasonSelection({
      explicitSeason: "UEHM-S12",
      cookieSeason: null,
      defaultSeasonCode: "UEHM-S12",
      authorizedCurrentProgramSeasons: []
    })).toThrow(SeasonContextError);
  });
});

describe("Operations Tasks mutation season integrity", () => {
  it("renders the resolved S11 season into both mutation forms", async () => {
    const ui = await OperationsTasksPage({
      searchParams: Promise.resolve({ season: "UEHM-S11", month: "2026-07" })
    });
    const { container } = render(React.createElement(React.Fragment, null, ui));
    const seasonInputs = Array.from(
      container.querySelectorAll<HTMLInputElement>('input[name="season_code"]')
    );
    expect(seasonInputs.map((input) => input.value)).toEqual(["UEHM-S11", "UEHM-S11"]);
  });

  it("forwards selected S11 to Create Action Item and writes only to S11", async () => {
    await expect(createActionItemAction(undefined, createActionForm("UEHM-S11"))).resolves.toMatchObject({ ok: true });
    expect(mutationCalls()).toEqual([
      expect.objectContaining({
        name: "create_action_item",
        args: expect.objectContaining({ p_season_code: "UEHM-S11" })
      })
    ]);
  });

  it("forwards selected S11 to Generate Follow-up and writes only to S11", async () => {
    await expect(generateMonthlyFollowupAction(undefined, generateFollowupForm("UEHM-S11"))).resolves.toMatchObject({ ok: true });
    expect(mutationCalls()).toEqual([
      expect.objectContaining({
        name: "generate_monthly_followup_actions",
        args: expect.objectContaining({ p_season_code: "UEHM-S11" })
      })
    ]);
  });

  it("keeps S12 as the server-resolved default for both mutations", async () => {
    await expect(createActionItemAction(undefined, createActionForm())).resolves.toMatchObject({ ok: true });
    await expect(generateMonthlyFollowupAction(undefined, generateFollowupForm())).resolves.toMatchObject({ ok: true });
    expect(mutationCalls().map((call) => call.args.p_season_code)).toEqual(["UEHM-S12", "UEHM-S12"]);
  });

  it("rejects a forged unauthorized UEHM season before Create Action Item writes", async () => {
    await expect(createActionItemAction(undefined, createActionForm("UEHM-S10"))).rejects.toBeInstanceOf(SeasonContextError);
    expect(mutationCalls()).toHaveLength(0);
  });

  it("rejects a forged cross-program season before Generate Follow-up writes", async () => {
    await expect(generateMonthlyFollowupAction(undefined, generateFollowupForm("HAM-S6"))).rejects.toBeInstanceOf(SeasonContextError);
    expect(mutationCalls()).toHaveLength(0);
  });

  it("rejects malformed hidden season input before either mutation writes", async () => {
    await expect(createActionItemAction(undefined, createActionForm("../UEHM-S11"))).rejects.toBeInstanceOf(SeasonContextError);
    await expect(generateMonthlyFollowupAction(undefined, generateFollowupForm("not a season"))).rejects.toBeInstanceOf(SeasonContextError);
    expect(mutationCalls()).toHaveLength(0);
  });
});
