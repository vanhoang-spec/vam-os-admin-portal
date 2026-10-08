/**
 * Gộp tên công ty tự khai (báo cáo tuyển mentor, BTC 08/10/2026).
 *
 * Điều phải đúng: các cách viết của một nơi về một khoá (MB = Quân Đội, ACB = Á Châu
 * khi là ngân hàng); tên dễ trùng không gộp nhầm ("Thực phẩm Á Châu" không phải ACB,
 * "Sài Gòn Công Thương" không phải VietinBank); chữ quốc gia đứng đầu tên được giữ;
 * tự do / nghỉ hưu không thành một "công ty". Khoá trên toàn bộ tên thật của mùa 12.
 */
import { describe, expect, it } from "vitest";
import { companyKeyOf } from "@/lib/company-name-core";
import { S12_MENTOR_COMPANIES } from "./fixtures/mentor-companies-s12";

const key = (name: string) => {
  const k = companyKeyOf(name);
  return k.kind === "company" ? k.key : k.kind;
};

describe("gộp các cách viết của một nơi", () => {
  it.each([
    ["MB Bank", ["MBBank - Chi nhánh Phú Nhuận", "Ngân hàng Quân Đội (MB Bank)", "Ngân Hàng TMCP Quân Đội - CN Quận 1 - Phòng Giao Dịch Tân Mỹ", "NH TMCP Quân Đội"]],
    ["ACB", ["Ngân hàng Á Châu", "Ngân hàng ACB", "Ngân hàng TMCP á châu ACB", "NH TMCP Á Châu"]],
    ["Manulife", ["Công ty BHNT Manulife", "Công ty Manulife VN", "Công Ty TNHH Manulife Việt Nam", "Manlife VN", "Manulife Vietnam Co.,Ltd"]],
    ["FWD", ["Công ty TNHH Bảo hiểm FWD Việt Nam", "Cty FWD Vietnam", "FWD Vietnam (Life Insurance)"]],
    ["Techcombank", ["Ngân hàng TMCP Kỹ Thương Việt Nam"]],
    ["TTC (Thành Thành Công)", ["Công ty cổ phần thành thành công biên hoà", "CTCP Thành Thành Công Biên Hòa (HSX: SBT)"]],
    ["Saigon Co.op", ["Liên hiệp Hợp tác xã Thương mại TP.HCM (Saigon Co.op)"]],
    ["BVBank", ["Ngân Hàng TMCP Bản Việt", "Timo Digital Bank by BVBank"]],
    ["Dai-ichi Life", ["Công Ty BHNT Dai-Ichi Việt Nam", "Dai-Ichi-Life Việt Nam"]]
  ])("%s", (brand, spellings) => {
    for (const s of spellings) expect(companyKeyOf(s)).toEqual({ kind: "company", key: `brand:${brand}`, brand });
  });

  it("tên không phải thương hiệu đã biết: bỏ phần pháp lý / quốc gia / chi nhánh rồi so", () => {
    expect(key("Expeditors Việt Nam")).toBe(key("Expeditors Vietnam Co.,Ltd"));
    expect(key("CTY TNHH PEROMA VIỆT NAM")).toBe(key("Peroma group"));
    expect(key("Hygge F&B Services Co., Ltd.")).toBe("name:hygge f&b services");
    expect(key("Cathay United Bank - HCMC Branch")).toBe("name:cathay united bank hcmc");
  });
});

describe("không gộp nhầm", () => {
  it("“Á Châu” không phải ngân hàng thì không phải ACB", () => {
    expect(key("Công ty cổ phần thực phẩm Á Châu")).toBe("name:thuc pham a chau");
    expect(key("Công Ty TNHH CoachPro Á Châu")).toBe("name:coachpro a chau");
  });

  it("Sài Gòn Công Thương (SaigonBank) khác VietinBank", () => {
    expect(key("Ngân hàng TMCP Sài Gòn Công thương")).toBe("brand:SaigonBank");
    expect(key("Ngân hàng VietinBank")).toBe("brand:VietinBank");
    expect(key("Viettinbank")).toBe("brand:VietinBank");
  });

  it("chữ quốc gia đứng đầu tên được giữ", () => {
    expect(key("Vietnam Airlines")).toBe("name:vietnam airlines");
    expect(key("VN Solutions")).toBe("name:vn solutions");
    expect(key("Nestle Vietnam")).toBe("brand:Nestlé");
  });
});

describe("không phải một nơi làm việc", () => {
  it.each(["Freelancer", "Tự do", "Tư vấn tự do", "Đã nghỉ hưu", "Self Employed", "Gap Year", "Không có", "{nhiều công ty, không tiện giới thiệu}"])(
    "%s → tự do / nghỉ hưu",
    (name) => {
      expect(companyKeyOf(name)).toEqual({ kind: "independent" });
    }
  );

  it("bỏ trống / N/A → không khai", () => {
    for (const name of ["", "   ", "N/A", "NA", null]) expect(companyKeyOf(name)).toEqual({ kind: "none" });
  });
});

describe("toàn bộ tên thật mùa 12", () => {
  it("523 cách viết → 459 nơi làm việc, 12 tự do / nghỉ hưu, 2 không khai", () => {
    const kinds: Record<string, number> = {};
    const keys = new Set<string>();
    for (const c of S12_MENTOR_COMPANIES) {
      const k = companyKeyOf(c);
      kinds[k.kind] = (kinds[k.kind] ?? 0) + 1;
      if (k.kind === "company") keys.add(k.key);
    }
    expect(S12_MENTOR_COMPANIES).toHaveLength(523);
    expect(kinds).toEqual({ company: 509, independent: 12, none: 2 });
    expect(keys.size).toBe(459);
  });
});
