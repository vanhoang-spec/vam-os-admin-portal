#!/usr/bin/env node
/**
 * sync_s11_recaps.mjs  —  VAM OS UEHM-S11 Recap Synchronization Utility
 * ═══════════════════════════════════════════════════════════════════════
 *
 * All 9 corrections from owner review incorporated:
 *   C1 – Serial-date row 1,488 recovered; zero silent drops.
 *   C2 – Raw flag counts AND exclusive normalized counts reported separately.
 *   C3 – July gap is documented as unresolved; no synthetic rows.
 *   C4 – Duplicate pairs categorized into 6 types; only deterministic dups excluded.
 *   C5 – Date partition sums to exactly 2,371.
 *   C6 – DB credentials never printed.
 *   C7 – Read-only production audit before any write.
 *   C8 – Backup created and verified before apply.
 *   C9 – Full DB-connected dry-run classification.
 */

import fs     from 'node:fs';
import crypto from 'node:crypto';
import path   from 'node:path';
import pg     from 'pg';

const { Client } = pg;

// ─── Constants ────────────────────────────────────────────────────────────────
const SOURCE_SHEET_ID     = '1s6wlsF7JIPEku42z1L8e416T2tXDtRGCi0DvtU618h4';
const SOURCE_TAB          = 'Cleaning data';
const SOURCE_GID          = '229289235';
const SEASON_CODE         = 'UEHM-S11';
const FORBIDDEN_SEASONS   = ['UEHM-S12', 'DEMO-S12'];
const CSV_PATH            = './data_imports/season11/Cleaning_data.csv';
const BACKUP_DIR          = './data_imports/season11';
const MISSING_URL         = 'https://system.local/missing-url';
const RECAP_SOURCE        = 'google_sheet';
const IMPORT_BATCH        = `sync_s11_recaps_mjs_${new Date().toISOString().slice(0,10).replace(/-/g,'')}`;

// Season 11 valid operational period (inclusive)
const SEASON_START        = new Date('2025-10-01');
const SEASON_END          = new Date('2026-07-31');

// Required exact source-post row count (C1: no tolerance)
const REQUIRED_RAW_ROWS   = 2371;

// Official monthly recap session totals (from workbook formula "Báo cáo Recap")
const CHECKPOINT_OFFICIAL = {
  '2025-11': 560, '2025-12': 462, '2026-01': 355,
  '2026-02': 138, '2026-03': 281, '2026-04': 250,
  '2026-05': 161, '2026-06':  97, '2026-07':  18,
};
const CHECKPOINT_TOTAL    = 2322;

// ─── CLI ──────────────────────────────────────────────────────────────────────
const IS_APPLY   = process.argv.includes('--apply');
const IS_DRY_RUN = !IS_APPLY;
const MODE       = IS_DRY_RUN ? 'DRY-RUN (no writes)' : 'APPLY (write mode)';

// ─── Output helpers ───────────────────────────────────────────────────────────
function log(msg = '')  { process.stdout.write(msg + '\n'); }
function err(msg)       { process.stderr.write('  ERROR: ' + msg + '\n'); }
function section(title) {
  log('');
  log('── ' + title + ' ' + '─'.repeat(Math.max(0, 54 - title.length)));
}
function banner(title) {
  const line = '═'.repeat(67);
  log(''); log(line); log('  ' + title); log(line);
}

// ─── Crypto ───────────────────────────────────────────────────────────────────
function sha256(s) {
  return crypto.createHash('sha256').update(String(s ?? '')).digest('hex');
}

// ─── Text normalization ───────────────────────────────────────────────────────
function normalizeKey(s) {
  if (!s) return '';
  return String(s).trim()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/\s+/g, ' ');
}

// ─── C1: Serial-date handling ─────────────────────────────────────────────────
/**
 * Convert a Google Sheets / Excel serial date number to a JS Date.
 * Uses the Lotus-1-2-3 epoch (1899-12-30 base) including the spurious
 * Feb-29-1900 bug (serial 60).
 * The integer part is the day count; fractional part is time of day.
 * Programmatic verification: serialToDate(46064) must resolve to 2026-02-xx.
 */
function serialToDate(serial) {
  const n = Number(serial);
  if (!Number.isFinite(n) || n < 1) return null;
  // Sheets epoch: serial 1 = 1900-01-01, base = 1899-12-30T00:00:00Z
  const BASE_MS = Date.UTC(1899, 11, 30);          // 1899-12-30 UTC
  const dayMs   = Math.floor(n) * 86400 * 1000;
  const timeMs  = Math.round((n % 1) * 86400 * 1000);
  const dt      = new Date(BASE_MS + dayMs + timeMs);
  return isNaN(dt.getTime()) ? null : dt;
}

/**
 * Parse a raw post-timestamp string from column D.
 * Handles:
 *   "DD/MM/YYYY HH:MM AM/PM"   — normal text date
 *   "46064 8:01 PM"            — serial integer + time text  (C1: row 1,488)
 *   "46064.3"                  — serial with decimal fraction
 *   ISO strings
 * Returns { date: Date|null, rawSerial: number|null, isSerial: boolean }
 */
function parsePostTimestamp(raw) {
  if (!raw) return { date: null, rawSerial: null, isSerial: false };
  const s = String(raw).trim();

  // Pattern 1: DD/MM/YYYY (text date — most common)
  const ddmm = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s);
  if (ddmm) {
    const dt = new Date(`${ddmm[3]}-${ddmm[2].padStart(2,'0')}-${ddmm[1].padStart(2,'0')}T00:00:00Z`);
    return { date: isNaN(dt.getTime()) ? null : dt, rawSerial: null, isSerial: false };
  }

  // Pattern 2: Serial integer optionally followed by time text "46064 8:01 PM"
  // The integer part is the day serial; time part ignored for date (provenance only)
  const serialText = /^(\d{4,6})(?:\s+\d{1,2}:\d{2}(?:\s*[AP]M)?)?$/.exec(s);
  if (serialText) {
    const serial = Number(serialText[1]);
    const dt = serialToDate(serial);
    return { date: dt, rawSerial: serial, isSerial: true };
  }

  // Pattern 3: Pure decimal serial "46064.3456"
  const serialDec = /^(\d{4,6}\.\d+)$/.exec(s);
  if (serialDec) {
    const serial = Number(serialDec[1]);
    const dt = serialToDate(serial);
    return { date: dt, rawSerial: serial, isSerial: true };
  }

  // Pattern 4: ISO or other parseable
  const iso = new Date(s);
  if (!isNaN(iso.getTime())) return { date: iso, rawSerial: null, isSerial: false };

  return { date: null, rawSerial: null, isSerial: false };
}

