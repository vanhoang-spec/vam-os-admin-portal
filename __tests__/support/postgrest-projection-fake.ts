/**
 * A PostgREST fake that honours the SELECT projection.
 *
 * ---------------------------------------------------------------------------
 * WHY IT IS BUILT THIS WAY
 * ---------------------------------------------------------------------------
 * The failure this fake exists to catch is a consumer reading a field the query
 * never selected. A mock that returns whole fixture rows regardless of the
 * projection cannot catch it: the field is present in the fake and absent in
 * Production. So this fake PARSES the projection — including embedded resources
 * and their column lists — and returns ONLY the selected fields. Delete a column
 * from a projection in `lib/data.ts` and the consumer reads `undefined` here,
 * exactly as it would against the real database.
 *
 * It also RECORDS every filter operator applied, so a test can assert the query
 * semantics themselves — `reviewer_admin_user_id = <actor>` was applied to the
 * QUERY — rather than the far weaker "the call returned no error".
 *
 * Supported surface is deliberately only what `lib/data.ts` emits on the
 * oversight path: `.select(projection, {count})`, `.eq`, `.neq`, `.in`, `.gt`,
 * `.order`, `.limit`, `.range`, and awaiting the builder directly.
 */

export type FakeStore = Record<string, any[]>;

export type RecordedFilter = { op: string; column: string; value: unknown };

export type RecordedQuery = {
  table: string;
  projection: string;
  count: string | null;
  filters: RecordedFilter[];
  orders: Array<{ column: string; ascending: boolean; nullsFirst?: boolean }>;
  range: { from: number; to: number } | null;
  limit: number | null;
};

type EmbedSpec = { alias: string; table: string; inner: boolean; columns: ParsedProjection };
type ParsedProjection = { columns: string[]; embeds: EmbedSpec[] };

