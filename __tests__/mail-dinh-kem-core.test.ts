/**
 * VAM00037 — kiểm tệp đính kèm (loại, cỡ, số lượng), đọc danh sách tệp từ form, đối chiếu với kho.
 *
 * Phần thuần của lib/mail-dinh-kem-core.ts: máy khách và máy chủ cùng dùng, nên một chỗ nới lỏng ở
 * đây là nới ở cả hai đầu.
 */
import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import {
  CO_TEP_TOI_DA,
  LOAI_TEP_DINH_KEM,
  MAIL_DINH_KEM_ACCEPT,
  SO_TEP_TOI_DA,
  TONG_DUNG_LUONG_TOI_DA,
  dinhDangDungLuong,
  doiChieuTepTrongKho,
  docTepTuForm,
  duongDanTepMoi,
  dungDinhKemThu,
  kiemMotTep,
  kiemThemTep,
  laLoiThieuBang,
  laTepCuaNguoiTai,
  slugTenTep,
  tenTepAnToan
} from "@/lib/mail-dinh-kem-core";

const SEASON = "00000000-0000-4000-8000-0000000000aa";
const ACTOR = "00000000-0000-4000-8000-0000000000a1";
const OTHER = "00000000-0000-4000-8000-0000000000a2";
const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";
const MB = 1024 * 1024;

describe("loại tệp", () => {
  it.each(["Hướng dẫn.pdf", "Thư mời.docx", "ds.xlsx", "slide.PPTX", "lich.ics", "poster.jpg", "a.csv"])(
    "nhận %s",
    (name) => {
      expect(kiemMotTep({ name, size: 1000 }).ok).toBe(true);
    }
  );

  it.each(["setup.exe", "run.bat", "app.js", "cai.sh", "tai.ps1", "macro.docm", "bang.xlsm", "trang.html", "hinh.svg", "goi.jar"])(
    "chặn tệp chạy được %s và nói rõ lý do",
    (name) => {
      const checked = kiemMotTep({ name, size: 1000 });
      expect(checked.ok).toBe(false);
      if (!checked.ok) expect(checked.message).toContain("chạy được mã");
    }
  );

  it("chặn tệp mang hai đuôi mà đuôi cuối là tệp thực thi", () => {
    expect(kiemMotTep({ name: "bao-cao.pdf.exe", size: 1000 }).ok).toBe(false);
  });

  it("không nhận tệp nén, tệp không đuôi và loại lạ", () => {
    expect(kiemMotTep({ name: "goi.zip", size: 10 }).ok).toBe(false);
    expect(kiemMotTep({ name: "README", size: 10 }).ok).toBe(false);
    expect(kiemMotTep({ name: "nhac.mp3", size: 10 }).ok).toBe(false);
  });

  it("chuỗi accept của ô chọn tệp suy đúng từ danh sách nhận, không có loại chạy được", () => {
    expect(MAIL_DINH_KEM_ACCEPT.split(",").sort()).toEqual(Object.keys(LOAI_TEP_DINH_KEM).map((e) => `.${e}`).sort());
    expect(MAIL_DINH_KEM_ACCEPT).not.toMatch(/\.(exe|bat|js|sh|html|svg|zip|docm)\b/);
  });
});

