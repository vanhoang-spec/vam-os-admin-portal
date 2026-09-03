# Codex Checkpoint 1 — Branch/history reconciliation

Date: 2026-08-30. Scope: read-only, targeted S12 recruitment history only.

- Original worktree `C:\vam-s12-account-provisioning`: branch `ops/s12-core-team-account-provisioning`, HEAD and merge-base `0244e67f4b6fbc034f6321e546cd782244396191` (`origin/main`), clean with no uncommitted or unrelated work.
- Remediation worktree `C:\vam-s12-recruitment-remediation`: branch `feat/s12-recruitment-operational-remediation`, committed HEAD `eb892e5030143b130a4c8f31f7390a56aab7d2c6`, based on `0244e67`, ahead by the three M2.1 interview commits replayed from staging.
- Replayed commits: `61521e7 -> 7c0eb18`, `c5adc16 -> fc22603`, `27c607a -> eb892e5`. The final range difference is context-only and preserves main's newer classification import.
- Old branch `origin/feat/s12-core-ops-readiness` is not safe to merge. Migrations 079–082 and its bulk code encode exactly/max two reviewers, conflicting with the approved configurable minimum of one and optional extra reviewers.
- Current main contains newer identity, application list/performance, form, and profile-review UX that a wholesale old-branch merge would regress.

Codex initially found an RPC/TypeScript alias mismatch (`admin_user_id/platform_role` versus `id/role`) and bulk-result copy inconsistent with partial outcomes. Both findings were dispositioned in the active implementation immediately after review.
