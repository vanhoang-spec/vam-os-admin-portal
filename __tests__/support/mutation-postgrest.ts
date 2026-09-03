export type MutationPredicate =
  | { kind: "eq"; column: string; value: unknown }
  | { kind: "neq"; column: string; value: unknown }
  | { kind: "in"; column: string; values: unknown[] };

export type MutationRecord = {
  table: string;
  operation: "select" | "insert" | "update";
  predicates: MutationPredicate[];
  values?: unknown;
  affected: number;
};

function matches(row: Record<string, any>, predicate: MutationPredicate) {
  if (predicate.kind === "eq") return row[predicate.column] === predicate.value;
  if (predicate.kind === "neq") return row[predicate.column] !== predicate.value;
  return predicate.values.includes(row[predicate.column]);
}

export class MutationPostgrestDb {
  tables: Record<string, Array<Record<string, any>>> = {};
  records: MutationRecord[] = [];
  private insertFailures = new Map<string, number>();
  private updateHooks = new Map<string, Array<() => void>>();
  private nextId = 1;

  reset() {
    this.tables = {};
    this.records = [];
    this.insertFailures.clear();
    this.updateHooks.clear();
    this.nextId = 1;
  }

  failNextInsert(table: string) {
    this.insertFailures.set(table, (this.insertFailures.get(table) ?? 0) + 1);
  }

  beforeNextUpdate(table: string, hook: () => void) {
    const hooks = this.updateHooks.get(table) ?? [];
    hooks.push(hook);
    this.updateHooks.set(table, hooks);
  }

  consumeInsertFailure(table: string) {
    const remaining = this.insertFailures.get(table) ?? 0;
    if (!remaining) return false;
    this.insertFailures.set(table, remaining - 1);
    return true;
  }

  runUpdateHook(table: string) {
    const hooks = this.updateHooks.get(table) ?? [];
    const hook = hooks.shift();
    if (hooks.length) this.updateHooks.set(table, hooks);
    else this.updateHooks.delete(table);
    hook?.();
  }

  generatedId() {
    return `generated-${this.nextId++}`;
  }
}

class Builder {
  private operation: "select" | "insert" | "update" = "select";
  private predicates: MutationPredicate[] = [];
  private inserted: unknown;
  private updated: Record<string, unknown> | undefined;
  private returning = false;
  private orders: Array<{ column: string; ascending: boolean }> = [];
  private rowLimit: number | null = null;

  constructor(private db: MutationPostgrestDb, private table: string) {}

  select(_columns = "*") {
    if (this.operation !== "select") this.returning = true;
    return this;
  }

  insert(values: unknown) {
    this.operation = "insert";
    this.inserted = values;
    return this;
  }

  update(values: Record<string, unknown>) {
    this.operation = "update";
    this.updated = values;
    return this;
  }

  eq(column: string, value: unknown) {
    this.predicates.push({ kind: "eq", column, value });
    return this;
  }

  neq(column: string, value: unknown) {
    this.predicates.push({ kind: "neq", column, value });
    return this;
  }

  in(column: string, values: unknown[]) {
    this.predicates.push({ kind: "in", column, values: [...values] });
    return this;
  }

  order(column: string, options?: { ascending?: boolean }) {
    this.orders.push({ column, ascending: options?.ascending !== false });
    return this;
  }

  limit(value: number) {
    this.rowLimit = value;
    return this;
  }

  private rows() {
    return this.db.tables[this.table] ?? (this.db.tables[this.table] = []);
  }

  private async execute() {
    if (this.operation === "insert") {
      if (this.db.consumeInsertFailure(this.table)) {
        this.db.records.push({
          table: this.table,
          operation: "insert",
          predicates: [],
          values: this.inserted,
          affected: 0
        });
        return { data: null, error: { code: "TEST_INSERT_FAILURE", message: "forced insert failure" } };
      }
      const source = Array.isArray(this.inserted) ? this.inserted : [this.inserted];
      const inserted = source.map((value) => {
        const row = { ...(value as Record<string, unknown>) } as Record<string, any>;
        if (!row.id) row.id = this.db.generatedId();
        this.rows().push(row);
        return { ...row };
      });
      this.db.records.push({
        table: this.table,
        operation: "insert",
        predicates: [],
        values: this.inserted,
        affected: inserted.length
      });
      return { data: this.returning ? inserted : null, error: null };
    }

    if (this.operation === "update") {
      this.db.runUpdateHook(this.table);
      const affected = this.rows().filter((row) => this.predicates.every((predicate) => matches(row, predicate)));
      for (const row of affected) Object.assign(row, this.updated);
      this.db.records.push({
        table: this.table,
        operation: "update",
        predicates: [...this.predicates],
        values: this.updated,
        affected: affected.length
      });
      return {
        data: this.returning ? affected.map((row) => ({ ...row })) : null,
        error: null
      };
    }

    let rows = this.rows()
      .filter((row) => this.predicates.every((predicate) => matches(row, predicate)))
      .map((row) => ({ ...row }));
    for (const order of this.orders.slice().reverse()) {
      rows.sort((left, right) => {
        const comparison = String(left[order.column] ?? "").localeCompare(String(right[order.column] ?? ""));
        return order.ascending ? comparison : -comparison;
      });
    }
    if (this.rowLimit !== null) rows = rows.slice(0, this.rowLimit);
    this.db.records.push({
      table: this.table,
      operation: "select",
      predicates: [...this.predicates],
      affected: rows.length
    });
    return { data: rows, error: null };
  }

  async maybeSingle() {
    const result = await this.execute();
    return {
      data: Array.isArray(result.data) ? result.data[0] ?? null : result.data,
      error: result.error
    };
  }

  async single() {
    return this.maybeSingle();
  }

  then(resolve: (value: any) => any, reject?: (reason: any) => any) {
    return this.execute().then(resolve, reject);
  }
}

export function mutationClient(db: MutationPostgrestDb) {
  return {
    from(table: string) {
      return new Builder(db, table);
    }
  };
}
