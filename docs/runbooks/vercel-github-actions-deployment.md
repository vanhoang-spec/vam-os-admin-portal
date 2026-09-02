# Vercel deployment through GitHub Actions

## Cutover gate

Do not merge the deployment pull request until all three repository or `production` environment secrets exist:

- `VERCEL_TOKEN`
- `VERCEL_ORG_ID`
- `VERCEL_PROJECT_ID`

The Vercel token must be dedicated to CI and stored only in GitHub Actions secrets. Never commit it or send it in chat.

## Production flow

1. A reviewed change reaches `main`.
2. GitHub Actions installs dependencies and runs `npm run typecheck` and `npm test`.
3. The workflow pulls the Vercel Production configuration.
4. Vercel CLI builds once and deploys the prebuilt artifact to Production.

`vercel.json` disables the native Vercel Git deployment so the same commit cannot deploy twice.

## Manual release

The repository owner or a collaborator with Actions access can use **Actions → Vercel Production Deployment → Run workflow**. The same tests and deployment gates apply.

## Failure behavior

- A missing secret stops before dependencies are installed.
- A type-check, test, build, or deployment failure stops the workflow.
- `cancel-in-progress: false` prevents a newer release from cancelling a Production deployment already in progress.
- Vercel rollback remains available to the Vercel account owner.

## Rotation

Rotate `VERCEL_TOKEN` when access changes or if exposure is suspected. Update the GitHub secret first, validate a manual workflow run, then revoke the old token.
