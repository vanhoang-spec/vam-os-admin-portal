/**
 * Where somebody goes after signing in.
 *
 * The cases that matter are the refusals and the boundaries: an address that
 * matches nobody, an address that matches two people, a participant carrying a
 * deep link into the staff portal, and a signed-in visitor the system does not
 * recognise at all. Getting any of those wrong means showing one person another
 * person's records.
 */
import { describe, it, expect } from "vitest";

import {
  canViewCrossProgramReports,
  describeProgramChoice,
  isParticipantPath,
  isReportOnlyRole,
  matchPersonByEmail,
  participantHomePath,
  resolvePostLogin,
  ROUTES,
  sortProgramChoices,
  type ProgramChoice
} from "@/lib/participant-auth-core";

function program(overrides: Partial<ProgramChoice> = {}): ProgramChoice {
  return {
    programId: "p-uehm",
    programCode: "UEHM",
    programName: "UEH Mentoring",
    role: "mentor",
    currentSeasonCode: "UEHM-S12",
    currentSeasonName: "Mùa 12",
    ...overrides
  };
}

const BK = program({
  programId: "p-bk",
  programCode: "BK",
  programName: "BK Mentoring",
  currentSeasonCode: "BK-S11",
  currentSeasonName: "Mùa 11"
});

describe("resolvePostLogin — participants", () => {
  it("takes a mentee straight in when they belong to one programme", () => {
    const decision = resolvePostLogin({
      hasParticipantAccount: true,
      programs: [program({ role: "mentee" })]
    });

    expect(decision.outcome).toBe("single_program");
    expect(decision.redirectTo).toBe("/ct/UEHM");
    expect(decision.programCode).toBe("UEHM");
  });

  it("asks a mentor in two programmes to choose", () => {
    const decision = resolvePostLogin({
      hasParticipantAccount: true,
      programs: [program(), BK]
    });

    expect(decision.outcome).toBe("choose_program");
    expect(decision.redirectTo).toBe(ROUTES.chooseProgram);
  });

  it("says so plainly when somebody belongs to no programme yet", () => {
    const decision = resolvePostLogin({ hasParticipantAccount: true, programs: [] });

    expect(decision.outcome).toBe("no_membership");
    expect(decision.redirectTo).toBe(ROUTES.noMembership);
  });

  it("never follows a participant's deep link into the staff portal", () => {
    for (const next of ["/operations", "/people", "/admin/users", "/matches", "/reviews"]) {
      const decision = resolvePostLogin({
        hasParticipantAccount: true,
        programs: [program()],
        requestedNext: next
      });

      expect(decision.redirectTo, next).toBe("/ct/UEHM");
    }
  });

  it("does follow a deep link that leads where participants may go", () => {
    const decision = resolvePostLogin({
      hasParticipantAccount: true,
      programs: [program()],
      requestedNext: "/ct/UEHM/tai-lieu"
    });

    expect(decision.redirectTo).toBe("/ct/UEHM/tai-lieu");
  });

  it("escapes a programme code rather than trusting it in a path", () => {
    expect(participantHomePath("UEH Mentoring/../admin")).toBe(
      "/ct/UEH%20Mentoring%2F..%2Fadmin"
    );
    expect(participantHomePath("")).toBe(ROUTES.noMembership);
    expect(participantHomePath(null)).toBe(ROUTES.noMembership);
  });
});

describe("resolvePostLogin — staff", () => {
  it("leaves ordinary staff where they have always landed", () => {
    const decision = resolvePostLogin({ adminRole: "core_team", programs: [program()] });

    expect(decision.outcome).toBe("staff");
    expect(decision.redirectTo).toBe(ROUTES.staffHome);
  });

  it("offers the picker to staff who work across more than one programme", () => {
    const decision = resolvePostLogin({ adminRole: "core_team", programs: [program(), BK] });

    expect(decision.outcome).toBe("choose_program");
  });

  it("always offers the picker to a super admin, who reaches every programme", () => {
    const decision = resolvePostLogin({ adminRole: "super_admin", programs: [] });

    expect(decision.outcome).toBe("choose_program");
  });

  it("honours a staff deep link over the picker — they already said where they were going", () => {
    const decision = resolvePostLogin({
      adminRole: "super_admin",
      programs: [program(), BK],
      requestedNext: "/reviews/assign-bulk"
    });

    expect(decision.outcome).toBe("staff");
    expect(decision.redirectTo).toBe("/reviews/assign-bulk");
  });

  it("sends a vam_admin to the reports console and nowhere else", () => {
    const decision = resolvePostLogin({
      adminRole: "vam_admin",
      programs: [program(), BK],
      // Even carrying a deep link into an operational screen.
      requestedNext: "/matches"
    });

    expect(decision.outcome).toBe("reports");
    expect(decision.redirectTo).toBe(ROUTES.reports);
  });

  it("keeps the staff experience for somebody who is both staff and a participant", () => {
    // A mentor granted an interviewer account — the app already creates these.
    const decision = resolvePostLogin({
      adminRole: "reviewer",
      hasParticipantAccount: true,
      programs: [program()]
    });

    expect(decision.outcome).toBe("staff");
  });
});