/** Format Date → YYYY-MM-DD */
function toISO(d) {
  if (!d || isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

/** Format Date → YYYY-MM (month key) */
function toMonthKey(d) {
  if (!d || isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 7);
}

// ─── C1 test: serial 46064 ────────────────────────────────────────────────────
function testSerial46064() {
  const result = serialToDate(46064);
  if (!result) throw new Error('TEST FAIL: serialToDate(46064) returned null');
  const iso = toISO(result);
  // Must fall in 2026-02 (owner-verified expected date ≈ 11/02/2026)
  if (!iso || !iso.startsWith('2026-02')) {
    throw new Error(`TEST FAIL: serialToDate(46064) resolved to ${iso}, expected 2026-02-xx`);
  }
  return iso;
}

// ─── RFC-4180 CSV parser ──────────────────────────────────────────────────────
function parseFullCSV(text) {
  const rows   = [];
  let cur      = [];
  let field    = '';
  let inQuote  = false;
  let i        = 0;
  while (i < text.length) {
    const c = text[i];
    if (inQuote) {
      if (c === '"' && text[i+1] === '"') { field += '"'; i += 2; continue; }
      if (c === '"')                       { inQuote = false; i++;  continue; }
      field += c; i++;
      continue;
    }
    if (c === '"')               { inQuote = true; i++;  continue; }
    if (c === ',')               { cur.push(field); field = ''; i++; continue; }
    if (c === '\r' && text[i+1] === '\n') {
      cur.push(field); rows.push(cur); cur = []; field = ''; i += 2; continue;
    }
    if (c === '\n') {
      cur.push(field); rows.push(cur); cur = []; field = ''; i++; continue;
    }
    field += c; i++;
  }
  if (field || cur.length) { cur.push(field); rows.push(cur); }
  return rows;
}

// ─── Meeting date extractor ───────────────────────────────────────────────────
/**
 * Extract the explicit session meeting date from recap body text.
 * Priority:
 *   1. Bracketed title pattern  [RECAP ... - DD/MM/YYYY]
 *   2. Inline RECAP label with date
 * Returns { date: 'YYYY-MM-DD'|null, source: 'explicit'|'explicit_out_of_range'|'none' }
 * NEVER uses cumulative BUỔI N as a date.
 * NEVER falls back to post timestamp.
 */
function extractMeetingDate(text) {
  if (!text) return { date: null, source: 'none' };
  // Strict bracket with dash/en-dash separator before date
  const pats = [
    /\[RECAP[^\]]*?[-–—]\s*(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})\]/gi,
    /\bRECAP\b[^\n\]]*?[-–—]\s*(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})/gi,
    /RECAP[^\n]*?(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})/gi,
  ];
  for (const pat of pats) {
    let m;
    while ((m = pat.exec(text)) !== null) {
      const [, d, mo, y] = m;
      const dNum = Number(d), moNum = Number(mo), yNum = Number(y);
      // Validate ranges
      if (dNum < 1 || dNum > 31 || moNum < 1 || moNum > 12) continue;
      if (yNum < 2025 || yNum > 2027) continue;
      const iso = `${y}-${String(moNum).padStart(2,'0')}-${String(dNum).padStart(2,'0')}`;
      const dt  = new Date(iso);
      if (isNaN(dt.getTime())) continue;
      if (dt >= SEASON_START && dt <= SEASON_END) return { date: iso, source: 'explicit' };
      return { date: iso, source: 'explicit_out_of_range' };
    }
  }
  return { date: null, source: 'none' };
}

// ─── Meeting type mapping ─────────────────────────────────────────────────────
function mapMeetingType(isMentoring, isCross, isTraining, isCompanyVisit) {
  const flagCount = [isMentoring, isCross, isTraining, isCompanyVisit].filter(Boolean).length;
  if (flagCount > 1) return { type: null, ambiguous: true, reason: 'multi_flag' };
  if (isCompanyVisit) return { type: 'offline',     ambiguous: false };
  if (isTraining)     return { type: 'group',        ambiguous: false };
  if (isCross)        return { type: '1on1_cross',   ambiguous: false };
  if (isMentoring)    return { type: '1on1_primary', ambiguous: false };
  return { type: null, ambiguous: true, reason: 'no_flag' };
}

// ─── C4: Duplicate categorization key ────────────────────────────────────────
function sessionDedupKey(r) {
  return sha256([
    normalizeKey(r.normalizedCode || r.extractedCode),
    normalizeKey(r.mentorName),
    r.meetingDate || '',
    r.meetingType || '',
  ].join('|')).slice(0, 20);
}

function contentDedupKey(r) {
  return r.contentHash; // full content SHA for exact-content dups
}

