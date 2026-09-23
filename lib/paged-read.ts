/**
 * Pagination contract for multi-row PostgREST reads.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS MODULE EXISTS
 * ---------------------------------------------------------------------------
 * PostgREST caps every response at `db-max-rows` (1000 on Supabase hosted) and
 * applies the cap SILENTLY: the response is `200 OK` with `error: null`, and a
 * truncated result is byte-for-byte indistinguishable from a complete one. Any
 * read that can return more rows than the cap is therefore a latent
 * data-correctness bug, not a performance issue.
 *
 * Paging alone is not enough. `SELECT ... LIMIT n OFFSET m` with no `ORDER BY`
 * has no defined row order in PostgreSQL, so two pages of the same query may
 * overlap or skip rows even with no concurrent writer at all — the planner is
 * free to return rows in a different physical order per request. Every paged
 * read must therefore declare a UNIQUE, NOT NULL ordering key.
 *
 * ---------------------------------------------------------------------------
 * THE THREE READ CLASSES
 * ---------------------------------------------------------------------------
 * Every multi-row read in the Operations/Admin loaders is classified as:
 *
 *   A — structurally bounded below the cap by contract (primary-key lookup,
 *       `.limit(n)` with n < cap, `head: true` count, `maybeSingle`).
 *       No change required; the bound is stated at the call site.
 *
 *   B — practically bounded but not guaranteed. Use `readBounded`, which
 *       asserts the bound and turns a violated assumption into a LOUD ERROR
 *       instead of silently truncated data.
 *
 *   C — potentially unbounded. Use `readAllPages`, which pages to exhaustion
 *       under a declared unique ordering key.
 *
 * ---------------------------------------------------------------------------
 * CONSISTENCY GUARANTEES — READ THIS BEFORE RELYING ON THEM
 * ---------------------------------------------------------------------------
 * Neither strategy is a snapshot. A multi-page read is N separate HTTP requests
 * in N separate implicit transactions; there is no REPEATABLE READ across them.
 * The two strategies give materially different guarantees and the difference is
 * deliberate:
 *
 * `keyset` — pages are `WHERE key > :cursor ORDER BY key ASC LIMIT n`.
 *   * NO DUPLICATES, ever. The cursor is strictly increasing and each page's
 *     window is disjoint from every previous page.
 *   * NO SKIPPED ROWS among rows that existed when the read started and were
 *     not deleted before their page was fetched. Concurrent INSERTs and DELETEs
 *     elsewhere in the key space cannot shift a row across a page boundary,
 *     because the boundary is a value, not an offset.
 *   * A row INSERTed mid-read is returned only if its key sorts after the
 *     cursor at that moment. Our keys are random v4 UUIDs, so a concurrent
 *     insert has roughly a 50% chance of being seen. This is the honest limit:
 *     the result is a consistent set of rows, not a point-in-time snapshot.
 *   * A row DELETEd mid-read before its page is fetched is absent. Correct.
 *
 * `range` — pages are `ORDER BY <unique tuple> ASC LIMIT n OFFSET m`, used only
 *   where no single column is unique (composite-PK link tables).
 *   * Row order within a page is fully deterministic.
 *   * A concurrent INSERT sorting BEFORE the current offset shifts later rows
 *     forward and can re-present a row on the next page. `readAllPages`
 *     de-duplicates on the ordering tuple, so this cannot corrupt the result.
 *   * A concurrent DELETE sorting BEFORE the current offset shifts later rows
 *     backward and CAN SKIP one row per deletion. This is not de-duplicable and
 *     is NOT fixed here. It is accepted only for tables whose rows are written
 *     by admin taxonomy edits, never by request traffic, so a read racing a
 *     delete is rare and self-heals on the next load. Do not add a table to the
 *     `range` strategy without re-checking that assumption.
 *
 * ---------------------------------------------------------------------------
 * TERMINATION
 * ---------------------------------------------------------------------------
 * A paged loop must NOT stop on a short page. If the server's `db-max-rows` is
 * ever lower than our requested page size, the first page comes back short and
 * "stop on short page" silently truncates — reintroducing the exact bug this
 * module exists to prevent. Both strategies here stop only on an EMPTY page,
 * and the `range` strategy advances its offset by the number of rows actually
 * received rather than by the size of the window it asked for. A server cap
 * below `SELECT_PAGE_SIZE` therefore costs extra requests, never rows.
 *
 * COST, STATED PLAINLY: a read whose result fits in one page costs TWO requests
 * — the data page and the empty page that proves exhaustion. Reads that return
 * nothing still cost one. Two cheaper alternatives were considered and
 * rejected: stopping on a short page assumes `db-max-rows >= SELECT_PAGE_SIZE`,
 * which is the assumption that produced the incident; and requesting
 * `count: "exact"` to learn the true total adds a COUNT(*) to every page of
 * every read, which is far more expensive on the large tables that need paging
 * most. One extra round trip per read is the honest price of not guessing.
 */

