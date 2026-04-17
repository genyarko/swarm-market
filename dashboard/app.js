// Dashboard client: consumes SSE stream from /events and renders state.
// No framework — direct DOM updates for zero install cost & guaranteed demo reliability.

const state = {
  market: '',
  coordinator: '',
  agents: new Map(), // address -> agentInfo
  feed: [], // newest first
  stats: null,
};

const $ = (id) => document.getElementById(id);

function shortAddr(a) {
  if (!a || /^0x0+$/.test(a)) return '—';
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

function timeStr(t) {
  const d = new Date(t);
  return d.toTimeString().slice(0, 8);
}

function iconFor(kind) {
  switch (kind) {
    case 'posted':    return '◆';
    case 'assigned':  return '➜';
    case 'completed': return '✓';
    case 'paid':      return '$';
    case 'cancelled': return '⚠';
    default: return '·';
  }
}

function connStatus(text, cls) {
  const el = $('conn-status');
  el.textContent = text;
  el.className = `pill ${cls}`;
}

function renderHeader() {
  $('market-addr').textContent = shortAddr(state.market);
  $('coord-addr').textContent = shortAddr(state.coordinator);
  const spent = state.stats?.totalSpentUsdc ?? 0;
  $('total-spent').textContent = `$${spent.toFixed(4)}`;
}

function renderAgents() {
  const container = $('agents');
  const all = Array.from(state.agents.values());
  const working = all.filter((a) => a.status === 'working').length;
  $('agents-subtitle').textContent = `${working}/${all.length} working`;

  // Build-and-diff: keep existing cards when possible to avoid animation flicker.
  container.innerHTML = '';
  for (const a of all) {
    const card = document.createElement('div');
    card.className = `agent-card ${a.status === 'working' ? 'working' : ''}`;
    const cap = a.capability ?? '—';
    card.innerHTML = `
      <div class="row">
        <span class="name">
          <span class="dot ${a.status === 'working' ? 'working' : ''}"></span>
          ${a.name}
        </span>
        <span class="cap cap-${cap}">${cap}</span>
      </div>
      <div class="stats-row">
        <span>tasks <strong>${a.completed}</strong></span>
        <span>earned <strong>$${a.earnedUsdc.toFixed(4)}</strong></span>
        ${a.currentTaskId ? `<span>on <strong>#${a.currentTaskId}</strong></span>` : ''}
      </div>
      <div class="addr">${shortAddr(a.address)}</div>
    `;
    container.appendChild(card);
  }
}

function renderFeed() {
  const list = $('feed');
  list.innerHTML = '';
  const recent = state.feed.slice(0, 60);
  $('feed-subtitle').textContent = recent.length ? `${state.feed.length} events` : 'awaiting events…';
  for (const e of recent) {
    const li = document.createElement('li');
    li.className = `enter ${e.kind}`;
    li.innerHTML = `
      <span class="time mono">${timeStr(e.t)}</span>
      <span class="icon">${iconFor(e.kind)}</span>
      <span class="text">${escapeHtml(e.text)}</span>
    `;
    list.appendChild(li);
  }
}

function renderFlow() {
  const flow = $('flow');
  const agents = Array.from(state.agents.values());
  const totalOut = agents.reduce((s, a) => s + a.earnedUsdc, 0);

  flow.innerHTML = `
    <div class="coord">
      <div class="title">Coordinator</div>
      <div class="out">$${totalOut.toFixed(4)}</div>
      <div class="sub">outgoing</div>
    </div>
    <div class="lanes"></div>
  `;
  const lanes = flow.querySelector('.lanes');
  for (const a of agents) {
    const lane = document.createElement('div');
    const activeClass = a.status === 'working' || a.earnedUsdc > 0 ? '' : 'idle';
    lane.className = `lane ${activeClass}`;
    lane.innerHTML = `
      <div class="line"></div>
      <div class="target">
        <span class="name">${a.name}</span>
        <span class="amt">$${a.earnedUsdc.toFixed(4)}</span>
      </div>
    `;
    lanes.appendChild(lane);
  }
}

function renderStats() {
  const s = state.stats;
  if (!s) return;
  $('s-posted').textContent = s.posted;
  $('s-completed').textContent = s.paid;
  $('s-avg').textContent = s.avgCompletionSec ? `${s.avgCompletionSec.toFixed(1)}s` : '—';
  $('s-avgcost').textContent = s.avgCostUsdc ? `$${s.avgCostUsdc.toFixed(4)}` : '—';
  const tc = s.txCount ?? 0;
  $('s-txcount').textContent = tc >= 50 ? `${tc} ✅` : String(tc);
  $('s-tput').textContent = `${s.throughputTasksPerSec.toFixed(2)}/s`;
  $('s-spent').textContent = `$${s.totalSpentUsdc.toFixed(4)}`;
  $('g-trad').textContent = `$${s.tradGasUsdc.toFixed(2)}`;
  $('g-arc').textContent = `$${s.arcGasUsdc.toFixed(2)}`;
  const savings =
    s.tradGasUsdc > 0
      ? ((s.tradGasUsdc - s.arcGasUsdc) / s.tradGasUsdc) * 100
      : 0;
  $('g-savings').textContent = s.tradGasUsdc > 0 ? `${savings.toFixed(2)}%` : '—';
  $('total-spent').textContent = `$${s.totalSpentUsdc.toFixed(4)}`;
}

function renderAll() {
  renderHeader();
  renderAgents();
  renderFeed();
  renderFlow();
  renderStats();
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function onInit(data) {
  state.market = data.market ?? '';
  state.coordinator = data.coordinator ?? '';
  state.agents.clear();
  for (const a of data.agents ?? []) state.agents.set(a.address.toLowerCase(), a);
  state.feed = data.feed ?? [];
  state.stats = data.stats ?? null;
  renderAll();
}

function onTask(evt) {
  // Keep feed in sync via /events entries below, but this lets the stats panel
  // react instantly without waiting for the next 'stats' event.
  const t = evt.task;
  if (!t) return;
  // Prepend synthetic feed entry based on event kind.
  const text = {
    posted:    `Task #${t.id} ${t.taskType} posted — reward ${Number(t.reward).toFixed(3)} USDC`,
    assigned:  `Task #${t.id} → ${evt.agent ?? shortAddr(t.assignee)}`,
    completed: `Task #${t.id} result submitted`,
    paid:      `${Number(t.reward).toFixed(3)} USDC → ${evt.agent ?? shortAddr(t.assignee)} (#${t.id})`,
    cancelled: `Task #${t.id} cancelled`,
  }[evt.kind] ?? `Task #${t.id} ${evt.kind}`;
  state.feed.unshift({ t: Date.now(), kind: evt.kind, text, taskId: t.id });
  if (state.feed.length > 300) state.feed.pop();
  renderFeed();
}

function onAgent(a) {
  state.agents.set(a.address.toLowerCase(), a);
  renderAgents();
  renderFlow();
}

function onStats(stats) {
  state.stats = stats;
  renderStats();
  renderFlow();
}

function connect() {
  connStatus('connecting', 'pill-warn');
  const es = new EventSource('/events');
  es.addEventListener('init', (e) => {
    connStatus('live', 'pill-ok');
    try { onInit(JSON.parse(e.data)); } catch (err) { console.error(err); }
  });
  es.addEventListener('task',  (e) => { try { onTask(JSON.parse(e.data)); } catch {} });
  es.addEventListener('agent', (e) => { try { onAgent(JSON.parse(e.data)); } catch {} });
  es.addEventListener('stats', (e) => { try { onStats(JSON.parse(e.data)); } catch {} });
  es.onerror = () => {
    connStatus('reconnecting', 'pill-warn');
  };
  es.onopen = () => {
    connStatus('live', 'pill-ok');
  };
}

connect();
