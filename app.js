const SUPABASE_URL = "https://znlzjtmwmouiahfovtdr.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpubHpqdG13bW91aWFoZm92dGRyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTUwMjg1NzAsImV4cCI6MjA3MDYwNDU3MH0.5PRe3Z4CzYjCoXNgFu2FiNPF0ufRhLHRSToBaJ6oeTg";
const AVAIL_TABLE  = "availability_dev";
function getLeagueCode() { return 'hanks-2025-8QwZ'; }     // replace

let SCHEDULE = [];
let ROSTER = [];

// Name formatter: First on line 1, Last (and middle) on line 2
function formatName(fullName) {
  const parts = (fullName || '').trim().split(/\s+/);
  if (!parts.length) return '<span class="first"></span>';
  if (parts.length === 1) return `<span class="first">${parts[0]}</span>`;
  const first = parts[0];
  const last = parts.slice(1).join(' ');
  return `<span class="first">${first}</span><span class="last">${last}</span>`;
}

function setHeaderOffset(){
  const h = document.getElementById('appHeader').offsetHeight;
  document.documentElement.style.setProperty('--headerH', h + 'px');
}
window.addEventListener('resize', setHeaderOffset);

async function fetchOrThrow(path) {
  const res = await fetch(path, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${res.statusText}`);
  return res.json();
}

async function loadData() {
  try {
    const [team, schedule, roster] = await Promise.all([
      fetchOrThrow('./data/team.json'),
      fetchOrThrow('./data/schedule.json'),
      fetchOrThrow('./data/roster.json')
    ]);
    SCHEDULE = schedule;
    ROSTER = roster;
    document.getElementById('teamLogo').src = team.logoUrl || '';
    document.getElementById('teamName').textContent = team.teamName || "Hammerin' Hanks";
    document.getElementById('appHeader').classList.remove('has-back');
    setHeaderOffset();
    await renderSchedule();
  } catch (err) {
    console.error('Failed to load JSON:', err);
    document.getElementById('app').innerHTML = `<div class="note">Failed to load data. Check that <code>/data/team.json</code>, <code>/data/schedule.json</code>, and <code>/data/roster.json</code> exist. Details: ${String(err).replace(/[<>]/g,'')}</div>`;
  }
}

function sbHeaders(extra={}) {
  return Object.assign({
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation,resolution=merge-duplicates'
  }, extra);
}
async function sbFetch(path, opts={}) {
  const res = await fetch(`${SUPABASE_URL}${path}`, opts);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
async function loadAvailability(gameId) {
  const code = getLeagueCode();
  const params = new URLSearchParams({ select: '*', game_id: `eq.${gameId}`, league_code: `eq.${code}` });
  const rows = await sbFetch(`/rest/v1/${AVAIL_TABLE}?${params.toString()}`, { headers: sbHeaders() });
  const map = {}; for (const r of rows) map[r.player_id] = r.status; return map;
}
async function saveAvailability(gameId, playerId, status) {
  const code = getLeagueCode();
  const body = [{ game_id: gameId, player_id: playerId, status: status ?? null, league_code: code }];
  return sbFetch(`/rest/v1/${AVAIL_TABLE}`, { method: 'POST', headers: sbHeaders(), body: JSON.stringify(body) });
}
async function tallyServer(gameId) {
  const map = await loadAvailability(gameId);
  let ins=0, outs=0, iff=0; Object.values(map).forEach(s => { if (s==='in') ins++; else if (s==='out') outs++; else if (s==='if') iff++; });
  return { ins, outs, iff };
}

async function renderSchedule() {
  const app = document.getElementById('app');
  app.innerHTML = '';
  const countsList = await Promise.all(SCHEDULE.map(g => tallyServer(g.id)));
  SCHEDULE.forEach((game, idx) => {
    const counts = countsList[idx];
    const div = document.createElement('div');
    div.className = 'game-button';
    div.innerHTML = `
      <div><strong>${game.date}</strong> • ${game.time}</div>
      <div>${game.field} | Opponent: ${game.opponent} <span class="badge ${game.homeAway.toLowerCase()}">${game.homeAway}</span></div>
      <div style="color: var(--muted); font-size: 13px;">In: ${counts.ins} • Out: ${counts.outs} • If Needed: ${counts.iff}</div>
    `;
    div.onclick = () => renderRoster(game);
    app.appendChild(div);
  });
}

async function renderRoster(game) {
  const app = document.getElementById('app');
  document.getElementById('appHeader').classList.add('has-back');

  // Slim sticky opponent toolbar
  app.innerHTML = `
    <div class="subheader">
      <div class="subheader-inner">
        <div>vs. ${game.opponent}</div>
        <div style="color:var(--muted); font-size:13px;">${game.date} • ${game.time} • ${game.field} • <span class="badge ${game.homeAway.toLowerCase()}">${game.homeAway}</span></div>
      </div>
    </div>
  `;

  let current = {}; try { current = await loadAvailability(game.id); } catch (e) { console.error(e); }
  ROSTER.forEach(player => {
    const status = current[player.id] || '';
    const row = document.createElement('div');
    row.className = 'roster-card';
    row.innerHTML = `
      <div class="who">${formatName(player.name)}</div>
      <div class="btns">
        <button class='btn in ${status==='in'?'active in':''}' onclick='setStatus("${game.id}","${player.id}","in")'>In</button>
        <button class='btn out ${status==='out'?'active out':''}' onclick='setStatus("${game.id}","${player.id}","out")'>Out</button>
        <button class='btn if ${status==='if'?'active if':''}' onclick='setStatus("${game.id}","${player.id}","if")'>If Needed</button>
      </div>
    `;
    app.appendChild(row);
  });
}

async function setStatus(gameId, playerId, status) {
  try {
    const current = await loadAvailability(gameId);
    const next = current[playerId] === status ? null : status; // clicking same choice clears it
    await saveAvailability(gameId, playerId, next);
    showToast("Response Recorded!");
    const game = SCHEDULE.find(g => g.id === gameId);
    await renderRoster(game);
  } catch (e) {
    alert('Save failed. Check your Supabase URL, anon key, table, and RLS.');
    console.error(e);
  }
}

// Toast helper
function showToast(message = "Response Recorded!") {
  // Remove any existing toast
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();

  const t = document.createElement('div');
  t.className = 'toast';
  t.setAttribute('role', 'status');
  t.setAttribute('aria-live', 'polite');
  t.innerHTML = `
    <span class="check" aria-hidden="true">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
        <path d="M20 6L9 17l-5-5" stroke="#22c55e" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </span>
    <span>${message}</span>
  `;
  document.body.appendChild(t);

  // Auto-hide
  setTimeout(() => {
    t.classList.add('hide');
    setTimeout(() => t.remove(), 220);
  }, 1400);
}

// Start
loadData();
