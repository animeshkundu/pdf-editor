# 0027. Deploy the accepted artifact into mounted public URL space

## Status

Accepted

## Date

2026-07-30

## Supersedes

[ADR 0021](0021-deploy-through-ci-rather-than-git-integration.md)

## Context

ADR 0021 correctly moved deployment behind CI, but still asked Vercel to rebuild after CI
accepted a different artifact. The tools.kundus.in deployment also needs a landing page at
`/pdf/`, the application at `/pdf/app/`, and collision-free application assets.

The sibling photo-tools deployment demonstrates a Build Output API arrangement that avoids
both problems. The static tree is mounted unmodified under an internal prefix, public routes
rewrite into it, and Vercel uploads the artifact without rebuilding. Its app response policy
is extracted from the built app's meta policy and extended only with the header-only
`frame-ancestors 'none'` directive. This removes ADR 0021's stale duplicated-policy concern.

## Decision

CI builds the application with `PDF_EDITOR_BASE=/pdf-editor/app/`, drives that mounted
production artifact, and uploads `dist/`. The deployment workflow checks out the exact
accepted commit, downloads that artifact into `site/app/`, assembles Build Output API v3, and
deploys with `vercel deploy --prebuilt`.

The unmodified site tree is mounted at `.vercel/output/static/pdf-editor/`. Ordered routes
publish `/pdf/` and `/pdf/app/`; mount-space redirects precede public rewrites so a rewritten
request cannot redirect back into a loop. Header routes precede the filesystem handler.

`vercel.json` disables Git deployments and contains no competing build or policy. The Build
Output configuration preserves every existing response header, appends
`frame-ancestors 'none'` to the app's extracted meta policy, does not add COOP or COEP, and
applies immutable caching only to hashed application assets.

## Consequences

### Positive

- The bytes deployed are the bytes CI accepted.
- The landing page and application occupy stable public paths without asset collisions.
- The app CSP has one source of truth while clickjacking protection remains effective.

### Negative

- Local and browser acceptance now require the assembled mounted artifact.
- Route ordering and artifact download are deployment-critical and need explicit checks.

### Neutral

- Zero egress is unchanged. The landing page has no script and the application retains the
  exact default-deny meta policy in `web/index.html`.

## Notes

Implemented by `scripts/build-vercel-output.mjs`, `scripts/prepare-site.mjs`,
`.github/workflows/vercel.yml`, and `tests/e2e/playwright.config.ts`.