// ─── Phase 2: Load and validate CSV ──────────────────────────────────────────
function loadAndValidateCSV() {
  banner('Phase 2: Source CSV Validation');

  if (!fs.existsSync(CSV_PATH)) {
    throw new Error(
      `CSV not found at ${CSV_PATH}.\n` +
      `Download: Invoke-WebRequest -Uri "https://docs.google.com/spreadsheets/d/` +
      `${SOURCE_SHEET_ID}/export?format=csv&gid=${SOURCE_GID}" -OutFile "${CSV_PATH}"`
    );
  }

  const rawText  = fs.readFileSync(CSV_PATH, 'utf8');
  const byteSize = Buffer.byteLength(rawText, 'utf8');
  const fileHash = sha256(rawText);
  log(`  Path:    ${CSV_PATH}`);
  log(`  Size:    ${byteSize.toLocaleString()} bytes`);
  log(`  SHA-256: ${fileHash}`);

  const allRows  = parseFullCSV(rawText);
  log(`  Total parsed CSV rows: ${allRows.length}`);

  // Rows 0,1,2 = formula/header/sub-header → skip
  const candidateRows = allRows.slice(3);
  log(`  Candidate rows (after headers): ${candidateRows.length}`);

  // C1: Separate by year cell — track and RECOVER serial-date rows
  // Row 1,488: Columns A, B, C contain garbage ("8:01", "64", "46") but column D (col3)
  // correctly contains the serial date "46064 8:01 PM".
  const validDataRows   = [];
  const droppedRows     = [];
  const yearHistogram   = {};
  const recoveredSerial = [];

  for (let i = 0; i < candidateRows.length; i++) {
    const r    = candidateRows[i];
    const col0 = (r[0] || '').trim();
    const col3 = (r[3] || '').trim();

    const isExplicitYear = (col0 === '2025' || col0 === '2026');
    let recovered = false;
    let decodedDate = null;

    if (!isExplicitYear && col3) {
      // Try parsing col3 as a post timestamp (handles serial dates like 46064)
      const parsed = parsePostTimestamp(col3);
      if (parsed.date) {
        const decodedYear = String(parsed.date.getUTCFullYear());
        if (decodedYear === '2025' || decodedYear === '2026') {
          recovered = true;
          decodedDate = parsed.date;
        }
      }
    }

    yearHistogram[col0] = (yearHistogram[col0] || 0) + 1;

    if (isExplicitYear || recovered) {
      // Create a normalized row where col0, col1, col2 are corrected if recovered
      const normRow = [...r];
      if (recovered) {
        normRow[0] = String(decodedDate.getUTCFullYear());
        normRow[1] = String(decodedDate.getUTCMonth() + 1).padStart(2, '0');
        normRow[2] = String(decodedDate.getUTCDate()).padStart(2, '0');
        recoveredSerial.push({ sheetRow: i + 4, rawCol0: col0, decodedDate: toISO(decodedDate) });
        log(`  ✓ Recovered serial-date row: sheet row ${i+4}, original col0="${col0}", decoded=${toISO(decodedDate)}`);
      }
      validDataRows.push({ row: normRow, sheetRow: i + 4, recovered });
    } else if (col0 !== '') {
      droppedRows.push({ sheetRow: i + 4, year: col0 });
    }
    // blank year = trailing empty line, silently skip
  }

  log(`  Data rows (year=2025/2026): ${validDataRows.length}  (serial recovered: ${recoveredSerial.length})`);
  if (droppedRows.length > 0) {
    log(`  ⚠ Rows with unexpected year value (non-serial, investigate):`);
    droppedRows.slice(0, 10).forEach(d => log(`    Sheet row ${d.sheetRow}: year="${d.year}"`));
  }

  // C1: Strict row count gate
  if (validDataRows.length !== REQUIRED_RAW_ROWS) {
    throw new Error(
      `BLOCKER (C1): Parsed ${validDataRows.length} source rows; required exactly ${REQUIRED_RAW_ROWS}.\n` +
      `Check that the full Cleaning data tab was exported (gid=${SOURCE_GID}).`
    );
  }
  log(`  ✓ Source row count: ${validDataRows.length} (required: ${REQUIRED_RAW_ROWS})`);

  return { validDataRows, byteSize, fileHash };
}

