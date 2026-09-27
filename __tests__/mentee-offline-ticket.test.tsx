import {expect,it} from "vitest";
import {renderToStaticMarkup} from "react-dom/server";
import {createRequire} from "node:module";
import jsQR from "jsqr";
import {InterviewTicket} from "@/app/dat-ca/[token]/interview-ticket";
import {parseOfflineQr} from "@/lib/mentee-offline-core";
// pngjs is the PNG encoder shipped with qrcode; decode the ACTUAL downloadable image.
const {PNG}=createRequire(import.meta.url)("pngjs");
it("ảnh tải về quét được bằng cùng bộ đọc QR của Support",async()=>{
  const code="11111111-1111-4111-8111-111111111111";
  const html=renderToStaticMarkup(await InterviewTicket({code}));
  const encoded=/src="data:image\/png;base64,([^" ]+)"/.exec(html)?.[1];
  expect(encoded).toBeTruthy();
  const png=PNG.sync.read(Buffer.from(encoded!,"base64"));
  const decoded=jsQR(new Uint8ClampedArray(png.data),png.width,png.height);
  expect(decoded?.data).toBe(`VAM-PV:${code}`);
  expect(parseOfflineQr(decoded!.data)).toBe(code);
  expect(html).toContain('download="ve-phong-van-mentee.png"');
  expect(parseOfflineQr(`https://example.test/dat-ca/${code}`)).toBeNull();
});
it("thiếu mã thì báo lỗi, không tạo vé rỗng",async()=>{
  const html=renderToStaticMarkup(await InterviewTicket({code:""}));
  expect(html).toContain('role="alert"');expect(html).not.toContain("data:image");
});
