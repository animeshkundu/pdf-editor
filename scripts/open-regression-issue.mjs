#!/usr/bin/env node
// Files (or updates) a GitHub issue for a scheduled-job regression.
//
// Driven from a script rather than inline in the workflow for two reasons. First,
// .github/workflows/** is immutable to the autonomous build pipeline, so anything that
// might need tuning belongs outside it. Second, self-hosted runners frequently lack `gh`
// and `jq`, so this talks to the REST API with the runtime the repository already
// requires instead of assuming a toolbelt.
//
//   node scripts/open-regression-issue.mjs --title "Nightly perf regression" \
//        --body-file perf/summary.md --label perf-regression
//
// A run that regresses two nights running must not produce two issues. The existing open
// issue carrying the same marker gets a comment instead, so the thread stays one thread.

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const readArg = (flag, fallback = null) => {
  const index = args.indexOf(flag);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const title = readArg('--title');
const bodyFile = readArg('--body-file');
const label = readArg('--label', 'regression');
const repo = process.env.GITHUB_REPOSITORY;
const token = process.env.GITHUB_TOKEN;

function fail(message) {
  console.error(`[open-regression-issue] ${message}`);
  process.exit(1);
}

if (!title) fail('--title is required.');
if (!repo) fail('GITHUB_REPOSITORY is not set.');
if (!token) fail('GITHUB_TOKEN is not set. The job needs `issues: write`.');

let body = '';
if (bodyFile) {
  const path = join(root, bodyFile);
  if (!existsSync(path)) fail(`--body-file ${bodyFile} does not exist.`);
  body = readFileSync(path, 'utf8');
}

const runUrl =
  process.env.GITHUB_SERVER_URL && process.env.GITHUB_RUN_ID
    ? `${process.env.GITHUB_SERVER_URL}/${repo}/actions/runs/${process.env.GITHUB_RUN_ID}`
    : null;

const footer = [
  '',
  '---',
  runUrl ? `Detected by [this run](${runUrl}).` : 'Detected by a scheduled run.',
  process.env.GITHUB_SHA ? `Commit \`${process.env.GITHUB_SHA}\`.` : null,
  '',
  'Closing this issue is the right move once the numbers are explained or the baseline',
  'is refreshed. The next scheduled run reopens the thread if the regression persists.',
]
  .filter((line) => line !== null)
  .join('\n');

async function api(path, init = {}) {
  const response = await fetch(`https://api.github.com/${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'content-type': 'application/json',
      'user-agent': 'pdf-editor-ci',
      ...init.headers,
    },
  });
  if (!response.ok) {
    throw new Error(`GitHub API ${path} responded ${response.status}: ${await response.text()}`);
  }
  return response.json();
}

try {
  const open = await api(
    `repos/${repo}/issues?state=open&per_page=100&labels=${encodeURIComponent(label)}`,
  );
  // The API returns pull requests through the issues endpoint too; they are not what we
  // are looking for and could otherwise absorb the comment.
  const existing = open.find((issue) => !issue.pull_request && issue.title === title);

  if (existing) {
    await api(`repos/${repo}/issues/${existing.number}/comments`, {
      method: 'POST',
      body: JSON.stringify({ body: `${body}${footer}` }),
    });
    console.log(`[open-regression-issue] Commented on #${existing.number}: ${existing.html_url}`);
  } else {
    const created = await api(`repos/${repo}/issues`, {
      method: 'POST',
      body: JSON.stringify({ title, body: `${body}${footer}`, labels: [label] }),
    });
    console.log(`[open-regression-issue] Opened #${created.number}: ${created.html_url}`);
  }
} catch (error) {
  fail(error.message);
}
