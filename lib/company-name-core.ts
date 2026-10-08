import { tokenize } from "@/lib/matching-round2-groups-core";

/**
 * Gộp tên công ty tự khai về một khoá, để đếm "công ty nào có nhiều mentor nhất"
 * (báo cáo tuyển mentor, BTC 08/10/2026).
 *
 * Mùa 12 có ~500 cách viết cho chừng 400 nơi làm việc: "MB Bank", "MBBank - Chi
 * nhánh Phú Nhuận", "NH TMCP Quân Đội", "Ngân hàng TMCP Quân Đội - CN Quận 1 - PGD
 * Tân Mỹ" là MỘT ngân hàng. Đếm theo chữ gõ thì không công ty nào quá 4 người.
 *
 * Hai lớp, theo thứ tự:
 *   1. BIỆT DANH cho các thương hiệu lớn mà tên pháp lý khác hẳn tên thường gọi
 *      (Quân Đội = MB, Kỹ Thương = Techcombank). Cụm khớp trên token đã bỏ dấu.
 *      Những tên dễ trùng ("á châu" — vừa là ACB vừa là "Thực phẩm Á Châu") chỉ
 *      khớp khi đi kèm chữ ngân hàng.
 *   2. Còn lại: bỏ phần pháp lý ("công ty", "TNHH", "cổ phần", "JSC"…), phần quốc
 *      gia ("Việt Nam", "Vietnam") và phần chi nhánh sau "chi nhánh / CN / PGD",
 *      rồi so phần còn lại.
 *
 * Người làm tự do / nghỉ hưu / không nêu công ty → `independent`: không xếp hạng
 * cùng công ty, vì "Freelancer" không phải một nơi có 4 mentor.
 */

export type CompanyKey = { kind: "company"; key: string; brand: string | null } | { kind: "independent" } | { kind: "none" };

/** [cụm bỏ dấu, tên hiển thị]. Cụm dài/đặc thù đặt trước: thử theo thứ tự, gặp là dừng. */
const BRANDS: ReadonlyArray<readonly [string, string]> = [
  ["sai gon cong thuong", "SaigonBank"],
  ["ngan hang cong thuong", "VietinBank"],
  ["vietinbank", "VietinBank"],
  ["viettinbank", "VietinBank"],
  ["quan doi", "MB Bank"],
  ["mbbank", "MB Bank"],
  ["mb bank", "MB Bank"],
  ["ky thuong", "Techcombank"],
  ["techcombank", "Techcombank"],
  ["ngan hang tmcp a chau", "ACB"],
  ["ngan hang a chau", "ACB"],
  ["nh tmcp a chau", "ACB"],
  ["acb", "ACB"],
  ["sai gon thuong tin", "Sacombank"],
  ["sacombank", "Sacombank"],
  ["dau tu va phat trien viet nam", "BIDV"],
  ["bidv", "BIDV"],
  ["ngoai thuong", "Vietcombank"],
  ["vietcombank", "Vietcombank"],
  ["ngan hang tmcp nam a", "Nam A Bank"],
  ["nam a bank", "Nam A Bank"],
  ["ngan hang tmcp an binh", "ABBank"],
  ["ngan hang an binh", "ABBank"],
  ["abbank", "ABBank"],
  ["ngan hang tmcp quoc te", "VIB"],
  ["vib", "VIB"],
  ["ban viet", "BVBank"],
  ["bvbank", "BVBank"],
  ["shb", "SHB"],
  ["hdbank", "HDBank"],
  ["ocb", "OCB"],
  ["seabank", "SeABank"],
  ["vietbank", "Vietbank"],
  ["hsbc", "HSBC"],
  ["manulife", "Manulife"],
  ["manlife", "Manulife"],
  ["fwd", "FWD"],
  ["aia", "AIA"],
  ["dai ichi", "Dai-ichi Life"],
  ["generali", "Generali"],
  ["prudential", "Prudential"],
  ["pvi", "Bảo hiểm PVI"],
  ["phu hung", "Phú Hưng Life"],
  ["shinhan life", "Shinhan Life"],
  ["pwc", "PwC"],
  ["deloitte", "Deloitte"],
  ["kpmg", "KPMG"],
  ["ernst & young", "EY"],
  ["ernst young", "EY"],
  ["unilever", "Unilever"],
  ["suntory pepsico", "Suntory PepsiCo"],
  ["heineken", "Heineken"],
  ["nestle", "Nestlé"],
  ["frieslandcampina", "FrieslandCampina"],
  ["friesland campina", "FrieslandCampina"],
  ["vinamilk", "Vinamilk"],
  ["masan", "Masan"],
  ["thanh thanh cong", "TTC (Thành Thành Công)"],
  ["saigon co op", "Saigon Co.op"],
  ["sai gon co op", "Saigon Co.op"],
  ["lien hiep hop tac xa thuong mai", "Saigon Co.op"],
  ["grab", "Grab"],
  ["fpt", "FPT"],
  ["pnj", "PNJ"],
  ["maersk", "Maersk"],
  ["expeditors", "Expeditors"],
  ["vingroup", "Vingroup"],
  ["antdemy", "Antdemy"],
  ["sol e&c", "SOL E&C"],
  ["astrazeneca", "AstraZeneca"],
  ["mega lifesciences", "Mega Lifesciences"],
  ["home credit", "Home Credit"]
];

