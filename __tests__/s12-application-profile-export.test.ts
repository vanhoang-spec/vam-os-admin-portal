import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("react", () => ({ cache: <T extends (...args: any[]) => any>(fn: T) => fn }));

import {
  applicationExportCsv,
  applicationExportFilename,
  buildApplicationExportData,
  flattenRawPayload,
  guardSpreadsheetFormula,
  type ApplicationExportData
} from "@/lib/application-export";
import { applicationExportPdf } from "@/lib/application-export-pdf";
import {
  loadAuthorizedApplicationExport,
  privateExportHeaders,
  type ApplicationExportAccessDependencies
} from "@/lib/application-export-access";

const application = {
  id: "app-123",
  person_id: "person-1",
  season_id: "season-12",
  intake_batch_id: "batch-12",
  role_applied: "mentor",
  full_name: "Nguyễn Ánh",
  email_primary: "anh@example.com",
  phone_primary: "+84 901 234 567",
  gender: "female",
  sbd: "M12-001",
  submitted_at: "2026-08-29",
  status: "submitted",
  final_status: null,
  source: "vam_os_form",
  consent_data_storage: true,
  consent_pdpa: null,
  consent_pdpa_at: null,
  acquisition_channel: "Bạn bè, đồng nghiệp",
  profile_url: null,
  raw_payload: {
    motivation_text: "Muốn đóng góp, học hỏi\nvà kết nối.",
    preferred_language: ["Tiếng Việt", "English"],
    nested: { quote: 'Cô ấy nói "xin chào"' }
  },
  score_total: null,
  score_breakdown: null,
  internal_notes: { must_not_export: "private" }
} as any;

const exportData = buildApplicationExportData({
  application,
  answers: [
    { id: "answer-1", question_key: "legacy_goal", question_label: "Mục tiêu cũ", value_text: "Dẫn dắt đội ngũ" }
  ],
  person: null,
  mentorProfile: {
    id: "mentor-profile-1",
    person_id: "person-1",
    mentor_code: "MT-001",
    company_current: "Công ty Việt",
    title_current: "Giám đốc",
    years_experience_min: 10,
    years_experience_text: "Hơn 10 năm",
    industry: "Giáo dục",
    function_area: "Chiến lược",
    bio_url: null
  } as any,
  menteeProfile: null,
  season: { id: "season-12", code: "S12", name: "Season 12", program_id: "uehm" }
});

describe("S12 targeted application export data", () => {
  it("builds an allow-listed Mentor export with S12 payload and legacy answers", () => {
    expect(exportData.applicantName).toBe("Nguyễn Ánh");
    expect(exportData.role).toBe("Mentor");
    expect(exportData.season).toBe("S12");
    expect(exportData.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ section: "Nội dung form S12", label: "Động lực tham gia", value: "Muốn đóng góp, học hỏi\nvà kết nối." }),
      expect.objectContaining({ section: "Câu trả lời ứng tuyển", label: "Mục tiêu cũ (legacy_goal)", value: "Dẫn dắt đội ngũ" }),
      expect.objectContaining({ section: "Hồ sơ Mentor", label: "Mã Mentor", value: "MT-001" })
    ]));
    expect(JSON.stringify(exportData)).not.toContain("must_not_export");
    expect(JSON.stringify(exportData)).not.toContain("private");
  });

  it("builds a Mentee export with relevant profile fields", () => {
    const data = buildApplicationExportData({
      application: { ...application, role_applied: "mentee", raw_payload: null } as any,
      answers: [],
      person: null,
      mentorProfile: null,
      menteeProfile: {
        id: "mentee-profile-1",
        person_id: "person-1",
        mentee_code: "ME-001",
        school_code: "UEH",
        school_raw: "Đại học Kinh tế TP.HCM",
        major: "Kinh doanh",
        class_cohort: "K49",
        mssv: "31231000001"
      } as any,
      season: { id: "season-12", code: "S12", name: "Season 12", program_id: "uehm" }
    });
    expect(data.role).toBe("Mentee");
    expect(data.fields).toContainEqual({ section: "Hồ sơ Mentee", label: "Mã số sinh viên", value: "31231000001" });
  });

  it("flattens nested payload objects and arrays instead of emitting opaque JSON", () => {
    expect(flattenRawPayload({ a: { b: "c" }, choices: ["x", "y"], groups: [{ name: "one" }, { name: "two" }] })).toEqual([
      { key: "a.b", value: "c" },
      { key: "choices", value: "x; y" },
      { key: "groups[1].name", value: "one" },
      { key: "groups[2].name", value: "two" }
    ]);
  });
});

