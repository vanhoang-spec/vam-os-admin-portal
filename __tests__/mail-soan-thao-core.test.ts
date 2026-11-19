/**
 * VAM00038 — thư có định dạng: lọc HTML ở máy chủ, rút bản chữ, kiểm mẫu thiết kế, điền ô vào HTML và
 * dựng thân thư cuối cùng. Module thuần: không database, không gửi thư.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  CHU_THAY_THU_CHI_CO_ANH,
  dungThanThuHtml,
  htmlSangChu,
  kiemMauThietKe,
  laMauThietKe,
  locHtmlThu
} from "@/lib/mail-soan-thao-core";
import { renderTemplate, renderTemplateHtml } from "@/lib/email-templates-core";
import { textToHtmlEmail } from "@/lib/email-core";
import { MAIL_ANH_MAX_WIDTH, duongDanAnhMoi, kiemAnhThu } from "@/lib/mail-anh-core";

const IMG = "https://kho.test/storage/v1/object/public/mail-anh/s/a.png";

const DESIGN = [
  '<h1 style="text-align: center">Thông báo {{mua}}</h1>',
  '<div data-vam-anh="" style="text-align:center;margin:0 0 12px"><img src="' + IMG + '" alt="Banner" width="900" data-align="center" style="width:900px;max-width:100%"></div>',
  '<p>Chào <strong>{{ten_nguoi_nhan}}</strong>, <span style="color: #c0392b; font-size: 18px; font-family: Arial, Helvetica, sans-serif">chữ màu</span></p>',
  "<ul><li><p>Một</p></li><li><p>Hai</p></li></ul>",
  '<table data-vam-khung="" role="presentation" width="100%"><tbody><tr><td data-mau-nen="#f1f7f4" bgcolor="#f1f7f4" style="background-color:#f1f7f4;padding:16px"><p>Trong khung</p></td></tr></tbody></table>',
  '<table style="width:100%;border-collapse:collapse"><tbody><tr><td data-vien="1" data-mau-nen="#ffeeaa" style="padding:8px;background-color:#ffeeaa;border:1px solid #cfd8d3"><p>Ô A</p></td><td style="padding:8px"><p>Ô B</p></td></tr></tbody></table>',
  '<p><a href="https://vam.test/su-kien?ma={{ma_thanh_vien}}">Xem sự kiện</a></p>'
].join("");

describe("locHtmlThu — chặn mọi thứ chạy được", () => {
  it("bỏ <script> cùng nội dung bên trong, và <style>, <iframe>, <svg>, <form>", () => {
    const out = locHtmlThu(
      '<p>Chào</p><script>alert(1)</script><style>p{color:red}</style><iframe src="https://x.test"></iframe><svg onload="alert(1)"><circle/></svg><form action="https://x.test"><input name="a"></form>'
    );
    expect(out).toBe("<p>Chào</p>");
    expect(out).not.toMatch(/alert|script|iframe|svg|form|input/i);
  });

  it("bỏ mọi thuộc tính on* (onerror, onclick, onload…)", () => {
    const out = locHtmlThu(`<p onclick="x()">a</p><img src="${IMG}" onerror="alert(1)"><a href="https://a.test" onmouseover="x()">b</a>`);
    expect(out).not.toMatch(/on(click|error|mouseover)/i);
    expect(out).toContain("<p>a</p>");
  });

  it("bỏ href javascript:, data:, vbscript: và đường dẫn tương đối", () => {
    for (const href of ["javascript:alert(1)", "JaVaScRiPt:alert(1)", " javascript:alert(1)", "data:text/html,x", "vbscript:x", "/duong-dan", "{{ma_thanh_vien}}", "//evil.test/x"]) {
      const out = locHtmlThu(`<p><a href="${href}">bấm</a></p>`);
      expect(out, href).toBe("<p><a>bấm</a></p>");
    }
  });

  it("giữ liên kết https / mailto, và luôn mở tab mới không lộ trang gốc", () => {
    expect(locHtmlThu('<p><a href="https://vam.test/a">x</a></p>')).toBe(
      '<p><a href="https://vam.test/a" target="_blank" rel="noopener noreferrer">x</a></p>'
    );
    expect(locHtmlThu('<p><a href="mailto:hello@vam.test">x</a></p>')).toContain('href="mailto:hello@vam.test"');
  });

  it("ảnh chỉ nhận https: bỏ ảnh http, data:, javascript: và ảnh không có src", () => {
    for (const src of ["http://kho.test/a.png", "data:image/png;base64,AAAA", "javascript:alert(1)", "", "/a.png"]) {
      expect(locHtmlThu(`<p>x</p><img src="${src}">`), src).toBe("<p>x</p>");
    }
    expect(locHtmlThu(`<img src="${IMG}" alt="a">`)).toContain(`src="${IMG}"`);
  });

  it("CSS chỉ giữ thuộc tính trong danh sách, giá trị đúng dạng", () => {
    const out = locHtmlThu(
      '<p style="color:#ff0000;position:fixed;background-image:url(javascript:alert(1));behavior:url(x.htc);font-size:expression(alert(1));width:100px">a</p>'
    );
    expect(out).toBe('<p style="color:#ff0000;width:100px">a</p>');
  });

  it("bỏ class và id (CSS của ứng dụng thư / trang quản trị không được chạm)", () => {
    expect(locHtmlThu('<p class="x" id="y">a</p>')).toBe("<p>a</p>");
  });

  it("giữ định dạng hợp lệ của trình thiết kế và kẹp bề rộng ảnh về khung 600px", () => {
    const out = locHtmlThu(DESIGN);
    expect(out).toContain('<h1 style="text-align:center">');
    expect(out).toContain("<strong>{{ten_nguoi_nhan}}</strong>");
    expect(out).toContain('style="color:#c0392b;font-size:18px;font-family:Arial, Helvetica, sans-serif"');
    expect(out).toContain(`width="${MAIL_ANH_MAX_WIDTH}"`);
    expect(out).toContain('data-align="center"');
    expect(out).toContain("data-vam-khung");
    expect(out).toContain('data-mau-nen="#ffeeaa"');
    expect(out).toContain("<ul><li><p>Một</p></li>");
    expect(out).toContain('href="https://vam.test/su-kien?ma={{ma_thanh_vien}}"');
  });
});

describe("htmlSangChu — bản chữ thuần của thư", () => {
  it("giữ đoạn, xuống dòng, danh sách và địa chỉ liên kết", () => {
    const text = htmlSangChu(
      locHtmlThu('<p>Chào <b>bạn</b>,</p><p>Dòng 1<br>Dòng 2</p><ul><li><p>Một</p></li><li><p>Hai</p></li></ul><p><a href="https://vam.test/a">Xem</a></p>')
    );
    expect(text).toBe("Chào bạn,\n\nDòng 1\nDòng 2\n\n- Một\n\n- Hai\n\nXem (https://vam.test/a)");
  });

  it("giải mã ký tự: &lt; &amp; &nbsp; ra đúng chữ", () => {
    expect(htmlSangChu("<p>a &lt; b &amp;&nbsp;c</p>")).toBe("a < b & c");
  });
});

describe("kiemMauThietKe", () => {
  const base = { kind: "general_announcement" as const, name: "Thư thiết kế", subject: "Thông báo {{mua}}" };

  it("trả HTML ĐÃ LỌC và bản chữ rút từ nó", () => {
    const result = kiemMauThietKe({ ...base, bodyHtml: `${DESIGN}<script>x()</script>` });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.bodyHtml).not.toContain("script");
    expect(result.body).toContain("Chào {{ten_nguoi_nhan}}");
    expect(result.body).toContain("Trong khung");
  });

  it("chặn ô điền lạ, kể cả ô chỉ nằm trong href", () => {
    const result = kiemMauThietKe({ ...base, bodyHtml: '<p><a href="https://vam.test/?x={{so_dien_thoai}}">Link</a></p>' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("{{so_dien_thoai}}");
  });

  it("chặn ô điền bị định dạng cắt ngang", () => {
    const result = kiemMauThietKe({ ...base, bodyHtml: "<p>Chào {{ten_<strong>nguoi</strong>_nhan}}</p>" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("cắt ngang");
  });

  it("chặn thư rỗng (kể cả thư chỉ còn thẻ rỗng sau khi lọc)", () => {
    expect(kiemMauThietKe({ ...base, bodyHtml: "<p></p><script>x</script>" }).ok).toBe(false);
  });

  it("thư chỉ có ảnh vẫn lưu được, phần chữ thuần mang lời nhắc mở HTML", () => {
    const result = kiemMauThietKe({ ...base, bodyHtml: `<img src="${IMG}">` });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.body).toBe(CHU_THAY_THU_CHI_CO_ANH);
  });

  it("chữ có dấu < > (vd 'điểm < 5') không bị coi là thẻ HTML", () => {
    const result = kiemMauThietKe({ ...base, bodyHtml: "<p>Chào {{ten_nguoi_nhan}}, điểm &lt; 5</p>" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.body).toContain("điểm ‹ 5");
      expect(result.bodyHtml).toContain("điểm &lt; 5");
    }
  });

  it("kiểm tên / tiêu đề bằng đúng luật của mẫu chữ thuần", () => {
    expect(kiemMauThietKe({ ...base, name: " ", bodyHtml: "<p>a</p>" }).ok).toBe(false);
    expect(kiemMauThietKe({ ...base, subject: "<b>x</b>", bodyHtml: "<p>a</p>" }).ok).toBe(false);
  });
});

describe("renderTemplateHtml — mail merge trong HTML", () => {
  const html = locHtmlThu(DESIGN);
  const values = (name: string, code = "UEHR0012") => ({ ten_nguoi_nhan: name, mua: "UEHM-S12", vai_tro: "mentee", ma_thanh_vien: code, xung_ho: "" });

  it("thay đúng từng người nhận", () => {
    const a = renderTemplateHtml({ kind: "general_announcement", html, values: values("Nguyễn Văn A", "UEHR0001") });
    const b = renderTemplateHtml({ kind: "general_announcement", html, values: values("Trần Thị B", "UEHR0002") });
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.html).toContain("<strong>Nguyễn Văn A</strong>");
    expect(a.html).toContain("ma=UEHR0001");
    expect(a.html).not.toContain("Trần Thị B");
    expect(b.html).toContain("<strong>Trần Thị B</strong>");
    expect(b.html).toContain("ma=UEHR0002");
    expect(a.html).not.toMatch(/\{\{/);
  });

  it("escape giá trị: tên chứa thẻ / dấu nháy tới hộp thư dưới dạng chữ", () => {
    const evil = '<img src=x onerror="alert(1)">';
    const result = renderTemplateHtml({ kind: "general_announcement", html, values: values(evil, '" onmouseover="x') });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.html).not.toContain("<img src=x");
    expect(result.html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    // Ô trong thuộc tính href không thoát được khỏi dấu nháy.
    expect(result.html).toContain("ma=&quot; onmouseover=&quot;x");
    // Và lượt lọc cuối không biến chữ đã escape trở lại thành thẻ.
    const sent = dungThanThuHtml(result.html);
    expect(sent).not.toMatch(/<img src=x|<a [^>]*onmouseover/);
    expect(sent).toContain("&lt;img src=x");
    // href có dấu nháy / khoảng trắng sau khi điền thì không còn là địa chỉ hợp lệ: liên kết bị bỏ.
    expect(sent).toContain('<a style="color:#16834c;text-decoration:underline">Xem sự kiện</a>');
  });

  it("thiếu giá trị thì chặn bức thư; ô được phép rỗng thì xoá gọn", () => {
    const missing = renderTemplateHtml({ kind: "general_announcement", html, values: { mua: "UEHM-S12" } });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.missing).toContain("ten_nguoi_nhan");

    const blank = renderTemplateHtml({
      kind: "general_announcement",
      html: "<p>Kính gửi {{xung_ho}} {{ten_nguoi_nhan}},</p>",
      values: { ten_nguoi_nhan: "Nam", xung_ho: "" }
    });
    expect(blank).toEqual({ ok: true, html: "<p>Kính gửi Nam,</p>" });
  });
});

describe("dungThanThuHtml — thân thư gửi đi", () => {
  const merged = renderTemplateHtml({
    kind: "general_announcement",
    html: locHtmlThu(DESIGN),
    values: { ten_nguoi_nhan: "Nguyễn Văn A", mua: "UEHM-S12", ma_thanh_vien: "UEHR0012" }
  });
  const html = merged.ok ? dungThanThuHtml(merged.html) : "";

  it("bố cục bảng rộng tối đa 600px, có bảng 600px riêng cho Outlook, kèm chữ ký", () => {
    expect(html).toContain("max-width:600px");
    expect(html).toContain('<!--[if mso]><table role="presentation" width="600"');
    expect(html).toContain("Ban tổ chức UEH Mentoring");
  });

  it("ảnh mang width (Outlook) và style co giãn (điện thoại); căn giữa bằng khối bọc", () => {
    expect(html).toMatch(new RegExp(`<img src="${IMG.replace(/[.?/]/g, "\\$&")}" alt="Banner" width="${MAIL_ANH_MAX_WIDTH}" style="[^"]*max-width:100%;height:auto[^"]*width:${MAIL_ANH_MAX_WIDTH}px"`));
    expect(html).not.toContain("900px");
    expect(html).toContain('<div style="text-align:center;margin:0 0 12px">');
  });

  it("ô bảng và khung có bgcolor cho Outlook; bảng có cellpadding / role presentation", () => {
    expect(html).toContain('bgcolor="#ffeeaa"');
    expect(html).toContain('bgcolor="#f1f7f4"');
    expect(html).toMatch(/<table style="[^"]*" role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"/);
    expect(html).toMatch(/<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate/);
  });

  it("đoạn văn, tiêu đề, liên kết mang style inline (Gmail bỏ khối <style>)", () => {
    expect(html).toContain('<p style="margin:0 0 12px">');
    expect(html).toMatch(/<h1 style="margin:0 0 12px;font-size:26px;[^"]*text-align:center">/);
    expect(html).toContain('style="color:#16834c;text-decoration:underline"');
  });

  it("không còn thuộc tính data-* nào (chỉ dành cho trình soạn)", () => {
    expect(html).not.toMatch(/data-(vam|mau|vien|align)/);
  });

  it("lọc lần cuối kể cả khi HTML đưa vào chưa qua lượt lọc lưu trữ", () => {
    const out = dungThanThuHtml('<p onclick="x">a</p><script>alert(1)</script><a href="javascript:x">b</a>');
    expect(out).not.toMatch(/onclick|<script|javascript:/);
  });
});

describe("thư chữ thuần cũ giữ nguyên", () => {
  it("laMauThietKe chỉ đúng khi có HTML thật", () => {
    expect(laMauThietKe(null)).toBe(false);
    expect(laMauThietKe(undefined)).toBe(false);
    expect(laMauThietKe("  ")).toBe(false);
    expect(laMauThietKe("<p>a</p>")).toBe(true);
  });

  it("renderTemplate và textToHtmlEmail của mẫu chữ thuần ra đúng như trước", () => {
    const filled = renderTemplate({
      kind: "general_announcement",
      subject: "Thông báo {{mua}}",
      body: "Chào {{ten_nguoi_nhan}},\n\nXem https://vam.test/a.",
      values: { ten_nguoi_nhan: "A <b>", mua: "S12" }
    });
    expect(filled).toEqual({ ok: true, subject: "Thông báo S12", body: "Chào A <b>,\n\nXem https://vam.test/a." });
    if (!filled.ok) return;
    expect(textToHtmlEmail(filled.body)).toContain(
      '<p>Chào A &lt;b&gt;,</p><p>Xem <a href="https://vam.test/a" style="color:#16834c">https://vam.test/a</a>.</p>'
    );
  });
});

describe("ảnh trong thư — luật kho mail-anh", () => {
  it("chỉ nhận png/jpeg/gif/webp, tối đa 3 MB; SVG bị từ chối", () => {
    expect(kiemAnhThu({ name: "a.png", size: 1000, mime: "image/png" }).ok).toBe(true);
    expect(kiemAnhThu({ name: "a.svg", size: 1000, mime: "image/svg+xml" }).ok).toBe(false);
    expect(kiemAnhThu({ name: "a.html", size: 1000, mime: "text/html" }).ok).toBe(false);
    expect(kiemAnhThu({ name: "a.png", size: 3 * 1024 * 1024 + 1, mime: "image/png" }).ok).toBe(false);
    expect(kiemAnhThu({ name: "a.png", size: 0, mime: "image/png" }).ok).toBe(false);
  });

  it("đường dẫn do máy chủ sinh, không mang tên tệp gốc", () => {
    const season = "00000000-0000-4000-8000-0000000000aa";
    const id = "11111111-1111-4111-8111-111111111111";
    expect(duongDanAnhMoi(season, id, "png")).toBe(`${season}/${id}.png`);
    expect(duongDanAnhMoi("../x", id, "png")).toBeNull();
    expect(duongDanAnhMoi(season, id, "svg")).toBeNull();
  });
});
