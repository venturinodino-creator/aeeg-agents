/* ================== CONFIG — edit me ================== */
const CONFIG = {
  user: 'venturinodino-creator',
  // Repo that holds this page + the hourly snapshot Action (data.json).
  // Which repos the page shows is decided there, in config.json, not here.
  snapshotRepo: 'aeeg-agents',
};
/* ====================================================== */

const $ = s => document.querySelector(s);
const agentsLabel = n => n + (n === 1 ? ' agent' : ' agents');
const store = {
  get(k,d){ try{ const v=localStorage.getItem(k); return v==null?d:JSON.parse(v);}catch{return d} },
  set(k,v){ try{ localStorage.setItem(k,JSON.stringify(v)); }catch{} }
};
const USER = CONFIG.user;
// all = every repo as loaded (the snapshot already holds only the AEEG repos); repos = what the page shows
let STATE = { source:'', all:[], repos:[], selected:'__all', agent:null, fetchedAt:null };
const isDormant = r => (Date.now()-new Date(r.pushed))/DAY > 60;

const DAY = 864e5;
const ago = d => { if(!d) return '—'; const s=(Date.now()-new Date(d))/1000;
  if(s<60) return 'now'; if(s<3600) return Math.floor(s/60)+'m'; if(s<86400) return Math.floor(s/3600)+'h';
  return Math.floor(s/86400)+'d'; };
const esc = s => String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

/* The page only ever reads data.json, the snapshot written by the GitHub Action in the aeeg-agents repo.
   It never calls the GitHub API itself, so it cannot show a repo the snapshot left out.
   If the snapshot can't be loaded it falls back to this browser's last good copy, then to an empty page with a
   notice. There is no sample data: nothing on this page is ever anything but real AEEG data. */
async function snapshot(){
  // Read every copy we can reach and keep the freshest one (raw GitHub updates even when Pages lags behind)
  const urls=[`https://raw.githubusercontent.com/${USER}/${CONFIG.snapshotRepo}/main/data.json`];
  if(location.protocol.startsWith('http')) urls.push('./data.json');
  const got=await Promise.all(urls.map(async u=>{
    try{ const r=await fetch(u+'?t='+Math.floor(Date.now()/6e4),{cache:'no-store'}); if(!r.ok) return null;
      const d=await r.json(); return (d && Array.isArray(d.repos) && d.repos.length) ? d : null; }catch{ return null; }
  }));
  return got.filter(Boolean).sort((x,y)=>new Date(y.generatedAt)-new Date(x.generatedAt))[0] || null;
}

// Every page on venturinodino-creator.github.io shares one browser storage, so this key is specific to this page:
// another dashboard's saved copy (with other repos in it) must never be picked up here.
const CACHE_KEY='aeeg-agents.cache.v1';
const STALE_AFTER=3*3600e3;   // the snapshot is hourly, so this long without a new one means the refresh is failing
const age=ms=>{ const m=Math.floor(ms/6e4); return m<60 ? m+'m' : m<2880 ? Math.floor(m/60)+'h' : Math.floor(m/1440)+'d'; };

async function load(){
  $('#sync').textContent='syncing…'; banner('');
  STATE.source='';
  const d=await snapshot();
  if(d){ STATE.all=d.repos;
    STATE.fetchedAt=new Date(d.generatedAt).getTime(); STATE.source='snapshot';
    store.set(CACHE_KEY,{at:STATE.fetchedAt,repos:STATE.all});
    if(Date.now()-STATE.fetchedAt>STALE_AFTER) banner(`The data is ${age(Date.now()-STATE.fetchedAt)} old — the hourly refresh may be failing. Check the Actions tab of the aeeg-agents repo.`);
    render(); return; }
  const cached=store.get(CACHE_KEY,null);
  if(cached && Array.isArray(cached.repos)){ STATE.all=cached.repos; STATE.fetchedAt=cached.at;
    banner(`Could not load the latest snapshot — showing the last good copy from ${age(Date.now()-cached.at)} ago.`); }
  else { STATE.all=[]; STATE.fetchedAt=null;
    banner('Could not load the AEEG snapshot, so nothing is shown. Try again in a minute.'); }
  render();
}

const syncLabel=()=>{ if(!STATE.fetchedAt) return 'no data'; const a=ago(STATE.fetchedAt);
  return (STATE.source==='snapshot'?'snapshot · ':'last good copy · ')+(a==='now'?'just now':a+' ago'); };

