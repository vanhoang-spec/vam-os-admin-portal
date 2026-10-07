/**
 * Ghép cặp Vòng 2 — 9 nhóm ngành và bộ từ khoá nhận diện (BTC 07/10/2026).
 *
 * Phần thuần, không I/O. Mọi chỗ cần biết "chữ này thuộc nhóm nào" đi qua đây.
 *
 * Vì sao không so khớp trên chữ đã bỏ dấu cho mọi từ: tiếng Việt bỏ dấu đụng nhau. "ai"
 * (trí tuệ nhân tạo) trùng "ai" (đại từ), "kho" (kho vận) trùng "khó", "quỹ" trùng "quy
 * trình", "thuế" trùng "thuê", "công chứng" trùng "công chúng". Mỗi từ khoá vì thế mang
 * một chế độ:
 *   - folded:  chữ thường, bỏ dấu, đ→d — cho cụm rõ nghĩa ("kế toán trưởng").
 *   - accent:  chữ thường, GIỮ dấu — cho từ dễ đụng ("kho", "quỹ", "thuế").
 *   - acronym: đúng chữ hoa như gõ — cho viết tắt ngắn ("AI", "IT", "BI", "SAP").
 *
 * Tách từ bằng cách duyệt từng ký tự, không dùng regex có gạch chéo ngược (CLAUDE.md:
 * công cụ ghi file trên máy này nuốt một lớp gạch chéo ngược mà mọi cổng vẫn xanh).
 */

export const INDUSTRY_GROUPS = [
  { code: 1, label: "Ngân hàng - Bảo hiểm" },
  { code: 2, label: "Kế toán - Kiểm toán" },
  { code: 3, label: "Tài chính - Đầu tư" },
  { code: 4, label: "Marketing - Kinh doanh" },
  { code: 5, label: "Logistics - Chuỗi cung ứng" },
  { code: 6, label: "Nhân sự" },
  { code: 7, label: "Luật" },
  { code: 8, label: "Công nghệ - Thống kê - HTTT" },
  { code: 9, label: "Khác" }
] as const;

export const OTHER_GROUP = 9;

export function industryGroupLabel(code: unknown): string {
  const n = Number(code);
  const group = INDUSTRY_GROUPS.find((g) => g.code === n);
  return group ? `${group.code}. ${group.label}` : "Chưa phân nhóm";
}

// Dải dấu kết hợp U+0300–U+036F dựng bằng mã số (CLAUDE.md, 14/09/2026).
const COMBINING_MARKS = new RegExp(`[${String.fromCharCode(0x300)}-${String.fromCharCode(0x36f)}]`, "g");

export type Token = {
  /** Đúng như gõ (NFC) — dùng cho viết tắt. */
  raw: string;
  /** Chữ thường, giữ dấu. */
  lower: string;
  /** Chữ thường, bỏ dấu, đ→d. */
  folded: string;
};

function fold(lower: string): string {
  return lower.normalize("NFD").replace(COMBINING_MARKS, "").split("đ").join("d").normalize("NFC");
}

function isTokenChar(ch: string): boolean {
  if (ch >= "0" && ch <= "9") return true;
  if (ch === "&") return true;
  // Chữ cái = ký tự có dạng hoa/thường khác nhau (gồm mọi chữ tiếng Việt dựng sẵn).
  return ch.toLowerCase() !== ch.toUpperCase();
}

/** Tách chữ thành token. Mọi ký tự không phải chữ/số/& là dấu ngăn. */
export function tokenize(text: unknown): Token[] {
  const source = String(text ?? "").normalize("NFC");
  const tokens: Token[] = [];
  let current = "";
  const push = () => {
    if (!current) return;
    const lower = current.toLowerCase();
    tokens.push({ raw: current, lower, folded: fold(lower) });
    current = "";
  };
  for (const ch of source) {
    if (isTokenChar(ch)) current += ch;
    else push();
  }
  push();
  return tokens;
}

type Mode = "folded" | "accent" | "acronym";

