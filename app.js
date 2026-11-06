'use strict';
/* ============================================================
   مساعد البنك — كل البيانات تنحفظ في الجهاز (localStorage + IndexedDB للصور)
   ============================================================ */

const KEY = 'bankhelper:v1';
const UNDO_KEY = id => KEY + ':undo:' + id;
const UNDO_LIMIT = 40;
const PCOLORS = ['#e53935', '#1e88e5', '#43a047', '#fb8c00', '#8e24aa', '#00acc1', '#6d4c41', '#d81b60', '#546e7a', '#7cb342'];
const LIGHT_GROUPS = ['lightblue', 'yellow'];

const $ = (s, r = document) => r.querySelector(s);
const DEVICES = { phone: '📱 جوال', tablet: '📲 آيباد', laptop: '💻 لابتوب' };
const device = () => document.documentElement.dataset.device;
function curDeviceSetting() { try { return localStorage.getItem('bankhelper:device') || 'auto'; } catch (e) { return 'auto'; } }
function setDevice(d) {
  try { localStorage.setItem('bankhelper:device', d); } catch (e) { }
  document.documentElement.dataset.device = d === 'auto' ? window.AUTO_DEVICE : d;
  syncKbd();
}
function syncKbd() { document.querySelectorAll('.tabs kbd').forEach(k => k.hidden = device() !== 'laptop'); }
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const clone = o => JSON.parse(JSON.stringify(o));
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = v => { const n = Math.round(Number(String(v).replace(/[^\d.\-]/g, ''))); return isFinite(n) ? n : 0; };

let store = loadStore();
let G = null;          // اللعبة الحالية
let tab = 'players';
let lastAmountInput = null;

/* ---------------- التخزين ---------------- */
function loadStore() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s && s.games) return s;
  } catch (e) { }
  return { games: {}, currentId: null };
}
function save() {
  if (G) { G.updated = Date.now(); store.games[G.id] = G; store.currentId = G.id; }
  try { localStorage.setItem(KEY, JSON.stringify(store)); }
  catch (e) { toast('⚠️ ما قدرت أحفظ — ذاكرة المتصفح ممتلئة'); }
}
function getUndo() { try { return JSON.parse(localStorage.getItem(UNDO_KEY(G.id))) || []; } catch (e) { return []; } }
function setUndo(arr) { try { localStorage.setItem(UNDO_KEY(G.id), JSON.stringify(arr.slice(-UNDO_LIMIT))); } catch (e) { } }

function makeGame(name, from) {
  const props = (from ? from.props : defaultProps()).map(p => ({
    id: p.id || uid(), group: p.group, name: p.name, en: p.en || '', price: p.price,
    rent: p.rent.slice(), house: p.house, mortgage: p.mortgage,
    owner: null, level: 0, mortgaged: false,
  }));
  return {
    id: uid(), name: name || 'لعبة ' + new Date().toLocaleDateString('ar-SA-u-nu-latn'),
    created: Date.now(), updated: Date.now(),
    currency: from?.currency ?? 'جنيه', startMoney: from?.startMoney ?? 1500, goAmount: from?.goAmount ?? 200,
    players: [], props, log: [], photos: [],
  };
}
function openGame(id) {
  G = store.games[id];
  store.currentId = id;
  save(); render();
}

/* ---------------- مساعدات ---------------- */
const groupOf = id => DEFAULT_GROUPS.find(g => g.id === id) || DEFAULT_GROUPS[0];
const player = id => G.players.find(p => p.id === id);
const prop = id => G.props.find(p => p.id === id);
const nameOf = id => id === 'bank' ? 'البنك' : (player(id)?.name || '؟');
const fmt = n => (n < 0 ? '-' : '') + Math.abs(n).toLocaleString('en') + (G?.currency ? ' ' + G.currency : '');
const timeStr = t => new Date(t).toLocaleTimeString('ar-SA-u-nu-latn', { hour: 'numeric', minute: '2-digit' });
const dateStr = t => new Date(t).toLocaleString('ar-SA-u-nu-latn', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
const levelText = l => l === 5 ? '🏨 فندق' : l > 0 ? '🏠'.repeat(l) : '';
const isLight = g => LIGHT_GROUPS.includes(g);

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 2200);
}

/* كل عملية تمر من هنا: تنحفظ نسخة للتراجع + تنكتب في السجل */
function act(text, icon, fn) {
  const snap = JSON.stringify({ players: G.players, props: G.props, log: G.log });
  const res = fn();
  if (res === false) return false;
  G.log.unshift({ id: uid(), t: Date.now(), text, icon });
  const u = getUndo(); u.push(snap); setUndo(u);
  save(); render(); toast(icon + ' ' + text);
  return true;
}
function undo() {
  const u = getUndo();
  if (!u.length) return toast('ما فيه شي تتراجع عنه');
  const last = G.log[0];
  if (!confirm('تتراجع عن آخر عملية؟\n\n' + (last ? last.text : ''))) return;
  const s = JSON.parse(u.pop()); setUndo(u);
  G.players = s.players; G.props = s.props; G.log = s.log;
  save(); render(); closeSheet(); toast('↩︎ تم التراجع');
}

function move(from, to, amt) {
  if (from !== 'bank') player(from).balance -= amt;
  if (to !== 'bank') player(to).balance += amt;
}
function moneyText(from, to, amt, note) {
  const n = note ? ` (${note})` : '';
  if (from === 'bank') return `البنك أعطى ${nameOf(to)} ${fmt(amt)}${n}`;
  if (to === 'bank') return `${nameOf(from)} دفع للبنك ${fmt(amt)}${n}`;
  return `${nameOf(from)} دفع لـ ${nameOf(to)} ${fmt(amt)}${n}`;
}
function transfer(from, to, amt, note) {
  amt = num(amt);
  if (amt <= 0) { toast('اكتب مبلغ صحيح'); return false; }
  if (from === to) { toast('نفس الشخص!'); return false; }
  return act(moneyText(from, to, amt, note), '💸', () => move(from, to, amt));
}