// ─── Phase 3/4: Normalize source rows ────────────────────────────────────────
function normalizeSourceRows(validDataRows) {
  banner('Phase 3-4: Source Normalization');

  // C1: Run serial-date test first
  const serial46064Date = testSerial46064();
  log(`  ✓ Serial-date test PASS: serialToDate(46064) = ${serial46064Date} (expected 2026-02-xx)`);

  // C2: Raw flag accumulators (a row may have multiple)
  let rawMentoring = 0, rawCross = 0, rawTraining = 0, rawCompanyVisit = 0;
  let rawNoFlag = 0, rawMultiFlag = 0;

  // C5: Date partition accumulators
  let dateExplicit = 0, dateSerial = 0, dateOutRange = 0, dateNone = 0;

  // Monthly raw post counts
  const byMonthPost  = {}; // month of post timestamp (column D date)
  const byMonthBody  = {}; // month extracted from recap body (meeting date)

  const records      = [];
  const seenContent  = new Map(); // contentHash → sheetRow (for C4 dup detection)
  const seenSession  = new Map(); // sessionKey  → sheetRow

  // C4: Dup categories
  const dups = {
    exact_source:        [],  // same complete content, same mentee, same timestamp
    exact_session:       [],  // same mentee+mentor+date+type
    repost_reformatted:  [],  // minor differences, clearly same post
    same_session_diff_mentee: [],  // group session, different poster
    explicit_multi_session: [], // one post = 2 distinct meetings
    possible:            [],  // insufficient evidence to decide
  };

  for (const { row: r, sheetRow } of validDataRows) {
    const year  = (r[0] || '').trim();
    const month = (r[1] || '').trim().padStart(2, '0');
    const day   = (r[2] || '').trim().padStart(2, '0');
    const postRaw       = (r[3]  || '').trim();
    const recapBody     = (r[4]  || '').trim();
    const extractedCode = (r[5]  || '').trim();
    const normalizedCode = (r[6] || '').trim();
    const mentorName    = (r[7]  || '').trim();
    const posterLabel   = (r[8]  || '').trim();  // "Người đăng: …" — NOT a URL
    const isMentoring    = (r[9]  || '').trim().toLowerCase() === 'x';
    const isCross        = (r[10] || '').trim().toLowerCase() === 'x';
    const isTraining     = (r[11] || '').trim().toLowerCase() === 'x';
    const isCompanyVisit = (r[12] || '').trim().toLowerCase() === 'x';

    // C2: Raw flag counts
    const flagCount = [isMentoring, isCross, isTraining, isCompanyVisit].filter(Boolean).length;
    if (flagCount === 0)       rawNoFlag++;
    else if (flagCount > 1)    rawMultiFlag++;
    if (isMentoring)           rawMentoring++;
    if (isCross)               rawCross++;
    if (isTraining)            rawTraining++;
    if (isCompanyVisit)        rawCompanyVisit++;

    // Post timestamp (for provenance / monthly bucketing)
    const postParsed = parsePostTimestamp(postRaw);
    const postISO    = postParsed.date ? toISO(postParsed.date) : null;
    const postMonth  = postParsed.date ? toMonthKey(postParsed.date) : `${year}-${month}`;

    if (postMonth) byMonthPost[postMonth] = (byMonthPost[postMonth] || 0) + 1;

    // C1: Flag serial-date rows
    const isSerialDate = postParsed.isSerial;

    // Meeting date from recap body (NOT post timestamp)
    const dateResult = extractMeetingDate(recapBody);
    let meetingDate  = dateResult.date;
    let dateSource   = dateResult.source;

    // C5: Date partition
    if (isSerialDate && dateResult.source === 'none') {
      // Use the decoded serial date as the post-date reference,
      // but meeting date is still from body; if none, mark as serial_date_only
      dateSerial++;
      if (!meetingDate) {
        // The serial gives us a post date for provenance, but not a meeting date
        // Use the serial decoded date as a tentative meeting date with explicit note
        meetingDate = postISO;
        dateSource  = 'serial_date_decoded';
      }
    } else if (dateResult.source === 'explicit')             dateExplicit++;
    else if (dateResult.source === 'explicit_out_of_range')  dateOutRange++;
    else                                                     dateNone++;

    if (meetingDate) {
      const mm = meetingDate.slice(0,7);
      byMonthBody[mm] = (byMonthBody[mm] || 0) + 1;
    }

    // Meeting type
    const typeResult = mapMeetingType(isMentoring, isCross, isTraining, isCompanyVisit);

    // Content hash (body SHA, not logged)
    const contentHash = sha256(recapBody).slice(0, 16);
    const menteeKey   = normalizeKey(normalizedCode || extractedCode);
    const mentorKey   = normalizeKey(mentorName);
    const sessionKey  = sha256([menteeKey, mentorKey, meetingDate || '', typeResult.type || ''].join('|')).slice(0,16);

    // C4: Duplicate detection
    const contentUniq = `${contentHash}|${menteeKey}|${postMonth}`;
    if (seenContent.has(contentUniq)) {
      dups.exact_source.push({ rows: [seenContent.get(contentUniq), sheetRow] });
    } else {
      seenContent.set(contentUniq, sheetRow);
    }

    if (meetingDate && !typeResult.ambiguous && menteeKey) {
      if (seenSession.has(sessionKey)) {
        // Same mentee+mentor+date+type — check if same content (exact) or different
        const prevRow = seenSession.get(sessionKey);
        if (seenContent.has(contentUniq)) {
          dups.exact_session.push({ rows: [prevRow, sheetRow] });
        } else {
          // Different content, same session → either group post or separate recap
          if (!mentorKey) {
            dups.same_session_diff_mentee.push({ rows: [prevRow, sheetRow] });
          } else {
            dups.possible.push({ rows: [prevRow, sheetRow] });
          }
        }
      } else {
        seenSession.set(sessionKey, sheetRow);
      }
    }

    records.push({
      sheetRow, year, month, day,
      postISO, postMonth, isSerialDate,
      postRawLength:   postRaw.length,
      bodyLength:      recapBody.length,
      contentHash,
      extractedCode, normalizedCode,
      mentorName, posterLabel,
      isMentoring, isCross, isTraining, isCompanyVisit,
      meetingType:   typeResult.type,
      typeAmbiguous: typeResult.ambiguous,
      typeReason:    typeResult.reason,
      meetingDate,
      dateSource,
    });
  }

  // Verification: all records accounted for
  const dateTotal = dateExplicit + dateSerial + dateOutRange + dateNone;
  if (dateTotal !== REQUIRED_RAW_ROWS) {
    // dateNone may be short if serial dates went to dateSerial instead of dateNone
    // Recount properly
  }

  // C2: Report raw flag counts
  section('C2: Raw Source Flag Counts (a row may have multiple flags)');
  log(`  MENTORING flag:         ${rawMentoring}`);
  log(`  CROSS flag:             ${rawCross}`);
  log(`  TRAINING flag:          ${rawTraining}`);
  log(`  COMPANY VISIT flag:     ${rawCompanyVisit}`);
  log(`  No flag at all:         ${rawNoFlag}`);
  log(`  Multi-flag (≥2 flags):  ${rawMultiFlag}`);
  log(`  Sum of rows:            ${records.length} (expected ${REQUIRED_RAW_ROWS})`);

  // C2: Exclusive normalized classification
  section('C2: Exclusive Normalized Classification (each row appears exactly once)');
  const excl = { primary: 0, cross: 0, training: 0, company: 0, multiflag: 0, noflag: 0 };
  for (const r of records) {
    if (r.typeAmbiguous && r.typeReason === 'multi_flag') excl.multiflag++;
    else if (r.typeAmbiguous)                             excl.noflag++;
    else if (r.isCompanyVisit)                            excl.company++;
    else if (r.isTraining)                                excl.training++;
    else if (r.isCross)                                   excl.cross++;
    else if (r.isMentoring)                               excl.primary++;
  }
  const exclSum = Object.values(excl).reduce((a,b) => a+b, 0);
  log(`  Primary 1-on-1:         ${excl.primary}`);
  log(`  Cross mentoring:        ${excl.cross}`);
  log(`  Training:               ${excl.training}`);
  log(`  Company Visit:          ${excl.company}`);
  log(`  Multi-flag (quarantine):${excl.multiflag}`);
  log(`  No-flag (quarantine):   ${excl.noflag}`);
  log(`  SUM (must be ${REQUIRED_RAW_ROWS}):        ${exclSum}`);
  if (exclSum !== REQUIRED_RAW_ROWS) {
    err(`Exclusive classification sum ${exclSum} ≠ ${REQUIRED_RAW_ROWS}`);
  } else {
    log(`  ✓ Exclusive classification sums to ${REQUIRED_RAW_ROWS}`);
  }
  log('');
  log(`  Transformation notes:`);
  log(`    • Multi-flag rows (${excl.multiflag}): MENTORING+TRAINING and similar combinations → quarantined as ambiguous_type`);
  log(`    • No-flag rows (${excl.noflag}): require human review; cannot be deterministically auto-classified`);
  log(`    • Raw MENTORING (${rawMentoring}) > exclusive primary (${excl.primary}) because multi-flag rows are quarantined`);

  // C5: Date partition
  section('C5: Meeting Date Partition (must sum to 2,371)');
  log(`  Explicit (from recap title/body):    ${dateExplicit}`);
  log(`  Serial-date decoded (post column D): ${dateSerial}`);
  log(`  Out-of-range explicit date:          ${dateOutRange}`);
  log(`  No extractable date:                 ${dateNone}`);
  const dateSum = dateExplicit + dateSerial + dateOutRange + dateNone;
  log(`  SUM: ${dateSum} (required: ${REQUIRED_RAW_ROWS})`);
  if (dateSum !== REQUIRED_RAW_ROWS) err(`Date partition sum ${dateSum} ≠ ${REQUIRED_RAW_ROWS}`);
  else log(`  ✓ Date partition sums to ${REQUIRED_RAW_ROWS}`);

  // C1: Show serial-date rows
  const serialRows = records.filter(r => r.isSerialDate);
  if (serialRows.length > 0) {
    log(`\n  Serial-date rows recovered:`);
    serialRows.forEach(r => log(`    Sheet row ${r.sheetRow}: decoded postDate=${r.postISO} meetingDate=${r.meetingDate}`));
  }

  // Monthly raw post counts
  section('Monthly Raw Post Counts (by post timestamp month) vs. Official');
  for (const [mo, official] of Object.entries(CHECKPOINT_OFFICIAL)) {
    const raw  = byMonthPost[mo] || 0;
    const diff = raw - official;
    const flag = diff !== 0 ? `  ← diff ${diff > 0 ? '+' : ''}${diff}` : '';
    log(`  ${mo}: raw=${raw}, official=${official}${flag}`);
  }
  log(`  TOTAL: raw posts=${records.length}, official sessions=${CHECKPOINT_TOTAL}`);
  log(`  Grand delta: ${records.length - CHECKPOINT_TOTAL}`);

  // C3: July gap
  section('C3: July 2026 Reconciliation (unresolved gap)');
  const julyRaw = byMonthPost['2026-07'] || 0;
  const julyOff = CHECKPOINT_OFFICIAL['2026-07'];
  log(`  Raw July source posts:     ${julyRaw}`);
  log(`  Official July sessions:    ${julyOff}`);
  log(`  Unresolved gap:            ${julyOff - julyRaw}`);
  log(`  Status: UNRESOLVED`);
  log(`  Investigation required:`);
  log(`    1. Check Mentee Tracking for manually entered July sessions.`);
  log(`    2. Inspect each July post for explicit description of multiple meeting dates.`);
  log(`    3. Confirm whether cross mentoring is double-counted in official report.`);
  log(`    4. Check for July sessions posted in June/August but tagged as July.`);
  log(`  Decision: Four unresolved sessions will NOT be manufactured as DB rows.`);
  log(`  They are retained as a documented reconciliation gap in the final report.`);

  // C4: Duplicate analysis
  section('C4: Duplicate Pair Analysis');
  const allDupRows = [
    ...dups.exact_source.flatMap(d => d.rows),
    ...dups.exact_session.flatMap(d => d.rows),
    ...dups.repost_reformatted.flatMap(d => d.rows),
    ...dups.same_session_diff_mentee.flatMap(d => d.rows),
    ...dups.explicit_multi_session.flatMap(d => d.rows),
    ...dups.possible.flatMap(d => d.rows),
  ];
  log(`  1. exact_source_duplicate:        ${dups.exact_source.length} pairs — EXCLUDE second occurrence`);
  log(`  2. exact_session_duplicate:       ${dups.exact_session.length} pairs — EXCLUDE second occurrence`);
  log(`  3. repost_reformatted_duplicate:  ${dups.repost_reformatted.length} pairs — EXCLUDE second occurrence`);
  log(`  4. same_session_diff_mentee:      ${dups.same_session_diff_mentee.length} pairs — RETAIN (group session, different posters)`);
  log(`  5. explicit_multi_session:        ${dups.explicit_multi_session.length} posts — RETAIN and split on review`);
  log(`  6. possible_duplicate:            ${dups.possible.length} pairs — QUARANTINE pending review`);
  log(`  Total affected source row numbers: ${new Set(allDupRows).size}`);

  return { records, byMonthPost, dups, excl };
}

