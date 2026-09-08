# VAM OS — WP 2B.3: REDIRECT THE OLD VERCEL PROJECT

**For:** the previous owner's side (anh Thắng and his Claude)
**From:** the new technical owner (`vanhoang-spec`)
**Mode:** one hostname setting. No code, no database, no deploys, no DNS.
**Updated:** 2026-09-08, after cut-over completed and the first feature shipped.

```
TARGET = https://vam-os.vercel.app
```

That value is final for this work package. A custom domain
(`os.alumni-mentoring.edu.vn`) is in progress on the new owner's side but is not
ready, and this change must not wait for it — see *Why this is now urgent*. When
the custom domain is live the redirect target will be updated; that is a
one-field edit later, not a reason to delay now.

---

## 1. State — what has already happened

The migration is **complete and verified on the new owner's side.** This is not
cut-over. Cut-over is done.

- GitHub repo `vanhoang-spec/vam-os-admin-portal` — transferred, owned by the new owner.
- Production Supabase — inside the new owner's Pro organization. Project ref, URL
  and API keys never changed (an organization transfer preserves them). **There
  is exactly one production database and there always was.**
- New Vercel project `tcm17/vam-os-admin-portal` — serving at `vam-os.vercel.app`,
  Node 24.x, function region `sin1`.
- **Cut-over completed 2026-09-08.** `VERCEL_PROJECT_ID`, `VERCEL_ORG_ID` and
  `VERCEL_TOKEN` on the GitHub `Production` environment point at the new project.
  Two deployments have since run green end-to-end from `push` on `main`.
- The old project **no longer receives any deployment** and cannot: nothing points
  at it any more.

## 2. Why this is now urgent, and no longer tidy-up

When this package was first drafted the two deployments were byte-identical, so
the only argument was hygiene. **That is no longer true.**

| | Commit | Build fingerprint (`/apply/mentor` chunks) |
|---|---|---|
| `vam-os.vercel.app` (new) | `38b5eff`, moving | `87d37a489e686e1e` |
| `vam-os-admin-portal.vercel.app` (old) | **frozen at `cc75c10`** | `572cd090ef8b9fa0` |

`main` is **7 commits ahead** of what the old hostname serves, and the gap grows
with every merge.

The first of those commits shipped an applicant confirmation email. The
consequence is specific and it is the reason this cannot wait:

- **Both hostnames write to the same production database.** An application
  submitted through either one lands in the same `applications` table.
- The **new** build attempts a confirmation email and records the attempt in
  `public.outbound_emails` — including attempts suppressed by configuration.
- The **old** build contains no email code at all. An application submitted
  through it produces **no email and no row in the log**. Not a failed row — no
  row. From the operator's screen those applicants are invisible.
- **The links already distributed to mentors and mentees point at the old
  hostname.** So today the majority of real intake traffic reaches the frozen
  build.

The same argument holds for every future fix. The old build still carries valid
Supabase Production credentials, so it is a frozen second copy of the
application with write access to the live database, diverging further from
`main` on every merge. Any validation rule or bug fix added from now on is
absent from it while it remains able to write.

## 3. What is requested

Configure `vam-os-admin-portal.vercel.app` to **redirect** to `TARGET`.

Vercel dashboard → the **old** project `vam-os-admin-portal` → **Settings** →
**Domains** → select `vam-os-admin-portal.vercel.app` → **Edit** → set
**Redirect to** = `https://vam-os.vercel.app` → **Save**.

Use status **307 (temporary)** for now, not 308. The target will change again
once the custom domain is live, and browsers cache a 308 permanently — a wrong
308 is very hard to take back from users' browsers.

**Do not delete the project.** Links to `vam-os-admin-portal.vercel.app` were
sent to real mentors and mentees; deleting the project frees the hostname and
turns every one of those links into a 404. Redirecting preserves them.

### Timing

Both intake forms are currently **open** to the public, and the forms autosave
drafts to `localStorage` on the applicant's own device
(`app/apply/_components/use-apply-autosave.ts`). `localStorage` is scoped per
origin, so at the moment the redirect goes live **anyone part-way through an
application loses their unsaved draft and lands on an empty form**. Submitted
applications are unaffected — they are already rows in the database.

Please make the change at a quiet hour, not during a recruitment push.

## 4. Verification

Run these and report the output verbatim.

```
curl -sI https://vam-os-admin-portal.vercel.app/apply/mentee | head -20
```

Expect `HTTP/1.1 307` and a `location:` header of
`https://vam-os.vercel.app/apply/mentee` — **path preserved**. If `location`
drops the path and points at the bare host, the redirect is misconfigured:
report it and stop rather than patching it with rewrites.

```
curl -s -o /dev/null -w "%{http_code} %{url_effective}\n" -L https://vam-os-admin-portal.vercel.app/apply/mentor
```

Expect `200` and a final URL under `vam-os.vercel.app`.

## 5. After the redirect is verified

Revoke the old deployment token. The `VERCEL_TOKEN` that GitHub Actions used
before cut-over belongs to the previous owner's Vercel account and is no longer
referenced by anything, but it is still a live credential with deploy rights.

[vercel.com/account/tokens](https://vercel.com/account/tokens) on the **previous
owner's** account → identify the token used for VAM OS deployments → delete it.

If it cannot be identified with certainty, **stop and report** rather than
guessing; deleting the wrong token could break an unrelated project.

## 6. Retiring the project — later, and not by default

Leave the old project in place, redirecting, for at least **30 days**. It costs
nothing and is the rollback path if something unexpected appears on the new
deployment.

After that, deleting it is a decision about whether the distributed links still
matter — deleting frees the hostname and the redirect stops working. It is not
routine cleanup, and it needs the new owner's explicit go-ahead.

---

## Out of scope — please do not do these

- **Do not touch Supabase.** The database belongs to the new owner's
  organization. Do not rotate the `anon` or `service_role` keys — the live
  deployment runs on them and rotating breaks production instantly.
- **Do not touch DNS for `alumni-mentoring.edu.vn`.** Records there are being
  handled directly with the registrar by the new owner. In particular the MX
  records carry a mailbox this project's email work depends on.
- **Do not modify the GitHub repository**, its workflows, or its secrets.
- **Do not redeploy the old project**, including a "redeploy to refresh". It
  would only extend the life of the frozen copy.
- **Do not implement application features.** Two changes are tracked separately
  and are not part of this work: blocking Season 11 mentees from re-applying to
  Season 12, and admin reactivation of a declined mentor.

---

## Report back

```
VAM_OS_2B3_STATUS=PASS | PARTIAL | BLOCKED

TARGET=https://vam-os.vercel.app
REDIRECT_CONFIGURED=YES | NO
REDIRECT_STATUS_CODE=
PATH_PRESERVED=YES | NO
APPLY_MENTOR_FINAL_URL=
APPLY_MENTEE_FINAL_URL=
CHANGE_APPLIED_AT=            (local time, so the new owner can correlate
                               any applicant who reports a lost draft)
OLD_TOKEN_REVOKED=YES | NO | COULD_NOT_IDENTIFY
OLD_PROJECT_DELETED=NO        (expected: NO — see section 6)

SUPABASE_TOUCHED=0
DNS_TOUCHED=0
GITHUB_TOUCHED=0
DEPLOYS_TRIGGERED=0

BLOCKERS=
NOTES=
```