/* ---------- derived ---------- */
function health(r){
  const age=(Date.now()-new Date(r.pushed))/DAY;
  if(r.workflows.some(w=>w.status!=='completed')) return 'run';
  if(r.workflows.some(w=>w.concl==='failure')) return 'fail';
  if(age<=7) return 'ok'; if(age<=30) return 'idle'; return 'dormant';
}
const DOT = {scheduled:'s',ok:'g',idle:'a',fail:'r',run:'c pulse',dormant:'s',running:'c pulse'};
const COL = {ok:'#41e08a',idle:'#f2b84b',fail:'#ff5d6c',run:'#3fd7e8',dormant:'#4c6070'};

/* One repo's agents: its GitHub Actions workflows that the snapshot flagged as agents (they run on a schedule or
   by hand; CI, smoke checks and the Pages deploy are plumbing and are not listed).
   The satellite dots, the agents list and the agent detail all read from here. */
const wfStatus = w => w.status!=='completed'?'running': w.concl==='failure'?'fail': w.concl==='success'?'ok':'idle';
const runResult = x => x.status!=='completed'?'running': x.concl==='success'?'succeeded': x.concl==='failure'?'failed': (x.concl||'no result');
const repoAgents = r => r.workflows.filter(w=>w.agent).map(w=>({ id:r.name+'::'+w.name, name:w.name, repo:r.name,
  kind:'GitHub Action', role:w.event, date:w.date, url:w.url, status:wfStatus(w), run:w }));
const allAgents = () => STATE.repos.flatMap(repoAgents);
const agentCol = a => a.status==='running'?COL.run: a.status==='fail'?COL.fail: COL.ok;

/* Claude's coding work, shown beside the agents but never counted as one. A squash-merge commit ("… (#67)") or a
   merge commit ("Merge pull request #67") is the same change as pull request #67, so it is listed once, as the PR. */
