const API = '';
const CDN = 'https://cdn.kreatix.dev/file/Yapp-Data/';
const $ = (id) => document.getElementById(id);
let tok = JSON.parse(sessionStorage.getItem('yappAdmin') || 'null');
let tab = 'open';
let email = '';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ago = (t) => { const s = Math.max(1, Math.floor(Date.now() / 1000 - (t > 1e12 ? t / 1000 : t))); return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.floor(s / 60)}m ago` : s < 86400 ? `${Math.floor(s / 3600)}h ago` : `${Math.floor(s / 86400)}d ago`; };
const save = (t) => { tok = t; t ? sessionStorage.setItem('yappAdmin', JSON.stringify(t)) : sessionStorage.removeItem('yappAdmin'); };

async function raw(path, opts = {}) {
  return fetch(API + path, { ...opts, headers: { 'content-type': 'application/json', ...(tok ? { authorization: `Bearer ${tok.access_token}` } : {}) } });
}
async function call(path, opts = {}) {
  let r = await raw(path, opts);
  if (r.status === 401 && tok?.refresh_token) {
    const f = await fetch('/v1/auth/refresh', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refresh_token: tok.refresh_token }) });
    if (f.ok) { save(await f.json()); r = await raw(path, opts); }
  }
  if (r.status === 401 || r.status === 403) { save(null); show(); throw new Error(r.status === 403 ? 'not an admin' : 'signed out'); }
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error(j?.message || `error ${r.status}`);
  return j;
}

function av(u) {
  const key = u?.pfp || u?.avatar;
  const src = key ? (/^[pqbc]-/.test(key) ? CDN + key : `/avatars/${key}`) : '';
  const img = src ? `<img src="${esc(src)}" alt="" loading="lazy">` : '';
  return `<div class="av">${img || esc((u?.display_name || u?.username || '?')[0].toUpperCase())}</div>`;
}
function person(u, sub) {
  if (!u) return `<div class="row">${av(null)}<div class="who"><b>deleted account</b></div></div>`;
  return `<div class="row">${av(u)}<div class="who"><b>${esc(u.display_name || u.username)}</b><span>@${esc(u.username || '-')} · ${esc(u.email)}${sub ? ' · ' + sub : ''}</span></div></div>`;
}

async function stats() {
  const s = await call('/v1/admin/overview');
  const items = [['users', s.users], ['online', s.online], ['new today', s.new_24h], ['msgs today', s.messages_24h], ['groups', s.groups], ['open reports', s.open_reports], ['blocks', s.blocks], ['banned', s.banned]];
  $('stats').innerHTML = items.map(([k, v]) => `<div class="stat"><b>${v}</b><span>${k}</span></div>`).join('');
}

async function render() {
  const L = $('list');
  $('search').hidden = tab !== 'users';
  try {
    if (tab === 'users') {
      const v = await call(`/v1/admin/users?q=${encodeURIComponent($('q').value)}`);
      L.innerHTML = v.length ? v.map((u) => `<div class="item">${person(u, `${u.friends} friends · ${u.reports} reports · joined ${ago(u.created_at)}${u.online ? ' · online' : ''}`)}<div class="actions"><button class="danger" data-ban="${esc(u.id)}">ban</button></div></div>`).join('') : '<p class="empty">no users</p>';
    } else if (tab === 'bans') {
      const v = await call('/v1/admin/bans');
      L.innerHTML = v.length ? v.map((b) => `<div class="item"><div class="row"><div class="who"><b>${esc(b.email)}</b><span>${esc(b.reason || 'no reason')} · ${ago(b.created_at)}</span></div><button class="ghost" data-unban="${esc(b.email)}">unban</button></div></div>`).join('') : '<p class="empty">nobody banned</p>';
    } else {
      const v = await call(`/v1/admin/reports?status=${tab}`);
      L.innerHTML = v.length ? v.map((r) => `<div class="item">
        ${person(r.target, `${r.target_reports} report${r.target_reports === 1 ? '' : 's'} total`)}
        <div class="reason">${esc(r.reason)}</div>
        ${r.snapshot ? `<div class="quote">${esc(r.snapshot)}</div>` : ''}
        <div class="meta">reported by ${esc(r.reporter?.username ? '@' + r.reporter.username : 'deleted account')} · ${ago(r.created_at)}${r.group_id ? ' · in a group' : ''}</div>
        <div class="actions">
          ${r.status !== 'dismissed' ? `<button class="ghost" data-status="dismissed" data-id="${esc(r.id)}">dismiss</button>` : ''}
          ${r.status !== 'open' ? `<button class="ghost" data-status="open" data-id="${esc(r.id)}">reopen</button>` : ''}
          ${r.target ? `<button class="danger" data-ban="${esc(r.target_id)}">ban</button>` : ''}
        </div></div>`).join('') : '<p class="empty">nothing here</p>';
    }
  } catch (e) { L.innerHTML = `<p class="empty">${esc(e.message)}</p>`; }
}

async function refresh() { await Promise.all([stats().catch(() => {}), render()]); }

function show() {
  $('login').hidden = !!tok;
  $('dash').hidden = !tok;
  if (tok) refresh();
}

$('emailForm').addEventListener('submit', async (e) => {
  e.preventDefault(); $('loginErr').textContent = '';
  email = $('email').value.trim();
  const r = await fetch('/v1/auth/start', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email }) });
  if (!r.ok) { $('loginErr').textContent = (await r.json().catch(() => ({}))).message || 'could not send code'; return; }
  $('emailForm').hidden = true; $('codeForm').hidden = false; $('code').focus();
});
$('codeForm').addEventListener('submit', async (e) => {
  e.preventDefault(); $('loginErr').textContent = '';
  const r = await fetch('/v1/auth/confirm', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, code: $('code').value.trim() }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { $('loginErr').textContent = j.message || 'wrong code'; return; }
  save(j);
  try { await call('/v1/admin/overview'); show(); } catch (err) { $('emailForm').hidden = false; $('codeForm').hidden = true; $('loginErr').textContent = err.message; }
});
$('signOut').addEventListener('click', () => { if (tok?.refresh_token) fetch('/v1/auth/logout', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refresh_token: tok.refresh_token }) }); save(null); show(); });
$('tabs').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  tab = b.dataset.tab;
  document.querySelectorAll('#tabs button').forEach((x) => x.classList.toggle('on', x === b));
  render();
});
let qt; $('q').addEventListener('input', () => { clearTimeout(qt); qt = setTimeout(render, 250); });
$('list').addEventListener('click', async (e) => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.ban) {
    if (b.dataset.sure !== '1') { b.dataset.sure = '1'; b.textContent = 'tap again to ban'; setTimeout(() => { b.dataset.sure = ''; b.textContent = 'ban'; }, 3000); return; }
    const reason = prompt('ban reason (optional)') ?? '';
    b.disabled = true;
    try { await call(`/v1/admin/users/${encodeURIComponent(b.dataset.ban)}/ban`, { method: 'POST', body: JSON.stringify({ reason }) }); } catch (err) { alert(err.message); }
  } else if (b.dataset.unban) {
    b.disabled = true; await call(`/v1/admin/bans/${encodeURIComponent(b.dataset.unban)}`, { method: 'DELETE' }).catch((err) => alert(err.message));
  } else if (b.dataset.status) {
    b.disabled = true; await call(`/v1/admin/reports/${encodeURIComponent(b.dataset.id)}`, { method: 'POST', body: JSON.stringify({ status: b.dataset.status }) }).catch((err) => alert(err.message));
  }
  refresh();
});
document.addEventListener('error', (e) => { if (e.target.tagName === 'IMG') e.target.remove(); }, true);
show();
