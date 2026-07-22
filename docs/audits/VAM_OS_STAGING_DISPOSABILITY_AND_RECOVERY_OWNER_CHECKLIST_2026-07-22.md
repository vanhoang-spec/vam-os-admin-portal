# VAM OS Staging Disposability and Recovery Owner Checklist — 2026-07-22

No backup, reset, or staging mutation is authorized.

- [ ] Supabase project is `vam-os-staging`, ref exactly `ljfneyuvpxrmejpxsmpz`.
- [ ] Vercel Preview still points to that staging ref.
- [ ] Staging contains no unique production/business data.
- [ ] Existing staging Auth users have a safe recreation manifest; no passwords/tokens exported.
- [ ] Storage objects are nonessential or separately backed up without copying production objects.
- [ ] Existing staging schema may be reset/recreated.
- [ ] Rollback is recreate staging from the reviewed baseline, not restore production data.
- [ ] Named operator and recovery point are recorded.
- [ ] Production project `qkkroesfiazsejkzflcd` is not selected.
- [ ] A final target-identity check will occur immediately before any future execution.

## Owner options

- **A — Reset/recreate staging:** safest deterministic target when no unique assets exist; requires explicit reset/bootstrap authorization.
- **B — Preserve selected staging-only assets:** inventory and back up only approved non-production Auth/storage/config assets, then recreate; requires a reviewed preservation plan.
- **C — Block bootstrap:** select when disposability, backup, identity, or recovery cannot be confirmed.

Owner selection: ________  Owner: ________  Date: ________  Recovery operator: ________