/**
 * Rows requested per page. Matches the assumed Supabase `db-max-rows`. The
 * loops below stay correct if the real cap is lower (see TERMINATION above).
 */
export const SELECT_PAGE_SIZE = 1000;

/**
 * Ceiling on pages per read (~500k rows). Exceeding it returns an error rather
 * than looping forever or returning a partial set as if it were complete.
 */
export const MAX_PAGES = 500;

/** Default assertion limit for a class-B read. Deliberately below the cap. */
export const BOUNDED_READ_LIMIT = 500;

/**
 * How a table is paged.
 *
 * `keyset` — `key` is a single UNIQUE NOT NULL column.
 * `range`  — `key` is an ordered column tuple that is jointly UNIQUE NOT NULL.
 */
export type PageOrder =
  | { readonly strategy: "keyset"; readonly key: string }
  | { readonly strategy: "range"; readonly key: readonly string[] };

/**
 * The ordering key per table. This registry is the single place the pagination
 * contract is asserted, so a call site cannot pick a different (or absent) key.
 *
 * `id uuid primary key default gen_random_uuid()` is proven for every `keyset`
 * table below, either by its `create table` in `supabase_migrations/` or, for
 * the pre-012 core tables whose creating DDL predates this repository, by a
 * foreign key in a tracked migration that references `<table>(id)` — a FK
 * target must be UNIQUE and NOT NULL:
 *
 *   people                        012 mentoring_recaps.mentor_person_id -> people(id)
 *   seasons                       012 mentoring_recaps.season_id        -> seasons(id)
 *   matches                       012 mentoring_recaps.match_id         -> matches(id)
 *   events                        051 event_registrations.event_id      -> events(id)
 *   event_links / event_registrations                                    051
 *   mentor_profiles               036 mentor_industries.mentor_profile_id -> mentor_profiles(id)
 *   mentee_profiles               046a matches.mentee_profile_id        -> mentee_profiles(id)
 *   admin_users                   044a review_assignment_batches.created_by -> admin_users(id)
 *   programs / industries /
 *   function_areas / intake_batches / mentor_program_participations      036
 *   mentoring_recaps / event_participations                              012
 *   operational_team_assignments                                         016
 *   action_items                                                         023
 *   review_assignment_batches                                            044a
 *   person_season_memberships                                            052
 *   applications / application_answers / application_reviews             059
 *   outbound_emails               supabase/migrations/20260909090000 create table (id uuid primary key)
 *   account_person_auth_links     supabase/migrations/20260910260000 create table (id uuid primary key)
 *   event_reminder_runs /
 *   event_reminder_recipients     supabase/migrations/20260914090000 create table (id uuid primary key)
 *   event_survey_responses /
 *   event_survey_recipients       supabase/migrations/20260919043000 create table (id uuid primary key)
 *   interviewer_profiles / interview_slots /
 *   interview_bookings /
 *   interview_slot_invites        supabase/migrations/20260922100000 create table (id uuid primary key)
 *   interview_mentor_availability supabase/migrations/20260923040000 create table (id uuid primary key)
 *
 * The two `range` tables are the exception and the reason this registry is not
 * just `.order("id")`: `mentor_industries` and `mentor_function_areas` are
 * composite-PK link tables created by migration 036 with NO `id` column at all.
 * Ordering them by `id` would fail with a PostgREST 400, not degrade quietly.
 */
