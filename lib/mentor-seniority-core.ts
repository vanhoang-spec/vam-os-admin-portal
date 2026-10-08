import { tokenize } from "@/lib/matching-round2-groups-core";

/**
 * Cấp bậc của mentor đọc từ chức danh tự khai (báo cáo tuyển mentor, BTC 08/10/2026).
 *
 * Chức danh là chữ tự do, trộn Việt – Anh, viết tắt, sai chính tả ("gám đốc", "gđ",
 * "pgđ", "manarger"). Luật dựng từ 397 chức danh thật của mùa 12:
 *
 *   - So từng CỤM từ trên token đã bỏ dấu, ưu tiên cụm dài nhất tại mỗi vị trí — để
 *     "phó tổng giám đốc" không bị đọc thành "tổng giám đốc", "trợ lý giám đốc" không
 *     thành "giám đốc", "chief accountant" không thành "chief".
 *   - Một chức danh có nhiều cụm ("Founder & Coach", "Phó chủ tịch kiêm Tổng giám đốc")
 *     lấy cấp CAO NHẤT.
 *   - Không khớp cụm nào → "Chưa xếp được": BTC thấy và tự đọc, không đoán.
 *
 * Kết quả kèm cụm đã khớp, để danh sách trên trang ghi được vì sao người này ở cấp đó.
 */

export const SENIORITY_LEVELS = [
  { key: "c_level", label: "Chủ tịch / CEO / Nhà sáng lập" },
  { key: "senior_director", label: "Phó TGĐ / VP / Giám đốc cấp cao" },
  { key: "director", label: "Giám đốc / Phó GĐ / Director / Head" },
  { key: "manager", label: "Trưởng phòng / Manager / Lead" },
  { key: "academic", label: "Giảng viên / Học thuật" },
  { key: "specialist", label: "Chuyên viên / Chuyên gia / Tư vấn" },
  { key: "independent", label: "Tự do / Nghỉ hưu / Nhà đầu tư" },
  { key: "unclassified", label: "Chưa xếp được" }
] as const;

export type SeniorityLevel = (typeof SENIORITY_LEVELS)[number]["key"];

export function seniorityLabel(level: SeniorityLevel): string {
  return SENIORITY_LEVELS.find((l) => l.key === level)?.label ?? level;
}

/** Thứ tự = độ cao: số nhỏ thắng khi một chức danh khớp nhiều cụm. */
const RANK = new Map<SeniorityLevel, number>(SENIORITY_LEVELS.map((l, i) => [l.key, i]));

/** null = cụm "chặn": nuốt token để chúng không khớp cụm ngắn hơn, không mang cấp nào. */
type Spec = readonly [phrase: string, level: SeniorityLevel | null];