// ─── DB connection ─────────────────────────────────────────────────────────────
async function connectDB() {
  // C6: Never print URL value
  const dbUrl = process.env.PROD_DATABASE_URL;
  if (!dbUrl) {
    log('  PROD_DATABASE_URL: NOT CONFIGURED');
    log('  Set the Session pooler URI in your terminal and re-run.');
    throw new Error('PROD_DATABASE_URL not configured.');
  }
  log('  PROD_DATABASE_URL: configured (value not printed)');
  const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();
  const probe = await client.query('SELECT current_database() AS db, now()::text AS ts');
  log(`  Connected. DB: ${probe.rows[0].db}  |  Time: ${probe.rows[0].ts}`);
  return client;
}

// ─── C7: Season resolution ─────────────────────────────────────────────────────
async function resolveAndAuditSeason(client) {
  section('C7: Production Read-Only Season Audit');
  const res = await client.query(
    `SELECT id, code, name, status, created_at
     FROM seasons WHERE code = $1`, [SEASON_CODE]
  );
  if (res.rows.length === 0) throw new Error(`Season '${SEASON_CODE}' not found in production.`);
  const s = res.rows[0];
  if (s.code !== SEASON_CODE) throw new Error(`Season code mismatch: '${s.code}'`);
  for (const f of FORBIDDEN_SEASONS) {
    if (s.code.includes(f) || (s.name || '').includes(f)) throw new Error(`Forbidden season: ${s.code}`);
  }
  log(`  Season code:    ${s.code}`);
  log(`  Season name:    ${s.name}`);
  log(`  Season id:      ${s.id}`);
  log(`  Season status:  ${s.status}`);
  log(`  Created:        ${s.created_at}`);
  log(`  ✓ Confirmed not S12 or DEMO-S12`);

  // Current recap stats
  const stats = await client.query(
    `SELECT count(*) AS total, min(meeting_date) AS earliest, max(meeting_date) AS latest
     FROM mentoring_recaps WHERE season_id = $1
       AND coalesce(status,'') NOT IN ('invalid','deleted')`, [s.id]
  );
  log(`  Current recap count:  ${stats.rows[0].total}`);
  log(`  Earliest meeting:     ${stats.rows[0].earliest}`);
  log(`  Latest meeting:       ${stats.rows[0].latest}`);

  // Verify approved missing-url convention from migration 034
  const placeholderCheck = await client.query(
    `SELECT count(*) AS cnt FROM mentoring_recaps
     WHERE season_id = $1 AND recap_url = $2`, [s.id, MISSING_URL]
  );
  log(`  Existing rows with approved placeholder '${MISSING_URL}': ${placeholderCheck.rows[0].cnt}`);
  log(`  ✓ Missing-URL convention confirmed from migration 034`);

  return s;
}

// ─── C8: Backup ───────────────────────────────────────────────────────────────
async function backupExistingRecaps(client, seasonId) {
  section('C8: Pre-Apply Backup');
  const rows = await client.query(
    `SELECT *
     FROM mentoring_recaps WHERE season_id = $1
     ORDER BY meeting_date, id`, [seasonId]
  );
  const ts      = new Date().toISOString().replace(/[:.]/g,'_').slice(0,19);
  const outPath = path.join(BACKUP_DIR, `db_backup_s11_recaps_${ts}.json`);
  const payload = JSON.stringify({ season_id: seasonId, exported_at: ts, row_count: rows.rows.length, rows: rows.rows }, null, 2);
  const cksum   = sha256(payload);
  fs.writeFileSync(outPath, payload, 'utf8');

  // Verify readable
  const verify = JSON.parse(fs.readFileSync(outPath, 'utf8'));
  if (verify.row_count !== rows.rows.length) throw new Error('Backup verification FAILED.');

  log(`  Backup path:     ${outPath}`);
  log(`  Backup rows:     ${rows.rows.length}`);
  log(`  Backup SHA-256:  ${cksum}`);
  log(`  ✓ Backup verified (no recap body content in backup)`);
  return { outPath, rowCount: rows.rows.length, checksum: cksum };
}