/** Splits on commas that are not inside parentheses. */
function splitTopLevel(input: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of input) {
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (char === "," && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  if (current.trim()) parts.push(current);
  return parts.map((part) => part.trim()).filter(Boolean);
}

export function parseProjection(projection: string): ParsedProjection {
  const columns: string[] = [];
  const embeds: EmbedSpec[] = [];

  for (const token of splitTopLevel(projection)) {
    const open = token.indexOf("(");
    if (open === -1) {
      columns.push(token.trim());
      continue;
    }
    const head = token.slice(0, open).trim();
    const body = token.slice(open + 1, token.lastIndexOf(")"));
    const [aliasPart, targetPart] = head.includes(":")
      ? [head.slice(0, head.indexOf(":")), head.slice(head.indexOf(":") + 1)]
      : [head, head];
    const inner = targetPart.includes("!inner");
    // `admin_users!application_reviews_reviewer_admin_user_id_fkey` -> admin_users
    const table = targetPart.split("!")[0].trim();
    embeds.push({
      alias: aliasPart.trim(),
      table,
      inner,
      columns: parseProjection(body)
    });
  }

  return { columns, embeds };
}

/**
 * How an embedded resource is joined to its parent row.
 * Keyed by "<parentTable>.<embeddedTable>".
 */
export type JoinMap = Record<string, { localKey: string; foreignKey: string }>;

const DEFAULT_JOINS: JoinMap = {
  "application_reviews.applications": { localKey: "application_id", foreignKey: "id" },
  "application_reviews.admin_users": { localKey: "reviewer_admin_user_id", foreignKey: "id" }
};

function resolvePath(row: any, path: string): unknown {
  if (!path.includes(".")) return row?.[path];
  const [head, ...rest] = path.split(".");
  return resolvePath(row?.[head], rest.join("."));
}

export function makeProjectionFake(store: FakeStore, joins: JoinMap = DEFAULT_JOINS) {
  const queries: RecordedQuery[] = [];

  function builder(table: string) {
    const record: RecordedQuery = {
      table,
      projection: "",
      count: null,
      filters: [],
      orders: [],
      range: null,
      limit: null
    };
    queries.push(record);

    let parsed: ParsedProjection = { columns: [], embeds: [] };

    /** Attaches every embedded resource so filters can address `alias.column`. */
    function joined(): any[] {
      const rows = store[table] ?? [];
      return rows
        .map((row) => {
          const withEmbeds: any = { ...row };
          let dropped = false;
          for (const embed of parsed.embeds) {
            const join = joins[`${table}.${embed.table}`];
            if (!join) throw new Error(`Fake has no join for ${table}.${embed.table}`);
            const localValue = row[join.localKey];
            const match =
              localValue === null || localValue === undefined
                ? null
                : (store[embed.table] ?? []).find((candidate) => candidate[join.foreignKey] === localValue) ??
                  null;
            if (!match && embed.inner) dropped = true;
            withEmbeds[embed.alias] = match;
          }
          return dropped ? null : withEmbeds;
        })
        .filter((row): row is any => row !== null);
    }

    function apply(rows: any[]): any[] {
      let result = rows;
      for (const filter of record.filters) {
        result = result.filter((row) => {
          const actual = resolvePath(row, filter.column);
          if (filter.op === "eq") return actual === filter.value;
          if (filter.op === "neq") return actual !== filter.value;
          if (filter.op === "in") return (filter.value as unknown[]).includes(actual);
          if (filter.op === "gt") return String(actual) > String(filter.value);
          if (filter.op === "is") return actual === filter.value;
          throw new Error(`Fake does not implement operator ${filter.op}`);
        });
      }
      for (const order of [...record.orders].reverse()) {
        result = [...result].sort((a, b) => {
          const left = resolvePath(a, order.column);
          const right = resolvePath(b, order.column);
          const leftNull = left === null || left === undefined;
          const rightNull = right === null || right === undefined;
          if (leftNull && rightNull) return 0;
          if (leftNull) return order.nullsFirst ? -1 : 1;
          if (rightNull) return order.nullsFirst ? 1 : -1;
          const cmp = String(left).localeCompare(String(right));
          return order.ascending ? cmp : -cmp;
        });
      }
      return result;
    }

    /** Returns only the selected fields, so an unselected field reads undefined. */
    function project(row: any, spec: ParsedProjection): any {
      const output: any = {};
      for (const column of spec.columns) output[column] = row?.[column];
      for (const embed of spec.embeds) {
        const value = row?.[embed.alias];
        output[embed.alias] = value ? project(value, embed.columns) : null;
      }
      return output;
    }

    function run() {
      const filtered = apply(joined());
      const total = filtered.length;
      let rows = filtered;
      if (record.range) rows = rows.slice(record.range.from, record.range.to + 1);
      if (record.limit !== null) rows = rows.slice(0, record.limit);
      return { rows: rows.map((row) => project(row, parsed)), total };
    }

    function settle() {
      const { rows, total } = run();
      return {
        data: rows,
        error: null,
        count: record.count === "exact" ? total : null
      };
    }

    const query: any = {
      select: (projection: string, options?: { count?: string }) => {
        record.projection = projection;
        record.count = options?.count ?? null;
        parsed = parseProjection(projection);
        return query;
      },
      eq: (column: string, value: unknown) => {
        record.filters.push({ op: "eq", column, value });
        return query;
      },
      neq: (column: string, value: unknown) => {
        record.filters.push({ op: "neq", column, value });
        return query;
      },
      in: (column: string, value: unknown[]) => {
        record.filters.push({ op: "in", column, value });
        return query;
      },
      gt: (column: string, value: unknown) => {
        record.filters.push({ op: "gt", column, value });
        return query;
      },
      is: (column: string, value: unknown) => {
        record.filters.push({ op: "is", column, value });
        return query;
      },
      order: (column: string, options?: { ascending?: boolean; nullsFirst?: boolean }) => {
        record.orders.push({
          column,
          ascending: options?.ascending !== false,
          nullsFirst: options?.nullsFirst
        });
        return query;
      },
      limit: (n: number) => {
        record.limit = n;
        return query;
      },
      range: (from: number, to: number) => {
        record.range = { from, to };
        return Promise.resolve(settle());
      },
      then: (resolve: any, reject: any) => Promise.resolve(settle()).then(resolve, reject)
    };

    return query;
  }

  return {
    client: { from: builder },
    queries,
    /** Every filter applied to the last query issued against `table`. */
    lastQueryFor(table: string): RecordedQuery | undefined {
      return [...queries].reverse().find((query) => query.table === table);
    },
    reset() {
      queries.length = 0;
    }
  };
}
