const fs = require('fs');
let code = fs.readFileSync('__tests__/support/fake-postgrest.ts', 'utf-8');

code = code.replace(
  `| { kind: "notNull"; column: string }`,
  `| { kind: "notNull"; column: string }\n  | { kind: "ilike"; column: string; pattern: string }`
);

code = code.replace(
  `| { kind: "or"; expression: string };`,
  `| { kind: "or"; expression: string; options?: { foreignTable?: string } };`
);

code = code.replace(
  `function matchesOrTerm(row: any, term: string) {`,
  `function escapeRegex(str: string) { return str.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&'); }\n\nfunction matchesOrTerm(row: any, term: string) {`
);

code = code.replace(
  `  const eqMatch = term.match(/^([^.]+)\\.eq\\.(.*)$/);
  if (eqMatch) return String(row[eqMatch[1]]) === eqMatch[2];
  throw new Error(\`fake-postgrest: unsupported or() term "\${term}"\`);`,
  `  const eqMatch = term.match(/^([^.]+)\\.eq\\.(.*)$/);
  if (eqMatch) {
    let val = eqMatch[2];
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
    return String(row[eqMatch[1]]) === val;
  }
  const ilikeMatch = term.match(/^([^.]+)\\.ilike\\.(.*)$/);
  if (ilikeMatch) {
    let val = ilikeMatch[2];
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
    const regex = new RegExp('^' + val.split('%').map(escapeRegex).join('.*') + '$', 'i');
    return regex.test(String(row[ilikeMatch[1]] ?? ""));
  }
  throw new Error(\`fake-postgrest: unsupported or() term "\${term}"\`);`
);

code = code.replace(
  `    case "notNull":
      return rows.filter((row) => row[filter.column] !== null && row[filter.column] !== undefined);`,
  `    case "notNull":
      return rows.filter((row) => row[filter.column] !== null && row[filter.column] !== undefined);
    case "ilike": {
      const regex = new RegExp('^' + filter.pattern.split('%').map(escapeRegex).join('.*') + '$', 'i');
      return rows.filter((row) => regex.test(String(row[filter.column] ?? "")));
    }`
);

code = code.replace(
  `function compareForOrder(a: any, b: any, ascending: boolean) {`,
  `function compareForOrder(a: any, b: any, ascending: boolean, nullsFirst: boolean) {`
);

code = code.replace(
  `  if (aNull) return ascending ? 1 : -1;
  if (bNull) return ascending ? -1 : 1;`,
  `  if (aNull) return nullsFirst ? -1 : 1;
  if (bNull) return nullsFirst ? 1 : -1;`
);

code = code.replace(
  `    order: { column: string; ascending: boolean }[],`,
  `    order: { column: string; ascending: boolean; nullsFirst: boolean }[],`
);

code = code.replace(
  `order.map((entry) => \`\${entry.column}:\${entry.ascending ? "asc" : "desc"}\`),`,
  `order.map((entry) => \`\${entry.column}:\${entry.ascending ? "asc" : "desc"}\${entry.nullsFirst ? ".nullsfirst" : ""}\`),`
);

code = code.replace(
  `const result = compareForOrder(a[entry.column], b[entry.column], entry.ascending);`,
  `const result = compareForOrder(a[entry.column], b[entry.column], entry.ascending, entry.nullsFirst);`
);

code = code.replace(
  `      const response: any = { data: window.head ? null : projected, error: null };
      if (window.count) response.count = totalCountAfterFilters;
      
      return response;`,
  `      const response: any = { data: window.head ? null : projected, error: null };
      if (window.count) response.count = totalCountAfterFilters;
      
      if (window.assertNoSilentCap && capped.length >= db.maxRows) {
        throw new Error('assertNoSilentCap: Fake database row cap of ' + db.maxRows + ' was hit silently');
      }
      return response;`
);

code = code.replace(
  `window: { from: number | null; to: number | null; limit: number | null; count?: string; head?: boolean }`,
  `window: { from: number | null; to: number | null; limit: number | null; count?: string; head?: boolean; assertNoSilentCap?: boolean }`
);

code = code.replace(
  `gt: (column: string, value: unknown) => withFilter({ kind: "gt", column, value }),`,
  `gt: (column: string, value: unknown) => withFilter({ kind: "gt", column, value }),
      ilike: (column: string, pattern: string) => withFilter({ kind: "ilike", column, pattern }),
      or: (expression: string, options?: { foreignTable?: string }) => withFilter({ kind: "or", expression, options }),`
);

code = code.replace(
  `order: (column: string, opts?: { ascending?: boolean }) =>
        builder(table, columns, filters, [...order, { column, ascending: opts?.ascending ?? true }], window),`,
  `order: (column: string, opts?: { ascending?: boolean; nullsFirst?: boolean }) =>
        builder(table, columns, filters, [...order, { column, ascending: opts?.ascending ?? true, nullsFirst: opts?.nullsFirst ?? !opts?.ascending }], window),`
);

code = code.replace(
  `limit: (limit: number) => builder(table, columns, filters, order, { ...window, limit }),`,
  `limit: (limit: number) => builder(table, columns, filters, order, { ...window, limit }),
      assertNoSilentCap: () => builder(table, columns, filters, order, { ...window, assertNoSilentCap: true }),`
);

fs.writeFileSync('__tests__/support/fake-postgrest.ts', code);
