/**
 * A deliberately hostile in-memory stand-in for the Supabase PostgREST client.
 *
 * The `/operations` Production defect survived review because the test doubles
 * in this repository were *kinder than the real server*: they returned every
 * matching row, in insertion order, for any query. Under such a mock an
 * unpaginated read looks correct and an unordered paged read looks stable. Both
 * are broken against PostgREST.
 *
 * This fake models the two behaviours that actually bite:
 *
 * 1. THE SILENT ROW CAP. PostgREST truncates every response at `db-max-rows`
 *    and says nothing: HTTP 200, `error: null`. A read that returns exactly
 *    `maxRows` rows is indistinguishable from a complete one.
 *
 * 2. UNDEFINED ORDER WITHOUT `ORDER BY`. PostgreSQL makes no promise about row
 *    order for a query with no `ORDER BY`, and the order can differ between two
 *    executions of the same statement. `unstableUnorderedReads` (on by default)
 *    rotates the row set per request, so offset paging without a deterministic
 *    ORDER BY produces duplicates and gaps here exactly as it can in
 *    production. A test that pages an unordered query WILL fail against this
 *    fake — which is the point.
 *
 * Every request is recorded in `db.requests` so a test can assert what the
 * loader actually asked for: how many round trips, whether each page was
 * ordered, and whether every page carried identical filters.
 */

export const DEFAULT_MAX_ROWS = 1000;

export type RecordedRequest = {
  table: string;
  /** The projection asked for — identifies which logical read a page belongs to. */
  columns: string;
  /** Serialised filter set — identical strings mean identical predicates. */
  filters: string;
  /** Ordering columns applied, in order. Empty means the read was unordered. */
  order: string[];
  from: number | null;
  to: number | null;
  limit: number | null;
  returned: number;
};

type Filter =
  | { kind: "in"; column: string; values: unknown[] }
  | { kind: "eq"; column: string; value: unknown }
  | { kind: "neq"; column: string; value: unknown }
  | { kind: "gt"; column: string; value: unknown }
  | { kind: "gte"; column: string; value: unknown }
  | { kind: "lt"; column: string; value: unknown }
  | { kind: "ilike"; column: string; pattern: string }
  | { kind: "notNull"; column: string }
  | { kind: "or"; expression: string };

export type FakeDb = {
  tables: Record<string, any[]>;
  errors: Record<string, any>;
  maxRows: number;
  unstableUnorderedReads: boolean;
  requests: RecordedRequest[];
  /**
   * Per-request failure injection, for the cases a whole-table error cannot
   * express: page 1 succeeds and page 2 fails, or chunk 3 fails after chunks 1
   * and 2 returned rows. Receives the request about to run and how many
   * requests this table has already served.
   */
  injectError?: (request: RecordedRequest, priorRequestsForTable: number) => any | null;
  reset: () => void;
};

export function createFakeDb(init?: Partial<Pick<FakeDb, "maxRows" | "unstableUnorderedReads">>): FakeDb {
  const db: FakeDb = {
    tables: {},
    errors: {},
    maxRows: init?.maxRows ?? DEFAULT_MAX_ROWS,
    unstableUnorderedReads: init?.unstableUnorderedReads ?? true,
    requests: [],
    reset() {
      for (const key of Object.keys(db.tables)) delete db.tables[key];
      for (const key of Object.keys(db.errors)) delete db.errors[key];
      db.requests.length = 0;
      db.injectError = undefined;
    }
  };
  return db;
}