export const PAGE_ORDER = {
  account_person_auth_links: { strategy: "keyset", key: "id" },
  action_items: { strategy: "keyset", key: "id" },
  admin_users: { strategy: "keyset", key: "id" },
  application_answers: { strategy: "keyset", key: "id" },
  application_decisions: { strategy: "keyset", key: "id" },
  application_reviews: { strategy: "keyset", key: "id" },
  applications: { strategy: "keyset", key: "id" },
  event_links: { strategy: "keyset", key: "id" },
  event_participations: { strategy: "keyset", key: "id" },
  event_registrations: { strategy: "keyset", key: "id" },
  event_reminder_recipients: { strategy: "keyset", key: "id" },
  event_reminder_runs: { strategy: "keyset", key: "id" },
  event_survey_recipients: { strategy: "keyset", key: "id" },
  event_survey_responses: { strategy: "keyset", key: "id" },
  events: { strategy: "keyset", key: "id" },
  function_areas: { strategy: "keyset", key: "id" },
  industries: { strategy: "keyset", key: "id" },
  intake_batches: { strategy: "keyset", key: "id" },
  interview_bookings: { strategy: "keyset", key: "id" },
  interview_mentor_availability: { strategy: "keyset", key: "id" },
  interview_slot_invites: { strategy: "keyset", key: "id" },
  interview_slots: { strategy: "keyset", key: "id" },
  interviewer_profiles: { strategy: "keyset", key: "id" },
  matches: { strategy: "keyset", key: "id" },
  mentee_profiles: { strategy: "keyset", key: "id" },
  mentor_function_areas: { strategy: "range", key: ["mentor_profile_id", "function_area_id"] },
  mentor_industries: { strategy: "range", key: ["mentor_profile_id", "industry_id"] },
  mentor_profiles: { strategy: "keyset", key: "id" },
  mentor_program_participations: { strategy: "keyset", key: "id" },
  mentoring_recaps: { strategy: "keyset", key: "id" },
  operational_team_assignments: { strategy: "keyset", key: "id" },
  outbound_emails: { strategy: "keyset", key: "id" },
  people: { strategy: "keyset", key: "id" },
  person_season_invites: { strategy: "keyset", key: "id" },
  person_season_memberships: { strategy: "keyset", key: "id" },
  programs: { strategy: "keyset", key: "id" },
  review_assignment_batches: { strategy: "keyset", key: "id" },
  seasons: { strategy: "keyset", key: "id" }
} as const satisfies Record<string, PageOrder>;

/** A table with a proven pagination contract. Anything else will not compile. */
export type PagedTable = keyof typeof PAGE_ORDER;

export function pageOrderFor(table: PagedTable): PageOrder {
  return PAGE_ORDER[table];
}

/** The ordering columns a table pages on, in order. */
export function pageKeyColumns(table: PagedTable): readonly string[] {
  const order = PAGE_ORDER[table];
  return order.strategy === "keyset" ? [order.key] : order.key;
}

/**
 * Adds the ordering key to a projection that omits it. Keyset paging needs the
 * cursor value in the payload and `range` de-duplication needs the tuple, so a
 * caller that selects a narrow column list must still receive the key.
 */
export function projectionWithPageKey(table: PagedTable, columns: string): string {
  const projection = columns.trim();
  if (projection === "*" || projection === "") return columns;
  const present = new Set(projection.split(",").map((column) => column.trim()));
  const missing = pageKeyColumns(table).filter((column) => !present.has(column));
  return missing.length ? `${projection},${missing.join(",")}` : columns;
}

export type PagedResult<T> = { data: T[]; error: unknown | null };

function pagingError(table: string, message: string) {
  return { code: "VAM_PAGINATION", message: `${table}: ${message}` };
}

/**
 * A per-page query factory. It MUST return a freshly built query carrying every
 * filter the read needs. Rebuilding rather than mutating one builder is what
 * guarantees "filters are identical on every page" structurally instead of by
 * convention. `columns` is the projection with the ordering key already added.
 */
export type PageQueryFactory = (columns: string) => any;

/**
 * Class C. Reads every row matching the query, paging under the table's
 * declared unique ordering key. See the consistency guarantees above — this
 * returns a complete, duplicate-free set, not a point-in-time snapshot.
 */
