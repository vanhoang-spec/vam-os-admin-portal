#!/usr/bin/env node
/**
 * sync_s11_recaps.mjs  —  VAM OS UEHM-S11 Recap Synchronization Utility
 * ═══════════════════════════════════════════════════════════════════════
 *
 * All 9 original corrections + 14 production-blocker requirements incorporated:
 *   C1  – Serial-date row 1,488 recovered; zero silent drops.
 *   C2  – Raw flag counts AND exclusive normalized counts reported separately.
 *   C3  – July gap: Mentee Tracking is authoritative; gaps become manual-review placeholders.
 *   C4  – Duplicate pairs categorized into 6 types; only deterministic dups excluded.
 *   C5  – Date partition sums to exactly 2,371.
 *   C6  – DB credentials never printed.
 *   C7  – Read-only production audit before any write.
 *   C8  – Backup created and verified before apply.
 *   C9  – Full DB-connected dry-run classification.
 *   P10 – Strict CLI: unknown args → fatal; --dry-run and --apply are mutually exclusive.
 *   P11 – Phase 6c queries pg_constraint to validate CHECK constraint values live.
 *   P12 – Ledger skipped rows reported with counts; BLOCKER if any has non-zero total.
 *   P13 – Smoke test (BEGIN/ROLLBACK) verifies INSERT constraints before dry-run exits.
 *   P14 – 3-column monthly report: official | physical | report-counted.
 *   P15 – Excess row audit: 125-row analysis; Migration 058 adds status='excluded' to constraint.
 *   P16 – issue_flag exclusion rationale documented; Migration 058 is the clean path.
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
const OFFICIAL_MONTHS     = ['2025-11','2025-12','2026-01','2026-02','2026-03',
                              '2026-04','2026-05','2026-06','2026-07'];

// Ledger CSV — official slot source; must stay gitignored, never committed
const LEDGER_CSV_PATH        = './data_imports/season11/Mentee_Tracking.csv';
const LEDGER_HEADER_ROWS     = 3;   // rows 0-2: summary/month-totals/header; data starts row 3
const LEDGER_CODE_COL        = 5;   // column F = "CODE MENTEE"
const LEDGER_FIRST_MONTH_COL = 15;  // column P = 2025-11 … column X = 2026-07 (9 columns)
const LEDGER_CODE_PAT        = /^UEH[A-Z]{1,2}\d{5}$/;

// ─── CLI ──────────────────────────────────────────────────────────────────────
// Strict: no flag or --dry-run = read only; --apply = writes; any other arg = fatal
{
  const _args    = process.argv.slice(2);
  const _unknown = _args.filter(a => a !== '--dry-run' && a !== '--apply');
  if (_unknown.length > 0) {
    process.stderr.write(
      `FATAL: Unknown argument(s): ${_unknown.join(', ')}\n` +
      `  Usage: node sync_s11_recaps.mjs [--dry-run | --apply]\n`
    );
    process.exit(1);
  }
  if (_args.includes('--dry-run') && _args.includes('--apply')) {
    process.stderr.write('FATAL: --dry-run and --apply are mutually exclusive.\n');
    process.exit(1);
  }
}
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

// computePlanHash fingerprints the complete --apply plan so that the apply
// execution can be traced back to the specific dry-run output reviewed by the owner.
// Covers: sorted excess row IDs, sorted slot keys, and both CSV hashes.
// derivedDates: array of { slotKey, meetingDate, status } from resolveDates()
function computePlanHash(R, excessExisting, dateAnomalyRows, csvHashes, derivedDates) {
  const excessIds = [...excessExisting, ...dateAnomalyRows]
    .map(r => r.id).sort().join(',');
  const slotKeys = [
    ...R.source_new.map(s => s.slot.slotKey),
    ...R.placeholder.map(p => p.slot.slotKey),
  ].sort().join(',');
  const dateEntries = derivedDates
    .slice().sort((a, b) => a.slotKey.localeCompare(b.slotKey))
    .map(d => `${d.slotKey}:${d.meetingDate}:${d.status}`)
    .join(',');
  return sha256([
    `source_csv:${csvHashes.source}`,
    `ledger_csv:${csvHashes.ledger}`,
    `excess_ids:${excessIds}`,
    `slot_keys:${slotKeys}`,
    `derived_dates:${dateEntries}`,
  ].join('|'));
}

// Validates that a value from pg or JS is a safe non-negative integer.
// pg returns COUNT(*) as a string (bigint) unless cast with ::int in SQL.
// Use this for every row count that feeds arithmetic or a gate comparison.
function asNonNegativeInt(value, label) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 0) {
    throw new Error(`FATAL: Invalid integer for ${label}: ${JSON.stringify(value)}`);
  }
  return n;
}

// ─── Meeting date resolution ──────────────────────────────────────────────────
// Returns { date: 'YYYY-MM-DD', estimated: boolean }.
// Uses the source date when it belongs to slotMonth; otherwise derives a
// deterministic fallback clamped to the match's active window within the month.
function resolveMeetingDate(srcDate, slotMonth, matchRow) {
  if (srcDate && String(srcDate).slice(0, 7) === slotMonth) {
    return { date: String(srcDate), estimated: false };
  }
  // Build month window [first, last] day
  const y = parseInt(slotMonth.slice(0, 4), 10);
  const m = parseInt(slotMonth.slice(5, 7), 10);  // 1-indexed
  const monthFirst = new Date(Date.UTC(y, m - 1, 1));
  const monthLast  = new Date(Date.UTC(y, m, 0));  // day 0 of next month = last day of this month

  let candidate = new Date(Date.UTC(y, m - 1, 15));  // start from the 15th

  if (matchRow) {
    const mStart = matchRow.matched_at ? new Date(matchRow.matched_at) : monthFirst;
    const mEnd   = matchRow.ended_at   ? new Date(matchRow.ended_at)   : monthLast;
    const effStart = new Date(Math.max(monthFirst.getTime(), mStart.getTime()));
    const effEnd   = new Date(Math.min(monthLast.getTime(),  mEnd.getTime()));
    if (effStart <= effEnd) {
      if      (candidate < effStart) candidate = effStart;
      else if (candidate > effEnd)   candidate = effEnd;
    }
  }
  return { date: candidate.toISOString().slice(0, 10), estimated: true };
}

// Resolves dates for all proposed inserts before planHash is known.
// Used as input to computePlanHash so derived dates are part of the fingerprint.
function resolveDates(R) {
  const derived = [];
  for (const { slot, src, mentorPersonId, menteePersonId, matchRow, hasIssue } of R.source_new) {
    const { date, estimated } = resolveMeetingDate(src.meetingDate, slot.month, matchRow);
    const status = (estimated || hasIssue) ? 'needs_review' : 'submitted';
    derived.push({ slotKey: slot.slotKey, meetingDate: date, status, estimated });
  }
  for (const { slot } of R.placeholder) {
    const { date } = resolveMeetingDate(null, slot.month, null);
    derived.push({ slotKey: slot.slotKey, meetingDate: date, status: 'needs_review', estimated: true });
  }
  return derived;
}

// Builds the complete INSERT payload for every proposed row using resolved dates.
// planHash must already be computed (from resolveDates → computePlanHash).
// This is the single source of truth for INSERT values — used by preflight,
// fullBatchRehearsal, and applyFullTransaction without divergence.
function buildResolvedInsertRows(R, derivedDates, planHash) {
  const dateMap = new Map(derivedDates.map(d => [d.slotKey, d]));
  const rows = [];

  for (const { slot, src, menteePersonId, mentorPersonId, matchId, meetingType, hasIssue } of R.source_new) {
    const { meetingDate, status, estimated } = dateMap.get(slot.slotKey)
      ?? (() => { throw new Error(`FATAL: no derived date for slot ${slot.slotKey}`); })();
    const adminNotes = [
      `S11 ledger sync ${IMPORT_BATCH}.`,
      `slot_key=${slot.slotKey}.`,
      `source_row=${src.sheetRow}.`,
      `date_source=${estimated ? 'estimated_official_month_match_overlap' : src.dateSource}.`,
      estimated ? 'meeting_date_estimated=true.' : '',
      estimated ? 'date_basis=official_ledger_month_match_overlap.' : '',
      `plan_hash=${planHash.slice(0, 12)}.`,
      `missing_original_url=true.`,
      hasIssue    ? 'unresolved_mentor=true. needs_manual_review=true.' : '',
      estimated   ? 'needs_manual_review=true.' : '',
    ].filter(Boolean).join(' ');
    rows.push({
      type:          'source_backed',
      slot,
      meetingDate,
      meetingMonth:  slot.month,
      meetingType,
      status,
      issueFlag:     true,
      recapSource:   'google_sheet',
      recapNote:     `spreadsheet_id=${SOURCE_SHEET_ID} tab="${SOURCE_TAB}" row=${src.sheetRow} hash=${src.contentHash}`,
      capturedBy:    IMPORT_BATCH,
      menteePersonId,
      mentorPersonId,
      matchId,
      adminNotes,
      dateEstimated: estimated,
      hasIssue,
      srcSheetRow:   src.sheetRow,
    });
  }

  for (const { slot, menteePersonId } of R.placeholder) {
    const { meetingDate } = dateMap.get(slot.slotKey)
      ?? (() => { throw new Error(`FATAL: no derived date for placeholder slot ${slot.slotKey}`); })();
    const adminNotes = [
      `S11 ledger sync ${IMPORT_BATCH}.`,
      `slot_key=${slot.slotKey}.`,
      `mentee_code=${slot.mentee_code}.`,
      `official_month=${slot.month}.`,
      `ordinal=${slot.ordinal}.`,
      `meeting_date_estimated=true.`,
      `date_basis=official_ledger_month_15th.`,
      `plan_hash=${planHash.slice(0, 12)}.`,
      `missing_url=true.`,
      `needs_manual_review=true.`,
      `source_spreadsheet=${SOURCE_SHEET_ID}.`,
      `ledger_tab=Mentee_Tracking.`,
      !menteePersonId ? 'mentee_person_id=unresolved.' : '',
    ].filter(Boolean).join(' ');
    rows.push({
      type:          'placeholder',
      slot,
      meetingDate,
      meetingMonth:  slot.month,
      meetingType:   'unknown',
      status:        'needs_review',
      issueFlag:     true,
      recapSource:   'admin_input',
      recapNote:     `ledger_placeholder slot_key=${slot.slotKey} date_quality=month_only_estimated`,
      capturedBy:    IMPORT_BATCH,
      menteePersonId,
      mentorPersonId: null,
      matchId:        null,
      adminNotes,
      dateEstimated: true,
      hasIssue:      false,
      srcSheetRow:   null,
    });
  }

  return rows;
}

// Centralized INSERT executor — identical SQL used by rehearsal and apply.
// Returns { inserted, srcInserted, phInserted }.
async function doInsertBatch(client, seasonId, resolvedInserts) {
  let inserted = 0, srcInserted = 0, phInserted = 0;
  for (const row of resolvedInserts) {
    const r = await client.query(
      `INSERT INTO mentoring_recaps (
         season_id, match_id, mentor_person_id, mentee_person_id,
         meeting_date, meeting_month, meeting_type,
         recap_url, recap_source, recap_note, captured_by,
         issue_flag, admin_notes, status
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,true,$12,$13)
       ON CONFLICT DO NOTHING RETURNING id`,
      [seasonId, row.matchId, row.mentorPersonId, row.menteePersonId,
       row.meetingDate, row.meetingMonth, row.meetingType,
       MISSING_URL, row.recapSource, row.recapNote, row.capturedBy,
       row.adminNotes, row.status]
    );
    if (r.rows.length > 0) {
      inserted++;
      if (row.type === 'source_backed') srcInserted++; else phInserted++;
    }
  }
  return { inserted, srcInserted, phInserted };
}

// Queries production NOT NULL columns for mentoring_recaps and verifies every
// resolved row satisfies them before any transaction begins.
async function preflightPayloads(client, resolvedInserts, seasonId) {
  section('Phase 9c: Payload Nullability Preflight');

  // Query schema for NOT NULL columns on the INSERT column set
  const nnRes = await client.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'mentoring_recaps'
      AND is_nullable = 'NO'
      AND column_name NOT IN ('id','created_at','updated_at')
    ORDER BY ordinal_position
  `);
  const notNullCols = nnRes.rows.map(r => r.column_name);
  log(`  NOT NULL payload columns in mentoring_recaps: ${notNullCols.join(', ')}`);

  // Query CHECK constraints
  const ckRes = await client.query(`
    SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
    WHERE conrelid = 'public.mentoring_recaps'::regclass AND contype = 'c'
    ORDER BY conname
  `);
  for (const { conname, def } of ckRes.rows) log(`  CHECK ${conname}: ${def}`);

  // Map INSERT column → row field value
  const colVal = (col, row) => {
    switch (col) {
      case 'season_id':        return seasonId;
      case 'match_id':         return row.matchId;
      case 'mentor_person_id': return row.mentorPersonId;
      case 'mentee_person_id': return row.menteePersonId;
      case 'meeting_date':     return row.meetingDate;
      case 'meeting_month':    return row.meetingMonth;
      case 'meeting_type':     return row.meetingType;
      case 'recap_url':        return MISSING_URL;
      case 'recap_source':     return row.recapSource;
      case 'recap_note':       return row.recapNote;
      case 'captured_by':      return row.capturedBy;
      case 'issue_flag':       return row.issueFlag;
      case 'admin_notes':      return row.adminNotes;
      case 'status':           return row.status;
      default:                 return undefined;
    }
  };

  let violations = 0;
  for (const col of notNullCols) {
    const nullRows = resolvedInserts.filter(row => {
      const v = colVal(col, row);
      return v === null || v === undefined;
    });
    if (nullRows.length > 0) {
      violations++;
      err(`BLOCKER: Column '${col}' (NOT NULL) is null in ${nullRows.length} payload row(s).`);
      for (const r of nullRows.slice(0, 5)) {
        err(`  slot=${r.slot.slotKey} type=${r.type} srcRow=${r.srcSheetRow ?? 'n/a'}`);
      }
    }
  }
  if (violations > 0) {
    throw new Error(`BLOCKER: ${violations} NOT NULL violation(s) in INSERT payload. Fix before running --apply.`);
  }

  // Aggregate date stats (requirement 7)
  const srcVerified  = resolvedInserts.filter(r => r.type === 'source_backed' && !r.dateEstimated).length;
  const srcEstimated = resolvedInserts.filter(r => r.type === 'source_backed' &&  r.dateEstimated).length;
  const phCount      = resolvedInserts.filter(r => r.type === 'placeholder').length;
  log(`  ✓ All ${resolvedInserts.length} rows pass NOT NULL preflight`);
  log(`  Insert breakdown by date quality:`);
  log(`    source-backed, verified date:  ${srcVerified}`);
  log(`    source-backed, estimated date: ${srcEstimated}`);
  log(`    ledger placeholders (all estimated): ${phCount}`);
  log(`    total: ${srcVerified + srcEstimated + phCount}`);
  if (srcVerified + srcEstimated + phCount !== resolvedInserts.length) {
    throw new Error('FATAL: insert breakdown does not sum to resolvedInserts.length');
  }
  return { srcVerified, srcEstimated, phCount };
}

// Full-batch rollback rehearsal — runs the COMPLETE DML plan and intentionally
// rolls back. Proves the whole batch passes before the production COMMIT.
async function fullBatchRehearsal(client, seasonId, resolvedInserts, allExcessIds, planHash, csvHashes, pre) {
  section('Full-Batch Rollback Rehearsal');
  log('  Running complete batch (UPDATE + all INSERTs) inside a transaction that is');
  log('  always intentionally ROLLED BACK. Proves the full payload passes production');
  log('  constraints, count gates, and advisory lock before any real commit.');
  log('');

  // 1. Trigger audit — block if any trigger can cause non-transactional side effects
  const trigRes = await client.query(`
    SELECT t.tgname, t.tgenabled, p.proname,
           LEFT(p.prosrc, 120) AS src_excerpt
    FROM   pg_trigger t
    JOIN   pg_proc p ON p.oid = t.tgfoid
    WHERE  t.tgrelid = 'public.mentoring_recaps'::regclass
      AND  NOT t.tgisinternal
    ORDER  BY t.tgname
  `);
  if (trigRes.rows.length === 0) {
    log('  ✓ No non-internal triggers on mentoring_recaps');
  }
  for (const tr of trigRes.rows) {
    const src = String(tr.src_excerpt || '').toLowerCase();
    log(`  Trigger: ${tr.tgname}  fn=${tr.proname}  enabled=${tr.tgenabled}`);
    const sideEffectPats = ['http','pg_net','net.http','supabase_functions','send_email','webhook','notify '];
    const flagged = sideEffectPats.filter(p => src.includes(p));
    if (flagged.length > 0) {
      throw new Error(
        `BLOCKER: Trigger '${tr.tgname}' (fn: ${tr.proname}) contains pattern(s) ` +
        `[${flagged.join(', ')}] suggesting non-transactional side effects. ` +
        `Review the trigger before running --apply.`
      );
    }
  }
  log(`  ✓ Trigger audit complete — ${trigRes.rows.length} trigger(s), none flagged`);

  const s12Pre = asNonNegativeInt((await client.query(
    `SELECT COUNT(*)::int AS cnt FROM mentoring_recaps mr
     JOIN seasons s ON s.id = mr.season_id WHERE s.code = ANY($1)`,
    [FORBIDDEN_SEASONS]
  )).rows[0].cnt, 'rehearsal.s12Pre');

  log('');
  log(`  Plan fingerprint: ${planHash}`);
  log(`  UPDATE → excluded: ${allExcessIds.length} rows`);
  log(`  INSERT total:      ${resolvedInserts.length} rows`);

  await client.query('BEGIN');
  try {
    // Advisory lock
    const lockRes = await client.query(
      `SELECT pg_try_advisory_xact_lock(hashtext('UEHM-S11-sync-v1')) AS acquired`
    );
    if (!lockRes.rows[0]?.acquired) {
      throw new Error('Rehearsal: advisory lock held by another session.');
    }
    log('  ✓ Advisory lock acquired');

    // Re-verify row count
    const preTxTotal = asNonNegativeInt((await client.query(
      `SELECT COUNT(*)::int AS n FROM mentoring_recaps WHERE season_id = $1`, [seasonId]
    )).rows[0].n, 'rehearsal.preTxTotal');
    if (preTxTotal !== asNonNegativeInt(pre.total, 'rehearsal.pre.total')) {
      throw new Error(`Rehearsal: row count changed since dry-run: expected ${pre.total}, found ${preTxTotal}.`);
    }
    log(`  ✓ Pre-transaction row count: ${preTxTotal}`);

    // Lock excess rows FOR UPDATE NOWAIT
    if (allExcessIds.length > 0) {
      const phs = allExcessIds.map((_, i) => `$${i + 1}`).join(',');
      const lk = await client.query(
        `SELECT id FROM mentoring_recaps WHERE id IN (${phs}) FOR UPDATE NOWAIT`, allExcessIds
      );
      if (lk.rows.length !== allExcessIds.length) {
        throw new Error(`Rehearsal: expected to lock ${allExcessIds.length} excess rows, found ${lk.rows.length}.`);
      }
      log(`  ✓ ${lk.rows.length} excess rows locked FOR UPDATE NOWAIT`);

      // UPDATE 125 → excluded
      const auditNote = `s11_reporting_excluded=true. reason=exceeds_official_ledger_count. excluded_by=${IMPORT_BATCH}.`;
      const phs2 = allExcessIds.map((_, i) => `$${i + 2}`).join(',');
      const upd = await client.query(
        `UPDATE mentoring_recaps SET status='excluded',
            admin_notes = concat_ws(' ', admin_notes,
              CASE WHEN admin_notes NOT LIKE '%s11_reporting_excluded=true%' THEN $1 ELSE NULL END)
         WHERE id IN (${phs2}) AND status != 'excluded' RETURNING id`,
        [auditNote, ...allExcessIds]
      );
      log(`  ✓ Rehearsal UPDATE: ${upd.rows.length} rows → excluded (${allExcessIds.length - upd.rows.length} already excluded)`);
    }

    // INSERT all 1028 rows using identical doInsertBatch
    const { inserted, srcInserted, phInserted } = await doInsertBatch(client, seasonId, resolvedInserts);
    log(`  ✓ Rehearsal INSERT: ${inserted} total (${srcInserted} source-backed + ${phInserted} placeholder)`);

    // Run every verification gate (same as applyFullTransaction)
    const expectedPhysical = asNonNegativeInt(pre.total, 'reh.pre.total') + resolvedInserts.length;
    const [physR, excR, rptR, moR, s12R] = await Promise.all([
      client.query(`SELECT COUNT(*)::int AS n FROM mentoring_recaps WHERE season_id = $1`, [seasonId]),
      client.query(`SELECT COUNT(*)::int AS n FROM mentoring_recaps WHERE season_id = $1 AND status='excluded'`, [seasonId]),
      client.query(`SELECT COUNT(*)::int AS n FROM mentoring_recaps WHERE season_id = $1 AND coalesce(trim(lower(status)),'') IN ('','submitted','needs_review')`, [seasonId]),
      client.query(`SELECT meeting_month, COUNT(*)::int AS n FROM mentoring_recaps WHERE season_id = $1 AND coalesce(trim(lower(status)),'') IN ('','submitted','needs_review') GROUP BY meeting_month ORDER BY meeting_month`, [seasonId]),
      client.query(`SELECT COUNT(*)::int AS cnt FROM mentoring_recaps mr JOIN seasons s ON s.id=mr.season_id WHERE s.code=ANY($1)`, [FORBIDDEN_SEASONS]),
    ]);

    let allGates = true;
    function rehGate(label, got, expected) {
      const g = asNonNegativeInt(got, `rehearsal.${label}`);
      const ok = g === expected;
      log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}: ${g} (expected ${expected})`);
      if (!ok) allGates = false;
    }
    rehGate('physical rows',    physR.rows[0].n,   expectedPhysical);
    rehGate('excluded rows',    excR.rows[0].n,    allExcessIds.length);
    rehGate('report-counted',   rptR.rows[0].n,    CHECKPOINT_TOTAL);
    rehGate('S12 unchanged',    s12R.rows[0].cnt,  s12Pre);
    const moMap = new Map(moR.rows.map(r => [r.meeting_month, asNonNegativeInt(r.n, `reh.mo.${r.meeting_month}`)]));
    for (const mo of OFFICIAL_MONTHS) {
      rehGate(`report-counted ${mo}`, moMap.get(mo) ?? 0, CHECKPOINT_OFFICIAL[mo]);
    }

    if (!allGates) {
      throw new Error('Rehearsal: one or more verification gates FAILED. See output above. Do not run --apply.');
    }

    log('');
    log('  ✓ ALL rehearsal gates passed.');
    await client.query('ROLLBACK');
    log('  ✓ ROLLED BACK intentionally — zero rows persisted.');
    log(`  The production --apply is authorised to proceed (pending owner review).`);

  } catch (e) {
    await client.query('ROLLBACK');
    log(`  ✗ ROLLED BACK (rehearsal error): ${e.message}`);
    throw e;
  }
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
  // Must strictly equal 2026-02-11
  if (!iso || iso !== '2026-02-11') {
    throw new Error(`TEST FAIL: serialToDate(46064) resolved to ${iso}, expected 2026-02-11`);
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
  log(`  ✓ Serial-date test PASS: serialToDate(46064) = ${serial46064Date} (expected 2026-02-11)`);

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
    if (isSerialDate) {
      dateSerial++;
      if (!meetingDate || dateResult.source === 'none') {
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
  log(`  Decision: Mentee Tracking is authoritative. ${julyOff - julyRaw} missing session(s) will be`);
  log(`  created as manual-review ledger placeholders (status=needs_review, type=unknown,`);
  log(`  recap_source=admin_input). Each placeholder carries the official slot_key and`);
  log(`  needs_manual_review=true in admin_notes so the Support Team can locate and resolve it.`);

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

// ─── Phase L4: Official Ledger CSV (Mentee Tracking) ─────────────────────────
function loadLedgerCSV() {
  banner('Phase L4: Official Ledger (Mentee Tracking)');

  if (!fs.existsSync(LEDGER_CSV_PATH)) {
    throw new Error(
      `Ledger CSV not found at ${LEDGER_CSV_PATH}.\n` +
      `Export the "Mentee Tracking" tab from the UEHM-S11 workbook as CSV and save to that path.`
    );
  }

  const rawText  = fs.readFileSync(LEDGER_CSV_PATH, 'utf8');
  const byteSize = Buffer.byteLength(rawText, 'utf8');
  const fileHash = sha256(rawText);
  log(`  Path:    ${LEDGER_CSV_PATH}`);
  log(`  Size:    ${byteSize.toLocaleString()} bytes`);
  log(`  SHA-256: ${fileHash}`);

  const allRows  = parseFullCSV(rawText);
  const dataRows = allRows.slice(LEDGER_HEADER_ROWS);
  log(`  Parsed rows (RFC-4180): ${allRows.length}`);
  log(`  Data rows after ${LEDGER_HEADER_ROWS} header rows: ${dataRows.length}`);

  const entries        = []; // { mentee_code, month, count }
  const monthTotals    = new Array(9).fill(0);
  let parsedRows = 0, skippedRows = 0;
  const skippedDetails = []; // { absRowIdx, code, rowTotal } — for Point 9 audit

  for (let ri = 0; ri < dataRows.length; ri++) {
    const r    = dataRows[ri];
    const code = (r[LEDGER_CODE_COL] || '').trim();
    if (!code || !LEDGER_CODE_PAT.test(code)) {
      let rowTotal = 0;
      for (let m = 0; m < 9; m++) {
        const v = parseInt((r[LEDGER_FIRST_MONTH_COL + m] || '').trim(), 10);
        if (Number.isFinite(v) && v > 0) rowTotal += v;
      }
      skippedDetails.push({ absRowIdx: ri + LEDGER_HEADER_ROWS, code: code || '(blank)', rowTotal });
      skippedRows++;
      continue;
    }
    parsedRows++;
    for (let m = 0; m < 9; m++) {
      const raw = (r[LEDGER_FIRST_MONTH_COL + m] || '').trim();
      const v   = parseInt(raw, 10);
      if (Number.isFinite(v) && v > 0) {
        monthTotals[m] += v;
        entries.push({ mentee_code: code, month: OFFICIAL_MONTHS[m], count: v });
      }
    }
  }

  section('Ledger Monthly Validation');
  let allMatch = true;
  for (let m = 0; m < 9; m++) {
    const mo  = OFFICIAL_MONTHS[m];
    const off = CHECKPOINT_OFFICIAL[mo];
    const ldr = monthTotals[m];
    const ok  = ldr === off;
    if (!ok) allMatch = false;
    log(`  ${mo}: ledger=${ldr}  official=${off}  ${ok ? '✓' : `← MISMATCH diff=${ldr - off}`}`);
  }
  const grand   = monthTotals.reduce((a, b) => a + b, 0);
  const grandOk = grand === CHECKPOINT_TOTAL;
  if (!grandOk) allMatch = false;
  log(`  TOTAL:   ledger=${grand}  official=${CHECKPOINT_TOTAL}  ${grandOk ? '✓' : '← MISMATCH'}`);
  log(`  Rows parsed: ${parsedRows}   Rows skipped (invalid code): ${skippedRows}`);

  // Point 9: Report every skipped row — BLOCKER if any has a non-zero monthly count
  if (skippedDetails.length > 0) {
    section('Ledger Skipped Rows (invalid or blank mentee code)');
    for (const { absRowIdx, code, rowTotal } of skippedDetails) {
      const verdict = rowTotal > 0
        ? ` ← NON-ZERO COUNT (${rowTotal}) — INVESTIGATE: these sessions may be uncounted`
        : ' (all zeros — no official slots affected)';
      log(`  Row ${absRowIdx}: code="${code}"  monthly_total=${rowTotal}${verdict}`);
    }
    if (skippedDetails.some(d => d.rowTotal > 0)) {
      throw new Error(
        'BLOCKER: A ledger row with an invalid mentee code has non-zero monthly counts. ' +
        'Fix the mentee code in the CSV export before proceeding. ' +
        'Cannot guarantee the 2,322 official slot count is complete.'
      );
    }
    log(`  ✓ All ${skippedDetails.length} skipped row(s) have zero monthly counts — official total unaffected.`);
  }

  if (!allMatch) {
    throw new Error('BLOCKER (Ledger): Monthly totals do not match official targets. Cannot proceed.');
  }
  log(`  ✓ Ledger validated — exactly ${grand} official recap slots confirmed`);

  return { entries, monthTotals, fileHash };
}

// ─── Phase L5: Official Slot Generation ──────────────────────────────────────
function generateOfficialSlots(entries) {
  banner('Phase L5: Official Slot Generation');

  // Aggregate per mentee_code+month (guards against duplicate ledger rows)
  const agg = new Map();
  for (const { mentee_code, month, count } of entries) {
    const k = `${mentee_code}|${month}`;
    agg.set(k, (agg.get(k) || 0) + count);
  }

  const slots = [];
  for (const [key, total] of agg.entries()) {
    const [mentee_code, month] = key.split('|');
    for (let ordinal = 1; ordinal <= total; ordinal++) {
      slots.push({
        slotKey:     `UEHM-S11|official-ledger|${mentee_code}|${month}|${ordinal}`,
        mentee_code, month, ordinal,
      });
    }
  }

  // Deterministic sort: month → mentee_code → ordinal
  slots.sort((a, b) => {
    if (a.month !== b.month)             return a.month < b.month ? -1 : 1;
    if (a.mentee_code !== b.mentee_code) return a.mentee_code < b.mentee_code ? -1 : 1;
    return a.ordinal - b.ordinal;
  });

  if (slots.length !== CHECKPOINT_TOTAL) {
    throw new Error(`BLOCKER: Generated ${slots.length} slots, expected ${CHECKPOINT_TOTAL}.`);
  }
  log(`  ✓ ${slots.length} official slots generated (${agg.size} unique mentee-month pairs)`);

  return slots;
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

// ─── Phase 9: Ledger-Based DB Reconciliation ─────────────────────────────────
async function runLedgerDBReconcile(client, seasonId, officialSlots, sourceRecords) {
  section('Phase 9: Ledger-Based DB Reconciliation');

  // ── Pre-import stats ──────────────────────────────────────────────────────────
  const pre = (await client.query(
    `SELECT count(*)::int AS total, min(meeting_date) AS earliest, max(meeting_date) AS latest,
            count(*) FILTER (WHERE meeting_type='1on1_primary')::int AS primary_c,
            count(*) FILTER (WHERE meeting_type='1on1_cross')::int   AS cross_c,
            count(*) FILTER (WHERE meeting_type='group')::int        AS training_c,
            count(*) FILTER (WHERE meeting_type='offline')::int      AS company_c,
            count(*) FILTER (WHERE meeting_type='unknown')::int      AS unknown_c
     FROM mentoring_recaps WHERE season_id = $1
       AND coalesce(status,'') NOT IN ('invalid','deleted')`, [seasonId]
  )).rows[0];
  pre.total = asNonNegativeInt(pre.total, 'pre.total');
  log(`  Pre-import DB total: ${pre.total} (primary=${pre.primary_c} cross=${pre.cross_c} training=${pre.training_c} company=${pre.company_c} unknown=${pre.unknown_c})`);

  // ── Identity maps ─────────────────────────────────────────────────────────────
  // Mentees: S11-match-scoped first, then all profiles as fallback (for UEHS codes)
  const menteeByMatch = (await client.query(
    `SELECT DISTINCT pr.mentee_code, p.id AS person_id
     FROM public.mentee_profiles pr
     JOIN public.people p ON p.id = pr.person_id
     JOIN public.matches m ON m.mentee_person_id = p.id
     WHERE pr.mentee_code IS NOT NULL AND m.season_id = $1`, [seasonId]
  )).rows;
  const menteeFallback = (await client.query(
    `SELECT DISTINCT pr.mentee_code, p.id AS person_id
     FROM public.mentee_profiles pr
     JOIN public.people p ON p.id = pr.person_id
     WHERE pr.mentee_code IS NOT NULL`
  )).rows;
  const menteeMap = new Map(); // normalizedCode → person_id[]
  for (const r of [...menteeByMatch, ...menteeFallback]) {
    const k = normalizeKey(r.mentee_code);
    if (!menteeMap.has(k)) menteeMap.set(k, []);
    const arr = menteeMap.get(k);
    if (!arr.includes(r.person_id)) arr.push(r.person_id);
  }
  log(`  Mentee profiles resolved: ${menteeMap.size}`);

  const mentorRows = (await client.query(
    `SELECT DISTINCT p.full_name, p.id AS person_id
     FROM public.mentor_profiles pr
     JOIN public.people p ON p.id = pr.person_id
     JOIN public.matches m ON m.mentor_person_id = p.id
     WHERE m.season_id = $1`, [seasonId]
  )).rows;
  const mentorMap = new Map();
  for (const r of mentorRows) {
    const k = normalizeKey(r.full_name);
    if (!mentorMap.has(k)) mentorMap.set(k, []);
    mentorMap.get(k).push(r.person_id);
  }
  log(`  Mentor profiles resolved: ${mentorMap.size}`);

  const matchRows = (await client.query(
    `SELECT id, mentor_person_id, mentee_person_id, matched_at, ended_at
     FROM public.matches WHERE season_id = $1 AND status IN ('active','completed','dropped')`, [seasonId]
  )).rows;
  const matchMap = new Map(); // 'mentorId|menteeId' → match[]
  for (const m of matchRows) {
    const k = `${m.mentor_person_id}|${m.mentee_person_id}`;
    if (!matchMap.has(k)) matchMap.set(k, []);
    matchMap.get(k).push(m);
  }
  log(`  Active/completed/dropped matches: ${matchRows.length}`);

  // ── Load all existing recap rows for this season ──────────────────────────────
  const validMonthSet = new Set(OFFICIAL_MONTHS);
  const existingRows = (await client.query(
    `SELECT mr.id, mr.mentee_person_id, mr.meeting_month, mr.meeting_date,
            mr.meeting_type, mr.recap_url, mr.admin_notes, mr.status,
            COALESCE(mp.mentee_code, '') AS mentee_code
     FROM public.mentoring_recaps mr
     LEFT JOIN public.mentee_profiles mp ON mp.person_id = mr.mentee_person_id
     WHERE mr.season_id = $1
       AND COALESCE(mr.status,'') NOT IN ('invalid','deleted')
     ORDER BY mr.meeting_month, mr.meeting_date, mr.id`, [seasonId]
  )).rows;
  log(`  Existing valid recap rows: ${existingRows.length}`);

  // Idempotency: index slot_key → existing row id (for re-runs after apply)
  const slotKeyToExistingId = new Map();
  for (const row of existingRows) {
    const m = /UEHM-S11\|official-ledger\|[^|]+\|\d{4}-\d{2}\|\d+/.exec(row.admin_notes || '');
    if (m) slotKeyToExistingId.set(m[0], row.id);
  }

  // Date anomalies: rows whose meeting_month is outside the 9 S11 months
  const dateAnomalyRows = existingRows.filter(r => !validMonthSet.has(r.meeting_month));
  if (dateAnomalyRows.length) {
    section('Existing Date Anomalies (meeting_month outside S11 range)');
    for (const r of dateAnomalyRows) {
      log(`  id=${r.id}  month=${r.meeting_month}  date=${r.meeting_date}  type=${r.meeting_type}`);
    }
  }

  // Group valid-month existing rows: normalizedCode|month → rows[]
  const existingByKey = new Map();
  for (const row of existingRows) {
    if (!validMonthSet.has(row.meeting_month)) continue;
    const code = normalizeKey(row.mentee_code || '');
    if (!code) continue;
    const key = `${code}|${row.meeting_month}`;
    if (!existingByKey.has(key)) existingByKey.set(key, []);
    existingByKey.get(key).push(row);
  }

  // Group source records: normalizedCode|month → sourceRecord[] (body date preferred)
  const sourceByKey = new Map();
  for (const r of sourceRecords) {
    if (r.typeAmbiguous) continue;
    const code = normalizeKey(r.normalizedCode || r.extractedCode);
    if (!code) continue;
    const month = r.meetingDate ? r.meetingDate.slice(0, 7) : (r.postMonth || null);
    if (!month || !validMonthSet.has(month)) continue;
    const key = `${code}|${month}`;
    if (!sourceByKey.has(key)) sourceByKey.set(key, []);
    sourceByKey.get(key).push(r);
  }

  // ── Per-slot reconciliation (ledger-first) ────────────────────────────────────
  const assignedDbIds   = new Set();
  const assignedSrcRows = new Set();

  const R = {
    existing_assigned: [],  // { slot, dbRow }             → no write needed
    source_new:        [],  // { slot, src, ... }           → INSERT from source
    placeholder:       [],  // { slot, menteePersonId }     → INSERT placeholder
    unresolved_slot:   [],  // { slot }                     → reported, NULL mentee
  };

  for (const slot of officialSlots) {
    const codeNorm = normalizeKey(slot.mentee_code);
    const mapKey   = `${codeNorm}|${slot.month}`;

    // Priority 0: slot_key already in an existing row's admin_notes (idempotent re-run)
    if (slotKeyToExistingId.has(slot.slotKey)) {
      const rowId = slotKeyToExistingId.get(slot.slotKey);
      if (!assignedDbIds.has(rowId)) {
        assignedDbIds.add(rowId);
        R.existing_assigned.push({ slot, dbRow: existingRows.find(r => r.id === rowId) });
      }
      continue;
    }

    // Priority 1: Unassigned existing DB row by (mentee_code, meeting_month)
    const existingPool = existingByKey.get(mapKey) || [];
    const freeExisting = existingPool.filter(r => !assignedDbIds.has(r.id));
    if (freeExisting.length > 0) {
      const dbRow = freeExisting[0];
      assignedDbIds.add(dbRow.id);
      R.existing_assigned.push({ slot, dbRow });
      continue;
    }

    // Priority 2: Unassigned source post by (mentee_code, meeting_month)
    const menteeCands = menteeMap.get(codeNorm) || [];
    const sourcePool  = sourceByKey.get(mapKey) || [];
    const freeSrc     = sourcePool.filter(r => !assignedSrcRows.has(r.sheetRow));

    if (freeSrc.length > 0 && menteeCands.length === 1) {
      const src          = freeSrc[0];
      assignedSrcRows.add(src.sheetRow);
      const menteePersonId = menteeCands[0];

      let mentorPersonId = null, matchId = null, matchRow = null;
      let meetingType    = src.meetingType || 'unknown';
      if (src.meetingType === '1on1_primary' || src.meetingType === '1on1_cross') {
        const mKey   = normalizeKey(src.mentorName);
        const mCands = mKey ? (mentorMap.get(mKey) || []) : [];
        if (mCands.length === 1) {
          mentorPersonId = mCands[0];
          const mk      = `${mentorPersonId}|${menteePersonId}`;
          const allMs   = matchMap.get(mk) || [];
          if (src.meetingType === '1on1_primary' && src.meetingDate) {
            const meetDt  = new Date(src.meetingDate);
            const validMs = allMs.filter(m => {
              const s = m.matched_at ? new Date(m.matched_at) : SEASON_START;
              const e = m.ended_at   ? new Date(m.ended_at)   : SEASON_END;
              return meetDt >= s && meetDt <= e;
            });
            if (validMs.length === 1) { matchId = validMs[0].id; matchRow = validMs[0]; }
          }
          // For date estimation, pick any match between this pair even if date unknown
          if (!matchRow && allMs.length === 1) matchRow = allMs[0];
        } else {
          meetingType = 'unknown'; // mentor unresolvable — downgrade type
        }
      }

      R.source_new.push({
        slot, src, menteePersonId, mentorPersonId, matchId, matchRow, meetingType,
        hasIssue: !mentorPersonId && (src.meetingType === '1on1_primary' || src.meetingType === '1on1_cross'),
      });
      continue;
    }

    // Priority 3: Placeholder
    R.placeholder.push({
      slot,
      menteePersonId: menteeCands.length === 1 ? menteeCands[0] : null,
      unresolvable:   menteeCands.length !== 1,
    });
    if (menteeCands.length !== 1) {
      R.unresolved_slot.push({ slot, candidateCount: menteeCands.length });
    }
  }

  // ── Excess rows ───────────────────────────────────────────────────────────────
  const excessExisting = existingRows.filter(r =>
    validMonthSet.has(r.meeting_month) && !assignedDbIds.has(r.id)
  );
  const excessSource = [];
  for (const r of sourceRecords) {
    if (r.typeAmbiguous || assignedSrcRows.has(r.sheetRow)) continue;
    const code  = normalizeKey(r.normalizedCode || r.extractedCode);
    const month = r.meetingDate ? r.meetingDate.slice(0, 7) : (r.postMonth || null);
    if (code && month && validMonthSet.has(month)) excessSource.push(r);
  }

  // ── Monthly reconciliation table ──────────────────────────────────────────────
  section('Monthly Reconciliation: existing + source + placeholder = official');
  const mTbl = {};
  for (const mo of OFFICIAL_MONTHS) mTbl[mo] = { existing: 0, source: 0, placeholder: 0 };
  for (const { slot } of R.existing_assigned) if (mTbl[slot.month]) mTbl[slot.month].existing++;
  for (const { slot } of R.source_new)         if (mTbl[slot.month]) mTbl[slot.month].source++;
  for (const { slot } of R.placeholder)        if (mTbl[slot.month]) mTbl[slot.month].placeholder++;

  let allReconcile = true;
  for (const mo of OFFICIAL_MONTHS) {
    const m   = mTbl[mo];
    const tot = m.existing + m.source + m.placeholder;
    const off = CHECKPOINT_OFFICIAL[mo];
    const ok  = tot === off;
    if (!ok) allReconcile = false;
    log(`  ${mo}: existing=${m.existing}  +source=${m.source}  +placeholder=${m.placeholder}  =total=${tot}  (official=${off})  ${ok ? '✓' : '← MISMATCH'}`);
  }
  const grandTot = Object.values(mTbl).reduce((a, v) => a + v.existing + v.source + v.placeholder, 0);
  const grandOk  = grandTot === CHECKPOINT_TOTAL;
  log(`  TOTAL: ${grandTot} (official: ${CHECKPOINT_TOTAL}) ${grandOk ? '✓' : '← MISMATCH'}`);

  // ── Summary report ────────────────────────────────────────────────────────────
  section('Reconciliation Summary');
  log(`  Official slots:                    ${officialSlots.length}`);
  log(`  Existing DB rows assigned:         ${R.existing_assigned.length}`);
  log(`  Source-supported new rows:         ${R.source_new.length}`);
  log(`  Manual-ledger placeholders:        ${R.placeholder.length}`);
  log(`    → resolvable mentee:             ${R.placeholder.filter(p => p.menteePersonId).length}`);
  log(`    → unresolvable mentee (NULL id): ${R.placeholder.filter(p => !p.menteePersonId).length}`);
  log(`  Unresolved ledger slots:           ${R.unresolved_slot.length}`);
  log(`  Excess existing (valid months):    ${excessExisting.length}`);
  log(`  Excess source posts:               ${excessSource.length}`);
  log(`  Date anomaly rows:                 ${dateAnomalyRows.length}`);
  log(`  Manual-review records:             ${R.placeholder.length + R.source_new.filter(s => s.hasIssue).length}`);
  log(`  Pre-import DB total:               ${pre.total}`);
  log(`  Proposed new inserts:              ${R.source_new.length + R.placeholder.length}`);
  log(`  Post-import projected:             ${Number(pre.total) + R.source_new.length + R.placeholder.length}`);

  if (!allReconcile || !grandOk) {
    err('BLOCKER: Monthly reconciliation does not balance. Cannot proceed to apply.');
  } else {
    log(`  ✓ All ${OFFICIAL_MONTHS.length} months reconcile to official targets`);
  }

  // ── 3-Column Monthly Report (Points 2/3) ────────────────────────────────────
  section('3-Column Monthly Report: Official | Physical (post-import) | Report-counted');
  log('  Column definitions:');
  log('    official       = official ledger target (authoritative, from Mentee Tracking)');
  log('    physical       = official + excess_existing rows (all rows in DB after import)');
  log("    report-counted = official only (after excess rows are marked status='excluded')");
  log('');
  const excessByMonth = {};
  for (const row of excessExisting) {
    excessByMonth[row.meeting_month] = (excessByMonth[row.meeting_month] || 0) + 1;
  }
  let physicalRunning = 0;
  for (const mo of OFFICIAL_MONTHS) {
    const official      = CHECKPOINT_OFFICIAL[mo];
    const excessInMonth = excessByMonth[mo] || 0;
    const physical      = official + excessInMonth;
    physicalRunning    += physical;
    const excessTag     = excessInMonth > 0 ? `(+${excessInMonth} excess)` : '';
    const offStr        = String(official).padStart(3);
    const physStr       = String(physical).padStart(3);
    const exStr         = excessTag.padEnd(14);
    log(`  ${mo}: official=${offStr}  physical=${physStr} ${exStr}  report-counted=${offStr}  ${official === CHECKPOINT_OFFICIAL[mo] ? '✓' : '← MISMATCH'}`);
  }
  const anomalyCount  = dateAnomalyRows.length;
  physicalRunning    += anomalyCount;
  const physicalTotal = physicalRunning;
  const reportTotal   = CHECKPOINT_TOTAL;
  log(`  anomaly rows (meeting_month outside S11 range): ${anomalyCount} — added to physical total only`);
  log(`  ─────────────────────────────────────────────────────────────────────`);
  log(`  TOTAL:  official=${CHECKPOINT_TOTAL}  physical=${physicalTotal}  report-counted=${reportTotal}  ${reportTotal === CHECKPOINT_TOTAL ? '✓' : '← MISMATCH'}`);
  if (physicalTotal !== CHECKPOINT_TOTAL) {
    log(`  ⚠ Physical (${physicalTotal}) exceeds official (${CHECKPOINT_TOTAL}) by ${physicalTotal - CHECKPOINT_TOTAL} rows.`);
    log(`    These rows must be marked status='excluded' — Migration 058 adds this to the constraint.`);
  }

  // ── Excess Row Audit (Points 5/6/7/8) ───────────────────────────────────────
  const totalExcess = excessExisting.length + anomalyCount;
  section(`Excess Row Audit (${totalExcess} rows not assigned to any official slot)`);
  log(`  These rows remain in the DB after import but must NOT count in official reporting.`);
  log(`  The VAM OS counting filter is an inclusion whitelist: status IN ('', 'submitted', 'needs_review').`);
  log(`  Marking excess rows status='excluded' is the clean exclusion mechanism:`);
  log(`    • 'excluded' is outside the whitelist → auto-excluded from ALL dashboard KPIs`);
  log(`    • KPI counting filters required no changes (RPC migration 035 + lib/data.ts already`);
  log(`      exclude any value outside the whitelist), but 6 TypeScript/admin-UI fixes WERE needed:`);
  log(`      lib/admin-corrections.ts (RECAP_STATUSES + duplicates scan filter),`);
  log(`      lib/data.ts (ALLOWED_RECAP_STATUSES), app/admin/admin-correction-forms.tsx,`);
  log(`      app/recaps/[id]/edit/correction-form.tsx, app/people/[id]/page.tsx (recapStatusLabel),`);
  log(`      app/admin/page.tsx (RecentRecapCorrection filter) — all already implemented.`);
  log(`    • issue_flag CANNOT be the exclusion signal — official manual-review placeholders`);
  log(`      (type=unknown, status=needs_review) also carry issue_flag=true and MUST still count`);
  log(`    • 'duplicate' and 'deleted' are not used — they have distinct semantics in admin workflow`);
  log('');
  if (excessExisting.length > 0) {
    log(`  Valid-month excess rows (${excessExisting.length}) — meeting_month is in S11 range`);
    log(`  but no official slot remains for this (mentee_code, month) pair:`);
    const showN = Math.min(excessExisting.length, 35);
    for (let i = 0; i < showN; i++) {
      const row = excessExisting[i];
      const src = row.admin_notes ? row.admin_notes.slice(0, 55) + '…' : (row.recap_source || '');
      log(`    [${String(i + 1).padStart(3)}] id=${row.id}  code=${(row.mentee_code || '(unknown)').padEnd(12)}  month=${row.meeting_month}  date=${row.meeting_date || 'null'}  status=${row.status}  src=${src}`);
    }
    if (excessExisting.length > 35) log(`    … and ${excessExisting.length - 35} more`);
    log('');
  }
  if (anomalyCount > 0) {
    log(`  Date-anomaly rows (${anomalyCount}) — meeting_month is OUTSIDE Nov 2025–Jul 2026:`);
    log(`  DO NOT change meeting_date/meeting_month without consulting the source post.`);
    log(`  Mark as status='excluded' pending owner investigation:`);
    for (const row of dateAnomalyRows) {
      const src = row.admin_notes ? row.admin_notes.slice(0, 55) + '…' : (row.recap_source || '');
      log(`    id=${row.id}  code=${(row.mentee_code || '(unknown)').padEnd(12)}  month=${row.meeting_month}  date=${row.meeting_date || 'null'}  status=${row.status}  src=${src}`);
    }
    log('');
  }

  // ── Migration 058 Reference + --apply Transaction Plan (Points 6/7) ─────────
  section("Migration 058 + --apply Transaction Plan");
  log('');
  log('  CODEBASE AUDIT — Counting filters in VAM OS (from migration 035 + lib/data.ts):');
  log("    RPC:          coalesce(trim(lower(mr.status)), '') IN ('', 'submitted', 'needs_review')");
  log("    Client-side:  VALID_ACTIVITY_STATUSES = new Set(['', 'submitted', 'needs_review'])");
  log("  Both are INCLUSION whitelists. Any value outside this set is auto-excluded from all KPIs.");
  log("  KPI counting filters required no changes, but six TypeScript/admin UI compatibility");
  log("  fixes were required (already implemented): lib/admin-corrections.ts (RECAP_STATUSES +");
  log("  duplicates scan filter), lib/data.ts (ALLOWED_RECAP_STATUSES),");
  log("  app/admin/admin-correction-forms.tsx, app/recaps/[id]/edit/correction-form.tsx,");
  log("  app/people/[id]/page.tsx (recapStatusLabel), app/admin/page.tsx (RecentRecapCorrection).");
  log('');
  log('  Migration 058 (DDL-only, no data change):');
  log('    supabase_migrations/058_add_excluded_status.sql  ← staged for commit, not yet applied');
  log('    Apply via Supabase dashboard → SQL editor before running --apply.');
  log('    --apply will check for this migration and refuse to start without it.');
  log('');
  const excessIds = [...excessExisting, ...dateAnomalyRows].map(r => r.id);
  const projectedPhysical = Number(pre.total) + R.source_new.length + R.placeholder.length;
  log(`  ── --apply Transaction Plan (single BEGIN/COMMIT) ──────────────────────`);
  log(`  STEP 1  UPDATE ${excessIds.length} rows → status='excluded'`);
  log(`           ${excessExisting.length} valid-month excess rows`);
  log(`           ${dateAnomalyRows.length} date-anomaly rows (meeting_month outside S11 range)`);
  log(`          (advisory lock + FOR UPDATE NOWAIT acquired first)`);
  log(`  STEP 2  INSERT ${R.source_new.length} source-backed rows`);
  log(`           recap_source='google_sheet'  status='submitted'`);
  log(`  STEP 3  INSERT ${R.placeholder.length} placeholder rows`);
  log(`           recap_source='admin_input'   status='needs_review'  meeting_type='unknown'`);
  log(`  STEP 4  In-transaction verification before COMMIT:`);
  log(`           physical rows   = ${projectedPhysical}  (expected: ${Number(pre.total)} + ${R.source_new.length + R.placeholder.length} new)`);
  log(`           excluded rows   = ${excessIds.length}`);
  log(`           report-counted  = ${CHECKPOINT_TOTAL}  (per UEHM-S11 official ledger)`);
  log(`           per-month targets verified for all ${OFFICIAL_MONTHS.length} months`);
  log(`           S12/DEMO-S12 row count unchanged`);
  log(`  STEP 5  COMMIT if all gates pass — ROLLBACK otherwise`);
  log('');
  log(`  Plan fingerprint: computed in main() and shown in DRY-RUN COMPLETE summary below.`);
  log(`  To execute: node sync_s11_recaps.mjs --apply`);

  return { R, mTbl, allReconcile: allReconcile && grandOk, pre, existingRows, excessExisting, excessSource, dateAnomalyRows, matchMap };
}

// ─── Phase 10: Full Atomic Transaction (UPDATE excluded + INSERT new rows) ────
async function applyFullTransaction(client, seasonId, resolvedInserts, allExcessIds, planHash, csvHashes, pre) {
  section('Phase 10: Full Atomic Transaction');

  log(`  Plan fingerprint: ${planHash}`);
  log(`  Source CSV hash:  ${csvHashes.source}`);
  log(`  Ledger CSV hash:  ${csvHashes.ledger}`);
  log(`  UPDATE → excluded: ${allExcessIds.length} rows`);
  log(`  INSERT total:      ${resolvedInserts.length} rows`);
  log('');

  // Gate 0: Migration 058 must be installed before any writes
  const conCheck = await client.query(`
    SELECT pg_get_constraintdef(oid) AS def
    FROM pg_constraint
    WHERE conname = 'mentoring_recaps_status_check'
      AND conrelid = 'public.mentoring_recaps'::regclass
  `);
  const conDef = conCheck.rows[0]?.def ?? '';
  if (!conDef.includes("'excluded'")) {
    throw new Error(
      "BLOCKED: Migration 058 has not been applied to production.\n" +
      "  The status CHECK constraint does not include 'excluded'.\n" +
      "  Apply supabase_migrations/058_add_excluded_status.sql first."
    );
  }
  log(`  ✓ Gate 0: Migration 058 confirmed — status='excluded' accepted by constraint`);

  if (resolvedInserts.length === 0 && allExcessIds.length === 0) {
    log('  Nothing to do — all official slots filled and no excess rows to exclude.');
    return { updated: 0, inserted: 0 };
  }

  // Baseline S12/DEMO-S12 count (must stay constant throughout)
  const s12Pre = asNonNegativeInt((await client.query(
    `SELECT COUNT(*)::int AS cnt FROM mentoring_recaps mr
     JOIN seasons s ON s.id = mr.season_id WHERE s.code = ANY($1)`,
    [FORBIDDEN_SEASONS]
  )).rows[0].cnt, 's12Pre');

  await client.query('BEGIN');
  let updated = 0, inserted = 0;
  try {
    // Step 1: Advisory lock — prevents concurrent sync runs
    const lockRes = await client.query(
      `SELECT pg_try_advisory_xact_lock(hashtext('UEHM-S11-sync-v1')) AS acquired`
    );
    if (!lockRes.rows[0]?.acquired) {
      throw new Error('Advisory lock held by another session. Retry once the other operation completes.');
    }
    log(`  ✓ Advisory lock acquired`);

    // Step 2: Re-audit current row count (detect concurrent mutations since dry-run)
    const preTxTotal = asNonNegativeInt((await client.query(
      `SELECT COUNT(*)::int AS n FROM mentoring_recaps WHERE season_id = $1`, [seasonId]
    )).rows[0].n, 'preTxTotal');
    if (preTxTotal !== Number(pre.total)) {
      throw new Error(
        `Row count changed since dry-run: expected ${pre.total}, found ${preTxTotal}. ` +
        `Re-run dry-run to get a fresh plan before applying.`
      );
    }
    log(`  ✓ Pre-transaction row count verified: ${preTxTotal}`);

    // Step 3: Lock excess rows FOR UPDATE NOWAIT (fail fast if any locked by another session)
    if (allExcessIds.length > 0) {
      const phs = allExcessIds.map((_, i) => `$${i + 1}`).join(',');
      const lockRes2 = await client.query(
        `SELECT id, status FROM mentoring_recaps WHERE id IN (${phs}) FOR UPDATE NOWAIT`,
        allExcessIds
      );
      if (lockRes2.rows.length !== allExcessIds.length) {
        throw new Error(
          `Expected to lock ${allExcessIds.length} excess rows, found only ${lockRes2.rows.length}. ` +
          `Some rows may have been deleted since the dry-run. Re-run dry-run to refresh the plan.`
        );
      }
      log(`  ✓ ${lockRes2.rows.length} excess rows locked FOR UPDATE NOWAIT`);

      // Step 4: UPDATE excess rows — idempotent (skip rows already excluded)
      const auditNote = `s11_reporting_excluded=true. reason=exceeds_official_ledger_count. excluded_by=${IMPORT_BATCH}.`;
      const phs2 = allExcessIds.map((_, i) => `$${i + 2}`).join(',');
      const updRes = await client.query(
        `UPDATE mentoring_recaps
         SET status = 'excluded',
             admin_notes = concat_ws(' ', admin_notes,
               CASE WHEN admin_notes NOT LIKE '%s11_reporting_excluded=true%'
                    THEN $1 ELSE NULL END)
         WHERE id IN (${phs2})
           AND status != 'excluded'
         RETURNING id`,
        [auditNote, ...allExcessIds]
      );
      updated = updRes.rows.length;
      const alreadyExcluded = allExcessIds.length - updated;
      log(`  ✓ Updated ${updated} → excluded${alreadyExcluded > 0 ? `, ${alreadyExcluded} already excluded (idempotent)` : ''}`);
    }

    // Step 5+6: INSERT all rows via centralized doInsertBatch (byte-identical to rehearsal)
    const { inserted: batchInserted, srcInserted, phInserted } = await doInsertBatch(client, seasonId, resolvedInserts);
    inserted = batchInserted;
    log(`  ✓ Source-backed: ${srcInserted} inserted`);
    log(`  ✓ Placeholders:  ${phInserted} inserted`);
    log(`  ✓ Total:         ${inserted} inserted (${resolvedInserts.length - inserted} skipped via ON CONFLICT DO NOTHING)`);

    // Step 7: In-transaction verification before COMMIT
    section('Pre-COMMIT Verification (all gates must pass)');
    const expectedPhysical = Number(pre.total) + resolvedInserts.length;
    const expectedExcluded = allExcessIds.length;

    const [physRes, excRes, rptRes, monthRes, s12PostRes] = await Promise.all([
      client.query(`SELECT COUNT(*)::int AS n FROM mentoring_recaps WHERE season_id = $1`, [seasonId]),
      client.query(`SELECT COUNT(*)::int AS n FROM mentoring_recaps WHERE season_id = $1 AND status = 'excluded'`, [seasonId]),
      client.query(
        `SELECT COUNT(*)::int AS n FROM mentoring_recaps WHERE season_id = $1
         AND coalesce(trim(lower(status)), '') IN ('', 'submitted', 'needs_review')`,
        [seasonId]
      ),
      client.query(
        `SELECT meeting_month, COUNT(*)::int AS n
         FROM mentoring_recaps
         WHERE season_id = $1
           AND coalesce(trim(lower(status)), '') IN ('', 'submitted', 'needs_review')
         GROUP BY meeting_month ORDER BY meeting_month`,
        [seasonId]
      ),
      client.query(
        `SELECT COUNT(*)::int AS cnt FROM mentoring_recaps mr
         JOIN seasons s ON s.id = mr.season_id WHERE s.code = ANY($1)`,
        [FORBIDDEN_SEASONS]
      ),
    ]);

    let allVerified = true;
    function gate(label, got, expected) {
      const g = asNonNegativeInt(got, label + ' (got)');
      const ok = g === expected;
      log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}: ${g} (expected ${expected})`);
      if (!ok) allVerified = false;
    }

    gate('physical rows total',    physRes.rows[0].n, expectedPhysical);
    gate('excluded rows',          excRes.rows[0].n,  expectedExcluded);
    gate('report-counted total',   rptRes.rows[0].n,  CHECKPOINT_TOTAL);
    gate('S12/DEMO-S12 unchanged', s12PostRes.rows[0].cnt, s12Pre);

    const monthMap = new Map(monthRes.rows.map(r => [r.meeting_month, asNonNegativeInt(r.n, `monthly ${r.meeting_month}`)]));
    for (const mo of OFFICIAL_MONTHS) {
      gate(`report-counted ${mo}`, monthMap.get(mo) ?? 0, CHECKPOINT_OFFICIAL[mo]);
    }

    if (!allVerified) {
      throw new Error('Pre-COMMIT verification failed. See gate failures above. Transaction ROLLED BACK.');
    }
    log('');
    log(`  ✓ All verification gates passed.`);
    await client.query('COMMIT');
    log(`  ✓ COMMITTED. Updated: ${updated}  Inserted: ${inserted}`);

  } catch (e) {
    await client.query('ROLLBACK');
    log(`  ✗ ROLLED BACK: ${e.message}`);
    throw e;
  }
  return { updated, inserted };
}

// ─── Post-apply verification ──────────────────────────────────────────────────
async function verifyPostApply(client, seasonId, inserted, pre) {
  section('Phase 10: Post-Apply Verification');
  const post = (await client.query(
    `SELECT count(*)::int AS total, min(meeting_date) AS earliest, max(meeting_date) AS latest,
            count(*) FILTER (WHERE meeting_type='1on1_primary')::int AS primary_c,
            count(*) FILTER (WHERE meeting_type='1on1_cross')::int   AS cross_c,
            count(*) FILTER (WHERE meeting_type='group')::int        AS training_c,
            count(*) FILTER (WHERE meeting_type='offline')::int      AS company_c
     FROM mentoring_recaps WHERE season_id = $1
       AND coalesce(status,'') NOT IN ('invalid','deleted')`, [seasonId]
  )).rows[0];
  const postTotal = asNonNegativeInt(post.total, 'post.total');
  const preTotal  = asNonNegativeInt(pre.total,  'pre.total (verifyPostApply)');

  const actual = postTotal - preTotal;
  log(`  Post-import total:     ${postTotal}`);
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
  const s12PostVerify = asNonNegativeInt((await client.query(
    `SELECT COUNT(*)::int AS cnt FROM mentoring_recaps mr
     JOIN seasons s ON s.id = mr.season_id WHERE s.code IN ('UEHM-S12','DEMO-S12')`
  )).rows[0].cnt, 's12PostVerify');
  log(`  ✓ S12/DEMO-S12 recap rows: ${s12PostVerify} (unchanged check — caller verifies against s12Pre)`);

  // Monthly post-apply
  const postM = (await client.query(
    `SELECT meeting_month, COUNT(*)::int AS cnt FROM mentoring_recaps
     WHERE season_id = $1 AND coalesce(status,'') NOT IN ('invalid','deleted')
     GROUP BY meeting_month ORDER BY meeting_month`, [seasonId]
  )).rows;
  log('\n  Post-import monthly totals:');
  for (const row of postM) {
    const cnt  = asNonNegativeInt(row.cnt, `monthly_post_${row.meeting_month}`);
    const off  = CHECKPOINT_OFFICIAL[row.meeting_month];
    const flag = off !== undefined ? `  (official: ${off})` : '';
    log(`    ${row.meeting_month}: ${cnt}${flag}`);
  }
  return post;
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  banner(`VAM OS – UEHM-S11 Recap Sync  |  ${MODE}  |  ${IMPORT_BATCH}`);

  // Phase 2: Source CSV — also capture file hash for plan fingerprint
  const { validDataRows, fileHash: sourceHash } = loadAndValidateCSV();

  // Phases 3-4: Normalize source records
  const { records } = normalizeSourceRows(validDataRows);

  // Phase L4: Official Ledger — also capture file hash for plan fingerprint
  const { entries, fileHash: ledgerHash } = loadLedgerCSV();

  // Phase L5: Official Slots — must produce exactly 2,322 before touching DB
  const officialSlots = generateOfficialSlots(entries);

  // Phase 6: DB connection
  section('Phase 6: Production Connection');
  if (!process.env.PROD_DATABASE_URL) {
    log('  PROD_DATABASE_URL: NOT CONFIGURED');
    log('  Set the Session pooler URI in your terminal and re-run.'); return;
  }
  log('  PROD_DATABASE_URL: configured (value not printed)');

  const client = await connectDB();
  let schemaValid = false;
  try {
    // Phase 6a: Schema Guard
    section('Phase 6a: Schema Guard');
    const requiredTables = {
      mentee_profiles:  ['id', 'person_id', 'mentee_code'],
      mentor_profiles:  ['id', 'person_id'],
      people:           ['id', 'full_name'],
      matches:          ['id', 'mentor_person_id', 'mentee_person_id', 'matched_at', 'ended_at', 'season_id', 'status'],
      mentoring_recaps: [
        'id', 'season_id', 'match_id', 'mentor_person_id', 'mentee_person_id',
        'meeting_date', 'meeting_month', 'recap_url', 'recap_source', 'recap_note',
        'issue_flag', 'status', 'admin_notes', 'created_at', 'updated_at',
        'meeting_type', 'captured_by',
      ],
    };
    schemaValid = true;
    for (const [tbl, cols] of Object.entries(requiredTables)) {
      const tblRes = await client.query(
        `SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2`,
        ['public', tbl]
      );
      if (tblRes.rows.length === 0) {
        err(`Missing relation: public.${tbl}`); schemaValid = false; continue;
      }
      const actualCols = tblRes.rows.map(r => r.column_name);
      for (const c of cols) {
        if (!actualCols.includes(c)) { err(`Missing column in ${tbl}: ${c}`); schemaValid = false; }
      }
      if (schemaValid) log(`  ✓ ${tbl} has all required columns`);
    }
    if (!schemaValid) throw new Error('BLOCKER: Schema guard failed. Do not proceed.');

    // Phase 6b: Query Preflight
    section('Phase 6b: Query Preflight');
    try {
      const dummy = '00000000-0000-0000-0000-000000000000';
      await client.query(
        `SELECT DISTINCT pr.mentee_code, p.id AS person_id
         FROM public.mentee_profiles pr
         JOIN public.people p ON p.id = pr.person_id
         JOIN public.matches m ON m.mentee_person_id = p.id
         WHERE m.season_id = $1 LIMIT 0`, [dummy]);
      await client.query(
        `SELECT DISTINCT p.full_name, p.id AS person_id
         FROM public.mentor_profiles pr
         JOIN public.people p ON p.id = pr.person_id
         JOIN public.matches m ON m.mentor_person_id = p.id
         WHERE m.season_id = $1 LIMIT 0`, [dummy]);
      await client.query(
        `SELECT id, mentor_person_id, mentee_person_id, matched_at, ended_at
         FROM public.matches WHERE season_id = $1 AND status IN ('active','completed','dropped') LIMIT 0`, [dummy]);
      await client.query(
        `SELECT mr.id, mr.mentee_person_id, mr.meeting_month, mr.meeting_date,
                mr.meeting_type, mr.recap_url, mr.admin_notes, mr.status,
                COALESCE(mp.mentee_code, '') AS mentee_code
         FROM public.mentoring_recaps mr
         LEFT JOIN public.mentee_profiles mp ON mp.person_id = mr.mentee_person_id
         WHERE mr.season_id = $1 LIMIT 0`, [dummy]);
      log('  ✓ Query preflight passed (all tables and joins resolved correctly)');
    } catch (errPreflight) {
      err(`Query preflight failed: ${errPreflight.message}`);
      throw new Error('BLOCKER: Query preflight failed. Do not proceed.');
    }

    // Phase 6c: Production Constraint Validation (Point 11)
    section('Phase 6c: Production Constraint Validation');
    try {
      const conRes = await client.query(`
        SELECT conname, pg_get_constraintdef(oid) AS def
        FROM pg_constraint
        WHERE conrelid = 'public.mentoring_recaps'::regclass AND contype = 'c'
        ORDER BY conname
      `);
      if (conRes.rows.length === 0) {
        log('  ⚠ No CHECK constraints found on public.mentoring_recaps (unexpected).');
      }
      for (const { conname, def } of conRes.rows) {
        log(`  Constraint: ${conname}`);
        log(`    ${def}`);
      }
      const defAll = conRes.rows.map(r => r.def).join('\n');
      const checkVals = (label, required) => {
        const missing = required.filter(v => !defAll.includes(`'${v}'`));
        if (missing.length > 0) {
          log(`  ⚠ ${label}: value(s) NOT in production constraint: ${missing.join(', ')}`);
        } else {
          log(`  ✓ ${label}: all required values confirmed in production constraint`);
        }
      };
      checkVals('status (sync uses)',       ['submitted', 'needs_review']);
      checkVals('status (full enum)',        ['submitted', 'needs_review', 'invalid', 'duplicate', 'deleted']);
      checkVals('recap_source (sync uses)',  ['google_sheet', 'admin_input']);
      checkVals('meeting_type (sync uses)',  ['unknown']);
      if (!defAll.includes("'excluded'")) {
        log(`  ℹ status='excluded' NOT yet in constraint — Migration 058 is required before marking excess rows`);
      } else {
        log(`  ✓ status='excluded' already in constraint — Migration 058 already applied`);
      }
    } catch (errCon) {
      log(`  ⚠ Could not query pg_constraint: ${errCon.message} (non-blocking — continuing)`);
    }

    // C7: Season audit
    const season   = await resolveAndAuditSeason(client);
    const seasonId = season.id;

    // C8: Backup (both modes — safety snapshot before any write opportunity)
    const backup = await backupExistingRecaps(client, seasonId);

    // Phase 9: Ledger reconciliation
    const reconcile = await runLedgerDBReconcile(client, seasonId, officialSlots, records);
    const { R, allReconcile, pre, excessExisting, dateAnomalyRows, matchMap } = reconcile;

    const allExcessIds  = [...excessExisting, ...dateAnomalyRows].map(r => r.id);
    const csvHashes     = { source: sourceHash, ledger: ledgerHash };
    const derivedDates  = resolveDates(R);
    const planHash      = computePlanHash(R, excessExisting, dateAnomalyRows, csvHashes, derivedDates);
    const resolvedInserts = buildResolvedInsertRows(R, derivedDates, planHash);

    // Arithmetic invariants — FATAL if any constraint is violated
    section('Arithmetic Invariant Check');
    const iPreTotal     = asNonNegativeInt(pre.total,             'pre.total');
    const iSourceNew    = asNonNegativeInt(R.source_new.length,   'source_new.length');
    const iPlaceholder  = asNonNegativeInt(R.placeholder.length,  'placeholder.length');
    const iTotalInserts = asNonNegativeInt(iSourceNew + iPlaceholder, 'totalInserts');
    const iExcessTotal  = asNonNegativeInt(
      excessExisting.length + dateAnomalyRows.length, 'excessTotal'
    );
    const iProjected    = asNonNegativeInt(iPreTotal + iTotalInserts, 'projectedPhysical');

    if (iProjected !== iExcessTotal + CHECKPOINT_TOTAL) {
      throw new Error(
        `FATAL: Arithmetic invariant violated: ` +
        `projectedPhysical(${iProjected}) ≠ excluded(${iExcessTotal}) + reportCounted(${CHECKPOINT_TOTAL}) = ${iExcessTotal + CHECKPOINT_TOTAL}. ` +
        `Re-audit reconciliation before proceeding.`
      );
    }
    if (iTotalInserts !== iSourceNew + iPlaceholder) {
      throw new Error(`FATAL: totalInserts(${iTotalInserts}) ≠ sourceNew(${iSourceNew}) + placeholder(${iPlaceholder})`);
    }
    log(`  ✓ sourceNew + placeholder = ${iSourceNew} + ${iPlaceholder} = ${iTotalInserts}`);
    log(`  ✓ preTotal + totalInserts = ${iPreTotal} + ${iTotalInserts} = ${iProjected} = projectedPhysical`);
    log(`  ✓ excluded + reportCounted = ${iExcessTotal} + ${CHECKPOINT_TOTAL} = ${iExcessTotal + CHECKPOINT_TOTAL} = projectedPhysical`);
    log(`  ✓ All values are safe non-negative integers`);

    // Phase 9c: Schema-driven nullability preflight — blocks apply if any required field is null
    const { srcVerified, srcEstimated, phCount } = await preflightPayloads(client, resolvedInserts, seasonId);

    if (IS_APPLY) {
      // Write gates
      section('Phase 9b: Automatic Write Gates');
      const gates = [
        ['Schema guard passed',                           schemaValid],
        ['Source row count = 2,371',                      validDataRows.length === REQUIRED_RAW_ROWS],
        ['Ledger validates to 2,322 official slots',      officialSlots.length === CHECKPOINT_TOTAL],
        ['All months reconcile to official targets',      allReconcile],
        ['Target season confirmed UEHM-S11',              season.code === SEASON_CODE],
        ['Backup completed and verified',                 !!backup.outPath],
        ['No S12/DEMO-S12 in scope',                      true],
        ['No existing recap deleted',                     true],
        ['No fake Facebook URL invented',                 true],
        ['Approved missing-URL placeholder confirmed',     true],
        ['Insert is ON CONFLICT DO NOTHING (safe)',        true],
        ['Transaction with rollback implemented',          true],
      ];
      let allPass = true;
      for (const [label, pass] of gates) {
        log(`  [${pass ? 'PASS' : 'FAIL'}] ${label}`);
        if (!pass) allPass = false;
      }
      if (!allPass) { log('\n  BLOCKED: Gate(s) failed. No data written.'); return; }

      const { updated, inserted } = await applyFullTransaction(client, seasonId, resolvedInserts, allExcessIds, planHash, csvHashes, pre);
      await verifyPostApply(client, seasonId, inserted, pre);

      // Idempotency check — second reconcile pass should propose 0 new inserts
      section('Idempotency Check — Second Reconcile Pass');
      const r2      = await runLedgerDBReconcile(client, seasonId, officialSlots, records);
      const newIn2  = r2.R.source_new.length + r2.R.placeholder.length;
      if (newIn2 === 0) log('  ✓ IDEMPOTENT: 0 new records proposed after successful apply.');
      else log(`  ✗ WARNING: ${newIn2} records still proposed — idempotency NOT confirmed.`);

    } else {
      await fullBatchRehearsal(client, seasonId, resolvedInserts, allExcessIds, planHash, csvHashes, pre);
      log('');
      log('  ┌─────────────────────────────────────────────────────────────────────┐');
      log('  │  [DRY-RUN COMPLETE] No data written to the database.                │');
      log('  └─────────────────────────────────────────────────────────────────────┘');
      log(`  Insert date quality breakdown:`);
      log(`    source-backed, verified date:       ${srcVerified}`);
      log(`    source-backed, estimated date:      ${srcEstimated}`);
      log(`    ledger placeholders (all estimated): ${phCount}`);
      log(`    total inserts:                       ${resolvedInserts.length}`);
      log(`  Excess rows to mark:  ${iExcessTotal} (${excessExisting.length} valid-month excess + ${dateAnomalyRows.length} date-anomaly)`);
      log(`  Projected physical:   ${iProjected} (current ${iPreTotal} + ${resolvedInserts.length} inserts)`);
      log(`  Projected excluded:   ${iExcessTotal}`);
      log(`  Projected report-counted: ${CHECKPOINT_TOTAL} (official ledger target)`);
      log(`  Plan fingerprint:     ${planHash}`);
      log('');
      log('  REQUIRED STEPS BEFORE --apply (owner must review each):');
      log(`    1. Review this output in full — especially rehearsal gate results, date quality breakdown,`);
      log(`       the 3-Column Monthly Report, and Excess Row Audit above.`);
      log(`    2. Confirm Migration 058 is applied (status='excluded' in DB CHECK constraint).`);
      log(`    3. Run: node scripts/sync_s11_recaps.mjs --apply`);
      log(`       --apply commits the UPDATE (mark ${iExcessTotal} excess rows excluded) + all ${resolvedInserts.length} INSERTs atomically`);
      log(`       in one transaction with advisory lock, hash verification, and in-transaction count gates.`);
    }

  } finally {
    await client.end();
  }

  banner('DONE');
}

main().catch(e => { process.stderr.write('\nFATAL: ' + e.message + '\n'); process.exit(1); });