/** Splits `a.in.(x,y),b.eq.z` on top-level commas only. */
function splitOrExpression(expression: string) {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of expression) {
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (char === "," && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  if (current) parts.push(current);
  return parts;
}

function matchesOrTerm(row: any, term: string) {
  const inMatch = term.match(/^([^.]+)\.in\.\((.*)\)$/);
  if (inMatch) {
    const values = inMatch[2].length ? inMatch[2].split(",") : [];
    return values.includes(String(row[inMatch[1]]));
  }
  const eqMatch = term.match(/^([^.]+)\.eq\.(.*)$/);
  if (eqMatch) return String(row[eqMatch[1]]) === eqMatch[2];
  throw new Error(`fake-postgrest: unsupported or() term "${term}"`);
}

function applyFilter(rows: any[], filter: Filter) {
  switch (filter.kind) {
    case "in":
      return rows.filter((row) => filter.values.includes(row[filter.column]));
    case "eq":
      return rows.filter((row) => row[filter.column] === filter.value);
    case "neq":
      return rows.filter((row) => row[filter.column] !== filter.value);
    case "gt":
      return rows.filter((row) => String(row[filter.column]) > String(filter.value));
    case "gte":
      return rows.filter((row) => String(row[filter.column]) >= String(filter.value));
    case "lt":
      return rows.filter((row) => String(row[filter.column]) < String(filter.value));
    case "ilike":
      return rows.filter((row) => postgresIlikeMatches(row[filter.column], filter.pattern));
    case "notNull":
      return rows.filter((row) => row[filter.column] !== null && row[filter.column] !== undefined);
    case "or": {
      const terms = splitOrExpression(filter.expression);
      return rows.filter((row) => terms.some((term) => matchesOrTerm(row, term)));
    }
    default:
      return rows;
  }
}

/** A focused model of PostgreSQL ILIKE, including %, _ and backslash escapes. */
export function postgresIlikeMatches(value: unknown, pattern: unknown): boolean {
  const input = String(value ?? "");
  const source = String(pattern ?? "");
  let regex = "^";
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (char === "\\" && index + 1 < source.length) {
      index += 1;
      regex += source[index].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    } else if (char === "%" || char === "*") {
      regex += ".*";
    } else if (char === "_") {
      regex += ".";
    } else {
      regex += char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`${regex}$`, "iu").test(input);
}

/** PostgreSQL ordering: ascending is NULLS LAST, descending is NULLS FIRST. */
function compareForOrder(a: any, b: any, ascending: boolean) {
  const aNull = a === null || a === undefined;
  const bNull = b === null || b === undefined;
  if (aNull && bNull) return 0;
  if (aNull) return ascending ? 1 : -1;
  if (bNull) return ascending ? -1 : 1;
  const left = String(a);
  const right = String(b);
  if (left === right) return 0;
  return (left < right ? -1 : 1) * (ascending ? 1 : -1);
}

function projectColumns(row: any, columns: string) {
  const projection = String(columns ?? "*").trim();
  if (!projection || projection === "*") return { ...row };
  const wanted = projection.split(",").map((column) => column.trim()).filter(Boolean);
  const out: Record<string, unknown> = {};
  for (const column of wanted) {
    if (Object.prototype.hasOwnProperty.call(row, column)) out[column] = row[column];
  }
  return out;
}

export function fakeClient(db: FakeDb, options?: { rpc?: (...args: any[]) => any }) {
  let requestCounter = 0;

  function builder(
    table: string,
    columns: string,
    filters: Filter[],
    order: { column: string; ascending: boolean }[],
    window: { from: number | null; to: number | null; limit: number | null }
  ) {
    const withFilter = (filter: Filter) => builder(table, columns, [...filters, filter], order, window);

    function run() {
      const priorRequestsForTable = db.requests.filter((request) => request.table === table).length;
      const recorded: RecordedRequest = {
        table,
        columns,
        filters: JSON.stringify(filters),
        order: order.map((entry) => `${entry.column}:${entry.ascending ? "asc" : "desc"}`),
        from: window.from,
        to: window.to,
        limit: window.limit,
        returned: 0
      };
      db.requests.push(recorded);
      const error = db.errors[table] ?? db.injectError?.(recorded, priorRequestsForTable) ?? null;
      if (error) return { data: null, error };

      // Every real row carries its primary key. Fixtures that omit `id` would
      // otherwise fail keyset paging for a reason the database never produces,
      // so a stable synthetic key is supplied. A loader that forgets to PROJECT
      // the key still fails, because `select` below returns only the requested
      // columns.
      let rows = (db.tables[table] ?? []).map((row, index) =>
        row && row.id === undefined ? { ...row, id: `${table}#${String(index).padStart(8, "0")}` } : row
      );
      for (const filter of filters) rows = applyFilter(rows, filter);

      if (order.length) {
        rows.sort((a, b) => {
          for (const entry of order) {
            const result = compareForOrder(a[entry.column], b[entry.column], entry.ascending);
            if (result !== 0) return result;
          }
          return 0;
        });
      } else if (db.unstableUnorderedReads && rows.length > 1) {
        // No ORDER BY: PostgreSQL may hand back any permutation, and a second
        // execution may differ. Rotating per request reproduces that.
        requestCounter += 1;
        const offset = requestCounter % rows.length;
        rows = rows.slice(offset).concat(rows.slice(0, offset));
      }

      if (window.from !== null) {
        const end = window.to === null ? rows.length : window.to + 1;
        rows = rows.slice(window.from, end);
      }
      if (window.limit !== null) rows = rows.slice(0, window.limit);

      // The silent cap, applied last and never reported.
      const capped = rows.slice(0, db.maxRows);
      recorded.returned = capped.length;
      return { data: capped.map((row) => projectColumns(row, columns)), error: null };
    }

    const self: any = {
      in: (column: string, values: unknown[]) => withFilter({ kind: "in", column, values }),
      eq: (column: string, value: unknown) => withFilter({ kind: "eq", column, value }),
      neq: (column: string, value: unknown) => withFilter({ kind: "neq", column, value }),
      gt: (column: string, value: unknown) => withFilter({ kind: "gt", column, value }),
      gte: (column: string, value: unknown) => withFilter({ kind: "gte", column, value }),
      lt: (column: string, value: unknown) => withFilter({ kind: "lt", column, value }),
      ilike: (column: string, pattern: unknown) =>
        withFilter({ kind: "ilike", column, pattern: String(pattern ?? "") }),
      not: (column: string, operator: string, value: unknown) => {
        if (operator !== "is" || value !== null) throw new Error(`fake-postgrest: unsupported not(${operator})`);
        return withFilter({ kind: "notNull", column });
      },
      or: (expression: string) => withFilter({ kind: "or", expression }),
      order: (column: string, opts?: { ascending?: boolean }) =>
        builder(table, columns, filters, [...order, { column, ascending: opts?.ascending !== false }], window),
      limit: (limit: number) => builder(table, columns, filters, order, { ...window, limit }),
      range: (from: number, to: number) => builder(table, columns, filters, order, { ...window, from, to }),
      maybeSingle: () => {
        const { data, error } = run();
        if (error) return Promise.resolve({ data: null, error });
        return Promise.resolve({ data: (data as any[])[0] ?? null, error: null });
      },
      then: (resolve: any, reject?: any) => Promise.resolve(run()).then(resolve, reject)
    };
    return self;
  }

  return {
    from: (table: string) => ({
      select: (columns = "*") => builder(table, columns, [], [], { from: null, to: null, limit: null })
    }),
    rpc: (...args: any[]) =>
      Promise.resolve(options?.rpc ? options.rpc(...args) : { data: null, error: { code: "PGRST202", message: "not found" } })
  };
}

/** Requests recorded for one table, in issue order. */
export function requestsFor(db: FakeDb, table: string) {
  return db.requests.filter((request) => request.table === table);
}