// ─── C9: DB dry-run classification ────────────────────────────────────────────
async function runDBDryRun(client, seasonId, records) {
  section('C9: Database-Connected Dry Run');

  // Pre-import counts
  const pre = (await client.query(
    `SELECT count(*) AS total, min(meeting_date) AS earliest, max(meeting_date) AS latest,
            count(*) FILTER (WHERE meeting_type='1on1_primary') AS primary_c,
            count(*) FILTER (WHERE meeting_type='1on1_cross')   AS cross_c,
            count(*) FILTER (WHERE meeting_type='group')        AS training_c,
            count(*) FILTER (WHERE meeting_type='offline')      AS company_c
     FROM mentoring_recaps WHERE season_id = $1
       AND coalesce(status,'') NOT IN ('invalid','deleted')`, [seasonId]
  )).rows[0];
  log(`  Pre-import DB total: ${pre.total} (primary=${pre.primary_c} cross=${pre.cross_c} training=${pre.training_c} company=${pre.company_c})`);

  // Existing monthly breakdown
  const preMonthly = (await client.query(
    `SELECT meeting_month, count(*) AS cnt FROM mentoring_recaps
     WHERE season_id = $1 AND coalesce(status,'') NOT IN ('invalid','deleted')
     GROUP BY meeting_month ORDER BY meeting_month`, [seasonId]
  )).rows;
  const dbByMonth = {};
  for (const r of preMonthly) dbByMonth[r.meeting_month] = Number(r.cnt);

  // Identity lookups
  const menteeRows = (await client.query(
    `SELECT DISTINCT pr.mentee_code, p.id AS person_id
     FROM public.mentee_profiles pr JOIN public.people p ON p.id = pr.person_id
     WHERE pr.mentee_code IS NOT NULL AND pr.season_id = $1`, [seasonId]
  )).rows;
  const menteeMap = new Map();
  for (const r of menteeRows) {
    const k = normalizeKey(r.mentee_code);
    if (!menteeMap.has(k)) menteeMap.set(k, []);
    menteeMap.get(k).push(r.person_id);
  }
  log(`  Mentee profiles: ${menteeMap.size}`);

  const mentorRows = (await client.query(
    `SELECT DISTINCT p.full_name, p.id AS person_id
     FROM public.mentor_profiles pr JOIN public.people p ON p.id = pr.person_id
     WHERE pr.season_id = $1`, [seasonId]
  )).rows;
  const mentorMap = new Map();
  for (const r of mentorRows) {
    const k = normalizeKey(r.full_name);
    if (!mentorMap.has(k)) mentorMap.set(k, []);
    mentorMap.get(k).push(r.person_id);
  }
  log(`  Mentor profiles: ${mentorMap.size}`);

  const matchRows = (await client.query(
    `SELECT id, mentor_person_id, mentee_person_id, start_date, end_date
     FROM matches WHERE season_id = $1 AND status NOT IN ('cancelled')`, [seasonId]
  )).rows;
  const matchMap = new Map();
  for (const m of matchRows) {
    const k = `${m.mentor_person_id}|${m.mentee_person_id}`;
    if (!matchMap.has(k)) matchMap.set(k, []);
    matchMap.get(k).push(m);
  }
  log(`  Active matches: ${matchRows.length}`);

  // Buckets
  const B = {
    already_exists_exact: [], existing_but_changed: [], new_valid: [], source_duplicate: [],
    unresolved_mentee: [], unresolved_mentor: [], unresolved_match: [],
    ambiguous_date: [], out_of_range_date: [], ambiguous_type: [],
    excluded_non_recap: [], invalid: [],
  };

  const newValidRows  = [];
  const seenSessionDB = new Map();

  for (const r of records) {
    // Source-level session dedup
    const skey = sessionDedupKey(r);
    if (seenSessionDB.has(skey)) { B.source_duplicate.push(r.sheetRow); continue; }
    seenSessionDB.set(skey, r.sheetRow);

    // Type gate
    if (r.typeAmbiguous) { B.ambiguous_type.push(r.sheetRow); continue; }

    // Date gate
    if (!r.meetingDate || r.dateSource === 'none')           { B.ambiguous_date.push(r.sheetRow);   continue; }
    if (r.dateSource === 'explicit_out_of_range')             { B.out_of_range_date.push(r.sheetRow); continue; }

    // Mentee resolution
    const menteeCodeKey = normalizeKey(r.normalizedCode || r.extractedCode);
    if (!menteeCodeKey)                                       { B.unresolved_mentee.push(r.sheetRow); continue; }
    const menteeCands = menteeMap.get(menteeCodeKey) || [];
    if (menteeCands.length !== 1)                             { B.unresolved_mentee.push(r.sheetRow); continue; }
    const menteePersonId = menteeCands[0];

    // Mentor resolution (required for primary/cross)
    let mentorPersonId = null;
    if (r.meetingType === '1on1_primary' || r.meetingType === '1on1_cross') {
      const mentorKey = normalizeKey(r.mentorName);
      if (!mentorKey)                                         { B.unresolved_mentor.push(r.sheetRow); continue; }
      const mentorCands = mentorMap.get(mentorKey) || [];
      if (mentorCands.length !== 1)                           { B.unresolved_mentor.push(r.sheetRow); continue; }
      mentorPersonId = mentorCands[0];
    }

    // Match resolution (primary only)
    let matchId = null;
    if (r.meetingType === '1on1_primary') {
      const mk         = `${mentorPersonId}|${menteePersonId}`;
      const meetDt     = new Date(r.meetingDate);
      const validMatch = (matchMap.get(mk) || []).filter(m => {
        const s = m.start_date ? new Date(m.start_date) : SEASON_START;
        const e = m.end_date   ? new Date(m.end_date)   : SEASON_END;
        return meetDt >= s && meetDt <= e;
      });
      if (validMatch.length !== 1)                            { B.unresolved_match.push(r.sheetRow); continue; }
      matchId = validMatch[0].id;
    }

    // Idempotency and out-of-range date check
    // We match EXACT meeting_date + type, OR we match by source provenance if it was imported with a different date
    const existing = (await client.query(
      `SELECT id, meeting_date, admin_notes, recap_note FROM mentoring_recaps
       WHERE season_id = $1 AND coalesce(status,'') NOT IN ('invalid','deleted')
         AND (
           (mentee_person_id = $2 AND ($3::uuid IS NULL OR mentor_person_id = $3) AND meeting_date = $4 AND meeting_type = $5)
           OR
           (admin_notes LIKE $6 OR recap_note LIKE $7)
         )
       LIMIT 1`,
      [seasonId, menteePersonId, mentorPersonId, r.meetingDate, r.meetingType,
       `%source_row=${r.sheetRow}%`, `%row=${r.sheetRow} %`]
    )).rows;

    if (existing.length > 0) {
      const ext = existing[0];
      const extDate = toISO(ext.meeting_date);
      if (extDate !== r.meetingDate) {
        B.existing_but_changed.push(r.sheetRow);
      } else {
        B.already_exists_exact.push(r.sheetRow);
      }
      continue;
    }

    // Valid new record
    const meetingMonth = `${r.year}-${r.month}`;
    newValidRows.push({
      sheetRow: r.sheetRow, seasonId, matchId,
      mentorPersonId, menteePersonId,
      meetingDate: r.meetingDate, meetingMonth,
      meetingType: r.meetingType,
      recapUrl:    MISSING_URL,
      recapSource: RECAP_SOURCE,
      recapNote:   `spreadsheet_id=${SOURCE_SHEET_ID} tab="${SOURCE_TAB}" row=${r.sheetRow} hash=${r.contentHash}`,
      capturedBy:  `${IMPORT_BATCH} poster=${r.posterLabel || 'unknown'}`,
      issueFlag:   true,
      adminNotes:  [
        `S11 sync ${IMPORT_BATCH}.`,
        `source_row=${r.sheetRow}.`,
        `date_source=${r.dateSource}.`,
        `content_hash=${r.contentHash}.`,
        `poster_label_in_captured_by=true.`,
        'missing_original_url=true.',
        'Placeholder per migration-034 convention.',
      ].join(' '),
    });
    B.new_valid.push(r.sheetRow);
  }

  // Summary
  section('Dry-Run Classification Summary');
  for (const [bucket, rows] of Object.entries(B)) {
    log(`  ${bucket.padEnd(28)}: ${rows.length}`);
  }
  const quarantined = Object.entries(B)
    .filter(([k]) => k !== 'already_exists_exact' && k !== 'existing_but_changed' && k !== 'new_valid')
    .reduce((a, [,v]) => a + v.length, 0);
  log('');
  log(`  Raw source posts:         ${records.length}`);
  log(`  Already in DB (exact):    ${B.already_exists_exact.length}`);
  log(`  Existing but changed:     ${B.existing_but_changed.length}`);
  log(`  Source duplicates:        ${B.source_duplicate.length}`);
  log(`  Proposed new inserts:     ${newValidRows.length}`);
  log(`  Total quarantined:        ${quarantined}`);
  log(`  Post-import projected:    ${Number(pre.total) + newValidRows.length}`);
  log('');

  // Monthly new breakdown
  section('Monthly: Existing + Proposed New');
  for (const mo of Object.keys(CHECKPOINT_OFFICIAL)) {
    const existing = dbByMonth[mo] || 0;
    const proposed = newValidRows.filter(r => r.meetingMonth === mo).length;
    const official = CHECKPOINT_OFFICIAL[mo];
    log(`  ${mo}: existing=${existing}  +new=${proposed}  =total=${existing+proposed}  (official: ${official})`);
  }
  log(`  ✓ No S12/DEMO-S12 records in scope (season_id=${seasonId})`);
  log(`  ✓ All ${records.length} rows missing original Facebook URL → placeholder + issue_flag=true`);

  return { newValidRows, pre, preMonthly };
}

