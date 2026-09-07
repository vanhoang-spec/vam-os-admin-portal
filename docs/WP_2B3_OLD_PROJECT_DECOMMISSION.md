# VAM OS — WP 2B.3: OLD VERCEL PROJECT DECOMMISSION

**For:** the previous owner's side (anh Thắng and his Claude)
**From:** the new technical owner (`vanhoang-spec`)
**Mode:** one hostname change, one credential revocation. No code, no database, no deploys.

---

## FILL THIS IN BEFORE SENDING

```
TARGET_DOMAIN = ______________________________
```

Set it to the custom domain if it is live and serving (e.g.
`https://alumni-mentoring.edu.vn`), otherwise to `https://vam-os.vercel.app`.
**Do not proceed with a blank or unverified value** — verify it returns HTTP 200 on
`/apply/mentor` first. Everything below refers to it as `TARGET_DOMAIN`.

---

## STATE — what has already happened

The migration is **complete on the new owner's side**. This is cleanup, not cut-over.

- GitHub repo `vanhoang-spec/vam-os-admin-portal` — transferred, owned by the new owner.
- Production Supabase — already inside the new owner's Pro organization. **Its project
  ref, URL and API keys never changed**, because an organization transfer preserves
  them. There is exactly one production database and there always was.
- New Vercel project `tcm17/vam-os-admin-portal` — provisioned, Node 24.x, function
  region `sin1`, serving at `vam-os.vercel.app`.
- **Cut-over done 2026-09-08.** `VERCEL_PROJECT_ID`, `VERCEL_ORG_ID` and `VERCEL_TOKEN`
  on the GitHub `Production` environment now point at the new project. A
  `workflow_dispatch` run of `vercel-production.yml` completed green end-to-end and
  landed a Ready Production deployment. **Every push to `main` now deploys to the new
  project. The old project no longer receives deployments.**

## WHY THIS IS NOT OPTIONAL TIDY-UP

The old project `vam-os-admin-portal` keeps serving its **last build**, and that build
**still holds valid Supabase Production credentials**. As of today it is a frozen second
copy of the application with write access to the live database.

Today the two copies are identical, so nothing is wrong yet. From the next commit
onward they diverge: every validation rule, schema constraint or bug fix added to `main`
reaches the new deployment and **never reaches the frozen one**, which remains able to
write. The two public intake forms are currently in state `open`
(`public.application_form_controls`), so `vam-os-admin-portal.vercel.app/apply/mentor`
and `/apply/mentee` accept real submissions from anyone holding the link.

That is the exposure this work package closes.

---

## WP 2B.3-A — REDIRECT THE OLD HOSTNAME

**Do not delete the project first.** Links to `vam-os-admin-portal.vercel.app` were sent
to real mentors and mentees; deleting would 404 them. Redirecting preserves them.

1. Vercel dashboard → the **old** project `vam-os-admin-portal` → **Settings** →
   **Domains**.
2. Select `vam-os-admin-portal.vercel.app` → **Edit**.
3. Set **Redirect to** = `TARGET_DOMAIN`, status **307** (temporary) for the first few
   days, so it can be reverted without browsers having cached a permanent redirect.
   Move it to 308 later only if you want it permanent.
4. Save.

Vercel preserves the path and query string on a domain-level redirect, so
`/apply/mentee?foo=bar` lands on `TARGET_DOMAIN/apply/mentee?foo=bar`. **Verify this
rather than assuming it** — step B checks it explicitly.

### Timing

The intake forms autosave drafts to `localStorage` on the applicant's own device
(`app/apply/_components/use-apply-autosave.ts`). `localStorage` is scoped per origin, so
at the moment the redirect goes live **anyone mid-application loses their unsaved draft
and sees an empty form**. Submitted applications are unaffected — they are already rows
in the database.

Schedule the change for a quiet hour. Do not do it during a recruitment push.

## WP 2B.3-B — VERIFY

Run these and report the output verbatim.

```
curl -sI https://vam-os-admin-portal.vercel.app/apply/mentee | head -20
```

Expect `HTTP/1.1 307` (or 308) and a `location:` header pointing at
`TARGET_DOMAIN/apply/mentee` — **path preserved**. If `location` drops the path and
points at the bare domain, the redirect is misconfigured: report it and stop, do not
attempt to patch it with rewrites.

```
curl -s -o /dev/null -w "%{http_code} %{url_effective}\n" -L https://vam-os-admin-portal.vercel.app/apply/mentor
```

Expect `200` and a final URL under `TARGET_DOMAIN`.

## WP 2B.3-C — REVOKE THE OLD DEPLOYMENT TOKEN

Only after B passes.

The `VERCEL_TOKEN` that GitHub Actions used before the cut-over belongs to the previous
owner's Vercel account and is no longer referenced by anything. It is a live credential
with deploy rights.

1. [vercel.com/account/tokens](https://vercel.com/account/tokens) on the **previous
   owner's** account.
2. Identify the token that was used for VAM OS GitHub Actions deployments.
3. Delete it.

If which token it is cannot be established with certainty, **stop and report** rather
than guessing — deleting the wrong token could break an unrelated project.

## WP 2B.3-D — RETIRE THE PROJECT (LATER, NOT NOW)

Leave the old project in place, redirecting, for at least **30 days**. It costs nothing
and is the rollback path if something unexpected surfaces on the new deployment.

After that window, and only on the new owner's explicit go-ahead, the old project can be
deleted. Note that deleting it releases the name `vam-os-admin-portal.vercel.app`, at
which point the redirect stops and old links 404 — so this step is a decision about
whether those links still matter, not a routine cleanup.

---

## OUT OF SCOPE — DO NOT DO THESE

- **Do not touch Supabase.** The database belongs to the new owner's organization. Do
  not rotate the `anon` or `service_role` keys — the live deployment runs on them and
  rotating breaks production instantly.
- **Do not modify the GitHub repository**, its workflows, or its secrets. That side is
  finished and verified.
- **Do not redeploy the old project**, including "redeploy to refresh". It has no
  purpose and would extend the life of the frozen copy.
- **Do not change the old project's environment variables.** Removing them would break
  the redirect target's own hostname resolution only if the project is also serving; and
  in any case the project is being retired, not repaired.
- **Do not implement application features.** Two changes are tracked separately and are
  not part of this work: blocking Season 11 mentees from re-applying to Season 12, and
  admin reactivation of a declined mentor.

---

## REPORT BACK

```
VAM_OS_2B3_STATUS=PASS | PARTIAL | BLOCKED

TARGET_DOMAIN=
REDIRECT_CONFIGURED=YES | NO
REDIRECT_STATUS_CODE=
PATH_PRESERVED=YES | NO
APPLY_MENTOR_FINAL_URL=
APPLY_MENTEE_FINAL_URL=
OLD_TOKEN_REVOKED=YES | NO | COULD_NOT_IDENTIFY
OLD_PROJECT_DELETED=NO   (expected: NO — see 2B.3-D)

SUPABASE_TOUCHED=0
GITHUB_TOUCHED=0
DEPLOYS_TRIGGERED=0

BLOCKERS=
NOTES=
```
