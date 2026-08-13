/**
 * Minimal ambient declaration for the `pg` package.
 *
 * `pg` is a runtime dependency of this repository but ships no bundled types,
 * and `@types/pg` is not installed — adding a dev dependency for one opt-in
 * test would be a heavier change than the surface it types. Only the members
 * `__tests__/m069-r4-unapplied-guard-live.test.ts` actually uses are declared.
 *
 * `query` is declared with the multi-statement return shape the test relies on:
 * PostgreSQL's simple query protocol returns one result per statement, so
 * `pg` hands back an array when the text contains more than one.
 */
declare module "pg" {
  export interface QueryResult {
    rows: Array<Record<string, unknown>>;
    rowCount: number | null;
    command: string;
  }

  export class Client {
    constructor(config: { connectionString: string });
    connect(): Promise<void>;
    query(sql: string): Promise<QueryResult | QueryResult[]>;
    end(): Promise<void>;
  }
}