/** groups rỗng = cụm "chặn": nuốt các token để chúng không khớp từ khoá ngắn hơn. */
type KeywordSpec = readonly [phrase: string, groups: number | readonly number[], mode?: Mode];

const KEYWORDS: readonly KeywordSpec[] = [
  // ── 1 Ngân hàng - Bảo hiểm ─────────────────────────────────────────────────
  ["ngân hàng", 1],
  ["tài chính ngân hàng", 1],
  ["bank", 1],
  ["banking", 1],
  ["banker", 1],
  ["relationship manager", 1],
  ["quan hệ khách hàng", 1],
  ["tín dụng", 1, "accent"],
  ["credit", 1],
  ["thẩm định", 1],
  ["quản trị rủi ro", 1],
  ["quản lý rủi ro", 1],
  ["risk", 1],
  ["giám đốc chi nhánh", 1],
  ["branch manager", 1],
  ["phòng giao dịch", 1],
  ["giao dịch viên", 1],
  ["teller", 1],
  ["bảo hiểm", 1],
  ["insurance", 1],
  ["underwriter", 1],
  ["underwriting", 1],

  // ── 2 Kế toán - Kiểm toán ─────────────────────────────────────────────────
  ["kế toán", 2],
  ["kế toán trưởng", 2],
  ["kế toán tài chính", 2],
  ["accountant", 2],
  ["accounting", 2],
  ["chief accountant", 2],
  ["kiểm toán", 2],
  ["kiểm toán viên", 2],
  ["kiểm toán nội bộ", 2],
  ["auditor", 2],
  ["audit", 2],
  ["audit manager", 2],
  ["internal audit", 2],
  ["thuế", 2, "accent"],
  ["tax", 2],
  ["financial controller", 2],
  ["controller", 2],
  ["kiểm soát nội bộ", 2],
  ["ksnb", 2],
  ["internal control", 2],

  // ── 3 Tài chính - Đầu tư ──────────────────────────────────────────────────
  ["tài chính", 3],
  ["finance", 3],
  ["financial", 3],
  ["financial analyst", 3],
  ["phân tích tài chính", 3],
  ["fp&a", 3],
  ["corporate finance", 3],
  ["tài chính doanh nghiệp", 3],
  ["treasury", 3],
  ["kho bạc", 3, "accent"],
  // "Kinh doanh ngoại hối" ở ngân hàng là nghiệp vụ nguồn vốn, không phải bán hàng.
  ["nguồn vốn", 3],
  ["ngoại hối", 3],
  ["kinh doanh ngoại hối", 3],
  ["đầu tư", 3],
  ["investment", 3],
  ["investor", 3],
  ["quỹ", 3, "accent"],
  ["fund", 3],
  ["private equity", 3],
  ["venture capital", 3],
  ["m&a", 3],
  ["investment banking", 3],
  ["ngân hàng đầu tư", 3],
  ["chứng khoán", 3],
  ["securities", 3],
  ["equity research", 3],
  ["quản lý tài sản", 3],
  ["quản lý danh mục", 3],
  ["asset management", 3],
  ["portfolio", 3],
  ["wealth management", 3],
  ["valuation", 3],
  ["định giá", 3],
  ["fintech", 3],
  ["cfo", 3],
  ["finance director", 3],
  ["finance manager", 3],
  ["giám đốc tài chính", 3],
  // "Tài chính - Kế toán" là một phòng gộp: chưa đủ để chọn giữa 2 và 3.
  ["tài chính kế toán", [2, 3]],
  ["finance & accounting", [2, 3]],
  ["finance and accounting", [2, 3]],
  ["accounting & finance", [2, 3]],

  // ── 4 Marketing - Kinh doanh ──────────────────────────────────────────────
  ["marketing", 4],
  ["marketting", 4],
  ["maketing", 4],
  ["brand", 4],
  ["branding", 4],
  ["thương hiệu", 4],
  ["digital marketing", 4],
  ["performance marketing", 4],
  ["trade marketing", 4],
  ["product marketing", 4],
  ["content", 4],
  ["PR", 4, "acronym"],
  ["quan hệ công chúng", 4, "accent"],
  ["truyền thông", 4],
  ["communication", 4],
  ["communications", 4],
  ["media", 4],
  ["advertising", 4],
  ["quảng cáo", 4],
  ["sales", 4],
  ["sale", 4],
  ["bán hàng", 4],
  ["kinh doanh", 4],
  ["giám đốc kinh doanh", 4],
  ["phát triển kinh doanh", 4],
  ["phát triển kd", 4],
  ["market research", 4],
  ["nghiên cứu thị trường", 4],
  ["customer experience", 4],
  ["cgo", 4],
  ["giám đốc tăng trưởng", 4],
  ["key account", 4],
  ["business development", 4],
  ["BD", 4, "acronym"],
  ["account manager", 4],
  ["account executive", 4],
  ["e commerce", 4],
  ["ecommerce", 4],
  ["thương mại điện tử", 4],
  ["crm", 4],
  ["growth", 4],
  ["customer success", 4],
  ["chăm sóc khách hàng", 4],
  ["cmo", 4],

  // ── 5 Logistics - Chuỗi cung ứng ──────────────────────────────────────────
  ["supply chain", 5],
  ["chuỗi cung ứng", 5],
  ["logistics", 5],
  ["logistic", 5],
  ["procurement", 5],
  ["purchasing", 5],
  ["mua hàng", 5],
  ["thu mua", 5],
  ["sourcing", 5],
  ["demand planner", 5],
  ["supply planner", 5],
  ["demand planning", 5],
  ["s&op", 5],
  ["kho", 5, "accent"],
  ["kho vận", 5, "accent"],
  ["warehouse", 5],
  ["freight", 5],
  ["forwarding", 5],
  ["freight forwarding", 5],
  ["hải quan", 5],
  ["customs", 5],
  ["xuất nhập khẩu", 5],
  ["import export", 5],
  ["xnk", 5],
  ["ngoại thương", 5],
  ["fulfillment", 5],
  ["transportation", 5],
  ["vận tải", 5],
  ["vận chuyển", 5],

  // ── 6 Nhân sự ─────────────────────────────────────────────────────────────
  ["nhân sự", 6],
  ["nhân lực", 6],
  ["quản trị nhân lực", 6],
  ["human resources", 6],
  ["human resource", 6],
  ["HR", 6, "acronym"],
  ["HRM", 6, "acronym"],
  ["HRBP", 6, "acronym"],
  ["hr manager", 6],
  ["hr director", 6],
  ["chro", 6],
  ["chief human resources officer", 6],
  ["talent acquisition", 6],
  ["tuyển dụng", 6],
  ["recruitment", 6],
  ["recruiter", 6],
  ["headhunter", 6],
  ["headhunting", 6],
  ["learning & development", 6],
  ["learning and development", 6],
  ["l&d", 6],
  ["đào tạo", 6],
  ["compensation & benefits", 6],
  ["compensation and benefits", 6],
  ["c&b", 6],
  ["people", 6],

  // ── 7 Luật ────────────────────────────────────────────────────────────────
  ["luật", 7, "accent"],
  ["luật sư", 7, "accent"],
  ["luật kinh doanh", 7, "accent"],
  ["lawyer", 7],
  ["attorney", 7],
  ["counsel", 7],
  ["legal", 7],
  ["pháp chế", 7],
  ["pháp lý", 7],
  ["công chứng", 7, "accent"],
  ["công chứng viên", 7, "accent"],
  ["thẩm phán", 7],
  ["tuân thủ", 7],
  ["compliance", 7],

  // ── 8 Công nghệ - Thống kê - HTTT ─────────────────────────────────────────
  ["software", 8],
  ["phần mềm", 8],
  ["kỹ sư phần mềm", 8],
  ["developer", 8],
  ["lập trình", 8],
  ["data", 8],
  ["dữ liệu", 8],
  ["analytics", 8],
  ["AI", 8, "acronym"],
  ["ML", 8, "acronym"],
  ["artificial intelligence", 8],
  ["machine learning", 8],
  ["trí tuệ nhân tạo", 8],
  ["BI", 8, "acronym"],
  ["business intelligence", 8],
  ["thống kê", 8],
  ["toán kinh tế", 8],
  ["statistics", 8],
  ["statistical", 8],
  ["statistician", 8],
  ["QA", 8, "acronym"],
  ["tester", 8],
  ["devops", 8],
  ["IT", 8, "acronym"],
  ["công nghệ thông tin", 8],
  ["hệ thống thông tin", 8],
  ["information system", 8],
  ["information systems", 8],
  ["information technology", 8],
  ["erp", 8],
  ["SAP", 8, "acronym"],
  ["business analyst", 8],
  ["system analyst", 8],
  ["systems analyst", 8],
  ["BA", 8, "acronym"],
  ["an ninh mạng", 8],
  ["cyber security", 8],
  ["cybersecurity", 8],
  ["tech", 8],
  ["technology", 8],
  ["giám đốc công nghệ", 8],
  ["cto", 8],
  ["cio", 8],
  ["product manager", 8],
  ["product owner", 8],
  ["product", 8],

  // ── Cụm chặn: nuốt token để không khớp nhầm từ khoá ngắn bên trong ────────
  ["quản trị kinh doanh", []],
  ["kinh doanh quốc tế", []],
  ["công chúng", [], "accent"]
];

