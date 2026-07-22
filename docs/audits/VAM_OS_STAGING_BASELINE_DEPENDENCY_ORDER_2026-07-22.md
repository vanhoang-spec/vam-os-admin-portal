# VAM OS Staging Baseline Dependency Order — 2026-07-22

Deterministic target order:

1. approved extensions (`pgcrypto`, `citext` only when required);
2. application schemas;
3. confirmed enums/types;
4. confirmed sequences and ownership;
5. tables without foreign keys;
6. tables with foreign keys, initially without deferred cross-cycle FKs;
7. foreign keys/check/unique constraints;
8. indexes;
9. VAM OS-owned functions in dependency order;
10. triggers;
11. views;
12. enable/force RLS;
13. policies;
14. least-privilege grants/revokes;
15. comments.

Resolved high-level dependencies: types precede tables; core identity/program/season tables precede profiles, memberships, applications, activities, events, and matches; all tables precede functions/triggers/views; RLS precedes policy exposure.

Potential cycles: mutual profile/person or application/person FKs and view/function dependencies cannot be certified without complete constraint and dependency metadata. Resolve table cycles by creating tables first and adding confirmed FKs in step 7—never by inventing deferrability or delete behavior.

Unknowns blocking a complete topological sort: ten enum definitions/order, exact sequence ownership, three production view definitions, authoritative pre-012 DDL, function version provenance, and owner-approved security target.