function codingActivity(){
  return STATE.repos.flatMap(r=>{
    const prs=new Set((r.pulls||[]).map(p=>p.num));
    const isPrCommit=c=>{ const m=c.msg.match(/\(#(\d+)\)\s*$|^Merge pull request #(\d+)/); return !!m && prs.has(+(m[1]||m[2])); };
    return [
      ...r.commits.filter(c=>c.who==='claude' && !isPrCommit(c)).map(c=>({kind:'commit', repo:r.name, title:c.msg, url:c.url, date:c.date, ref:c.sha})),
      ...(r.pulls||[]).filter(p=>p.who==='claude').map(p=>({kind:'pr', repo:r.name, title:p.title, url:p.url, date:p.date, ref:'#'+p.num, state:p.state})),
    ];
  }).sort((a,b)=>new Date(b.date)-new Date(a.date));
}

/* ---------- render ---------- */
function render(){
  STATE.repos = STATE.all;
  if(STATE.selected!=='__all' && !STATE.repos.some(r=>r.name===STATE.selected)){ STATE.selected='__all'; STATE.agent=null; }
  const repos=STATE.repos;
  $('#sync').textContent = syncLabel();
  $('#crumbs').textContent = USER+' / '+(STATE.selected==='__all'?'overview':STATE.selected);

  // sidebar
  $('#nav').innerHTML = repos.map(r=>`<li data-id="${esc(r.name)}" class="${STATE.selected===r.name?'on':''}">
    <span class="dot ${DOT[health(r)]}"></span><span class="n">${esc(r.name)}</span><span class="k">${ago(r.pushed)}</span></li>`).join('')
    || '<li><span class="n">No repos</span></li>';
  document.querySelector('#navSys li').classList.toggle('on',STATE.selected==='__all');

  // KPIs
  const all=STATE.repos, commits=all.flatMap(r=>r.commits), ai=commits.filter(c=>c.who==='claude').length;
  const wk=commits.filter(c=>Date.now()-new Date(c.date)<7*DAY).length;
  const ag=allAgents();
  $('#fleetCount').textContent=all.length+' repos';
  $('#kpis').innerHTML = [
    [commits.length,'commits · 8w'], [commits.length?Math.round(ai/commits.length*100)+'%':'0%','by Claude'],
    [wk,'commits · 7d'], [all.filter(r=>health(r)==='ok'||health(r)==='run').length+'/'+all.length,'active repos'],
    [all.reduce((s,r)=>s+r.issues,0),'open issues'], [ag.filter(a=>a.status==='fail').length,'failing agents'],
  ].map(([b,s])=>`<div class="stat"><b>${b}</b><span>${s}</span></div>`).join('');

  // agents list
  $('#agentCount').textContent=ag.length;
  $('#agents').innerHTML = ag.sort((a,b)=>(b.status==='fail')-(a.status==='fail')||new Date(b.date||0)-new Date(a.date||0))
    .map(a=>`<li data-repo="${esc(a.repo||'')}" ${a.id?`data-agent="${esc(a.id)}"`:''} ${a.url?`data-url="${esc(a.url)}"`:''}>
      <span class="dot ${DOT[a.status]||'s'}"></span><span class="an">${esc(a.name)}</span><span class="ar">${a.date?ago(a.date):''}</span>
      <span class="ad">${esc(a.repo||'—')} · ${esc(a.kind)}${a.role?' · '+esc(a.role):''}</span></li>`).join('')
    || `<li class="none"><span></span><span class="an" style="color:var(--txt)">No scheduled agents yet</span>
        <span class="ad">An agent is a GitHub workflow that runs on a schedule or by hand. None exists in the AEEG repos yet; one will appear here as soon as it is added.</span></li>`;

  // coding activity: Claude's commits and pull requests, newest first (a feed, not agents)
  const act=codingActivity(), shown=act.slice(0,14);
  $('#activityCount').textContent=act.length;
  $('#activity').innerHTML = shown.map(x=>`<li><span class="tag ${x.kind==='pr'?(x.state==='merged'?'merged':'pr'):'ai'}">${x.kind==='pr'?'PR '+esc(x.state):'COMMIT'}</span>
      <span><span class="m" style="display:block"><a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.title)}</a></span>
      <span class="t">${esc(x.repo)} · ${esc(x.ref)} · ${ago(x.date)}</span></span></li>`).join('')
    || '<li><span class="t">No Claude activity in the last 8 weeks</span></li>';

  // hero + graph + detail
  const sel = STATE.repos.find(r=>r.name===STATE.selected);
  $('#heroTitle').textContent = sel? sel.name.toUpperCase().replace(/-/g,'_') : 'COMMAND GRID';
  $('#heroSub').textContent = sel? '// REPO · '+sel.lang.toUpperCase() : '// LIVE ENGINE · '+USER.toUpperCase();
  $('#heroMeta').textContent = `${commits.length} commits · ${agentsLabel(ag.length)} · ${all.length} repos`;
  const agent = STATE.agent && allAgents().find(a=>a.id===STATE.agent) || null;
  drawGraph(repos, sel);
  if(agent) drawAgent(agent, sel); else drawDetail(sel);

  // ticker
  const items = all.flatMap(r=>r.commits.slice(0,6).map(c=>({...c,repo:r.name}))).sort((a,b)=>new Date(b.date)-new Date(a.date)).slice(0,20);
  const t = items.map(c=>`<span>${c.ai?'◆':'◇'} <b>${esc(c.repo)}</b> ${esc(c.msg.slice(0,70))} <span style="color:#41566a">${ago(c.date)}</span></span>`).join('');
  $('#ticker').innerHTML = t ? t+t : '<span>No recent commits</span>';
}

function drawGraph(repos, sel){
  const svg=$('#graph'), W=svg.clientWidth||800, H=svg.clientHeight||460;
  const cx=W/2 + (sel && W>800?140:0), cy=H/2, R=Math.min(W<600?W*0.27:W*0.36,H*0.36);
  const ns='http://www.w3.org/2000/svg';
  let h='';
  // seeded random for stable layouts
  let seed=7; const rnd=()=>(seed=(seed*9301+49297)%233280)/233280;

  h+=`<circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="#1d3644" stroke-dasharray="2 5"/>`;
  h+=`<circle cx="${cx}" cy="${cy}" r="${R*0.55}" fill="none" stroke="#14262f"/>`;

  // core cloud: every commit is a particle; AI commits tinted violet
  const pts=[]; const list = sel? [sel] : repos;
  list.forEach((r,i)=>r.commits.forEach(c=>pts.push({c,r})));
  const coreR = R*0.5;
  const core = pts.map(p=>{ const a=rnd()*Math.PI*2, d=Math.sqrt(rnd())*coreR; return {x:cx+Math.cos(a)*d,y:cy+Math.sin(a)*d,...p}; });

  const n=repos.length||1;
  const pos={}; repos.forEach((r,i)=>{ const a=-Math.PI/2+i*2*Math.PI/n; pos[r.name]={x:cx+Math.cos(a)*R,y:cy+Math.sin(a)*R}; });

  // edges from particles to their repo (thin)
  core.forEach(p=>{ const q=pos[p.r.name]; if(!q) return;
    if(rnd()<(sel?0.5:0.18)) h+=`<line x1="${p.x.toFixed(1)}" y1="${p.y.toFixed(1)}" x2="${q.x.toFixed(1)}" y2="${q.y.toFixed(1)}" stroke="${p.c.ai?'#a98bff':'#ff8a7a'}" stroke-opacity=".12"/>`; });
  // intra-cloud mesh
  for(let i=0;i<core.length;i++){ const a=core[i], b=core[(i*7+3)%core.length]; if(!b||a===b) continue;
    h+=`<line x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}" stroke="#ff8a7a" stroke-opacity=".08"/>`; }
  core.forEach(p=>{ h+=`<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${p.c.ai?2.6:2}" fill="${p.c.ai?'#a98bff':'#ff8a7a'}" opacity=".85"><title>${esc(p.r.name)} · ${esc(p.c.msg)}</title></circle>`; });
  h+=`<circle cx="${cx}" cy="${cy}" r="5" fill="#3fd7e8"><animate attributeName="r" values="4;8;4" dur="2.4s" repeatCount="indefinite"/></circle>`;

  // repo nodes on the ring + their agents as satellites (fanned outward), labels pushed outside the ring
  let callout='';   // message beside the clicked agent dot, drawn last so it sits on top
  repos.forEach((r,i)=>{
    const p=pos[r.name], st=health(r), col=COL[st], on=sel&&sel.name===r.name;
    const ang=Math.atan2(p.y-cy,p.x-cx), ca=Math.cos(ang), sa=Math.sin(ang);
    const all=repoAgents(r);
    // up to 14 agents on the inner ring; any more spill onto a second ring further out
    const rings=[all.slice(0,14), all.slice(14,30)].filter(x=>x.length), rx=rings.length>1?5:10;
    rings.forEach((sats,k)=>{ const d=30+k*11, span=Math.min(Math.PI*1.1, sats.length*0.24*30/d);
      sats.forEach((s,j)=>{ const a=ang + (sats.length>1? -span/2 + j*span/(sats.length-1) : 0);
        const sx=(p.x+Math.cos(a)*d).toFixed(1), sy=(p.y+Math.sin(a)*d).toFixed(1), c=agentCol(s);
        // the ellipse is an invisible, larger click target stretched outward so neighbours don't overlap
        h+=`<line x1="${p.x}" y1="${p.y}" x2="${sx}" y2="${sy}" stroke="${c}" stroke-opacity="${k?.15:.3}"/>
          <g class="sat${STATE.agent===s.id?' on':''}" data-agent="${esc(s.id)}" style="color:${c}"><title>${esc(s.name)}</title>
            <ellipse cx="${sx}" cy="${sy}" rx="${rx}" ry="4" fill="transparent" transform="rotate(${(a*180/Math.PI).toFixed(1)} ${sx} ${sy})"/>
            <circle class="halo" cx="${sx}" cy="${sy}" r="6.5"/><circle class="d" cx="${sx}" cy="${sy}" r="3"/></g>`;
        if(STATE.agent===s.id){ const tx=(+sx+Math.cos(a)*18).toFixed(1), ty=(+sy+Math.sin(a)*18).toFixed(1), end=Math.cos(a)<0;
          const msg = runResult(s.run)+(s.date?' · '+ago(s.date)+(ago(s.date)==='now'?'':' ago'):'');
          callout=`<g class="callout" style="color:${c}"><rect rx="4"/><text x="${tx}" y="${ty}" style="text-anchor:${end?'end':'start'}">${esc(s.name)}<tspan class="s" x="${tx}" dy="12">${esc(msg)}</tspan></text></g>`; } }); });
    const L = rings.length>1? 55 : rings.length? 44 : 24, lx=p.x+ca*L, ly=p.y+sa*L + (Math.abs(sa)>0.7? (sa>0?10:-4):3);
    const anchor = Math.abs(ca)<0.35?'middle':(ca>0?'start':'end');
    const nm = r.name.length>24? r.name.slice(0,23)+'…' : r.name;
    h+=`<g class="repo-node" data-id="${esc(r.name)}" opacity="${sel&&!on?.45:isDormant(r)?.6:1}">
      <circle cx="${p.x}" cy="${p.y}" r="${on?22:18}" fill="none" stroke="${col}" stroke-opacity=".25">${st==='run'?'<animate attributeName="r" values="16;26;16" dur="1.6s" repeatCount="indefinite"/>':''}</circle>
      <circle class="ring" cx="${p.x}" cy="${p.y}" r="${on?17:14}" fill="#071016" stroke="${col}" stroke-width="1.5"/>
      <text x="${p.x}" y="${p.y+4}" class="node-label" style="fill:${col};font-size:10.5px">${r.commits.length}</text>
      <text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" class="node-label" style="text-anchor:${anchor}">${esc(nm)}<title>${esc(r.name)}</title></text>
      <text x="${lx.toFixed(1)}" y="${(ly+11).toFixed(1)}" class="node-sub" style="text-anchor:${anchor}">${esc(r.lang)} · ${ago(r.pushed)}${all.length?' · '+agentsLabel(all.length):''}</text></g>`;
  });
  if(!repos.length) h+=`<text x="${cx}" y="${cy+40}" class="node-sub">no repos match</text>`;
  svg.setAttribute('viewBox',`0 0 ${W} ${H}`); svg.innerHTML=h+callout;
  const co=svg.querySelector('.callout');
  if(co){ const t=co.querySelector('text'); let b=t.getBBox();
    // keep the message inside the stage, then size its background to the text
    const dx = b.x<8 ? 8-b.x : b.x+b.width>W-8 ? W-8-b.x-b.width : 0, dy = b.y<8 ? 8-b.y : b.y+b.height>H-8 ? H-8-b.y-b.height : 0;
    if(dx||dy){ co.setAttribute('transform',`translate(${dx.toFixed(1)} ${dy.toFixed(1)})`); }
    const r=co.querySelector('rect'); r.setAttribute('x',b.x-7); r.setAttribute('y',b.y-5); r.setAttribute('width',b.width+14); r.setAttribute('height',b.height+10); }
}

function drawDetail(r){
  const el=$('#detail');
  if(!r){ el.hidden=true; el.innerHTML=''; return; }
  const weeks=[...Array(8)].map((_,i)=>({i, all:0, ai:0}));
  r.commits.forEach(c=>{ const w=Math.floor((Date.now()-new Date(c.date))/(7*DAY)); if(w<8){ weeks[w].all++; if(c.ai) weeks[w].ai++; }});
  const max=Math.max(1,...weeks.map(w=>w.all)), ai=r.commits.filter(c=>c.who==='claude').length;
  const st=health(r);
  el.hidden=false;
  el.innerHTML=`<div class="ph"><span><span class="dot ${DOT[st]}"></span> &nbsp;${st==='run'?'running':st}</span><button class="x" id="closeD" aria-label="Close">×</button></div>
  <div class="body">
    <h2>${esc(r.name)} ${r.priv?'<span class="tag">private</span>':''}</h2>
    <p>${esc(r.desc)||'No description — add one on GitHub.'}</p>
    <div class="stats">
      <div class="stat"><b>${r.commits.length}</b><span>commits · 8w</span></div>
      <div class="stat"><b>${r.commits.length?Math.round(ai/r.commits.length*100):0}%</b><span>by Claude</span></div>
      <div class="stat"><b>${r.issues}</b><span>${r.prs==='—'?'issues + PRs':'open issues'}</span></div>
      <div class="stat"><b>${r.prs}</b><span>open PRs</span></div>
    </div>
    <div class="ph" style="padding:6px 0;border:0">Weekly activity</div>
    <div class="bars">${weeks.map(w=>`<div class="bar"><span>${w.i===0?'this wk':w.i+'w ago'}</span><i><em style="width:${w.all/max*100}%"></em></i><span>${w.all}</span></div>`).join('')}</div>
    ${r.workflows.length?`<div class="ph" style="padding:6px 0;border:0">Workflows</div><ul class="feed">${r.workflows.map(w=>`<li><span class="dot ${DOT[w.status!=='completed'?'run':w.concl==='failure'?'fail':w.concl==='success'?'ok':'idle']}" style="margin-top:4px"></span><span class="m"><a href="${esc(w.url)}" target="_blank" rel="noopener">${esc(w.name)}</a> <span class="t">${ago(w.date)}</span></span></li>`).join('')}</ul>`:''}
    <div class="ph" style="padding:6px 0;border:0">Latest commits</div>
    <ul class="feed">${r.commits.slice(0,10).map(c=>`<li><span class="tag ${c.ai?'ai':''}">${c.who==='claude'?'CLAUDE':c.who==='bot'?'AUTO':'YOU'}</span><span><span class="m" style="display:block"><a href="${esc(c.url)}" target="_blank" rel="noopener">${esc(c.msg)}</a></span><span class="t">${esc(c.sha)} · ${esc(c.author)} · ${ago(c.date)}</span></span></li>`).join('')||'<li><span class="t">No commits in 8 weeks</span></li>'}</ul>
    <div class="links"><a href="${esc(r.url)}" target="_blank" rel="noopener">↗ repo</a>${r.home?`<a href="${esc(r.home)}" target="_blank" rel="noopener">↗ live site</a>`:''}<a href="${esc(r.url)}/issues" target="_blank" rel="noopener">↗ issues</a></div>
  </div>`;
  $('#closeD').onclick=()=>select('__all');
}

function drawAgent(a, r){
  const el=$('#detail'), w=a.run;
  const result = runResult(w);
  el.hidden=false;
  el.innerHTML=`<div class="ph"><span><span class="dot ${DOT[a.status]||'s'}"></span> &nbsp;${esc(result)}</span><button class="x" id="closeD" aria-label="Close">×</button></div>
  <div class="body">
    <h2>${esc(a.name)}</h2>
    <p><span class="tag">GitHub Action</span>${a.repo?` &nbsp;in ${r?`<a href="#" data-back="${esc(a.repo)}">${esc(a.repo)}</a>`:esc(a.repo)}`:''}</p>
    <div class="stats">
      <div class="stat"><b style="font-size:13px">${esc(result)}</b><span>latest run</span></div>
      <div class="stat"><b style="font-size:13px">${a.date?ago(a.date)+(ago(a.date)==='now'?'':' ago'):'—'}</b><span>when</span></div>
      <div class="stat" style="grid-column:1/3"><b style="font-size:13px">${esc((a.role||'—').replace(/_/g,' '))}</b><span>triggered by</span></div>
    </div>
    ${w.runs?.length?`<div class="ph" style="padding:6px 0;border:0">Recent runs</div><ul class="feed">${w.runs.map(x=>`<li><span class="dot ${DOT[wfStatus(x)]}" style="margin-top:4px"></span><span class="m"><a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(runResult(x))}</a> <span class="t">${ago(x.date)} · ${esc((x.event||'').replace(/_/g,' '))}</span></span></li>`).join('')}</ul>`:''}
    <div class="links">${a.url?`<a href="${esc(a.url)}" target="_blank" rel="noopener">↗ latest run on GitHub</a>`:''}${r?`<a href="${esc(r.url)}/actions" target="_blank" rel="noopener">↗ all runs</a>`:''}</div>
  </div>`;
  $('#closeD').onclick=()=>select(r?r.name:'__all');
}

/* ---------- interactions ---------- */
function select(id){ STATE.selected=id; STATE.agent=null; render(); }
function selectAgent(id){ const a=allAgents().find(x=>x.id===id); if(!a) return;
  STATE.selected = STATE.repos.some(r=>r.name===a.repo) ? a.repo : '__all'; STATE.agent=id; render(); }
function banner(t){ const b=$('#banner'); b.style.display=t?'block':'none'; b.innerHTML=t;
  document.documentElement.style.setProperty('--bh', t? (b.offsetHeight+10)+'px':'0px'); }
document.addEventListener('click',e=>{
  const s=e.target.closest('.sat');
  if(s){ selectAgent(s.dataset.agent);
    // grow the clicked dot; it shrinks back when the mouse leaves it (see mousemove below)
    setTimeout(()=>document.querySelector('.sat.on')?.classList.add('zoom'),30); return; }
  const back=e.target.closest('[data-back]');
  if(back){ e.preventDefault(); select(back.dataset.back); return; }
  const n=e.target.closest('.nav li[data-id], .repo-node');
  if(n){ select(n.dataset.id); return; }
  const a=e.target.closest('.agents li');
  if(a){ if(a.dataset.agent) selectAgent(a.dataset.agent); else if(a.dataset.repo && STATE.repos.some(r=>r.name===a.dataset.repo)) select(a.dataset.repo); else if(a.dataset.url) window.open(a.dataset.url,'_blank','noopener'); }
});
// mousemove rather than mouseout: selecting an agent can re-centre the grid and move the dot out from under the cursor
$('#graph').addEventListener('mousemove',e=>{ const z=document.querySelector('.sat.zoom');
  if(z && !z.contains(e.target)) z.classList.remove('zoom'); });
let rt; addEventListener('resize',()=>{clearTimeout(rt);rt=setTimeout(render,120)});
setInterval(()=>{$('#sync').textContent=syncLabel()},30000);
load();