/** Cụm cho biết người khai không gắn với một công ty. */
const INDEPENDENT: readonly string[] = [
  "freelancer",
  "freelance",
  "tu do",
  "tu van tu do",
  "self employed",
  "nghi huu",
  "da nghi huu",
  "huu tri",
  "khong co",
  "gap year",
  "dang gap",
  "dau tu doc lap",
  "nhieu cong ty"
];

/** Cụm pháp lý / quốc gia bỏ đi trước khi so (bỏ dấu). Dài trước. */
const NOISE: readonly string[] = [
  "mot thanh vien",
  "tong cong ty",
  "cong ty",
  "ngan hang tmcp",
  "nh tmcp",
  "co phan",
  "tap doan",
  "co ltd",
  "sdn bhd",
  "cty",
  "ctcp",
  "cp",
  "tnhh",
  "tnhhh",
  "mtv",
  "jsc",
  "ltd",
  "inc",
  "llc",
  "pte",
  "corp",
  "corporation",
  "company",
  "limited",
  "group",
  "holdings",
  "holding"
];

/**
 * Chữ quốc gia: bỏ khi đứng SAU tên ("Nestle Vietnam", "… Việt Nam"), giữ khi đứng đầu —
 * "Vietnam Airlines" bỏ chữ đầu là còn "Airlines", "VN Solutions" còn "Solutions".
 */
const COUNTRY: readonly string[] = ["viet nam", "vietnam", "vn"];

/** Sau các token này là tên chi nhánh / phòng giao dịch: cắt bỏ. */
const BRANCH_MARKERS: readonly string[] = ["chi nhanh", "cn", "pgd", "phong giao dich", "branch"];

function words(text: unknown): string[] {
  return tokenize(text).map((t) => t.folded);
}

function findPhrase(list: readonly string[], phrase: string): number {
  const target = phrase.split(" ");
  for (let i = 0; i + target.length <= list.length; i += 1) {
    if (target.every((w, k) => list[i + k] === w)) return i;
  }
  return -1;
}

export function companyKeyOf(company: unknown): CompanyKey {
  const all = words(company);
  if (!all.length) return { kind: "none" };
  const joined = all.join(" ");
  if (joined === "n a" || joined === "na" || joined === "khong") return { kind: "none" };

  for (const [phrase, brand] of BRANDS) {
    if (findPhrase(all, phrase) >= 0) return { kind: "company", key: `brand:${brand}`, brand };
  }
  if (INDEPENDENT.some((phrase) => findPhrase(all, phrase) >= 0)) return { kind: "independent" };

  let rest = all;
  for (const marker of BRANCH_MARKERS) {
    const at = findPhrase(rest, marker);
    // Chỉ cắt khi còn tên đứng trước: "CN Tân Sơn Nhất" đứng một mình vẫn giữ.
    if (at > 0) rest = rest.slice(0, at);
  }
  const noise = NOISE.map((n) => n.split(" ")).sort((a, b) => b.length - a.length);
  const kept: string[] = [];
  let i = 0;
  while (i < rest.length) {
    const hit = noise.find((n) => n.every((w, k) => rest[i + k] === w));
    if (hit) {
      i += hit.length;
      continue;
    }
    kept.push(rest[i]);
    i += 1;
  }
  const country = COUNTRY.map((c) => c.split(" "));
  const named: string[] = [];
  let j = 0;
  while (j < kept.length) {
    const hit = j > 0 ? country.find((c) => c.every((w, k) => kept[j + k] === w)) : undefined;
    if (hit) {
      j += hit.length;
      continue;
    }
    named.push(kept[j]);
    j += 1;
  }
  const key = (named.length ? named : rest).join(" ");
  return { kind: "company", key: `name:${key}`, brand: null };
}