describe("S12 application CSV", () => {
  it("uses a UTF-8 BOM and preserves Vietnamese, commas, quotes, and multiline values", () => {
    const csv = applicationExportCsv(exportData);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain('"Field","Value"');
    expect(csv).toContain("Nguyễn Ánh");
    expect(csv).toContain('"Bạn bè, đồng nghiệp"');
    expect(csv).toContain('"Cô ấy nói ""xin chào"""');
    expect(csv).toContain('"Muốn đóng góp, học hỏi\nvà kết nối."');
  });

  it.each(["=1+1", "+SUM(A1:A2)", "-2+3", "@cmd"])("guards spreadsheet formula input %s", (dangerous) => {
    expect(guardSpreadsheetFormula(dangerous)).toBe(`'${dangerous}`);
    const data: ApplicationExportData = {
      ...exportData,
      fields: [{ section: "Câu trả lời ứng tuyển", label: "Kiểm tra", value: dangerous }]
    };
    expect(applicationExportCsv(data)).toContain(`"'${dangerous.replace(/"/g, '""')}"`);
  });

  it("uses deterministic non-PII filenames", () => {
    expect(applicationExportFilename(exportData, "csv")).toBe("vam-s12-mentor-application-app-123.csv");
  });
});

function admin(role: "core_team" | "reviewer" = "core_team") {
  return { id: "admin-1", email: "admin@example.com", full_name: "Admin", role, status: "active" as const, auth_user_id: "auth-1" };
}

function accessDependencies(events: string[] = []): ApplicationExportAccessDependencies {
  return {
    getCurrentAdminUser: async () => {
      events.push("auth");
      return admin();
    },
    canBrowseApplications: () => true,
    getAdminScopeContext: async () => {
      events.push("scope-context");
      return {
        adminUser: admin(),
        authUserId: "auth-1",
        globalRole: "core_team",
        isSuperAdmin: false,
        programScopes: [{ programId: "uehm", seasonId: "season-12", scopeLevel: "read", status: "active" }],
        scopeError: null
      };
    },
    getScopeFilter: async () => {
      events.push("scope-filter");
      return { allowedProgramIds: ["uehm"], allowedSeasonIds: ["season-12"] };
    },
    getApplication: async (id, scope) => {
      events.push(`application:${id}:${scope?.allowedSeasonIds?.join("|")}`);
      return { data: application, error: null };
    },
    getAnswersForApplication: async (id) => {
      events.push(`answers:${id}`);
      return { data: [], error: null };
    },
    getPersonByAuthorizedApplicationPersonId: async (id) => {
      events.push(`person:${id}`);
      return { data: null, error: null };
    },
    getMentorProfileByAuthorizedApplicationPersonId: async (id) => {
      events.push(`mentor:${id}`);
      return { data: null, error: null };
    },
    getMenteeProfileByAuthorizedApplicationPersonId: async (id) => {
      events.push(`mentee:${id}`);
      return { data: null, error: null };
    },
    getSeasonByAuthorizedApplicationSeasonId: async (id) => {
      events.push(`season:${id}`);
      return { data: { id, code: "S12", name: "Season 12", program_id: "uehm" }, error: null };
    }
  };
}

describe("S12 application export authorization", () => {
  it("denies unauthenticated requests before scope or data reads", async () => {
    const events: string[] = [];
    const deps = accessDependencies(events);
    deps.getCurrentAdminUser = async () => null;
    expect(await loadAuthorizedApplicationExport("app-123", deps)).toMatchObject({ ok: false, status: 401 });
    expect(events).toEqual([]);
  });

  it("denies a role without application browse permission", async () => {
    const events: string[] = [];
    const deps = accessDependencies(events);
    deps.getCurrentAdminUser = async () => admin("reviewer");
    deps.canBrowseApplications = () => false;
    expect(await loadAuthorizedApplicationExport("app-123", deps)).toMatchObject({ ok: false, status: 403 });
    expect(events).toEqual([]);
  });

  it("returns the same not-found response outside scope and never reads related PII", async () => {
    const events: string[] = [];
    const deps = accessDependencies(events);
    deps.getApplication = async () => {
      events.push("application-denied");
      return { data: null, error: null };
    };
    expect(await loadAuthorizedApplicationExport("outside-scope", deps)).toMatchObject({ ok: false, status: 404 });
    expect(events).toEqual(["auth", "scope-context", "scope-filter", "application-denied"]);
    expect(events.some((event) => /answers|person|mentor|mentee|season/.test(event))).toBe(false);
  });

  it("allows the exact scoped application and only then reads its related records", async () => {
    const events: string[] = [];
    const result = await loadAuthorizedApplicationExport("app-123", accessDependencies(events));
    expect(result).toMatchObject({ ok: true, data: { applicationId: "app-123", role: "Mentor" } });
    const applicationRead = events.findIndex((event) => event.startsWith("application:"));
    for (const prefix of ["answers:", "person:", "mentor:", "season:"]) {
      expect(events.findIndex((event) => event.startsWith(prefix))).toBeGreaterThan(applicationRead);
    }
    expect(events.some((event) => event.startsWith("mentee:"))).toBe(false);
  });
});

