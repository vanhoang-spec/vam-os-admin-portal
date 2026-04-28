# VAM OS Admin Portal MVP

VAM OS Admin Portal MVP v0.1 is an internal, read-only admin portal for Vietnam Alumni Mentoring, focused on UEH Mentoring Season 11 operations and data review.

The portal connects to Supabase production data and currently supports:

- Dashboard
- People
- Mentors
- Mentees
- Applications
- Application Detail
- Matches
- Match Detail
- People Detail
- Data Issues

## MVP Status

- Read-only.
- Internal only.
- Supabase production data is connected.
- No edit/update/delete actions yet.
- No login/auth yet.
- RLS is not enabled yet.
- This is not yet a public mentor/mentee portal.

## Documentation

- [MVP QA Checklist](docs/MVP_QA_CHECKLIST.md)
- [VAM OS Admin User Guide](docs/VAM_OS_ADMIN_USER_GUIDE.md)
- [Deployment Notes](docs/DEPLOYMENT_NOTES.md)
- [Roadmap](docs/VAM_OS_ROADMAP.md)
- [Phase 2 Activity & Event Tracking Plan Draft](docs/PHASE_2_ACTIVITY_AND_EVENT_TRACKING_PLAN_DRAFT.md)
- [Activity Import Guide Draft](docs/ACTIVITY_IMPORT_GUIDE_DRAFT.md)

## Setup

Install dependencies:

```bash
npm install
```

Create `.env.local` from `.env.local.example`:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-publishable-anon-key
VAM_OS_ADMIN_PASSWORD=temporary-internal-password
```

Use only the Supabase anon/publishable key.

`VAM_OS_ADMIN_PASSWORD` enables a temporary internal password gate for the whole app. It is not a replacement for Supabase Auth/RLS.

## Local Development

Use the clean dev command:

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

## Security Notes

Never put a Supabase `service_role` key, database password, or any secret key in frontend environment variables.

Because auth/RLS is not enabled yet, do not share a deployed public URL widely. Treat the app as an internal MVP for VAM core-team review only.

The temporary password gate should be enabled on Vercel Preview by setting `VAM_OS_ADMIN_PASSWORD`. Replace it with Supabase Auth, role-based access, and RLS before broad usage.

## Current Limitations

- No direct data editing.
- No issue resolution workflow yet.
- No public mentor/mentee login.
- No role-based access.
- No RLS policies.
- Some data quality issues still require manual review.
