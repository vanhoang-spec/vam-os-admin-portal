# VAM OS Staging Baseline Function and Trigger Design — 2026-07-22

Design only; not authorized for execution.

- Include the 13 VAM OS-owned functions classified in the offline analysis only after their referenced tables/types exist.
- Exclude all 45 extension-managed `citext`/compatibility routines. Recreate only the approved extension, never copied extension function DDL.
- Security review is mandatory for the seven SECURITY DEFINER functions: explicit safe `search_path`, least-privilege execute grants, caller checks, and staging role behavior.
- Create the three trigger functions before the 20 triggers.
- Create 17 `set_updated_at` triggers only after each named target table exists; preserve the catalog definition and timing/event exactly from the ignored source.
- Create the two membership-log immutability triggers after the log table and function.
- Create the membership scope-validation trigger after membership tables, referenced program/season objects, and validator function.
- Do not create any recruitment-campaign function or trigger; none exists in production and migration 061 is not authorized.

Exact function/trigger definitions remain in the ignored, safety-reviewed metadata input. They must be rendered through a separate reviewed artifact; this design does not paste executable SECURITY DEFINER DDL or invent grants.