describe("S12 application PDF", () => {
  it("generates a valid non-empty Vietnamese PDF and spans pages for long answers", async () => {
    const longData: ApplicationExportData = {
      ...exportData,
      fields: [
        ...exportData.fields,
        {
          section: "Câu trả lời ứng tuyển",
          label: "Câu trả lời dài bằng tiếng Việt",
          value: "Tôi mong muốn học hỏi và đóng góp cho cộng đồng. ".repeat(700)
        }
      ]
    };
    const pdf = await applicationExportPdf(longData);
    expect(pdf.subarray(0, 8).toString("ascii")).toBe("%PDF-1.3");
    expect(pdf.byteLength).toBeGreaterThan(10_000);
    const pdfSource = pdf.toString("latin1");
    expect((pdfSource.match(/\/Type \/Page\b/g) ?? []).length).toBeGreaterThan(1);
  }, 20_000);

  it("provides private attachment headers for participant PII", () => {
    const headers = privateExportHeaders("application/pdf", "vam-s12-mentor-application-app-123.pdf");
    expect(headers.get("content-type")).toBe("application/pdf");
    expect(headers.get("content-disposition")).toBe('attachment; filename="vam-s12-mentor-application-app-123.pdf"');
    expect(headers.get("cache-control")).toBe("private, no-store");
    expect(headers.get("x-content-type-options")).toBe("nosniff");
    expect(headers.get("referrer-policy")).toBe("no-referrer");
  });
});

describe("S12 export source regressions", () => {
  it("does not add broad application, people, or matches reads to the export path", () => {
    const access = readFileSync("lib/application-export-access.ts", "utf8");
    expect(access).not.toMatch(/\bgetApplications\b/);
    expect(access).not.toMatch(/\bgetPeople\b/);
    expect(access).not.toMatch(/\bgetMatches\b/);
    expect(access).toContain("getApplication(applicationId, scope)");
    expect(access.indexOf("getApplication(applicationId, scope)")).toBeLessThan(access.indexOf("getAnswersForApplication(application.id)"));
  });

  it("keeps detail queue navigation and adds both export actions", () => {
    const detail = readFileSync("app/applications/[id]/page.tsx", "utf8");
    expect(detail).toContain("Trước");
    expect(detail).toContain("Tiếp");
    expect(detail).toContain("Quay lại Hàng đợi");
    expect(detail).toContain("queryStrWithAmp");
    expect(detail).toContain("Tải CSV");
    expect(detail).toContain("Tải PDF");
  });
});

describe("S12 export route responses", () => {
  function mockRouteAccess() {
    vi.doMock("@/lib/application-export-access", () => ({
      loadAuthorizedApplicationExport: async () => ({ ok: true, data: exportData }),
      privateExportHeaders: (contentType?: string, filename?: string) => {
        const headers = new Headers({
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
          "Referrer-Policy": "no-referrer"
        });
        if (contentType) headers.set("Content-Type", contentType);
        if (filename) headers.set("Content-Disposition", `attachment; filename="${filename}"`);
        return headers;
      }
    }));
  }

  it("returns a downloadable UTF-8 CSV response", async () => {
    vi.resetModules();
    mockRouteAccess();
    const route = await import("@/app/applications/[id]/export/csv/route");
    const response = await route.GET(new Request("http://localhost/applications/app-123/export/csv"), {
      params: Promise.resolve({ id: "app-123" })
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("content-disposition")).toContain("attachment;");
    expect(new Uint8Array(await response.arrayBuffer()).subarray(0, 3)).toEqual(new Uint8Array([0xef, 0xbb, 0xbf]));
    vi.doUnmock("@/lib/application-export-access");
  });

  it("returns a non-empty downloadable application/pdf response", async () => {
    vi.resetModules();
    mockRouteAccess();
    const route = await import("@/app/applications/[id]/export/pdf/route");
    const response = await route.GET(new Request("http://localhost/applications/app-123/export/pdf"), {
      params: Promise.resolve({ id: "app-123" })
    });
    const body = Buffer.from(await response.arrayBuffer());
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="vam-s12-mentor-application-app-123.pdf"');
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(body.subarray(0, 8).toString("ascii")).toBe("%PDF-1.3");
    expect(body.byteLength).toBeGreaterThan(5_000);
    vi.doUnmock("@/lib/application-export-access");
  }, 20_000);
});