describe("cỡ và số lượng", () => {
  it("chặn tệp rỗng và tệp vượt giới hạn", () => {
    expect(kiemMotTep({ name: "a.pdf", size: 0 }).ok).toBe(false);
    expect(kiemMotTep({ name: "a.pdf", size: CO_TEP_TOI_DA }).ok).toBe(true);
    const big = kiemMotTep({ name: "a.pdf", size: CO_TEP_TOI_DA + 1 });
    expect(big.ok).toBe(false);
    if (!big.ok) expect(big.message).toContain("10 MB");
  });

  it("bỏ riêng tệp làm vượt tổng dung lượng, giữ các tệp khác", () => {
    const { accepted, problems } = kiemThemTep([{ size: 6 * MB }], [
      { name: "lon.pdf", size: 5 * MB },
      { name: "nho.pdf", size: 1 * MB }
    ]);
    expect(accepted.map((f) => f.name)).toEqual(["nho.pdf"]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("lon.pdf");
    expect(6 * MB + 1 * MB).toBeLessThanOrEqual(TONG_DUNG_LUONG_TOI_DA);
  });

  it(`tối đa ${SO_TEP_TOI_DA} tệp một lá thư`, () => {
    const current = Array.from({ length: SO_TEP_TOI_DA - 1 }, () => ({ size: 10 }));
    const { accepted, problems } = kiemThemTep(current, [
      { name: "a.pdf", size: 10 },
      { name: "b.pdf", size: 10 }
    ]);
    expect(accepted.map((f) => f.name)).toEqual(["a.pdf"]);
    expect(problems[0]).toContain(`đủ ${SO_TEP_TOI_DA} tệp`);
  });

  it("định dạng dung lượng kiểu Việt Nam", () => {
    expect(dinhDangDungLuong(1.25 * MB)).toBe("1,3 MB");
    expect(dinhDangDungLuong(2048)).toBe("2 KB");
  });
});

describe("tên tệp", () => {
  it("bỏ đường dẫn và ký tự điều khiển, giữ đuôi khi cắt tên dài", () => {
    expect(tenTepAnToan("C:\\fakepath\\Thư mời.pdf")).toBe("Thư mời.pdf");
    expect(tenTepAnToan("a\u0000b\nc.pdf")).toBe("abc.pdf");
    const long = tenTepAnToan(`${"x".repeat(200)}.docx`);
    expect(long.length).toBe(120);
    expect(long.endsWith(".docx")).toBe(true);
  });

  it("khoá trong kho là ASCII, bỏ dấu tiếng Việt, đúng thư mục của người tải", () => {
    expect(slugTenTep("Hướng dẫn Vòng 2 – Đợt 1.pdf")).toBe("huong-dan-vong-2-dot-1");
    const path = duongDanTepMoi(SEASON, ACTOR, U1, "Hướng dẫn.pdf");
    expect(path).toBe(`${SEASON}/${ACTOR}/${U1}/huong-dan.pdf`);
    expect(laTepCuaNguoiTai(SEASON, ACTOR, path)).toBe(true);
    expect(laTepCuaNguoiTai(SEASON, OTHER, path)).toBe(false);
    expect(laTepCuaNguoiTai(SEASON, ACTOR, `${SEASON}/${ACTOR}/${U1}/../x.pdf`)).toBe(false);
    expect(laTepCuaNguoiTai(SEASON, ACTOR, `${SEASON}/${ACTOR}/${U1}/x.exe`)).toBe(false);
  });
});

describe("đọc danh sách tệp từ form", () => {
  const scope = { seasonId: SEASON, actorId: ACTOR };
  const p1 = `${SEASON}/${ACTOR}/${U1}/huong-dan.pdf`;
  const p2 = `${SEASON}/${ACTOR}/${U2}/thu-moi.docx`;

  it("ô trống hoặc thiếu là không đính kèm — hành vi cũ", () => {
    expect(docTepTuForm(null, scope)).toEqual({ ok: true, files: [] });
    expect(docTepTuForm("", scope)).toEqual({ ok: true, files: [] });
  });

  it("nhận đúng tệp của chính người bấm, giữ thứ tự", () => {
    const read = docTepTuForm(JSON.stringify([{ path: p1, name: "Hướng dẫn.pdf" }, { path: p2, name: "Thư mời.docx" }]), scope);
    expect(read).toEqual({
      ok: true,
      files: [
        { path: p1, name: "Hướng dẫn.pdf" },
        { path: p2, name: "Thư mời.docx" }
      ]
    });
  });

  it("từ chối tệp của người khác, trùng, đổi đuôi tên, JSON hỏng, quá số lượng", () => {
    const foreign = `${SEASON}/${OTHER}/${U1}/huong-dan.pdf`;
    expect(docTepTuForm(JSON.stringify([{ path: foreign, name: "a.pdf" }]), scope).ok).toBe(false);
    expect(docTepTuForm(JSON.stringify([{ path: p1, name: "a.pdf" }, { path: p1, name: "a.pdf" }]), scope).ok).toBe(false);
    expect(docTepTuForm(JSON.stringify([{ path: p1, name: "a.exe" }]), scope).ok).toBe(false);
    expect(docTepTuForm("{oops", scope).ok).toBe(false);
    const many = Array.from({ length: SO_TEP_TOI_DA + 1 }, () => ({ path: p1, name: "a.pdf" }));
    expect(docTepTuForm(JSON.stringify(many), scope).ok).toBe(false);
  });
});

describe("đối chiếu với tệp thật trong kho", () => {
  const p1 = `${SEASON}/${ACTOR}/${U1}/a.pdf`;
  const p2 = `${SEASON}/${ACTOR}/${U2}/b.png`;
  const refs = [
    { path: p1, name: "A.pdf" },
    { path: p2, name: "B.png" }
  ];

  it("dùng cỡ THẬT trong kho, không tin con số trình duyệt khai", () => {
    const ok = doiChieuTepTrongKho(refs, [
      { path: p1, size: 1000, mimetype: "application/pdf" },
      { path: p2, size: 2000, mimetype: "image/png" }
    ]);
    expect(ok).toEqual({
      ok: true,
      files: [
        { path: p1, name: "A.pdf", size: 1000, mime: "application/pdf" },
        { path: p2, name: "B.png", size: 2000, mime: "image/png" }
      ]
    });
    const tooBig = doiChieuTepTrongKho(refs, [
      { path: p1, size: 6 * MB, mimetype: "application/pdf" },
      { path: p2, size: 5 * MB, mimetype: "image/png" }
    ]);
    expect(tooBig.ok).toBe(false);
  });

  it("tệp chưa tải lên xong hoặc sai loại thì từ chối", () => {
    expect(doiChieuTepTrongKho(refs, [{ path: p1, size: 10, mimetype: "application/pdf" }]).ok).toBe(false);
    expect(
      doiChieuTepTrongKho([refs[0]], [{ path: p1, size: 10, mimetype: "application/x-msdownload" }]).ok
    ).toBe(false);
  });

  it("dựng đính kèm dạng URL cho nhà cung cấp", () => {
    expect(dungDinhKemThu([{ name: "A.pdf", mime: "application/pdf", url: "https://kho/a.pdf?token=t" }])).toEqual([
      { filename: "A.pdf", url: "https://kho/a.pdf?token=t", contentType: "application/pdf" }
    ]);
  });

  it("nhận ra lỗi thiếu bảng (migration chưa áp)", () => {
    expect(laLoiThieuBang({ code: "PGRST205", message: "Could not find the table 'public.email_attachments' in the schema cache" })).toBe(true);
    expect(laLoiThieuBang({ code: "42P01", message: "relation does not exist" })).toBe(true);
    expect(laLoiThieuBang({ code: "57014", message: "timeout" })).toBe(false);
    expect(laLoiThieuBang(null)).toBe(false);
  });
});

describe("migration khớp với mã", () => {
  const sql = readFileSync(join(__dirname, "../supabase/migrations/20261119120000_mail_dinh_kem.sql"), "utf8");

  it("kho riêng không công khai, giới hạn cỡ và đúng danh sách MIME của mã", () => {
    expect(sql).toMatch(/values \('mail-dinh-kem', 'mail-dinh-kem', false, 10485760, array\[/);
    expect(sql).toMatch(/on conflict \(id\) do update set public = false/);
    expect(sql).not.toMatch(/create policy/i);
    const block = sql.slice(sql.indexOf("array["), sql.indexOf("])"));
    const mimes = Array.from(block.matchAll(/'([^']+)'/g)).map((m) => m[1]).sort();
    expect(mimes).toEqual(Array.from(new Set(Object.values(LOAI_TEP_DINH_KEM))).sort());
    expect(CO_TEP_TOI_DA).toBe(10485760);
  });

  it("bảng mới bật RLS, thu quyền anon/authenticated, service_role chỉ đọc và thêm", () => {
    expect(sql).toContain("create table if not exists public.email_attachments");
    expect(sql).toContain("alter table public.email_attachments enable row level security;");
    expect(sql).toContain("revoke all on public.email_attachments from public, anon, authenticated, service_role;");
    expect(sql).toContain("grant select, insert on public.email_attachments to service_role;");
    expect(sql).toMatch(/references public\.email_batches\(id\) on delete cascade/);
  });
});