/* ---------------- الإيجار ---------------- */
function rentOf(p, dice) {
  if (!p.owner || p.mortgaged) return 0;
  const type = groupOf(p.group).type;
  const mine = G.props.filter(q => q.group === p.group && q.owner === p.owner && !q.mortgaged);
  if (type === 'station') return p.rent[Math.min(mine.length, p.rent.length) - 1] || 0;
  if (type === 'utility') {
    const mult = mine.length >= 2 ? (p.rent[1] ?? p.rent[0]) : p.rent[0];
    return dice ? mult * dice : null;
  }
  if (p.level > 0) return p.rent[p.level] || 0;
  return ownsFullSet(p) ? p.rent[0] * 2 : p.rent[0];
}
function ownsFullSet(p) {
  const all = G.props.filter(q => q.group === p.group);
  return all.length > 0 && all.every(q => q.owner === p.owner);
}

/* ---------------- الرسم ---------------- */
function render() {
  if (!G) {
    const ids = Object.keys(store.games);
    if (store.currentId && store.games[store.currentId]) G = store.games[store.currentId];
    else if (ids.length) G = store.games[ids[0]];
    else { G = makeGame(); save(); }
  }
  $('#gameName').textContent = G.name;
  $('#gameSub').textContent = `${DEVICES[device()] || ''} · ${G.players.length} لاعب · آخر حفظ ${timeStr(G.updated)}`;
  $('#undoBtn').disabled = !getUndo().length;
  $$('.tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  const v = $('#view');
  if (tab === 'players') v.innerHTML = viewPlayers();
  if (tab === 'props') v.innerHTML = viewProps();
  if (tab === 'log') v.innerHTML = viewLog();
  if (tab === 'more') { v.innerHTML = viewMore(); loadPhotoThumbs(); }
}

function playerStats(pid) {
  const ps = G.props.filter(p => p.owner === pid);
  return {
    props: ps,
    houses: ps.reduce((s, p) => s + (p.level > 0 && p.level < 5 ? p.level : 0), 0),
    hotels: ps.filter(p => p.level === 5).length,
  };
}
function miniProps(ps) {
  return ps.map(p => `<i style="--c:${groupOf(p.group).color}" class="${p.mortgaged ? 'mort' : ''}" title="${esc(p.name)}">${p.level ? `<b>${p.level === 5 ? 'H' : p.level}</b>` : ''}</i>`).join('');
}

function viewPlayers() {
  let h = '';
  if (G.players.length) {
    const total = G.players.reduce((s, p) => s + p.balance, 0);
    const sold = G.props.filter(p => p.owner).length;
    h += `<div class="summary">
      <div><small>مع اللاعبين</small><b>${fmt(total)}</b></div>
      <div><small>المباعة</small><b>${sold} / ${G.props.length}</b></div>
      <div><small>العمليات</small><b>${G.log.length}</b></div></div>`;
  } else {
    h += `<div class="empty"><div class="big">🎲</div><h2>يلا نبدأ!</h2><p>أضف اللاعبين تحت، وكل واحد يبدأ بـ ${fmt(G.startMoney)}</p></div>`;
  }
  h += '<div class="pgrid-players">';
  for (const p of G.players) {
    const st = playerStats(p.id);
    h += `<div class="pcard" style="--c:${p.color}">
      <div class="ptop" data-act="player" data-id="${p.id}">
        <span class="avatar">${esc(p.name.trim()[0] || '?')}</span>
        <div class="nm"><b>${esc(p.name)}</b>
          <small><span>🃏 ${st.props.length}</span><span>🏠 ${st.houses}</span><span>🏨 ${st.hotels}</span></small></div>
        <span class="bal ${p.balance < 0 ? 'neg' : ''}"><span class="num">${p.balance.toLocaleString('en')}</span>${G.currency ? `<small>${esc(G.currency)}</small>` : ''}</span>
      </div>
      ${st.props.length ? `<div class="mini-props">${miniProps(st.props)}</div>` : ''}
      <div class="pbtns">
        <button class="act go" data-act="go" data-id="${p.id}"><i>🏁</i><b>+${G.goAmount.toLocaleString('en')}</b><small>البداية</small></button>
        <button class="act in" data-act="money" data-mode="in" data-id="${p.id}"><i>＋</i><b>إضافة</b><small>من البنك</small></button>
        <button class="act out" data-act="money" data-mode="out" data-id="${p.id}"><i>−</i><b>دفع</b><small>للبنك</small></button>
        <button class="act pay" data-act="money" data-mode="pay" data-id="${p.id}"><i>⇄</i><b>تحويل</b><small>للاعب</small></button>
      </div>
    </div>`;
  }
  h += `</div><div class="card add-player"><h3>➕ إضافة لاعب</h3>
    <div class="row"><input id="newPlayer" placeholder="اسم اللاعب" enterkeyhint="done" autocomplete="off">
    <button class="btn" data-act="addPlayer" style="flex:none;min-width:96px">إضافة</button></div></div>`;
  return h;
}

function viewProps() {
  let h = `<button class="btn ghost wide" data-act="newProp" style="margin-bottom:14px">➕ بطاقة جديدة</button><div class="groups">`;
  for (const g of DEFAULT_GROUPS) {
    const ps = G.props.filter(p => p.group === g.id);
    if (!ps.length) continue;
    h += `<section class="grp" style="--c:${g.color}"><div class="grp-h">
      <span class="dot"></span><span>${g.name}</span><span class="count">${ps.filter(p => p.owner).length}/${ps.length}</span></div>
      <div class="pgrid">${ps.map(propCard).join('')}</div></section>`;
  }
  return h + '</div>';
}
function propCard(p) {
  const g = groupOf(p.group), o = p.owner && player(p.owner);
  const icon = g.type === 'station' ? '🚂' : g.type === 'utility' ? (p.en && /water/i.test(p.en) ? '🚰' : '💡') : '';
  return `<button class="prop ${p.mortgaged ? 'mort' : ''} ${o ? 'owned' : ''}" style="--c:${g.color};${o ? `--oc:${o.color}` : ''}" data-act="prop" data-id="${p.id}">
    <span class="deed-h ${isLight(p.group) ? 'light' : ''}">${icon ? `<i>${icon}</i>` : ''}<span>${esc(p.name)}</span></span>
    <span class="body">
      <span class="pr">${fmt(p.price)}</span>
      <span class="houses">${levelText(p.level)}</span>
      ${o ? `<span class="owner-chip"><span class="od"></span>${esc(o.name)}</span>` : `<span class="owner-chip bank">🏦 البنك</span>`}
      ${p.mortgaged ? '<span class="stamp">مرهونة</span>' : ''}
    </span></button>`;
}

function viewLog() {
  if (!G.log.length) return `<div class="empty"><div class="big">📜</div><p>ما فيه عمليات للحين</p></div>`;
  return `<div class="card">
    <div class="row" style="margin-bottom:6px"><h3 style="margin:0">كل العمليات (${G.log.length})</h3>
    <button class="btn ghost sm" style="flex:none" data-act="undo">↩︎ تراجع عن آخر وحدة</button></div>
    ${G.log.map(l => `<div class="log-item"><span class="ic">${l.icon || '•'}</span>
      <span class="tx">${esc(l.text)}</span><time>${timeStr(l.t)}</time></div>`).join('')}</div>`;
}

function viewMore() {
  const games = Object.values(store.games).sort((a, b) => b.updated - a.updated);
  return `<div class="more-grid">
  <div class="card"><h3>📸 صور الطاولة</h3>
    <p class="muted small">صوّر اللوحة قبل لا توقفون عشان تعرفون كل واحد وين كان، والصورة تنحفظ مع اللعبة.</p>
    <button class="btn gold" data-act="photo" style="width:100%">📷 صوّر الطاولة الحين</button>
    <div class="photos" id="photos" style="margin-top:10px">${G.photos.map(ph => `
      <button class="photo" data-act="viewPhoto" data-id="${ph.id}"><img data-photo="${ph.id}" alt=""><span>${dateStr(ph.t)}</span></button>`).join('')}
    </div></div>

  <div class="card"><h3>🎲 الألعاب المحفوظة</h3>
    ${games.map(g => `<div class="game-item ${g.id === G.id ? 'cur' : ''}">
      <div class="info"><b>${esc(g.name)}</b><div class="muted small">${g.players.length} لاعب · ${dateStr(g.updated)}</div></div>
      ${g.id === G.id ? '' : `<button class="btn sm" data-act="openGame" data-id="${g.id}">فتح</button>`}
      <button class="btn ghost sm" data-act="delGame" data-id="${g.id}">🗑️</button></div>`).join('')}
    <button class="btn" data-act="newGame" style="width:100%;margin-top:10px">➕ لعبة جديدة</button>
    <p class="muted small">اللعبة الجديدة تاخذ نفس البطاقات والأسعار اللي عدلتها هنا، بس تبدأ من الصفر.</p></div>

  <div class="card"><h3>🖥️ الجهاز</h3>
    <p class="muted small" style="margin-top:0">الموقع عرف إنك فاتح من: <b>${DEVICES[window.AUTO_DEVICE]}</b>. إذا غلط، اختر جهازك:</p>
    <div class="chips">${[['auto', '✨ تلقائي'], ...Object.entries(DEVICES)].map(([k, v]) => `<button class="chip ${curDeviceSetting() === k ? 'on' : ''}" data-act="device" data-v="${k}">${v}</button>`).join('')}</div>
  </div>

  <div class="card"><h3>⚙️ الإعدادات</h3>
    <label class="f">اسم اللعبة</label><input id="setName" value="${esc(G.name)}">
    <div class="row">
      <div><label class="f">فلوس البداية</label><input id="setStart" type="number" inputmode="numeric" value="${G.startMoney}"></div>
      <div><label class="f">مبلغ خط البداية</label><input id="setGo" type="number" inputmode="numeric" value="${G.goAmount}"></div>
    </div>
    <label class="f">العملة (اختياري، مثل: ج أو $)</label><input id="setCur" value="${esc(G.currency)}" maxlength="6">
    <button class="btn" data-act="saveSettings" style="width:100%;margin-top:12px">💾 حفظ الإعدادات</button></div>

  <div class="card"><h3>💾 نسخة احتياطية</h3>
    <p class="muted small">كل شي محفوظ في هذا الجهاز تلقائيا. لو تبي تنقله لجوال ثاني أو تحتفظ بنسخة، نزّل ملف.</p>
    <div class="row"><button class="btn ghost" data-act="export">⬇️ تنزيل نسخة</button>
    <button class="btn ghost" data-act="import">⬆️ استرجاع نسخة</button></div></div>

  <div class="card"><h3>🧹 أخرى</h3>
    <div class="row wrap">
      <button class="btn ghost" data-act="resetGame">🔄 إعادة اللعبة من الصفر</button>
      <button class="btn ghost" data-act="resetProps">🃏 رجّع البطاقات الأصلية</button>
    </div></div></div>`;
}

/* ---------------- النوافذ (Sheet) ---------------- */
function openSheet(title, body) {
  $('#sheet').innerHTML = `<div class="sheet-h"><h2>${title}</h2><button class="x" data-act="close">✕</button></div>${body}`;
  $('#sheetOverlay').classList.add('show');
  $('#sheet').scrollTop = 0;
}
function closeSheet() { $('#sheetOverlay').classList.remove('show'); lastAmountInput = null; }

function amountField(id, val = '') {
  return `<input id="${id}" class="big-amount" type="number" inputmode="numeric" placeholder="0" value="${val}" data-amount>
    <div class="chips">${[10, 20, 50, 100, 200, 500].map(v => `<button class="chip" data-act="addAmt" data-v="${v}" data-for="${id}">+${v}</button>`).join('')}
    <button class="chip" data-act="clrAmt" data-for="${id}">مسح</button></div>`;
}
function playerSelect(id, exclude, withBank, selected) {
  const opts = G.players.filter(p => p.id !== exclude).map(p => `<option value="${p.id}" ${p.id === selected ? 'selected' : ''}>${esc(p.name)} (${fmt(p.balance)})</option>`);
  if (withBank) opts.unshift(`<option value="bank">🏦 البنك</option>`);
  return `<select id="${id}">${opts.join('')}</select>`;
}

function sheetMoney(mode, pid) {
  const p = player(pid);
  const notes = mode === 'in'
    ? ['بطاقة حظ', 'صندوق الجماعة', 'رهن', 'بيع']
    : mode === 'out' ? ['بطاقة حظ', 'صندوق الجماعة', 'شراء', 'السجن'] : ['إيجار', 'شراء', 'بطاقة حظ', 'دين'];
  const title = mode === 'in' ? `➕ البنك يعطي ${esc(p.name)}` : mode === 'out' ? `➖ ${esc(p.name)} يدفع للبنك` : `🔁 ${esc(p.name)} يحوّل`;
  if (mode === 'pay' && G.players.length < 2) return toast('لازم يكون فيه لاعب ثاني');
  openSheet(title, `
    <div class="card">
      <p class="muted small" style="margin-top:0">رصيد ${esc(p.name)} الحين: <b>${fmt(p.balance)}</b></p>
      ${mode === 'pay' ? `<label class="f">إلى</label>${playerSelect('mTo', pid, false)}` : ''}
      <label class="f">المبلغ</label>${amountField('mAmt')}
      <label class="f">ملاحظة (اختياري)</label><input id="mNote" placeholder="مثلا: إيجار">
      <div class="chips">${notes.map(n => `<button class="chip" data-act="note" data-v="${n}">${n}</button>`).join('')}</div>
      ${mode === 'out' ? `<div class="chips">${TAXES.map(t => `<button class="chip on" data-act="tax" data-v="${t.amount}" data-n="${t.name}">${t.name} ${fmt(t.amount)}</button>`).join('')}</div>` : ''}
    </div>
    <button class="btn ${mode === 'out' ? 'danger' : mode === 'pay' ? 'blue' : ''}" style="width:100%" data-act="doMoney" data-mode="${mode}" data-id="${pid}">✅ تأكيد</button>`);
  setTimeout(() => $('#mAmt')?.focus(), 50);
}

function sheetPlayer(pid) {
  const p = player(pid), st = playerStats(pid);
  const list = st.props.length ? `<div class="pgrid">${st.props.map(propCard).join('')}</div>` : '';
  const worth = p.balance + st.props.reduce((s, q) => s + (q.mortgaged ? q.mortgage : q.price) + (q.level ? q.level * q.house : 0), 0);
  openSheet(`<span class="avatar" style="--c:${p.color};display:inline-grid;width:32px;height:32px;font-size:16px;vertical-align:middle">${esc(p.name[0] || '?')}</span> ${esc(p.name)}`, `
    <div class="card">
      <div class="row"><div><div class="muted small">الرصيد</div><div class="bal ${p.balance < 0 ? 'neg' : ''}">${fmt(p.balance)}</div></div>
      <div><div class="muted small">قيمة كل ممتلكاته تقريبا</div><div class="bal" style="font-size:18px">${fmt(worth)}</div></div></div>
      <div class="muted small" style="margin-top:8px">🃏 ${st.props.length} بطاقة · 🏠 ${st.houses} بيت · 🏨 ${st.hotels} فندق</div>
    </div>
    <div class="card"><h3>البطاقات</h3>${list || '<p class="muted">ما عنده بطاقات</p>'}</div>
    <div class="card"><h3>تعديل</h3>
      <label class="f">الاسم</label><input id="pName" value="${esc(p.name)}">
      <label class="f">اللون</label>
      <div class="chips">${PCOLORS.map(c => `<button class="chip ${c === p.color ? 'on' : ''}" data-act="pColor" data-v="${c}" style="background:${c};border-color:${c};width:34px;height:34px"></button>`).join('')}</div>
      <label class="f">تعديل الرصيد مباشرة (لو صار غلط)</label>
      <input id="pBal" type="number" inputmode="numeric" value="${p.balance}" data-amount>
      <button class="btn" style="width:100%;margin-top:10px" data-act="savePlayer" data-id="${pid}">💾 حفظ</button>
      <button class="btn danger" style="width:100%;margin-top:8px" data-act="delPlayer" data-id="${pid}">🗑️ حذف اللاعب</button>
    </div>`);
}

function deedTable(p) {
  const type = groupOf(p.group).type;
  let rows = [];
  if (type === 'street') {
    const labels = ['الأرض فاضية', 'بيت واحد', 'بيتين', '3 بيوت', '4 بيوت', 'فندق'];
    rows = labels.map((l, i) => [l, fmt(p.rent[i] || 0), i === p.level && p.owner]);
    rows[0][0] += ' (ضعف لو عنده اللون كامل)';
    rows.push(['سعر البيت / الفندق', fmt(p.house)]);
  } else if (type === 'station') {
    const n = p.owner ? G.props.filter(q => q.group === p.group && q.owner === p.owner && !q.mortgaged).length : 0;
    rows = ['محطة وحدة', 'محطتين', '3 محطات', '4 محطات'].slice(0, p.rent.length).map((l, i) => [l, fmt(p.rent[i]), i === n - 1]);
  } else {
    const n = p.owner ? G.props.filter(q => q.group === p.group && q.owner === p.owner && !q.mortgaged).length : 0;
    rows = [['شركة وحدة', `× ${p.rent[0]} النرد`, n === 1], ['الشركتين', `× ${p.rent[1] ?? p.rent[0]} النرد`, n >= 2]];
  }
  rows.push(['قيمة الرهن', fmt(p.mortgage)]);
  const g = groupOf(p.group);
  return `<div class="deed" style="--c:${g.color}"><div class="head ${isLight(p.group) ? 'light' : ''}">
    <small>${g.name}</small><b>${esc(p.name)}</b>${p.en ? `<small>${esc(p.en)}</small>` : ''}</div>
    <table><tr><td>سعر الشراء</td><td>${fmt(p.price)}</td></tr>
    ${rows.map(r => `<tr class="${r[2] ? 'cur' : ''}"><td>${r[0]}</td><td>${r[1]}</td></tr>`).join('')}</table></div>`;
}

function sheetProp(id) {
  const p = prop(id), g = groupOf(p.group), type = g.type, o = p.owner && player(p.owner);
  let body = deedTable(p);
  if (!o) {
    body += `<div class="card"><h3>🏦 البطاقة عند البنك</h3>
      ${G.players.length ? `
      <label class="f">مين اشتراها؟</label>${playerSelect('bBuyer')}
      <label class="f">المبلغ (لو مزاد غيّره)</label>${amountField('bPrice', p.price)}
      <button class="btn" style="width:100%;margin-top:12px" data-act="buy" data-id="${id}">✅ تم البيع</button>
      <button class="btn ghost" style="width:100%;margin-top:8px" data-act="give" data-id="${id}">🎁 تسليمها بدون فلوس</button>`
      : '<p class="muted">أضف لاعبين أول</p>'}</div>`;
  } else {
    const r = rentOf(p);
    body += `<div class="card"><h3>👤 المالك: <span style="color:${o.color}">${esc(o.name)}</span></h3>
      ${p.mortgaged ? '<p class="badge" style="font-size:14px">البطاقة مرهونة — ما فيها إيجار</p>' : ''}
      ${!p.mortgaged && G.players.length > 1 ? `
      <div class="section" style="border:0;margin:0;padding:0">
        <label class="f">💰 دفع الإيجار — مين وقف عليها؟</label>${playerSelect('rPayer', p.owner)}
        ${type === 'utility' ? `<label class="f">كم مجموع النرد؟</label><input id="rDice" type="number" inputmode="numeric" placeholder="مثلا 7">` : ''}
        <button class="btn gold" style="width:100%;margin-top:10px" data-act="rent" data-id="${id}">
          💰 دفع الإيجار ${r !== null ? '(' + fmt(r) + ')' : ''}</button>
      </div>` : ''}

      ${type === 'street' ? `<div class="section"><h3>🏠 البيوت والفنادق</h3>
        <div class="lvl"><button class="btn danger" data-act="lvl" data-d="-1" data-id="${id}" ${p.level <= 0 ? 'disabled' : ''}>−</button>
        <span class="show">${levelText(p.level) || 'ولا بيت'}</span>
        <button class="btn" data-act="lvl" data-d="1" data-id="${id}" ${p.level >= 5 ? 'disabled' : ''}>+</button></div>
        <label class="row small muted" style="justify-content:center;gap:6px"><input type="checkbox" id="lvlPay" checked style="flex:none;width:20px;height:20px"> خصم/إرجاع الفلوس تلقائيا (البيت ${fmt(p.house)}، البيع بالنص)</label>
      </div>` : ''}

      <div class="section"><h3>🏷️ الرهن</h3>
        ${p.mortgaged
          ? `<button class="btn" style="width:100%" data-act="unmort" data-id="${id}">فك الرهن (يدفع ${fmt(Math.round(p.mortgage * 1.1))})</button>`
          : `<button class="btn ghost" style="width:100%" data-act="mort" data-id="${id}" ${p.level ? 'disabled' : ''}>رهن البطاقة (ياخذ ${fmt(p.mortgage)})</button>
             ${p.level ? '<p class="muted small">لازم يبيع البيوت أول</p>' : ''}`}
      </div>

      <div class="section"><h3>🔁 نقلها للاعب ثاني</h3>
        ${G.players.length > 1 ? `${playerSelect('tTo', p.owner)}
        <label class="f">بكم؟ (0 لو تبادل بدون فلوس)</label>${amountField('tPrice', 0)}
        <button class="btn blue" style="width:100%;margin-top:10px" data-act="trade" data-id="${id}">✅ تم النقل</button>` : '<p class="muted small">ما فيه لاعب ثاني</p>'}
        <button class="btn ghost" style="width:100%;margin-top:8px" data-act="toBank" data-id="${id}">🏦 رجّعها للبنك</button>
      </div></div>`;
  }
  body += `<button class="btn ghost" style="width:100%" data-act="editProp" data-id="${id}">✏️ تعديل بيانات البطاقة</button>`;
  openSheet(`${g.name}`, body);
}

function sheetEditProp(id) {
  const isNew = !id;
  const p = isNew ? { group: 'brown', name: '', en: '', price: 100, rent: [0, 0, 0, 0, 0, 0], house: 50, mortgage: 50 } : prop(id);
  const type = groupOf(p.group).type;
  const labels = type === 'street' ? ['أرض فاضية', 'بيت', 'بيتين', '3 بيوت', '4 بيوت', 'فندق']
    : type === 'station' ? ['محطة وحدة', 'محطتين', '3 محطات', '4 محطات'] : ['مضاعف النرد (شركة وحدة)', 'مضاعف النرد (الشركتين)'];
  openSheet(isNew ? '➕ بطاقة جديدة' : '✏️ تعديل البطاقة', `<div class="card">
    <label class="f">الاسم</label><input id="eName" value="${esc(p.name)}">
    <label class="f">الاسم بالإنجليزي (اختياري)</label><input id="eEn" value="${esc(p.en)}" dir="ltr">
    <label class="f">اللون / النوع</label>
    <select id="eGroup">${DEFAULT_GROUPS.map(g => `<option value="${g.id}" ${g.id === p.group ? 'selected' : ''}>${g.name}</option>`).join('')}</select>
    <div class="row"><div><label class="f">سعر الشراء</label><input id="ePrice" type="number" inputmode="numeric" value="${p.price}"></div>
    <div><label class="f">قيمة الرهن</label><input id="eMort" type="number" inputmode="numeric" value="${p.mortgage}"></div></div>
    ${type === 'street' ? `<label class="f">سعر البيت</label><input id="eHouse" type="number" inputmode="numeric" value="${p.house}">` : ''}
    <h3 style="margin-top:14px">${type === 'utility' ? 'مضاعفات النرد' : 'الإيجارات'}</h3>
    <div class="row wrap">${labels.map((l, i) => `<div style="min-width:30%"><label class="f">${l}</label>
      <input class="eRent" type="number" inputmode="numeric" value="${p.rent[i] ?? 0}"></div>`).join('')}</div>
    <p class="muted small">لو غيّرت النوع (مثلا من شارع لمحطة) احفظ وافتح التعديل مرة ثانية عشان تتغير خانات الإيجار.</p>
  </div>
  <button class="btn" style="width:100%" data-act="saveProp" data-id="${id || ''}">💾 حفظ</button>
  ${isNew ? '' : `<button class="btn danger" style="width:100%;margin-top:8px" data-act="delProp" data-id="${id}">🗑️ حذف البطاقة</button>`}`);
}

/* ---------------- الصور (IndexedDB) ---------------- */
const idb = {
  db: null,
  open() {
    if (this.db) return Promise.resolve(this.db);
    return new Promise((res, rej) => {
      const r = indexedDB.open('bankhelper-photos', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('photos');
      r.onsuccess = () => { this.db = r.result; res(this.db); };
      r.onerror = () => rej(r.error);
    });
  },
  async tx(mode, fn) {
    const db = await this.open();
    return new Promise((res, rej) => {
      const t = db.transaction('photos', mode), s = t.objectStore('photos');
      const r = fn(s);
      t.oncomplete = () => res(r && r.result);
      t.onerror = () => rej(t.error);
    });
  },
  put(id, blob) { return this.tx('readwrite', s => s.put(blob, id)); },
  get(id) { return this.tx('readonly', s => s.get(id)); },
  del(id) { return this.tx('readwrite', s => s.delete(id)); },
};
const urlCache = {};
async function photoURL(id) {
  if (urlCache[id]) return urlCache[id];
  const b = await idb.get(id);
  return b ? (urlCache[id] = URL.createObjectURL(b)) : '';
}
async function loadPhotoThumbs() {
  for (const img of $$('img[data-photo]')) img.src = await photoURL(img.dataset.photo);
}
function compress(file, max = 1600) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      c.toBlob(b => b ? res(b) : rej(), 'image/jpeg', 0.8);
    };
    img.onerror = rej;
    img.src = URL.createObjectURL(file);
  });
}
async function addPhoto(file) {
  try {
    const blob = await compress(file);
    const id = uid();
    await idb.put(id, blob);
    G.photos.unshift({ id, t: Date.now() });
    G.log.unshift({ id: uid(), t: Date.now(), text: 'تم حفظ صورة للطاولة', icon: '📸' });
    save(); render(); toast('📸 انحفظت الصورة');
  } catch (e) { toast('ما قدرت أحفظ الصورة'); }
}
async function viewPhoto(id) {
  const ph = G.photos.find(p => p.id === id);
  openSheet('📸 ' + dateStr(ph.t), `<img class="full-photo" src="${await photoURL(id)}" alt="">
    <button class="btn danger" style="width:100%;margin-top:10px" data-act="delPhoto" data-id="${id}">🗑️ حذف الصورة</button>`);
}

