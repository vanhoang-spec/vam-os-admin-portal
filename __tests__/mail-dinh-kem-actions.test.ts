/**
 * VAM00037 — các nút gửi của trang Mail với tệp đính kèm: chỉ người gửi được thư hàng loạt mới tải
 * tệp lên; tệp được kiểm với kho TRƯỚC khi mở lô; tệp chốt vào lô TRƯỚC khi lá đầu tiên đi; form
 * không tệp chạy y như cũ.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/admin-auth", () => ({ getCurrentAdminUser: vi.fn() }));
vi.mock("@/lib/program-scope", () => ({ getAdminScopeContext: vi.fn(), canOperateSeason: vi.fn() }));
vi.mock("@/lib/email-templates", () => ({ getMailSeason: vi.fn(), getEmailTemplate: vi.fn() }));
vi.mock("@/lib/bulk-mail", () => ({
  listBulkRecipients: vi.fn(),
  listEmailBatches: vi.fn(),
  createEmailBatch: vi.fn(),
  createCustomEmailBatch: vi.fn(),
  buildCustomRecipientUniverse: vi.fn(),
  searchCustomListPeople: vi.fn(),
  runEmailBatch: vi.fn()
}));
vi.mock("@/lib/email", () => ({ sendTemplatedEmail: vi.fn() }));
vi.mock("@/lib/mail-dinh-kem", () => ({
  capLinkTaiTep: vi.fn(),
  kiemTepDaTai: vi.fn(),
  ganTepVaoLo: vi.fn(),
  dinhKemChoThuThu: vi.fn(),
  boTepDaTai: vi.fn()
}));

import { getCurrentAdminUser } from "@/lib/admin-auth";
import { canOperateSeason, getAdminScopeContext } from "@/lib/program-scope";
import { getEmailTemplate, getMailSeason } from "@/lib/email-templates";
import { createEmailBatch, listBulkRecipients, runEmailBatch } from "@/lib/bulk-mail";
import { sendTemplatedEmail } from "@/lib/email";
import { boTepDaTai, capLinkTaiTep, dinhKemChoThuThu, ganTepVaoLo, kiemTepDaTai } from "@/lib/mail-dinh-kem";
import {
  removeMailAttachmentAction,
  requestMailAttachmentUploadAction,
  sendTestEmailAction,
  startBulkSendAction
} from "@/app/actions/bulk-mail";
import { initialBulkMailActionState } from "@/lib/bulk-mail-action-types";
import { MAIL_DINH_KEM_FIELD } from "@/lib/mail-dinh-kem-core";

const SEASON = "00000000-0000-4000-8000-0000000000aa";
const ACTOR = "00000000-0000-4000-8000-0000000000a1";
const TEMPLATE = "00000000-0000-4000-8000-0000000000cc";
const BATCH = "00000000-0000-4000-8000-0000000000dd";
const P1 = `${SEASON}/${ACTOR}/11111111-1111-4111-8111-111111111111/huong-dan.pdf`;
const FILES = [{ path: P1, name: "Hướng dẫn.pdf", size: 5000, mime: "application/pdf" }];
const URL_ATTACHMENTS = [{ filename: "Hướng dẫn.pdf", url: "https://kho.test/a?token=1", contentType: "application/pdf" }];

const order: string[] = [];

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

function signedInAs(role: string) {
  vi.mocked(getCurrentAdminUser).mockResolvedValue({
    id: ACTOR,
    email: "admin@vam.org",
    full_name: "A",
    role,
    status: "active",
    auth_user_id: null
  } as never);
}

const START = { template_id: TEMPLATE, audience: "mentee", confirm_count: "2" };
const WITH_FILE = { ...START, [MAIL_DINH_KEM_FIELD]: JSON.stringify([{ path: P1, name: "Hướng dẫn.pdf" }]) };

beforeEach(() => {
  vi.clearAllMocks();
  order.length = 0;
  signedInAs("admin");
  vi.mocked(getMailSeason).mockResolvedValue({ ok: true, id: SEASON, code: "UEHM-S12" });
  vi.mocked(getAdminScopeContext).mockResolvedValue({ scopeError: null } as never);
  vi.mocked(canOperateSeason).mockResolvedValue(true);
  vi.mocked(getEmailTemplate).mockResolvedValue({
    row: { id: TEMPLATE, seasonId: SEASON, kind: "general_announcement", name: "Mẫu", subject: "Tiêu đề", body: "Chào.", status: "approved" },
    error: null
  } as never);
  vi.mocked(listBulkRecipients).mockResolvedValue({
    partition: {
      sendable: [
        { personId: "p0", fullName: "A", email: "a@example.com", role: "mentee" },
        { personId: "p1", fullName: "B", email: "b@example.com", role: "mentee" }
      ],
      unreachable: []
    },
    error: null
  } as never);
  vi.mocked(createEmailBatch).mockImplementation(async () => {
    order.push("createEmailBatch");
    return { batch: { id: BATCH }, error: null } as never;
  });
  vi.mocked(ganTepVaoLo).mockImplementation(async () => {
    order.push("ganTepVaoLo");
    return { error: null };
  });
  vi.mocked(runEmailBatch).mockImplementation(async () => {
    order.push("runEmailBatch");
    return { ok: true, sent: 2, failed: 0, skipped: 0, remaining: 0, problems: [], error: null };
  });
  vi.mocked(kiemTepDaTai).mockImplementation(async () => {
    order.push("kiemTepDaTai");
    return { ok: true, files: FILES };
  });
  vi.mocked(dinhKemChoThuThu).mockResolvedValue({ ok: true, attachments: URL_ATTACHMENTS } as never);
  vi.mocked(sendTemplatedEmail).mockResolvedValue({ ok: true, skipped: false } as never);
});

describe("ai được tải tệp lên", () => {
  it.each(["core_team", "support_team", "viewer", "reviewer"])("%s không xin được link tải lên", async (role) => {
    signedInAs(role);
    const out = await requestMailAttachmentUploadAction({ files: [{ name: "a.pdf", size: 1 }], current: [] });
    expect(out.ok).toBe(false);
    expect(capLinkTaiTep).not.toHaveBeenCalled();
  });

  it("không có phạm vi vận hành mùa này thì không xin được link", async () => {
    vi.mocked(canOperateSeason).mockResolvedValue(false);
    const out = await requestMailAttachmentUploadAction({ files: [{ name: "a.pdf", size: 1 }], current: [] });
    expect(out.ok).toBe(false);
    expect(capLinkTaiTep).not.toHaveBeenCalled();
  });

  it("quản trị viên xin link cho đúng mùa và đúng tài khoản của mình", async () => {
    vi.mocked(capLinkTaiTep).mockResolvedValue({ ok: true, links: [], problems: [] });
    await requestMailAttachmentUploadAction({ files: [{ name: "a.pdf", size: 10 }], current: [{ size: 5 }] });
    expect(capLinkTaiTep).toHaveBeenCalledWith({
      seasonId: SEASON,
      actorId: ACTOR,
      current: [{ size: 5 }],
      files: [{ name: "a.pdf", size: 10 }]
    });
  });

  it("bỏ tệp: chỉ trong phạm vi tài khoản đang đăng nhập; không có quyền thì không xoá", async () => {
    vi.mocked(boTepDaTai).mockResolvedValue({ ok: true });
    await removeMailAttachmentAction(P1);
    expect(boTepDaTai).toHaveBeenCalledWith({ seasonId: SEASON, actorId: ACTOR, path: P1 });
    vi.clearAllMocks();
    signedInAs("viewer");
    expect(await removeMailAttachmentAction(P1)).toEqual({ ok: false });
    expect(boTepDaTai).not.toHaveBeenCalled();
  });
});

describe("gửi hàng loạt kèm tệp", () => {
  it("kiểm tệp với kho trước khi mở lô, chốt tệp vào lô trước khi gửi", async () => {
    const out = await startBulkSendAction(initialBulkMailActionState, form(WITH_FILE));
    expect(out.ok).toBe(true);
    expect(out.message).toContain("kèm 1 tệp");
    expect(order).toEqual(["kiemTepDaTai", "createEmailBatch", "ganTepVaoLo", "runEmailBatch"]);
    expect(kiemTepDaTai).toHaveBeenCalledWith([{ path: P1, name: "Hướng dẫn.pdf" }]);
    expect(ganTepVaoLo).toHaveBeenCalledWith({ batchId: BATCH, seasonId: SEASON, actorId: ACTOR, files: FILES });
  });

  it("tệp của người khác: từ chối, không mở lô, không hỏi kho", async () => {
    const foreign = P1.replace(ACTOR, "00000000-0000-4000-8000-0000000000a9");
    const out = await startBulkSendAction(
      initialBulkMailActionState,
      form({ ...START, [MAIL_DINH_KEM_FIELD]: JSON.stringify([{ path: foreign, name: "Hướng dẫn.pdf" }]) })
    );
    expect(out.ok).toBe(false);
    expect(kiemTepDaTai).not.toHaveBeenCalled();
    expect(createEmailBatch).not.toHaveBeenCalled();
  });

  it("tệp không có trong kho: không mở lô", async () => {
    vi.mocked(kiemTepDaTai).mockResolvedValue({ ok: false, message: "Hướng dẫn.pdf: tệp chưa tải lên xong." });
    const out = await startBulkSendAction(initialBulkMailActionState, form(WITH_FILE));
    expect(out.ok).toBe(false);
    expect(out.message).toContain("chưa tải lên xong");
    expect(createEmailBatch).not.toHaveBeenCalled();
  });

  it("chốt tệp hỏng: không gửi lá nào", async () => {
    vi.mocked(ganTepVaoLo).mockResolvedValue({ error: "Không chốt được tệp đính kèm vào lô. Lô đã đóng, chưa lá thư nào đi." });
    const out = await startBulkSendAction(initialBulkMailActionState, form(WITH_FILE));
    expect(out.ok).toBe(false);
    expect(runEmailBatch).not.toHaveBeenCalled();
  });

  it("form không tệp: không hỏi kho, lời nhắn như cũ", async () => {
    const out = await startBulkSendAction(initialBulkMailActionState, form(START));
    expect(out.ok).toBe(true);
    expect(kiemTepDaTai).not.toHaveBeenCalled();
    expect(out.message).not.toContain("tệp");
    expect(runEmailBatch).toHaveBeenCalledTimes(1);
  });
});

describe("gửi thử kèm tệp", () => {
  it("bản thử mang đúng bộ tệp đang chọn, không mở lô, không chốt tệp", async () => {
    const out = await sendTestEmailAction(
      initialBulkMailActionState,
      form({ template_id: TEMPLATE, [MAIL_DINH_KEM_FIELD]: WITH_FILE[MAIL_DINH_KEM_FIELD] })
    );
    expect(out.ok).toBe(true);
    expect(dinhKemChoThuThu).toHaveBeenCalledWith(FILES);
    expect(vi.mocked(sendTemplatedEmail).mock.calls[0][0].attachments).toEqual(URL_ATTACHMENTS);
    expect(createEmailBatch).not.toHaveBeenCalled();
    expect(ganTepVaoLo).not.toHaveBeenCalled();
  });

  it("bản thử không tệp: lời gọi gửi không mang khoá attachments", async () => {
    await sendTestEmailAction(initialBulkMailActionState, form({ template_id: TEMPLATE }));
    expect(vi.mocked(sendTemplatedEmail).mock.calls[0][0]).not.toHaveProperty("attachments");
    expect(dinhKemChoThuThu).not.toHaveBeenCalled();
  });
});