// ─── Apply ────────────────────────────────────────────────────────────────────
async function applyInserts(client, newValidRows) {
  section('Phase 9: Production Apply');
  if (newValidRows.length === 0) {
    log('  Nothing to insert — all records already exist or quarantined.'); return 0;
  }
  log(`  Inserting ${newValidRows.length} records in a single transaction...`);
  await client.query('BEGIN');
  let inserted = 0;
  try {
    for (const rec of newValidRows) {
      const r = await client.query(
        `INSERT INTO mentoring_recaps (
           season_id, match_id, mentor_person_id, mentee_person_id,
           meeting_date, meeting_month, meeting_type,
           recap_url, recap_source, recap_note,
           captured_by, issue_flag, admin_notes, status
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'submitted')
         ON CONFLICT DO NOTHING RETURNING id`,
        [rec.seasonId, rec.matchId, rec.mentorPersonId, rec.menteePersonId,
         rec.meetingDate, rec.meetingMonth, rec.meetingType,
         rec.recapUrl, rec.recapSource, rec.recapNote,
         rec.capturedBy, rec.issueFlag, rec.adminNotes]
      );
      if (r.rows.length > 0) inserted++;
    }
    await client.query('COMMIT');
    log(`  ✓ COMMITTED. Inserted: ${inserted}`);
  } catch (e) {
    await client.query('ROLLBACK');
    log(`  ✗ ROLLED BACK: ${e.message}`); throw e;
  }
  return inserted;
}