/* ---------------- النسخ الاحتياطي ---------------- */
const blobToData = b => new Promise(r => { const f = new FileReader(); f.onload = () => r(f.result); f.readAsDataURL(b); });
async function exportAll() {
  const photos = {};
  for (const g of Object.values(store.games)) for (const ph of g.photos) {
    const b = await idb.get(ph.id); if (b) photos[ph.id] = await blobToData(b);
  }
  const data = JSON.stringify({ app: 'bankhelper', v: 1, store, photos });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
  a.download = 'bank-backup-' + new Date().toISOString().slice(0, 10) + '.json';
  a.click();
  toast('⬇️ تم تنزيل النسخة');
}
async function importAll(file) {
  try {
    const d = JSON.parse(await file.text());
    if (d.app !== 'bankhelper') throw 0;
    for (const [id, url] of Object.entries(d.photos || {})) await idb.put(id, await (await fetch(url)).blob());
    Object.assign(store.games, d.store.games);
    G = null; store.currentId = d.store.currentId || store.currentId;
    save(); render(); toast('⬆️ تم الاسترجاع');
  } catch (e) { toast('الملف غير صحيح'); }
}

/* ---------------- الآلة الحاسبة ---------------- */
const calc = { expr: '' };
function calcRender() {
  $('#calcExpr').textContent = calc.expr.replace(/\*/g, '×').replace(/\//g, '÷');
  const r = calcEval(calc.expr);
  $('#calcRes').textContent = r === null ? (calc.expr ? '…' : '0') : r.toLocaleString('en');
}
function calcEval(e) {
  if (!e || !/^[\d+\-*/.() ]+$/.test(e)) return null;
  try { const v = Function('"use strict";return (' + e + ')')(); return isFinite(v) ? Math.round(v * 100) / 100 : null; }
  catch (x) { return null; }
}
function calcInit() {
  const keys = ['C', '(', ')', '÷', '7', '8', '9', '×', '4', '5', '6', '−', '1', '2', '3', '+', '0', '00', '⌫', '='];
  $('#calcKeys').innerHTML = keys.map(k => `<button data-k="${k}" class="${'÷×−+'.includes(k) ? 'op' : k === '=' ? 'eq' : k === 'C' ? 'cl' : ''}">${k}</button>`).join('');
  $('#calcKeys').addEventListener('click', e => {
    const k = e.target.dataset.k; if (!k) return;
    if (k === 'C') calc.expr = '';
    else if (k === '⌫') calc.expr = calc.expr.slice(0, -1);
    else if (k === '=') { const r = calcEval(calc.expr); if (r !== null) calc.expr = String(r); }
    else calc.expr += ({ '÷': '/', '×': '*', '−': '-' }[k] || k);
    calcRender();
  });
  $('#calcBtn').onclick = () => {
    if (!calc.expr && lastAmountInput && lastAmountInput.value) calc.expr = lastAmountInput.value;
    calcRender(); $('#calcOverlay').classList.add('show');
  };
  $('#calcClose').onclick = () => $('#calcOverlay').classList.remove('show');
  $('#calcUse').onclick = () => {
    const r = calcEval(calc.expr);
    if (r === null) return toast('ما فيه نتيجة');
    if (lastAmountInput && document.body.contains(lastAmountInput) && $('#sheetOverlay').classList.contains('show')) {
      lastAmountInput.value = Math.round(r); toast('تم وضع ' + Math.round(r) + ' في خانة المبلغ');
    } else {
      navigator.clipboard?.writeText(String(r)).catch(() => { });
      toast('النتيجة ' + r.toLocaleString('en') + ' (افتح عملية عشان تنحط في المبلغ)');
    }
    $('#calcOverlay').classList.remove('show');
  };
  $('#calcOverlay').addEventListener('click', e => { if (e.target.id === 'calcOverlay') $('#calcOverlay').classList.remove('show'); });
}

/* ---------------- الأحداث ---------------- */
const val = id => $('#' + id)?.value ?? '';

const actions = {
  close: closeSheet,
  undo,
  addPlayer() {
    const name = val('newPlayer').trim();
    if (!name) return toast('اكتب اسم اللاعب');
    const color = PCOLORS.find(c => !G.players.some(p => p.color === c)) || PCOLORS[G.players.length % PCOLORS.length];
    act(`انضم ${name} برصيد ${fmt(G.startMoney)}`, '👤', () => { G.players.push({ id: uid(), name, color, balance: G.startMoney }); });
    setTimeout(() => $('#newPlayer')?.focus(), 30);
  },
  player: d => sheetPlayer(d.id),
  go: d => transfer('bank', d.id, G.goAmount, 'خط البداية'),
  money: d => sheetMoney(d.mode, d.id),
  addAmt(d) { const i = $('#' + d.for); i.value = num(i.value) + num(d.v); lastAmountInput = i; },
  clrAmt(d) { $('#' + d.for).value = ''; },
  note(d) { $('#mNote').value = d.v; },
  tax(d) { $('#mAmt').value = d.v; $('#mNote').value = d.n; },
  doMoney(d) {
    const amt = val('mAmt'), note = val('mNote').trim();
    const ok = d.mode === 'in' ? transfer('bank', d.id, amt, note)
      : d.mode === 'out' ? transfer(d.id, 'bank', amt, note) : transfer(d.id, val('mTo'), amt, note);
    if (ok) closeSheet();
  },
  pColor(d) { $$('[data-act=pColor]').forEach(b => b.classList.toggle('on', b.dataset.v === d.v)); },
  savePlayer(d) {
    const p = player(d.id), name = val('pName').trim() || p.name;
    const color = $('[data-act=pColor].on')?.dataset.v || p.color;
    const bal = num(val('pBal'));
    const parts = [];
    if (name !== p.name) parts.push(`تغيير اسم ${p.name} إلى ${name}`);
    if (bal !== p.balance) parts.push(`تعديل رصيد ${name} من ${fmt(p.balance)} إلى ${fmt(bal)}`);
    act(parts.join(' · ') || `تعديل ${name}`, '✏️', () => { p.name = name; p.color = color; p.balance = bal; });
    closeSheet();
  },
  delPlayer(d) {
    const p = player(d.id);
    if (!confirm(`متأكد تحذف ${p.name}؟ بطاقاته ترجع للبنك.`)) return;
    act(`حذف اللاعب ${p.name} ورجعت بطاقاته للبنك`, '🗑️', () => {
      G.props.forEach(q => { if (q.owner === p.id) Object.assign(q, { owner: null, level: 0, mortgaged: false }); });
      G.players = G.players.filter(x => x.id !== p.id);
    });
    closeSheet();
  },
  prop: d => sheetProp(d.id),
  buy(d) {
    const p = prop(d.id), b = val('bBuyer'), amt = num(val('bPrice'));
    act(`${nameOf(b)} اشترى ${p.name} من البنك بـ ${fmt(amt)}`, '🃏', () => { move(b, 'bank', amt); p.owner = b; });
    sheetProp(d.id);
  },
  give(d) {
    const p = prop(d.id), b = val('bBuyer');
    act(`البنك سلّم ${p.name} لـ ${nameOf(b)} بدون فلوس`, '🎁', () => { p.owner = b; });
    sheetProp(d.id);
  },
  rent(d) {
    const p = prop(d.id), payer = val('rPayer');
    let dice = 0;
    if (groupOf(p.group).type === 'utility') { dice = num(val('rDice')); if (dice <= 0) return toast('اكتب مجموع النرد'); }
    const r = rentOf(p, dice);
    if (!r) return toast('ما فيه إيجار');
    if (transfer(payer, p.owner, r, 'إيجار ' + p.name)) closeSheet();
  },
  lvl(d) {
    const p = prop(d.id), dir = num(d.d), pay = $('#lvlPay')?.checked;
    if (dir > 0) {
      if (!ownsFullSet(p)) return toast('لازم يملك كل بطاقات اللون أول');
      if (G.props.some(q => q.group === p.group && q.mortgaged)) return toast('فيه بطاقة من نفس اللون مرهونة');
    }
    const nl = p.level + dir;
    const what = (dir > 0 ? (nl === 5 ? 'بنى فندق على' : 'بنى بيت على') : (p.level === 5 ? 'باع الفندق من' : 'باع بيت من'));
    const cost = dir > 0 ? p.house : Math.round(p.house / 2);
    act(`${nameOf(p.owner)} ${what} ${p.name}${pay ? ` (${dir > 0 ? '-' : '+'}${fmt(cost)})` : ''}`, dir > 0 ? '🏠' : '🔨', () => {
      if (pay) dir > 0 ? move(p.owner, 'bank', cost) : move('bank', p.owner, cost);
      p.level = nl;
    });
    sheetProp(d.id);
  },
  mort(d) {
    const p = prop(d.id);
    act(`${nameOf(p.owner)} رهن ${p.name} وأخذ ${fmt(p.mortgage)}`, '🏷️', () => { move('bank', p.owner, p.mortgage); p.mortgaged = true; });
    sheetProp(d.id);
  },
  unmort(d) {
    const p = prop(d.id), c = Math.round(p.mortgage * 1.1);
    act(`${nameOf(p.owner)} فك رهن ${p.name} ودفع ${fmt(c)}`, '🔓', () => { move(p.owner, 'bank', c); p.mortgaged = false; });
    sheetProp(d.id);
  },
  trade(d) {
    const p = prop(d.id), to = val('tTo'), amt = num(val('tPrice')), from = p.owner;
    act(`انتقلت ${p.name} من ${nameOf(from)} إلى ${nameOf(to)}${amt ? ` مقابل ${fmt(amt)}` : ''}`, '🔁', () => {
      if (amt > 0) move(to, from, amt);
      p.owner = to;
    });
    sheetProp(d.id);
  },
  toBank(d) {
    const p = prop(d.id);
    if (!confirm(`ترجع ${p.name} للبنك بدون فلوس؟`)) return;
    act(`رجعت ${p.name} من ${nameOf(p.owner)} للبنك`, '🏦', () => { Object.assign(p, { owner: null, level: 0, mortgaged: false }); });
    sheetProp(d.id);
  },
  newProp: () => sheetEditProp(null),
  editProp: d => sheetEditProp(d.id),
  saveProp(d) {
    const name = val('eName').trim();
    if (!name) return toast('اكتب اسم البطاقة');
    const group = val('eGroup'), type = groupOf(group).type;
    let rent = $$('.eRent').map(i => num(i.value));
    const want = type === 'street' ? 6 : type === 'station' ? 4 : 2;
    while (rent.length < want) rent.push(0);
    rent = rent.slice(0, want);
    const data = { name, en: val('eEn').trim(), group, price: num(val('ePrice')), mortgage: num(val('eMort')), house: $('#eHouse') ? num(val('eHouse')) : 0, rent };
    if (d.id) {
      const p = prop(d.id), changedType = groupOf(p.group).type !== type;
      act(`تعديل بيانات ${name}`, '✏️', () => { Object.assign(p, data); if (type !== 'street') p.level = 0; });
      changedType ? sheetEditProp(d.id) : sheetProp(d.id);
    } else {
      const id = uid();
      act(`إضافة بطاقة جديدة: ${name}`, '➕', () => { G.props.push({ id, ...data, owner: null, level: 0, mortgaged: false }); });
      sheetProp(id);
    }
  },
  delProp(d) {
    const p = prop(d.id);
    if (!confirm(`تحذف بطاقة ${p.name}؟`)) return;
    act(`حذف بطاقة ${p.name}`, '🗑️', () => { G.props = G.props.filter(q => q.id !== p.id); });
    closeSheet();
  },
  photo: () => $('#photoInput').click(),
  viewPhoto: d => viewPhoto(d.id),
  async delPhoto(d) {
    if (!confirm('تحذف الصورة؟')) return;
    await idb.del(d.id).catch(() => { });
    G.photos = G.photos.filter(p => p.id !== d.id);
    save(); render(); closeSheet();
  },
  openGame(d) { G = null; store.currentId = d.id; openGame(d.id); tab = 'players'; render(); toast('📂 فتحت ' + G.name); },
  async delGame(d) {
    const g = store.games[d.id];
    if (!confirm(`تحذف "${g.name}" نهائيا؟`)) return;
    for (const ph of g.photos) await idb.del(ph.id).catch(() => { });
    delete store.games[d.id];
    localStorage.removeItem(UNDO_KEY(d.id));
    if (G.id === d.id) { G = null; store.currentId = null; }
    save(); render();
  },
  newGame() {
    const name = prompt('اسم اللعبة الجديدة:', 'لعبة ' + new Date().toLocaleDateString('ar-SA-u-nu-latn', { weekday: 'long' }));
    if (name === null) return;
    const keep = G.players.length && confirm('تبي نفس اللاعبين؟');
    const g = makeGame(name.trim(), G);
    if (keep) g.players = G.players.map(p => ({ ...p, id: uid(), balance: g.startMoney }));
    store.games[g.id] = g; G = g; tab = 'players';
    save(); render(); toast('🎲 بدأت لعبة جديدة');
  },
  saveSettings() {
    G.name = val('setName').trim() || G.name;
    G.startMoney = num(val('setStart')) || G.startMoney;
    G.goAmount = num(val('setGo')) || G.goAmount;
    G.currency = val('setCur').trim();
    save(); render(); toast('💾 انحفظت الإعدادات');
  },
  device(d) { setDevice(d.v); render(); toast('صار الشكل على: ' + (d.v === 'auto' ? 'تلقائي (' + DEVICES[window.AUTO_DEVICE] + ')' : DEVICES[d.v])); },
  export: exportAll,
  import: () => $('#importInput').click(),
  resetGame() {
    if (!confirm('ترجع كل اللاعبين لفلوس البداية وكل البطاقات للبنك؟ (تقدر تتراجع)')) return;
    act('إعادة اللعبة من الصفر', '🔄', () => {
      G.players.forEach(p => p.balance = G.startMoney);
      G.props.forEach(p => Object.assign(p, { owner: null, level: 0, mortgaged: false }));
    });
  },
  resetProps() {
    if (!confirm('ترجع البطاقات للأسماء والأسعار الأصلية؟ تعديلاتك على البطاقات بتروح، والبطاقات ترجع للبنك.')) return;
    act('رجعت البطاقات الأصلية', '🃏', () => {
      G.props = defaultProps().map(p => ({ ...p, owner: null, level: 0, mortgaged: false }));
    });
  },
};

document.addEventListener('click', e => {
  const t = e.target.closest('[data-act]');
  if (!t) return;
  const fn = actions[t.dataset.act];
  if (fn) { e.preventDefault(); fn(t.dataset); }
});
document.addEventListener('focusin', e => { if (e.target.matches('[data-amount]')) lastAmountInput = e.target; });
document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.id === 'newPlayer') return actions.addPlayer();
  if (e.key === 'Enter' && e.target.id === 'mAmt') return $('[data-act=doMoney]')?.click();
  const typing = /INPUT|TEXTAREA|SELECT/.test(e.target.tagName);
  const calcOpen = $('#calcOverlay').classList.contains('show');
  if (e.key === 'Escape') { if (calcOpen) $('#calcOverlay').classList.remove('show'); else closeSheet(); return; }
  if (calcOpen && !typing) {
    const map = { '*': '×', '/': '÷', '-': '−', '+': '+', 'Enter': '=', '=': '=', 'Backspace': '⌫', 'Delete': 'C' };
    const k = map[e.key] || (/^[\d()]$/.test(e.key) ? e.key : null);
    if (k) { e.preventDefault(); $(`#calcKeys [data-k="${k}"]`)?.click(); }
    return;
  }
  if (typing) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); return undo(); }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const tabs = { '1': 'players', '2': 'props', '3': 'log', '4': 'more' };
  if (tabs[e.key] && !$('#sheetOverlay').classList.contains('show')) { tab = tabs[e.key]; render(); window.scrollTo(0, 0); }
  if (e.key.toLowerCase() === 'c' || e.key === 'ؤ') $('#calcBtn').click();
});
syncKbd();
$$('.tabs button').forEach(b => b.onclick = () => { tab = b.dataset.tab; render(); window.scrollTo(0, 0); });
$('#undoBtn').onclick = undo;
$('#sheetOverlay').addEventListener('click', e => { if (e.target.id === 'sheetOverlay') closeSheet(); });
$('#photoInput').onchange = e => { const f = e.target.files[0]; if (f) addPhoto(f); e.target.value = ''; };
$('#importInput').onchange = e => { const f = e.target.files[0]; if (f) importAll(f); e.target.value = ''; };

calcInit();
render();

if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => { });
