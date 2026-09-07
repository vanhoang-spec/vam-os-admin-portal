/**
 * lib/cross-fields-core.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * The one list of fields a mentor can master and a mentee can ask about.
 *
 * Until now this list lived in TSX, twice, with drift between the copies: the
 * mentor form offers "Y tế / Dược / Chăm sóc sức khoẻ" where the mentee form
 * says "Y tế / Dược", the mentee list carries `undecided` and drops
 * `legal_compliance`. Nobody noticed because nothing ever compared them — the
 * answers went into a JSON blob and were never read back.
 *
 * Cross-mentoring reads them back. A mentee asking about `finance_banking` has
 * to reach the mentors who ticked `finance_banking`, so the two lists must be
 * the same list, and the codes must be the ones stored.
 *
 * Three rules:
 *
 * CODES ARE PERMANENT. A label can be reworded; a code appears in stored rows
 * and in the catalog table, so changing one orphans data.
 *
 * INDUSTRY AND FUNCTION ARE SEPARATE VOCABULARIES that happen to share two
 * codes (`other`, and on the mentee side `undecided`). A field reference
 * therefore carries which of the two it came from — `field_kind` — rather than
 * relying on the code alone.
 *
 * `undecided` IS NOT A FIELD. It is a valid answer on the mentee application
 * ("I don't know yet") but it can never be a cross-mentoring request: there is
 * no group of mentors who mastered not knowing.
 */

export const FIELD_KINDS = ["industry", "function"] as const;
export type FieldKind = (typeof FIELD_KINDS)[number];

export type FieldOption = {
  code: string;
  label: string;
  /** True for answers that are valid on an application but cannot be requested. */
  requestable: boolean;
};

/** Ngành nghề. Codes match what the mentor and mentee application forms already store. */
export const INDUSTRY_FIELDS: FieldOption[] = [
  { code: "fmcg", label: "FMCG / Bán lẻ", requestable: true },
  { code: "tech", label: "Công nghệ / Phần mềm", requestable: true },
  { code: "finance_banking", label: "Tài chính / Ngân hàng", requestable: true },
  { code: "consulting", label: "Tư vấn / Chiến lược", requestable: true },
  { code: "manufacturing", label: "Sản xuất / Công nghiệp", requestable: true },
  { code: "education", label: "Giáo dục / Đào tạo", requestable: true },
  { code: "healthcare", label: "Y tế / Dược / Chăm sóc sức khoẻ", requestable: true },
  { code: "media_creative", label: "Truyền thông / Sáng tạo", requestable: true },
  { code: "logistics", label: "Logistics / Vận chuyển", requestable: true },
  { code: "real_estate", label: "Bất động sản / Xây dựng", requestable: true },
  { code: "energy_environment", label: "Năng lượng / Môi trường", requestable: true },
  { code: "public_nonprofit", label: "Khu vực công / Phi lợi nhuận", requestable: true },
  // Kept because the mentee form already stores it; never a cross request.
  { code: "undecided", label: "Chưa xác định rõ", requestable: false },
  { code: "other", label: "Khác", requestable: false }
];

/** Chức năng / chuyên môn. */
export const FUNCTION_FIELDS: FieldOption[] = [
  { code: "marketing", label: "Marketing / Brand", requestable: true },
  { code: "sales_bd", label: "Sales / Business Development", requestable: true },
  { code: "finance_accounting", label: "Tài chính / Kế toán", requestable: true },
  { code: "hr_people", label: "Nhân sự / People", requestable: true },
  { code: "operations", label: "Vận hành / Operations", requestable: true },
  { code: "tech_engineering", label: "Tech / Engineering", requestable: true },
  { code: "data_analytics", label: "Data / Analytics", requestable: true },
  { code: "product", label: "Product Management", requestable: true },
  { code: "strategy_consulting", label: "Strategy / Consulting", requestable: true },
  { code: "supply_chain", label: "Supply Chain / Logistics", requestable: true },
  { code: "legal_compliance", label: "Pháp lý / Compliance", requestable: true },
  { code: "general_management", label: "Quản trị tổng hợp", requestable: true },
  { code: "undecided", label: "Chưa xác định rõ", requestable: false },
  { code: "other", label: "Khác", requestable: false }
];

/**
 * One field, named unambiguously.
 *
 * `finance_banking` (an industry) and `finance_accounting` (a function) are
 * different things, and `other` exists in both lists — so a code alone is not
 * an identifier.
 */
export type FieldRef = { kind: FieldKind; code: string };

export function fieldsFor(kind: FieldKind): FieldOption[] {
  return kind === "industry" ? INDUSTRY_FIELDS : FUNCTION_FIELDS;
}

/** Only the fields somebody may actually request a session about. */
export function requestableFields(kind: FieldKind): FieldOption[] {
  return fieldsFor(kind).filter((field) => field.requestable);
}

/** Every field, flattened, for a picker that shows both vocabularies at once. */
export function allFields(): Array<FieldRef & FieldOption> {
  return [
    ...INDUSTRY_FIELDS.map((field) => ({ ...field, kind: "industry" as const })),
    ...FUNCTION_FIELDS.map((field) => ({ ...field, kind: "function" as const }))
  ];
}

const INDUSTRY_BY_CODE = new Map(INDUSTRY_FIELDS.map((field) => [field.code, field]));
const FUNCTION_BY_CODE = new Map(FUNCTION_FIELDS.map((field) => [field.code, field]));

function lookup(kind: FieldKind, code: string): FieldOption | undefined {
  return (kind === "industry" ? INDUSTRY_BY_CODE : FUNCTION_BY_CODE).get(code);
}

/** True when the code belongs to that vocabulary. */
export function isKnownField(kind: unknown, code: unknown): boolean {
  const fieldKind = String(kind ?? "");
  if (!(FIELD_KINDS as readonly string[]).includes(fieldKind)) return false;
  return Boolean(lookup(fieldKind as FieldKind, String(code ?? "")));
}

/** True when a session may be requested about it. */
export function isRequestableField(kind: unknown, code: unknown): boolean {
  const fieldKind = String(kind ?? "");
  if (!(FIELD_KINDS as readonly string[]).includes(fieldKind)) return false;
  return lookup(fieldKind as FieldKind, String(code ?? ""))?.requestable === true;
}

/**
 * The Vietnamese label for a stored code.
 *
 * Falls back to the code itself rather than to a placeholder: an unrecognised
 * value on screen should look like the data problem it is, not like a blank.
 */
export function fieldLabel(kind: unknown, code: unknown): string {
  const raw = String(code ?? "").trim();
  if (!raw) return "";
  const fieldKind = String(kind ?? "");
  if (!(FIELD_KINDS as readonly string[]).includes(fieldKind)) return raw;
  return lookup(fieldKind as FieldKind, raw)?.label ?? raw;
}

/** "Ngành nghề" / "Chức năng", for a sentence that names which list a field came from. */
export function fieldKindLabel(kind: unknown): string {
  return String(kind ?? "") === "function" ? "Chức năng" : "Ngành nghề";
}

/**
 * Clean a set of ticked boxes.
 *
 * Unknown codes are dropped rather than stored — the list only grows by
 * deliberate edit here, so anything else arriving is either an old form or
 * somebody editing the request. Order follows the declaration above, so two
 * mentors who ticked the same boxes produce the same rows.
 */
export function normalizeFields(kind: FieldKind, values: unknown): string[] {
  const raw = Array.isArray(values) ? values : [values];
  const chosen = new Set(raw.map((value) => String(value ?? "").trim()).filter(Boolean));
  return fieldsFor(kind)
    .filter((field) => chosen.has(field.code))
    .map((field) => field.code);
}

/**
 * The mentor application's flat "secondary industries and functions" answer,
 * split back into the two vocabularies.
 *
 * That form offers one combined list of 26 checkboxes, so the stored array
 * mixes both. Splitting it is how an existing applicant's answer becomes
 * mentor field rows without asking them anything.
 */
export function splitCombinedFields(values: unknown): { industries: string[]; functions: string[] } {
  const raw = Array.isArray(values) ? values : [values];
  const chosen = new Set(raw.map((value) => String(value ?? "").trim()).filter(Boolean));

  return {
    // `other` and `undecided` are in both lists; they are not fields, so they
    // are dropped by the requestable filter rather than landing in both.
    industries: INDUSTRY_FIELDS.filter((f) => f.requestable && chosen.has(f.code)).map((f) => f.code),
    functions: FUNCTION_FIELDS.filter((f) => f.requestable && chosen.has(f.code)).map((f) => f.code)
  };
}

/**
 * Everything one mentor mastered, from their application answers.
 *
 * Used at approval time so a mentor who never opens the confirmation form still
 * has fields on file. The primary answers are single-select and always count;
 * the secondary answer is the combined list above.
 */
export function fieldsFromApplication(payload: {
  industry_primary?: unknown;
  function_primary?: unknown;
  secondary_industries_functions?: unknown;
}): { industries: string[]; functions: string[] } {
  const secondary = splitCombinedFields(payload?.secondary_industries_functions);

  const primaryIndustry = String(payload?.industry_primary ?? "").trim();
  const primaryFunction = String(payload?.function_primary ?? "").trim();

  const industries = new Set(secondary.industries);
  const functions = new Set(secondary.functions);

  if (isRequestableField("industry", primaryIndustry)) industries.add(primaryIndustry);
  if (isRequestableField("function", primaryFunction)) functions.add(primaryFunction);

  return {
    industries: INDUSTRY_FIELDS.filter((f) => industries.has(f.code)).map((f) => f.code),
    functions: FUNCTION_FIELDS.filter((f) => functions.has(f.code)).map((f) => f.code)
  };
}