type CompiledKeyword = { phrase: string; tokens: string[]; groups: number[]; mode: Mode };

function tokenKey(token: Token, mode: Mode): string {
  return mode === "acronym" ? token.raw : mode === "accent" ? token.lower : token.folded;
}

// Từ khoá đi qua đúng đường tách từ với dữ liệu, nên một chuỗi nguồn lỡ ở dạng NFD vẫn
// khớp. Sắp dài trước: "kho bạc" phải thắng "kho", "ngân hàng đầu tư" thắng "ngân hàng".
const COMPILED: CompiledKeyword[] = KEYWORDS.map(([phrase, groups, mode = "folded"]) => ({
  phrase,
  mode,
  tokens: tokenize(phrase).map((t) => tokenKey(t, mode)),
  groups: (Array.isArray(groups) ? [...groups] : [groups as number]).sort((a, b) => a - b)
}))
  .filter((k) => k.tokens.length > 0)
  .sort((a, b) => b.tokens.length - a.tokens.length);

export type KeywordHit = { phrase: string; groups: number[] };
export type KeywordResult = { groups: number[]; hits: KeywordHit[] };

/**
 * Các nhóm mà một đoạn chữ gợi ra. Quét trái sang phải, tại mỗi vị trí lấy từ khoá DÀI
 * NHẤT khớp được rồi nhảy qua các token của nó — "kiểm toán nội bộ" tính một lần, "kho
 * bạc" không bị đọc thành "kho".
 */
export function keywordGroups(text: unknown): KeywordResult {
  const tokens = tokenize(text);
  const hits: KeywordHit[] = [];
  let i = 0;
  while (i < tokens.length) {
    let matched: CompiledKeyword | null = null;
    for (const keyword of COMPILED) {
      if (i + keyword.tokens.length > tokens.length) continue;
      let ok = true;
      for (let j = 0; j < keyword.tokens.length; j++) {
        if (tokenKey(tokens[i + j], keyword.mode) !== keyword.tokens[j]) {
          ok = false;
          break;
        }
      }
      if (ok) {
        matched = keyword;
        break;
      }
    }
    if (matched) {
      if (matched.groups.length) hits.push({ phrase: matched.phrase, groups: matched.groups });
      i += matched.tokens.length;
    } else {
      i += 1;
    }
  }
  const groups = Array.from(new Set(hits.flatMap((h) => h.groups))).sort((a, b) => a - b);
  return { groups, hits };
}