export async function readAllPages<T extends Record<string, any>>(
  table: PagedTable,
  columns: string,
  build: PageQueryFactory,
  pageSize = SELECT_PAGE_SIZE
): Promise<PagedResult<T>> {
  const order = PAGE_ORDER[table] as PageOrder;
  const projection = projectionWithPageKey(table, columns);
  const rows: T[] = [];

  if (order.strategy === "keyset") {
    const key = order.key;
    let cursor: string | null = null;
    for (let page = 0; ; page += 1) {
      if (page >= MAX_PAGES) {
        return { data: rows, error: pagingError(table, `read exceeded ${MAX_PAGES} pages`) };
      }
      let query = build(projection);
      if (cursor !== null) query = query.gt(key, cursor);
      const { data, error } = await query.order(key, { ascending: true }).limit(pageSize);
      if (error) return { data: rows, error };
      const batch = (data ?? []) as T[];
      if (!batch.length) break;
      const last = batch[batch.length - 1]?.[key];
      if (last === null || last === undefined) {
        // Without a cursor value the next page would repeat this one forever.
        // Fail loudly rather than loop or truncate.
        return { data: rows, error: pagingError(table, `pagination key "${key}" is missing or null in the result`) };
      }
      rows.push(...batch);
      cursor = String(last);
    }
    return { data: rows, error: null };
  }

  const keys = order.key;
  const seen = new Set<string>();
  let from = 0;
  for (let page = 0; ; page += 1) {
    if (page >= MAX_PAGES) {
      return { data: rows, error: pagingError(table, `read exceeded ${MAX_PAGES} pages`) };
    }
    let query = build(projection);
    for (const column of keys) query = query.order(column, { ascending: true });
    const { data, error } = await query.range(from, from + pageSize - 1);
    if (error) return { data: rows, error };
    const batch = (data ?? []) as T[];
    if (!batch.length) break;
    for (const row of batch) {
      if (keys.some((column) => row[column] === null || row[column] === undefined)) {
        // De-duplication would collapse distinct rows onto one key. Refuse.
        return { data: rows, error: pagingError(table, `ordering column missing or null in the result (${keys.join(",")})`) };
      }
      const identity = keys.map((column) => String(row[column])).join(" ");
      if (seen.has(identity)) continue;
      seen.add(identity);
      rows.push(row);
    }
    // Advance by rows RECEIVED, not by the window requested: a server cap below
    // `pageSize` must cost requests, never rows.
    from += batch.length;
  }
  return { data: rows, error: null };
}

/** Values per `.in()` filter. Keeps the request URL well under proxy limits. */
export const IN_FILTER_CHUNK = 200;

/**
 * Class C, keyed by a list: every row whose `column` is one of `values`.
 *
 * The list is split into chunks of IN_FILTER_CHUNK, and EACH chunk is paged to
 * exhaustion with `readAllPages`. Chunking alone is not enough — 200 people can
 * own more than 1000 rows between them — and paging alone is not enough either,
 * because 1000 ids in one `.in()` makes a URL some proxies refuse.
 *
 * The client is a parameter so the caller decides which credentials read the
 * table. Several tables this is used for have RLS with no policies; a quiet
 * fallback to a user client would return zero rows and no error.
 */
export async function readAllPagesIn<T extends Record<string, any>>(
  client: any,
  table: PagedTable,
  column: string,
  values: string[],
  columns: string,
  refine?: (query: any) => any
): Promise<PagedResult<T>> {
  const unique = Array.from(new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean)));
  const rows: T[] = [];
  for (let start = 0; start < unique.length; start += IN_FILTER_CHUNK) {
    const chunk = unique.slice(start, start + IN_FILTER_CHUNK);
    const result = await readAllPages<T>(table, columns, (projection) => {
      const query = client.from(table).select(projection).in(column, chunk);
      return refine ? refine(query) : query;
    });
    if (result.error) return { data: rows, error: result.error };
    rows.push(...result.data);
  }
  return { data: rows, error: null };
}

/**
 * Class B. Runs a read the application asserts stays below `limit`, and turns a
 * violated assertion into an error. Use where a bound follows from the data
 * model (roles per person, seasons per program) but is not enforced by a
 * constraint. Never use it to paper over a genuinely unbounded read.
 *
 * `limit` is deliberately below `db-max-rows`, so a full page here means the
 * application's own assumption was wrong — not that PostgREST capped us.
 */
export async function readBounded<T>(
  label: string,
  query: any,
  limit = BOUNDED_READ_LIMIT
): Promise<PagedResult<T>> {
  const { data, error } = await query.limit(limit);
  if (error) return { data: [], error };
  const rows = (data ?? []) as T[];
  if (rows.length >= limit) {
    return {
      data: [],
      error: pagingError(label, `bounded read returned ${rows.length} rows, at or over its asserted limit of ${limit}; the result may be incomplete`)
    };
  }
  return { data: rows, error: null };
}
