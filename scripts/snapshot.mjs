// AEEG Agents snapshot — run by .github/workflows/snapshot.yml every hour.
// Uses the GITHUB_TOKEN that GitHub Actions provides automatically (nothing to create or paste).
// Writes data.json, which index.html reads instead of calling the GitHub API from your browser.
// Only the repos named in config.json are collected; every other repo is dropped before anything is fetched for it.
import { readFileSync, writeFileSync } from 'node:fs';
import { slim, onlyAllowed } from './snapshot-shape.mjs';

const { owner: OWNER, repos: ALLOWED } = JSON.parse(readFileSync(new URL('../config.json', import.meta.url), 'utf8'));
const DAY = 864e5;
const H = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
if (process.env.GITHUB_TOKEN) H.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

async function gh(path) {
  const r = await fetch('https://api.github.com' + path, { headers: H });
  if (r.status === 404 || r.status === 409) return null;   // empty repo, Actions disabled, …
  if (!r.ok) throw new Error(`${path} → ${r.status}`);
  return r.json();
}

// Each repo is asked for by name, so nothing else is fetched and the owner's repo count never matters.
// Fail closed: a bad allow-list or a name with no matching repo throws before data.json is written,
// so the previous snapshot stays in place.
if (!Array.isArray(ALLOWED)) throw new Error('allow-list: expected a list of repo names');
const found = await Promise.all(ALLOWED.map(name => gh(`/repos/${OWNER}/${encodeURIComponent(name)}`)));
const list = onlyAllowed(found.filter(Boolean), ALLOWED);
console.log(`Allow-list: ${list.map(r => r.name).join(', ')}`);

// Runs are fetched per workflow, so a weekly or monthly agent is never pushed out of a shared window by busier
// workflows (Pages deploys, CI). Each run carries the workflow's name, which is how slim() groups them.
async function workflowRuns(full) {
  const wfs = (await gh(`/repos/${full}/actions/workflows?per_page=100`))?.workflows || [];
  const groups = await Promise.all(wfs.map(async w =>
    ((await gh(`/repos/${full}/actions/workflows/${w.id}/runs?per_page=20`))?.workflow_runs || []).map(x => ({ ...x, name: w.name }))));
  return groups.flat();
}

const since = new Date(Date.now() - 56 * DAY).toISOString();
const repos = [];
for (const r of list) {
  const active = (Date.now() - new Date(r.pushed_at)) / DAY <= 60;
  const commits = active ? (await gh(`/repos/${r.full_name}/commits?per_page=100&since=${since}`)) || [] : [];
  const runs    = active ? await workflowRuns(r.full_name) : [];
  const pulls   = active ? (await gh(`/repos/${r.full_name}/pulls?state=all&sort=updated&direction=desc&per_page=30`)) || [] : [];
  repos.push(slim(r, commits, runs, pulls));
}

writeFileSync('data.json', JSON.stringify({ generatedAt: new Date().toISOString(), user: OWNER, repos }));
const agents = repos.reduce((n, r) => n + r.workflows.filter(w => w.agent).length, 0);
console.log(`Snapshot: ${repos.length} repos, ${repos.reduce((n, r) => n + r.commits.length, 0)} commits, ` +
  `${repos.reduce((n, r) => n + r.pulls.length, 0)} pull requests, ${agents} agents`);
