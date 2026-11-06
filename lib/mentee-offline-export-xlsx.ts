import { EXPORT_GROUP_TITLES, type ExportGroup, type ExportTable } from "@/lib/mentee-offline-export-core";
import { columnLetter, groupSpans, groupedTableXlsx } from "@/lib/xlsx-grouped-table";

/**
 * XLSX thật cho bảng xuất mentee phỏng vấn trực tiếp (VAM00023). Cách dựng file nằm ở lib/xlsx-grouped-table.ts (dùng
 * chung với file xuất hồ sơ Mentor/Mentee, VAM00025); ở đây chỉ còn tên sheet, màu và thứ tự ba nhóm cột.
 *
 * Hai dòng đầu và hai cột đầu (mã hồ sơ, họ tên) được cố định khi cuộn.
 */

export { columnLetter, groupSpans };
export const XLSX_SHEET_NAME = "Mentee PV truc tiep";

/** Màu từng nhóm: đậm cho tiêu đề, nhạt cho nền dữ liệu. */
export const EXPORT_GROUP_COLORS: Record<ExportGroup, { header: string; tint: string }> = {
  profile: { header: "FF167C4B", tint: "FFEAF6EF" },
  screening: { header: "FF1D4ED8", tint: "FFEAF1FF" },
  interview: { header: "FFC2410C", tint: "FFFFF1E6" }
};
const GROUP_ORDER: ExportGroup[] = ["profile", "screening", "interview"];

export function menteeOfflineXlsx(table: ExportTable): Buffer {
  const groups = Object.fromEntries(
    GROUP_ORDER.map((group) => [group, { title: EXPORT_GROUP_TITLES[group], ...EXPORT_GROUP_COLORS[group] }])
  ) as Record<ExportGroup, { title: string; header: string; tint: string }>;
  return groupedTableXlsx(table, { sheetName: XLSX_SHEET_NAME, groupOrder: GROUP_ORDER, groups, frozenColumns: 2 });
}
