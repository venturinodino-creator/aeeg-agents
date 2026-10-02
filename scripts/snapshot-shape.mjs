// Shapes raw GitHub API data into one repo entry of data.json. Pure: no network, no file access.
const AI_RE     = /co-authored-by:\s*claude|claude-session|generated with \[claude|🤖/i;
const CLAUDE_RE = /claude/i;
const BOT_RE    = /\[bot\]|copilot|github-actions|actions-user/i;
const RECENT_RUNS = 5;   // run history kept per workflow

// An agent is a workflow that starts itself on a schedule or is started by hand. CI, pull-request checks and
// GitHub's own Pages deploy only react to a push or a pull request, so they are plumbing, not agents.
const AGENT_EVENTS = ['schedule', 'workflow_dispatch'];

// Keeps only the repos named on the allow-list, so nothing else is ever published. Fails closed: a bad list
// or a name with no matching repo (a typo, a renamed repo) throws, so the previous snapshot stays in place.
export function onlyAllowed(repos, allowed) {
  if (!Array.isArray(allowed) || !allowed.length || !allowed.every(n => typeof n === 'string')) {
    throw new Error('allow-list: expected a non-empty list of repo names');
  }
  const have = new Set(repos.map(r => r.name));
  const missing = allowed.filter(n => !have.has(n));
  if (missing.length) throw new Error(`allow-list: no repo named ${missing.join(', ')}`);
  const on = new Set(allowed);
  return repos.filter(r => on.has(r.name));
}

// Who wrote a change: Claude if the text carries a Claude marker or the author is a Claude login, an automation
// account if it looks like one, otherwise the owner.
const whoWrote = (text, login, name = '') => (AI_RE.test(text) || CLAUDE_RE.test(login || name)) ? 'claude'
  : BOT_RE.test(login + ' ' + name) ? 'bot' : 'you';

export function slim(r, commits, runs, pulls = []) {
  // one entry per workflow; runs arrive newest first, so each group starts with the latest run
  const wf = {}; runs.forEach(x => { (wf[x.name] ||= []).push(x); });
  const run = x => ({ status: x.status, concl: x.conclusion, date: x.updated_at, url: x.html_url, event: x.event });
  return {
    name: r.name, full: r.full_name, desc: r.description || '', url: r.html_url,
    home: r.homepage || (r.has_pages ? `https://${r.owner.login}.github.io/${r.name}/` : ''),
    lang: r.language || '—', pushed: r.pushed_at, priv: r.private,
    issues: r.open_issues_count || 0, prs: '—',
    commits: commits.map(c => {
      const login = c.author?.login || '', name = c.commit.author?.name || '';
      const who = whoWrote(c.commit.message, login, name);
      return { sha: c.sha.slice(0, 7), msg: c.commit.message.split('\n')[0], date: c.commit.author?.date,
               author: login || name || '?', url: c.html_url, who, ai: who !== 'you' };
    }),
    pulls: pulls.map(p => {
      const login = p.user?.login || '', who = whoWrote(`${p.title}\n${p.body || ''}`, login);
      return { num: p.number, title: p.title, author: login || '?', url: p.html_url, who, ai: who !== 'you',
               state: p.merged_at ? 'merged' : p.state, date: p.merged_at || p.updated_at };
    }),
    workflows: Object.entries(wf).map(([name, g]) => ({
      name, ...run(g[0]), agent: g.some(x => AGENT_EVENTS.includes(x.event)), runs: g.slice(0, RECENT_RUNS).map(run) })),
  };
}
