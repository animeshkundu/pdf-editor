# 21. Deploy through CI rather than Vercel's Git integration

Date: 2026-07-27

## Status

Accepted, and **not yet in effect**. Amends
[ADR 0006](0006-three-toolchain-build-and-committed-wasm.md) and the deployment mechanism
recorded in [`docs/PUBLISHING.md`](../PUBLISHING.md).

The Git integration was connected on 2026-07-27 and is currently the mechanism that
deploys, producing the first production deployment at 23:37 UTC that day. `deploy.yml`
holds no credentials and therefore skips, so the two do not conflict today. **Adding
`VERCEL_TOKEN`, `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID` without first disconnecting the
Git integration would put two mechanisms on the same production alias.** Pick one before
setting those secrets.

## Context

The original decision was Vercel's native Git integration: push `main`, Vercel builds and
deploys; open a pull request, Vercel publishes a preview. It needs no workflow, no token
and no secret, and it was the right default while nothing was deployed.

Two things changed the calculus.

**The gates only exist in GitHub Actions.** Vercel builds from `vercel.json`, which runs
`npm run build:vercel`: a manifest-only freshness check and `vite build`. It does not run
`npm run check`, `check:egress`, `check:size`, `check:supply` or the browser acceptance
suite. Under the Git integration those gates and the deployment are independent, so a
commit that fails every one of them still reaches a URL. That is not hypothetical here:
`main` carried three failing oracle tests for a day, and before that a first-gate failure
was silently skipping fifteen downstream gates including `check:egress`.

**Zero egress is enforced by a gate, not by the platform.**
[ADR 0002](0002-client-side-only-zero-egress.md) promises no third-party request ever
leaves the app. Nothing in Vercel's build enforces that. `scripts/check-no-egress.mjs`
does, and it runs only in CI. A deployment path that cannot see that gate can publish a
build that breaks the product's central promise.

The repository is also public now, so the AGPL's network-copyleft obligation is satisfied
by the source being available. The earlier reasoning that a deployment had to be kept
non-public through Deployment Protection no longer applies.

## Decision

**Deploy from GitHub Actions, gated on CI success.**

`.github/workflows/deploy.yml` triggers on `workflow_run` for the CI workflow and refuses
to run unless `conclusion == 'success'`. `main` deploys to production; every other branch
gets a preview. It checks out the exact SHA CI verified rather than the default branch,
which `workflow_run` would otherwise give it.

**Vercel still builds.** The alternative, uploading CI's verified `dist/` with
`vercel deploy --prebuilt`, would mean restating every header in `vercel.json` in Build
Output API form. Two copies of a security header set is how one of them goes stale. The
cost is one rebuild; the benefit is a single source of truth for headers, asserted after
the fact by `scripts/check-deployment.mjs` against the live URL.

**Absent credentials skip rather than fail.** Without `VERCEL_TOKEN`, `VERCEL_ORG_ID` and
`VERCEL_PROJECT_ID` the workflow reports why and exits green, matching how
`scripts/cargo.mjs` and `scripts/build-wasm.mjs` behave for a contributor without those
toolchains. A permanently red workflow trains people to ignore red workflows.

The Git integration must be left disconnected. Both mechanisms deploying the same project
would race for the production alias, and the ungated one would win often enough to make
the gate meaningless.

## Consequences

Nothing reaches a URL that CI has not accepted, including the egress and bundle-size
gates that define the product's promises. Deployment becomes reviewable: the mechanism is
a file in the repository rather than a setting in a dashboard.

The costs are real and worth naming. Deployment now depends on three secrets that a fork
or a new clone will not have, which is why the skip path exists. A Vercel build runs after
a CI build, so a push to `main` compiles the web app twice. Deployment is serialised
behind the full CI run rather than starting immediately, which trades a few minutes of
latency for the guarantee. And `deploy-check.yml`'s `deployment_status` trigger no longer
fires, because a CLI deployment creates no GitHub Deployment; the same assertions now run
inline in `deploy.yml`, and `deploy-check.yml` remains useful only for checking an
arbitrary URL by hand.