const PHRASES: readonly Spec[] = [
  // ── Chặn / đổi nghĩa: phải dài hơn cụm mà chúng che ──────────────────────────
  ["tro ly tong giam doc", "specialist"],
  ["tro ly giam doc", "specialist"],
  ["tro ly gd", "specialist"],
  ["tro ly hoi dong quan tri", "specialist"],
  ["tro ly phu trach", "specialist"],
  ["tro ly", "specialist"],
  ["tu van quan ly", "specialist"],
  ["assistant manager", "manager"],
  ["assistant", "specialist"],
  ["chief accountant", "manager"],
  ["head teacher", "academic"],
  ["giang vien noi bo", "specialist"],
  ["client partner", null],
  ["business partner", null],
  ["insight partner", "specialist"],
  ["phong quan ly", null],
  ["country sales manager", "manager"],

  // ── Chủ tịch / CEO / Nhà sáng lập ─────────────────────────────────────────────
  ["ceo", "c_level"],
  ["c e o", "c_level"],
  ["cfo", "c_level"],
  ["coo", "c_level"],
  ["cmo", "c_level"],
  ["cto", "c_level"],
  ["cgo", "c_level"],
  ["cio", "c_level"],
  ["chro", "c_level"],
  ["chief", "c_level"],
  ["founder", "c_level"],
  ["chu tich", "c_level"],
  ["tong giam doc", "c_level"],
  ["chu doanh nghiep", "c_level"],
  ["chu so huu", "c_level"],
  ["owner", "c_level"],
  ["managing director", "c_level"],
  ["manager director", "c_level"],
  ["general director", "c_level"],
  ["country head", "c_level"],
  ["country manager", "c_level"],
  ["vien truong", "c_level"],
  ["thanh vien hoi dong quan tri", "c_level"],
  ["bod member", "c_level"],
  ["board member", "c_level"],
  ["partner", "c_level"],

  // ── Phó TGĐ / VP / Giám đốc cấp cao ──────────────────────────────────────────
  ["pho tong giam doc", "senior_director"],
  ["deputy general director", "senior_director"],
  ["deputy ceo", "senior_director"],
  ["pho chu tich", "senior_director"],
  ["pho ct", "senior_director"],
  ["vice president", "senior_director"],
  ["vp", "senior_director"],
  ["svp", "senior_director"],
  ["evp", "senior_director"],
  ["senior director", "senior_director"],
  ["sr director", "senior_director"],
  ["executive director", "senior_director"],
  ["giam doc cap cao", "senior_director"],
  ["giam doc cao cap", "senior_director"],
  ["giam doc khoi", "senior_director"],

  // ── Giám đốc / Director / Head ───────────────────────────────────────────────
  ["giam doc", "director"],
  ["gam doc", "director"],
  ["gd", "director"],
  ["pgd", "director"],
  ["director", "director"],
  ["hrd", "director"],
  ["head", "director"],
  ["general manager", "director"],
  ["principal", "director"],
  ["truong van phong dai dien", "director"],
  ["truong chi nhanh", "director"],
  ["chanh van phong", "director"],
  ["luat su dieu hanh", "director"],
  ["truong ban", "director"],

  // ── Trưởng phòng / Manager / Lead ────────────────────────────────────────────
  ["manager", "manager"],
  ["manarger", "manager"],
  ["hrm", "manager"],
  ["truong phong", "manager"],
  ["pho phong", "manager"],
  ["pho truong phong", "manager"],
  ["pho truong ban", "manager"],
  ["truong nhom", "manager"],
  ["truong bo phan", "manager"],
  ["tbp", "manager"],
  ["tp", "manager"],
  ["phu trach", "manager"],
  ["ke toan truong", "manager"],
  ["quan ly", "manager"],
  ["team leader", "manager"],
  ["teamleader", "manager"],
  ["team lead", "manager"],
  ["leader", "manager"],
  ["lead", "manager"],
  ["supervisor", "manager"],

  // ── Giảng viên / Học thuật ───────────────────────────────────────────────────
  ["giang vien", "academic"],
  ["lecturer", "academic"],
  ["professor", "academic"],
  ["giao su", "academic"],
  ["giao vien", "academic"],
  ["teacher", "academic"],
  ["researcher", "academic"],
  ["nghien cuu vien", "academic"],

  // ── Chuyên viên / Chuyên gia / Tư vấn ────────────────────────────────────────
  ["chuyen vien", "specialist"],
  ["chuyen gia", "specialist"],
  ["specialist", "specialist"],
  ["expert", "specialist"],
  ["executive", "specialist"],
  ["consultant", "specialist"],
  ["tu van", "specialist"],
  ["analyst", "specialist"],
  ["associate", "specialist"],
  ["officer", "specialist"],
  ["accountant", "specialist"],
  ["ke toan", "specialist"],
  ["auditor", "specialist"],
  ["nhan vien", "specialist"],
  ["senior", "specialist"],
  ["trainer", "specialist"],
  ["coach", "specialist"],
  ["advisor", "specialist"],
  ["co van", "specialist"],
  ["kiem tra vien", "specialist"],
  ["cong chuc", "specialist"],
  ["luat su", "specialist"],
  ["lawyer", "specialist"],
  ["engineer", "specialist"],
  ["ky su", "specialist"],
  ["marketer", "specialist"],
  ["strategist", "specialist"],
  ["controller", "specialist"],
  ["product owner", "specialist"],
  ["hrbp", "specialist"],
  ["intern", "specialist"],
  ["dien gia", "specialist"],

  // ── Tự do / Nghỉ hưu / Nhà đầu tư ────────────────────────────────────────────
  ["tu do", "independent"],
  ["freelancer", "independent"],
  ["freelance", "independent"],
  ["self employed", "independent"],
  ["huu tri", "independent"],
  ["nghi huu", "independent"],
  ["volunteer", "independent"],
  ["nha dau tu", "independent"],
  ["investor", "independent"],
  ["master candidate", "independent"]
];

type Compiled = { words: string[]; level: SeniorityLevel | null; phrase: string };

const COMPILED: Compiled[] = PHRASES.map(([phrase, level]) => ({ words: phrase.split(" "), level, phrase }))
  // Dài trước: tại mỗi vị trí, cụm dài nhất được thử đầu tiên.
  .sort((a, b) => b.words.length - a.words.length);

export type SeniorityResult = { level: SeniorityLevel; matched: string | null };

export function seniorityOf(title: unknown): SeniorityResult {
  const words = tokenize(title).map((t) => t.folded);
  if (!words.length) return { level: "unclassified", matched: null };
  let best: { level: SeniorityLevel; phrase: string } | null = null;
  let i = 0;
  while (i < words.length) {
    const hit = COMPILED.find((c) => c.words.every((w, k) => words[i + k] === w));
    if (!hit) {
      i += 1;
      continue;
    }
    if (hit.level && (!best || (RANK.get(hit.level) ?? 99) < (RANK.get(best.level) ?? 99))) {
      best = { level: hit.level, phrase: hit.phrase };
    }
    i += hit.words.length;
  }
  return best ? { level: best.level, matched: best.phrase } : { level: "unclassified", matched: null };
}
