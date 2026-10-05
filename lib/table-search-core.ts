/**
 * Tìm kiếm trong bảng dữ liệu (BTC 05/10/2026): một ô, gõ tới đâu lọc tới đó, theo
 * BẤT KỲ thông tin nào đang hiện trên dòng — tên, email, SĐT, mã, trạng thái, đợt.
 *
 * Phần thuần, không đụng DOM: components/table-search.tsx lấy chữ của từng dòng rồi
 * hỏi ở đây. Chuẩn hoá dùng chung normalizeSearchText của bộ chọn mentor gia hạn —
 * hai cách bỏ dấu là hai cơ hội để một ô tìm ra mà ô kia không.
 */
import { normalizeSearchText } from "@/lib/renewal-search";

/**
 * Các từ của câu tìm: bỏ dấu, chữ thường, tách ở khoảng trắng và dấu câu.
 * "Nguyễn  Danh" → ["nguyen", "danh"]; "ntdanhvn@gmail" → ["ntdanhvn", "gmail"].
 */
export function tableSearchTerms(query: string): string[] {
  return normalizeSearchText(query).split(" ").filter(Boolean);
}

export type PreparedRowText = {
  /** Chữ của dòng đã chuẩn hoá, các phần cách nhau một khoảng trắng. */
  normal: string;
  /** Cùng chữ đó bỏ hết khoảng trắng: "0912 345 678" thành "0912345678". */
  compact: string;
};

export function prepareRowText(text: string): PreparedRowText {
  const normal = normalizeSearchText(text);
  return { normal, compact: normal.replace(/ /g, "") };
}

/**
 * Dòng khớp khi chứa ĐỦ mọi từ, ở bất kỳ cột nào. Đủ chứ không phải một: bảng vài
 * trăm người, một họ phổ biến trả về quá nhiều — người gõ thêm chữ thứ hai là để
 * thu hẹp. Câu tìm rỗng khớp mọi dòng.
 *
 * Từ có chữ số còn được so với bản dính liền, để SĐT hay mã gõ liền tìm ra chỗ
 * đang hiện có khoảng trắng hoặc gạch nối. Chỉ từ có chữ số: chữ thường mà so
 * dính liền thì "anhb" khớp nhầm "Danh B1" qua ranh giới hai cột.
 */
export function rowMatchesTerms(row: PreparedRowText, terms: readonly string[]): boolean {
  return terms.every((term) => row.normal.includes(term) || (/[0-9]/.test(term) && row.compact.includes(term)));
}

export type TableQuery = {
  terms: string[];
  /** Câu tìm trông như SĐT: các dạng chữ số cần thử ("+84 901…" và "0901…"). */
  phoneDigits: string[] | null;
};

/**
 * Đọc câu tìm một lần cho cả bảng. Câu chỉ gồm chữ số, khoảng trắng, + . - ( ) và
 * có từ 3 chữ số trở lên được hiểu thêm như SĐT: so liền một khối, và +84 với 0 đầu
 * là một. Không có bước này thì "+84 901 234 567" tách thành "84", "901", … và
 * không tìm ra "0901234567" — trang PV mentee offline đã tìm được kiểu này từ trước.
 */
export function parseTableQuery(query: string): TableQuery {
  const terms = tableSearchTerms(query);
  const digits = query.replace(/\D/g, "");
  if (!/^[+\d\s().-]+$/.test(query.trim()) || digits.length < 3) return { terms, phoneDigits: null };
  const variants = new Set([digits]);
  if (digits.startsWith("84")) variants.add(`0${digits.slice(2)}`);
  if (digits.startsWith("0")) variants.add(`84${digits.slice(1)}`);
  return { terms, phoneDigits: Array.from(variants) };
}

export function rowMatchesQuery(row: PreparedRowText, query: TableQuery): boolean {
  if (query.phoneDigits?.some((digits) => row.compact.includes(digits))) return true;
  return rowMatchesTerms(row, query.terms);
}

function searchableText(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (Array.isArray(value)) return value.map(searchableText).join(" ");
  return "";
}

/**
 * Cùng phép khớp, cho bảng lọc trên dữ liệu thay vì trên DOM (bảng có phân trang
 * phía trình duyệt: dòng ở trang 2 không có trong DOM để TableSearch đọc).
 * Nhận chuỗi, số, mảng chuỗi; giá trị khác bỏ qua.
 */
export function matchesTableQuery(values: readonly unknown[], query: string): boolean {
  const parsed = parseTableQuery(query);
  if (!parsed.terms.length) return true;
  return rowMatchesQuery(prepareRowText(values.map(searchableText).join(" ")), parsed);
}
