# Plans

One Markdown file per entry, named `YYYY-MM-DD-slug.md`.

Examples:

- `2026-08-04-vendor-and-patch-mupdf.md`
- `2026-08-11-tiled-render-queue.md`

Each entry includes:

- date and owner
- short context, including the ADRs it operates under
- the plan, as ordered units that can each be reviewed and tested independently
- acceptance criteria for each unit
- the verification commands that prove it
- risks, and what would make us abandon or change the plan
- links to related issues, pull requests, ADRs, research, and follow-ups

A plan that changes architecture or a long-lived process needs an ADR, not just a plan.
See [`../adr/0001-record-architecture-decisions.md`](../adr/0001-record-architecture-decisions.md).