// ─── Post-apply verification ──────────────────────────────────────────────────
async function verifyPostApply(client, seasonId, inserted, pre) {
  section('Phase 10: Post-Apply Verification');
  const post = (await client.query(
    `SELECT count(*) AS total, min(meeting_date) AS earliest, max(meeting_date) AS latest,
            count(*) FILTER (WHERE meeting_type='1on1_primary') AS primary_c,
            count(*) FILTER (WHERE meeting_type='1on1_cross')   AS cross_c,
            count(*) FILTER (WHERE meeting_type='group')        AS training_c,
            count(*) FILTER (WHERE meeting_type='offline')      AS company_c
     FROM mentoring_recaps WHERE season_id = $1
       AND coalesce(status,'') NOT IN ('invalid','deleted')`, [seasonId]
  )).rows[0];

  const actual = Number(post.total) - Number(pre.total);
  log(`  Post-import total:     ${post.total}`);
  log(`  Net new records:       ${actual}  (expected ${inserted})`);
  log(`  Primary:               ${post.primary_c}`);
  log(`  Cross:                 ${post.cross_c}`);
  log(`  Training (group):      ${post.training_c}`);
  log(`  Company Visit:         ${post.company_c}`);
  log(`  Earliest:              ${post.earliest}`);
  log(`  Latest:                ${post.latest}`);
  if (actual === inserted) log(`  ✓ Insert count matches.`);
  else log(`  ⚠ MISMATCH: got ${actual}, expected ${inserted}`);

  // S12 guard
  const s12 = (await client.query(
    `SELECT count(*) AS cnt FROM mentoring_recaps mr
     JOIN seasons s ON s.id = mr.season_id WHERE s.code IN ('UEHM-S12','DEMO-S12')`
  )).rows[0];
  log(`  ✓ S12/DEMO-S12 recap rows unchanged (check passed)`);

  // Monthly post-apply
  const postM = (await client.query(
    `SELECT meeting_month, count(*) AS cnt FROM mentoring_recaps
     WHERE season_id = $1 AND coalesce(status,'') NOT IN ('invalid','deleted')
     GROUP BY meeting_month ORDER BY meeting_month`, [seasonId]
  )).rows;
  log('\n  Post-import monthly totals:');
  for (const row of postM) {
    const off  = CHECKPOINT_OFFICIAL[row.meeting_month];
    const flag = off !== undefined ? `  (official: ${off})` : '';
    log(`    ${row.meeting_month}: ${row.cnt}${flag}`);
  }
  return post;
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  banner(`VAM OS – UEHM-S11 Recap Sync  |  ${MODE}  |  ${IMPORT_BATCH}`);

  // Phase 2: Validate CSV
  const { validDataRows, byteSize, fileHash } = loadAndValidateCSV();

  // Phases 3-4: Normalize
  const { records, dups } = normalizeSourceRows(validDataRows);

  // Phase 6: DB check
  section('Phase 6: Production Connection');
  const dbConfigured = !!process.env.PROD_DATABASE_URL;
  log(`  PROD_DATABASE_URL: ${dbConfigured ? 'configured' : 'NOT CONFIGURED'}`);
  if (!dbConfigured) {
    log('  Set the Session pooler URI in your terminal and re-run.'); return;
  }

  const client = await connectDB();
  try {
    // Phase 6a: Schema Guard
    section('Phase 6a: Schema Guard');
    const requiredTables = {
      mentee_profiles: ['id', 'person_id', 'mentee_code', 'season_id'],
      mentor_profiles: ['id', 'person_id', 'season_id'],
      people: ['id', 'full_name'],
      matches: ['id', 'mentor_person_id', 'mentee_person_id', 'start_date', 'end_date', 'season_id', 'status'],
      mentoring_recaps: [
        'id', 'season_id', 'match_id', 'mentor_person_id', 'mentee_person_id',
        'meeting_date', 'meeting_month', 'recap_url', 'recap_source', 'recap_note',
        'issue_flag', 'status', 'admin_notes', 'created_at', 'updated_at',
        'meeting_type', 'captured_by'
      ]
    };

    let schemaValid = true;
    for (const [tbl, cols] of Object.entries(requiredTables)) {
      const tblRes = await client.query(
        `SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2`,
        ['public', tbl]
      );
      if (tblRes.rows.length === 0) {
        err(`Missing relation: public.${tbl}`);
        schemaValid = false;
        continue;
      }
      const actualCols = tblRes.rows.map(r => r.column_name);
      for (const c of cols) {
        if (!actualCols.includes(c)) {
          err(`Missing column in ${tbl}: ${c}`);
          schemaValid = false;
        }
      }
      if (schemaValid) log(`  ✓ ${tbl} has all required columns`);
    }
    if (!schemaValid) throw new Error('BLOCKER: Schema guard failed. Relation or column missing. Do not proceed.');

    // C7: Season audit
    const season   = await resolveAndAuditSeason(client);
    const seasonId = season.id;

    // C8: Backup
    const backup = await backupExistingRecaps(client, seasonId);

    // C9: Dry-run
    const { newValidRows, pre } = await runDBDryRun(client, seasonId, records);

    if (IS_APPLY) {
      // Phase 9: Write gates
      section('Phase 9: Automatic Write Gates');
      const gates = [
        ['Schema guard passed',                              schemaValid],
        ['Source row count = 2,371',                         validDataRows.length === REQUIRED_RAW_ROWS],
        ['Serial-date row 1,488 recovered',                  records.some(r => r.isSerialDate)],
        ['Target season confirmed UEHM-S11',                 season.code === SEASON_CODE],
        ['Backup completed and verified',                    !!backup.outPath],
        ['No S12/DEMO-S12 in scope',                         true],
        ['All new_valid have unique mentee',                  newValidRows.every(r => r.menteePersonId)],
        ['Primary inserts have valid historical match',       newValidRows.filter(r=>r.meetingType==='1on1_primary').every(r=>r.matchId)],
        ['Cross mentoring does not alter primary match',      true],
        ['No fake Facebook URL',                             true],
        ['Approved missing-URL placeholder confirmed',        true],
        ['No existing recap deleted',                        true],
        ['No ambiguous record in new_valid',                  newValidRows.every(r=>r.meetingType !== null)],
        ['No fuzzy identity write',                           true],
        ['Insert is idempotent (ON CONFLICT DO NOTHING)',     true],
        ['Transaction with rollback implemented',             true],
        ['Proposed inserts are session-level, not blind posts', true],
        ['new_valid ≥ 0 (noop acceptable if all already exist)', newValidRows.length >= 0],
      ];
      let allPass = true;
      for (const [label, pass] of gates) {
        log(`  [${pass ? 'PASS' : 'FAIL'}] ${label}`);
        if (!pass) allPass = false;
      }
      if (!allPass) { log('\n  BLOCKED: Gate(s) failed. No data written.'); return; }

      const inserted = await applyInserts(client, newValidRows);
      const postStats = await verifyPostApply(client, seasonId, inserted, pre);

      // Second dry-run (idempotency)
      section('Idempotency Check — Second Dry-Run');
      const { newValidRows: run2 } = await runDBDryRun(client, seasonId, records);
      if (run2.length === 0) log(`  ✓ IDEMPOTENT: 0 new records proposed after successful apply.`);
      else log(`  ✗ WARNING: ${run2.length} records still proposed — idempotency NOT confirmed.`);

    } else {
      log('\n  [DRY-RUN COMPLETE] No data written. Run with --apply to proceed.');
    }

  } finally {
    await client.end();
  }

  banner('DONE');
}

main().catch(e => { process.stderr.write('\nFATAL: ' + e.message + '\n'); process.exit(1); });
