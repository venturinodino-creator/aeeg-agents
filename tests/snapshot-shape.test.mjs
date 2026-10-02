import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slim, onlyAllowed } from '../scripts/snapshot-shape.mjs';

const repo = { name: 'demo', full_name: 'me/demo', description: null, html_url: 'https://github.com/me/demo',
  homepage: '', has_pages: false, owner: { login: 'me' }, language: 'HTML', pushed_at: '2026-10-01T00:00:00Z',
  private: false, open_issues_count: 2 };

// GitHub lists runs newest first
const run = (name, n, conclusion = 'success', status = 'completed', event = 'schedule') => ({
  name, status, conclusion, updated_at: `2026-10-01T00:${String(59 - n).padStart(2, '0')}:00Z`,
  html_url: `https://github.com/me/demo/actions/runs/${name}-${n}`, event });

test('keeps one entry per workflow, described by its newest run', () => {
  const out = slim(repo, [], [run('Deploy', 0, 'failure'), run('CI', 0), run('Deploy', 1)]);
  assert.deepEqual(out.workflows.map(w => w.name), ['Deploy', 'CI']);
  const deploy = out.workflows[0];
  assert.equal(deploy.concl, 'failure');
  assert.equal(deploy.status, 'completed');
  assert.equal(deploy.url, 'https://github.com/me/demo/actions/runs/Deploy-0');
  assert.equal(deploy.event, 'schedule');
  assert.equal(deploy.date, '2026-10-01T00:59:00Z');
});

test('each workflow carries its recent runs, newest first', () => {
  const out = slim(repo, [], [run('CI', 0, 'failure'), run('Deploy', 0), run('CI', 1), run('CI', 2, null, 'in_progress')]);
  const ci = out.workflows.find(w => w.name === 'CI');
  assert.deepEqual(ci.runs, [
    { status: 'completed', concl: 'failure', date: '2026-10-01T00:59:00Z', url: 'https://github.com/me/demo/actions/runs/CI-0', event: 'schedule' },
    { status: 'completed', concl: 'success', date: '2026-10-01T00:58:00Z', url: 'https://github.com/me/demo/actions/runs/CI-1', event: 'schedule' },
    { status: 'in_progress', concl: null, date: '2026-10-01T00:57:00Z', url: 'https://github.com/me/demo/actions/runs/CI-2', event: 'schedule' },
  ]);
  assert.equal(out.workflows.find(w => w.name === 'Deploy').runs.length, 1);
});

test('recent runs are capped at five per workflow', () => {
  const out = slim(repo, [], [...Array(8)].map((_, n) => run('CI', n)));
  const ci = out.workflows[0];
  assert.equal(ci.runs.length, 5);
  assert.equal(ci.runs[4].url, 'https://github.com/me/demo/actions/runs/CI-4');
});

test('a repo with no runs has no workflows', () => {
  assert.deepEqual(slim(repo, [], []).workflows, []);
});

const agentFlags = runs => Object.fromEntries(slim(repo, [], runs).workflows.map(w => [w.name, w.agent]));

test('a scheduled workflow is an agent', () => {
  assert.deepEqual(agentFlags([run('Nightly scan', 0, 'success', 'completed', 'schedule')]), { 'Nightly scan': true });
});

test('a workflow started by hand is an agent', () => {
  assert.deepEqual(agentFlags([run('Backfill', 0, 'success', 'completed', 'workflow_dispatch')]), { Backfill: true });
});

test('push-only CI, pull-request-only checks and Pages deploys are not agents', () => {
  assert.deepEqual(agentFlags([
    run('CI', 0, 'success', 'completed', 'push'),
    run('Smoke check', 0, 'success', 'completed', 'pull_request'),
    run('pages build and deployment', 0, 'success', 'completed', 'dynamic'),
  ]), { CI: false, 'Smoke check': false, 'pages build and deployment': false });
});

test('a workflow whose newest run was a push but an older run was scheduled is an agent', () => {
  assert.deepEqual(agentFlags([
    run('Nightly scan', 0, 'success', 'completed', 'push'),
    run('Nightly scan', 1, 'success', 'completed', 'schedule'),
  ]), { 'Nightly scan': true });
});

test('a scheduled run older than the five kept still makes the workflow an agent', () => {
  const runs = [...[0, 1, 2, 3, 4, 5].map(n => run('Scan', n, 'success', 'completed', 'push')), run('Scan', 6, 'success', 'completed', 'schedule')];
  const scan = slim(repo, [], runs).workflows[0];
  assert.equal(scan.runs.length, 5);
  assert.equal(scan.agent, true);
});

const names = rs => rs.map(r => r.name);
const fetched = [{ name: 'african-earth-energy-crm' }, { name: 'AEEG' }, { name: 'denmark-crm' }, { name: 'calculator' }];

test('only repos on the allow-list are kept', () => {
  assert.deepEqual(names(onlyAllowed(fetched, ['AEEG', 'african-earth-energy-crm'])), ['african-earth-energy-crm', 'AEEG']);
});

test('allow-list names must match exactly, including case', () => {
  assert.throws(() => onlyAllowed(fetched, ['aeeg']), /aeeg/);
});

test('a name on the allow-list with no matching repo is an error, not a silent gap', () => {
  assert.throws(() => onlyAllowed(fetched, ['AEEG', 'no-such-repo']), /no-such-repo/);
});

test('an allow-list that is not a non-empty list of names is refused', () => {
  for (const bad of [undefined, null, 'AEEG', [], [1], [{ name: 'AEEG' }]]) {
    assert.throws(() => onlyAllowed(fetched, bad), /allow-list/);
  }
});