describe("resolvePostLogin — recognised as nobody", () => {
  it("refuses a signed-in visitor who is neither staff nor a linked participant", () => {
    const decision = resolvePostLogin({ programs: [program()] });

    expect(decision.outcome).toBe("no_account");
    expect(decision.redirectTo).toBe(ROUTES.login);
  });

  it("refuses even when programmes were somehow resolved for them", () => {
    // Belt and braces: membership rows without an account link grant nothing.
    const decision = resolvePostLogin({
      hasParticipantAccount: false,
      programs: [program(), BK]
    });

    expect(decision.outcome).toBe("no_account");
  });
});

describe("isParticipantPath", () => {
  it("admits the participant routes and their children", () => {
    for (const path of ["/ct", "/ct/UEHM", "/ct/UEHM/tai-lieu", "/chon-chuong-trinh", "/ct?x=1"]) {
      expect(isParticipantPath(path), path).toBe(true);
    }
  });

  it("refuses everything else, including lookalikes", () => {
    for (const path of [
      "/operations",
      "/people",
      "/admin",
      "/ctx",
      "/ct-admin",
      "/chon-chuong-trinh-admin",
      "//evil.com",
      "https://evil.com/ct",
      "",
      null
    ]) {
      expect(isParticipantPath(path), String(path)).toBe(false);
    }
  });
});

describe("matchPersonByEmail — the self-registration path", () => {
  const people = [
    { id: "person-1", email_primary: "an@vam.vn" },
    { id: "person-2", email_primary: "binh@vam.vn" }
  ];

  it("links an address that matches exactly one person", () => {
    expect(matchPersonByEmail("an@vam.vn", people)).toEqual({ ok: true, personId: "person-1" });
  });

  it("ignores case and surrounding spaces", () => {
    expect(matchPersonByEmail("  AN@VAM.VN  ", people)).toEqual({ ok: true, personId: "person-1" });
  });

  it("refuses rather than guessing when two people share an address", () => {
    const result = matchPersonByEmail("an@vam.vn", [
      ...people,
      { id: "person-3", email_primary: "AN@vam.vn" }
    ]);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("ambiguous");
    expect(result.message).toContain("trùng với nhiều hồ sơ");
  });

  it("says the address is not in the data, rather than failing silently", () => {
    const result = matchPersonByEmail("nguoila@gmail.com", people);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("no_match");
    expect(result.message).toContain("liên hệ ban tổ chức");
  });

  it("rejects an address that is not an address", () => {
    for (const value of ["", "  ", "khong-phai-email", "a@b", null, undefined, "x".repeat(300)]) {
      const result = matchPersonByEmail(value, people);
      expect(result.ok, String(value)).toBe(false);
      if (!result.ok) expect(result.reason).toBe("invalid_email");
    }
  });

  it("survives rows with a missing address", () => {
    const result = matchPersonByEmail("an@vam.vn", [
      { id: "person-9", email_primary: null },
      { id: "person-1", email_primary: "an@vam.vn" }
    ]);

    expect(result).toEqual({ ok: true, personId: "person-1" });
  });
});

describe("roles", () => {
  it("lets super admin and vam_admin read across programmes", () => {
    expect(canViewCrossProgramReports("super_admin")).toBe(true);
    expect(canViewCrossProgramReports("vam_admin")).toBe(true);
  });

  it("refuses everybody else", () => {
    for (const role of ["admin", "core_team", "support_team", "reviewer", "viewer", "", null]) {
      expect(canViewCrossProgramReports(role), String(role)).toBe(false);
    }
  });

  it("marks only vam_admin as read-only", () => {
    expect(isReportOnlyRole("vam_admin")).toBe(true);
    expect(isReportOnlyRole("super_admin")).toBe(false);
    expect(isReportOnlyRole("admin")).toBe(false);
  });
});

describe("presenting the programmes", () => {
  it("says the season and the role on one line", () => {
    expect(describeProgramChoice(program())).toBe("Mùa 12 · vai trò mentor");
  });

  it("falls back to the season code when there is no name", () => {
    expect(describeProgramChoice(program({ currentSeasonName: null }))).toBe(
      "UEHM-S12 · vai trò mentor"
    );
  });

  it("says plainly when a programme has no season open", () => {
    expect(
      describeProgramChoice(program({ currentSeasonName: null, currentSeasonCode: null }))
    ).toBe("chưa mở mùa nào · vai trò mentor");
  });

  it("leaves the role out when there is none, rather than printing an empty label", () => {
    expect(describeProgramChoice(program({ role: null }))).toBe("Mùa 12");
  });

  it("orders programmes so the list does not reshuffle between visits", () => {
    const sorted = sortProgramChoices([program(), BK]);
    expect(sorted.map((row) => row.programCode)).toEqual(["BK", "UEHM"]);
  });
});
