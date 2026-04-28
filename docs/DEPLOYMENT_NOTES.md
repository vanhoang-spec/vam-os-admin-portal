# Deployment Notes

## Required Environment Variables

Set these variables in local `.env.local` and in the deployment platform:

```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
VAM_OS_ADMIN_PASSWORD=
```

Use only the Supabase anon/publishable key.

`VAM_OS_ADMIN_PASSWORD` is a temporary internal access gate for MVP Preview deployments. It protects the app before Supabase Auth/RLS is implemented, but it is not a long-term security model.

## Security Warning

Never use a Supabase `service_role` key, database password, secret key, or any privileged credential in the frontend or in Vercel public environment variables.

MVP v0.1 does not include auth or RLS. Treat the deployment as internal-only.

Do not share the public URL widely until authentication, RLS, and role-based access are implemented.

## Local Development

Use the clean dev command to avoid stale Next.js cache/vendor chunk issues:

```bash
npm.cmd run dev:clean
```

Open:

```text
http://localhost:3000
```

## Build

```bash
npm.cmd run build
```

## Suggested Vercel Deployment Steps

1. Push the repo to the deployment Git provider.
2. Create a new Vercel project from the repo.
3. Set framework preset to Next.js.
4. Add environment variables:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `VAM_OS_ADMIN_PASSWORD`
5. Run the default build command:
   - `npm run build`
6. Deploy Preview first.
7. Verify all QA checklist items on Preview.
8. Promote to Production only for internal testing.

## Suggested Subdomain

```text
app.alumni-mentoring.edu.vn
```

## Current MVP Constraints

- Read-only Admin Portal.
- No edit forms.
- No auth.
- No RLS.
- No public mentor/mentee login.
- No direct issue resolution workflow yet.

## Pre-Deployment Checklist

- [ ] `npm.cmd run build` passes.
- [ ] `.env.local` does not contain service role key.
- [ ] `VAM_OS_ADMIN_PASSWORD` is set for Vercel Preview.
- [ ] Dashboard counts match production Supabase counts.
- [ ] Applications list does not fetch all `application_answers`.
- [ ] Data Issues page does not fetch `application_answers`.
- [ ] Internal stakeholders understand this is not yet a public portal.
