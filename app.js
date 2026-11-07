'use strict';
/* ============================================================
   مساعد البنك — كل البيانات تنحفظ في الجهاز (localStorage + IndexedDB للصور)
   ============================================================ */

const APP_VERSION = 14;
const KEY = 'bankhelper:v1';
const UNDO_KEY = id => KEY + ':undo:' + id;
const UNDO_LIMIT = 40;
const PCOLORS = ['#e53935', '#1e88e5', '#43a047', '#fb8c00', '#8e24aa', '#00acc1', '#6d4c41', '#d81b60', '#546e7a', '#7cb342'];
const LIGHT_GROUPS = ['lightblue', 'yellow'];

const $ = (s, r = document) => r.querySelector(s);
const DEVICES = { phone: 'جوال', tablet: 'آيباد', laptop: 'لابتوب' };
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
  catch (e) { toast('ما قدرت أحفظ — ذاكرة المتصفح ممتلئة'); }
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
const active = () => G.players.filter(p => !p.out);
const prop = id => G.props.find(p => p.id === id);
const nameOf = id => id === 'bank' ? 'البنك' : (player(id)?.name || '؟');
const fmt = n => (n < 0 ? '-' : '') + Math.abs(n).toLocaleString('en') + (G?.currency ? ' ' + G.currency : '');
const timeStr = t => new Date(t).toLocaleTimeString('ar-SA-u-nu-latn', { hour: 'numeric', minute: '2-digit' });
const dateStr = t => new Date(t).toLocaleString('ar-SA-u-nu-latn', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
const levelText = l => l === 5 ? `<span class="lv hotel">${I('hotel')}فندق</span>` : l > 0 ? `<span class="lv">${I('house').repeat(l)}</span>` : '';
const levelWords = l => l === 5 ? 'فندق' : l === 1 ? 'بيت' : l === 2 ? 'بيتين' : l + ' بيوت';
const isLight = g => LIGHT_GROUPS.includes(g);

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 2200);
}

/* كل عملية تمر من هنا: تنحفظ نسخة للتراجع + تنكتب في السجل */
let pendingMoves = [], pendingHint = '', pendingDebt = null;
const BILLS = [500, 100, 50, 20, 10, 5, 1];
function act(text, icon, fn) {
  const snap = JSON.stringify({ players: G.players, props: G.props, log: G.log });
  pendingMoves = []; pendingHint = '';
  const res = fn();
  if (res === false) return false;
  G.log.unshift({ id: uid(), t: Date.now(), text, icon });
  const u = getUndo(); u.push(snap); setUndo(u);
  save(); render();
  // لو أحد صار رصيده بالسالب بسبب هذي العملية، نفتح له شاشة الدين بعد الرسالة
  const debtor = active().find(p => p.balance < 0 && pendingMoves.some(m => m.from === p.id));
  pendingDebt = debtor ? debtor.id : null;
  if (pendingMoves.length || pendingHint) showInstruction(pendingMoves, pendingHint);
  else { toast(text); if (pendingDebt) { const d = pendingDebt; pendingDebt = null; setTimeout(() => sheetDebt(d), 300); } }
  pendingMoves = []; pendingHint = '';
  return true;
}

/* رسالة كبيرة للبنكي: وش يسوي بالفلوس الورق */
function showInstruction(moves, hint) {
  const P = id => {
    const p = id === 'bank' ? { name: 'البنك', color: '#0e4d2f' } : player(id);
    return `<b class="iname" style="--c:${p.color}">${esc(p.name)}</b>`;
  };
  const lines = moves.map(m => {
    const money = `<span class="imoney">${fmt(m.amt)}</span>`;
    if (m.from === 'bank') return `<div class="iline give"><span class="iic">${I('bank')}</span><div>أعطِ ${P(m.to)}<br>${money}<small>من البنك</small></div></div>`;
    if (m.to === 'bank') return `<div class="iline take"><span class="iic">${I('cash')}</span><div>خذ من ${P(m.from)}<br>${money}<small>وحطها في البنك</small></div></div>`;
    return `<div class="iline pay"><span class="iic">${I('swap')}</span><div>خلّ ${P(m.from)} يعطي ${P(m.to)}<br>${money}</div></div>`;
  }).join('');
  // الباقي: لو فيه لاعب يدفع، البنكي يضغط الورق اللي عطاه والموقع يحسب كم يرجع له
  const payer = moves.find(m => m.from !== 'bank');
  const change = payer ? `<div class="change" data-due="${payer.amt}">
      <div class="ch-h">${I('cash')} ${payer.to === 'bank' ? `كم عطاك ${esc(nameOf(payer.from))}؟` : `كم عطى ${esc(nameOf(payer.from))} لـ ${esc(nameOf(payer.to))}؟`} <small>اضغط على الورق</small></div>
      <input id="chGiven" class="big-amount" type="number" inputmode="numeric" placeholder="اكتب كم عطى" style="margin-bottom:8px">
      <div class="bills">${BILLS.map(v => `<button data-bill="${v}">${v}</button>`).join('')}<button data-bill="0" class="clr">مسح</button></div>
      <div class="ch-res"><span class="ch-given">عطى: <b>0</b></span><span class="ch-out muted">اضغط الورق اللي عطاك</span></div>
    </div>` : '';
  $('#instrBox').innerHTML = `${lines}${hint ? `<div class="ihint">${hint}</div>` : ''}${change}
    <button class="btn" id="instrOk" style="width:100%;margin-top:14px;font-size:19px;min-height:56px">تمام ${I('check')}</button>`;
  let given = 0;
  const showChange = () => {
    const due = payer.amt, box = $('#instrBox .ch-res');
    box.querySelector('.ch-given b').textContent = fmt(given);
    const out = box.querySelector('.ch-out');
    out.className = 'ch-out';
    if (!given) { out.textContent = 'اضغط الورق اللي عطاك'; out.classList.add('muted'); }
    else if (given === due) { out.innerHTML = 'مضبوط، ما له باقي'; out.classList.add('ok'); }
    else if (given > due) { out.innerHTML = payer.to === 'bank' ? `${I('undo')} رجّع له <b>${fmt(given - due)}</b>` : `${I('undo')} خلّ ${esc(nameOf(payer.to))} يرجّع له <b>${fmt(given - due)}</b>`; out.classList.add('back'); }
    else { out.innerHTML = `${I('alert')} ناقص <b>${fmt(due - given)}</b>`; out.classList.add('short'); }
  };
  $$('#instrBox [data-bill]').forEach(b => b.onclick = () => {
    const v = num(b.dataset.bill);
    given = v ? given + v : 0;
    $('#chGiven').value = given || '';
    showChange();
  });
  if (payer) $('#chGiven').oninput = e => { given = Math.max(0, num(e.target.value)); showChange(); };
  clearTimeout(toast._t); $('#toast').classList.remove('show');
  $('#instrOverlay').classList.add('show');
  $('#instrOk').onclick = hideInstruction;
  setTimeout(() => $('#instrOk')?.focus(), 30);
}
function hideInstructionLater(pid) {
  const back = () => { const p = player(pid); if (p && !p.out && p.balance < 0) sheetDebt(pid); else { closeSheet(); if (p) toast(`${p.name} سدّد الدين`); } };
  if ($('#instrOverlay').classList.contains('show')) $('#instrOk').onclick = () => { $('#instrOverlay').classList.remove('show'); back(); };
  else back();
}
function hideInstruction() {
  $('#instrOverlay').classList.remove('show');
  if (pendingDebt) { const d = pendingDebt; pendingDebt = null; const p = player(d); if (p && !p.out && p.balance < 0) sheetDebt(d); }
}
function undo() {
  const u = getUndo();
  if (!u.length) return toast('ما فيه شي تتراجع عنه');
  const last = G.log[0];
  if (!confirm('تتراجع عن آخر عملية؟\n\n' + (last ? last.text : ''))) return;
  const s = JSON.parse(u.pop()); setUndo(u);
  G.players = s.players; G.props = s.props; G.log = s.log;
  save(); render(); closeSheet(); toast('تم التراجع');
}

function move(from, to, amt) {
  if (!amt || from === to) return;
  if (from !== 'bank') { const f = player(from); f.balance -= amt; if (f.balance < 0) f.debtTo = to; }
  if (to !== 'bank') player(to).balance += amt;
  pendingMoves.push({ from, to, amt });
}
const hint = (h) => { pendingHint = h; };
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
  return act(moneyText(from, to, amt, note), 'cash', () => move(from, to, amt));
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
  $('#gameSub').textContent = `${DEVICES[device()] || ''} · ${active().length} لاعب · حُفظ ${timeStr(G.updated)}`;
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
    const total = active().reduce((s, p) => s + p.balance, 0);
    const sold = G.props.filter(p => p.owner).length;
    h += `<div class="summary">
      <div><small>مع اللاعبين</small><b>${fmt(total)}</b></div>
      <div><small>المباعة</small><b>${sold} / ${G.props.length}</b></div>
      <div><small>العمليات</small><b>${G.log.length}</b></div></div>`;
  } else {
    const others = Object.values(store.games).filter(g => g.id !== G.id && g.players.length).length;
    h += `<div class="empty"><div class="big">${I('dice')}</div><h2>يلا نبدأ!</h2><p>أضف اللاعبين تحت، وكل واحد يبدأ بـ ${fmt(G.startMoney)}</p>
      <div class="start-btns">
        <button class="btn blue" data-act="import">${I('folder')} كمّل لعبة محفوظة (من ملف)</button>
        ${others ? `<button class="btn ghost" data-act="gotoGames">${I('dice')} الألعاب اللي في هذا الجهاز (${others})</button>` : ''}
      </div></div>`;
  }
  if (G.players.length) h += (G.notes && G.notes.trim())
    ? `<button class="gnote" data-act="gotoNotes"><span class="gn-h">${I('pencil')} ملاحظات اللعبة <small>اضغط عشان تعدل</small></span><span class="gn-t">${esc(G.notes)}</span></button>`
    : `<button class="gnote empty-note" data-act="gotoNotes"><span class="gn-h">${I('pencil')} ملاحظات اللعبة</span><span class="gn-t muted">اضغط هنا واكتب أي ملاحظة، مثل القوانين اللي متفقين عليها</span></button>`;
  if (G.players.length) h += `<button class="quick-btn" data-act="quick">${I('zap')} عملية جديدة <small>إيجار · رهن · شراء · تحويل</small></button>`;
  h += '<div class="pgrid-players">';
  for (const p of active()) {
    const st = playerStats(p.id);
    h += `<div class="pcard" style="--c:${p.color}">
      <div class="ptop" data-act="player" data-id="${p.id}">
        <span class="avatar">${esc(p.name.trim()[0] || '?')}</span>
        <div class="nm"><b>${esc(p.name)}</b>
          <small><span>${I('card')} ${st.props.length}</span><span>${I('house')} ${st.houses}</span><span>${I('hotel')} ${st.hotels}</span></small></div>
        <span class="bal ${p.balance < 0 ? 'neg' : ''}"><span class="num">${p.balance.toLocaleString('en')}</span>${G.currency ? `<small>${esc(G.currency)}</small>` : ''}</span>
      </div>
      ${st.props.length ? `<div class="mini-props">${miniProps(st.props)}</div>` : ''}
      ${p.balance < 0 ? `<div class="debt-bar">${I('alert')}<div><b>عليه ${fmt(-p.balance)}</b><small>لازم يسدد أو يعلن إفلاسه</small></div>
        <button class="btn sm danger" data-act="debt" data-id="${p.id}">سدّد الدين</button></div>` : ''}
      ${p.note ? `<button class="pnote" data-act="playerNote" data-id="${p.id}">${I('pencil')}<span>${esc(p.note)}</span></button>` : ''}
      ${jailBar(p)}
      <div class="pbtns">
        <button class="act go" data-act="go" data-id="${p.id}"><i>${I('flag')}</i><b>+${G.goAmount.toLocaleString('en')}</b><small>البداية</small></button>
        <button class="act in" data-act="money" data-mode="in" data-id="${p.id}"><i>${I('plus')}</i><b>إضافة</b><small>من البنك</small></button>
        <button class="act out" data-act="money" data-mode="out" data-id="${p.id}"><i>${I('minus')}</i><b>دفع</b><small>للبنك</small></button>
        <button class="act pay" data-act="money" data-mode="pay" data-id="${p.id}"><i>${I('swap')}</i><b>تحويل</b><small>للاعب</small></button>
      </div>
    </div>`;
  }
  h += '</div>';
  const outs = G.players.filter(p => p.out);
  if (outs.length) h += `<div class="card out-list"><h3>${I('alert')} طلعوا من اللعبة</h3>${outs.map(p => `
    <div class="out-row" style="--c:${p.color}"><span class="avatar">${esc(p.name.trim()[0] || '?')}</span><b>${esc(p.name)}</b>
    <span class="muted small">أفلس${p.outTo ? ' لـ ' + esc(nameOf(p.outTo)) : ''} · ${timeStr(p.outAt || Date.now())}</span></div>`).join('')}</div>`;
  h += `<div class="card add-player"><h3>${I('plus')} إضافة لاعب</h3>
    <div class="row"><input id="newPlayer" placeholder="اسم اللاعب" enterkeyhint="done" autocomplete="off">
    <button class="btn" data-act="addPlayer" style="flex:none;min-width:96px">إضافة</button></div></div>`;
  return h;
}

function viewProps() {
  let h = `<button class="btn ghost wide" data-act="newProp" style="margin-bottom:14px">${I('plus')} بطاقة جديدة</button><div class="groups">`;
  const used = new Set();
  const fams = FAMILIES.map(f => f.groups ? f : { ...groupOf(f.id), groups: [f.id] });
  // أي مجموعة جديدة مو في القائمة تطلع لحالها
  DEFAULT_GROUPS.forEach(g => { if (!fams.some(f => f.groups.includes(g.id))) fams.push({ ...g, groups: [g.id] }); });
  for (const f of fams) {
    const sets = f.groups.map(gid => G.props.filter(p => p.group === gid)).filter(s => s.length);
    if (!sets.length) continue;
    const all = sets.flat();
    h += `<section class="grp" style="--c:${f.color}"><div class="grp-h">
      <span class="dot"></span><span>${f.name}</span><span class="count">${all.filter(p => p.owner).length}/${all.length}</span></div>
      ${sets.map((s, i) => `${sets.length > 1 ? `<div class="set-h"><span>طقم ${i + 1}</span><small>${s.length} بطاقات — لازم يملكها كلها عشان يبني</small></div>` : ''}
      <div class="pgrid">${s.map(propCard).join('')}</div>`).join('')}</section>`;
  }
  return h + '</div>';
}
function propCard(p) {
  const g = groupOf(p.group), o = p.owner && player(p.owner);
  const icon = g.type === 'station' ? 'train' : g.type === 'utility' ? (p.en && /water/i.test(p.en) ? 'drop' : 'bulb') : '';
  return `<button class="prop ${p.mortgaged ? 'mort' : ''} ${o ? 'owned' : ''}" style="--c:${g.color};${o ? `--oc:${o.color}` : ''}" data-act="prop" data-id="${p.id}">
    <span class="deed-h ${isLight(p.group) ? 'light' : ''}">${icon ? I(icon, 'deed-ic') : ''}<span>${esc(p.name)}</span></span>
    <span class="body">
      <span class="pr">${fmt(p.price)}</span>
      <span class="houses">${levelText(p.level)}</span>
      ${o ? `<span class="owner-chip"><span class="od"></span>${esc(o.name)}</span>` : `<span class="owner-chip bank">${I('bank')} البنك</span>`}
      ${p.mortgaged ? '<span class="stamp">مرهونة</span>' : ''}
    </span></button>`;
}

function viewLog() {
  if (!G.log.length) return `<div class="empty"><div class="big">${I('list')}</div><p>ما فيه عمليات للحين</p></div>`;
  return `<div class="card">
    <div class="row" style="margin-bottom:6px"><h3 style="margin:0">كل العمليات (${G.log.length})</h3>
    <button class="btn ghost sm" style="flex:none" data-act="undo">${I('undo')} تراجع عن آخر وحدة</button></div>
    ${G.log.map(l => `<div class="log-item"><span class="ic">${logIcon(l.icon)}</span>
      <span class="tx">${esc(l.text)}</span><time>${timeStr(l.t)}</time></div>`).join('')}</div>`;
}

function viewMore() {
  const games = Object.values(store.games).sort((a, b) => b.updated - a.updated);
  return `<div class="more-grid">
  <div class="card version-card"><div class="row">
    <div><h3 style="margin:0">${I('refresh')} نسخة الموقع: ${APP_VERSION}</h3>
    <p class="muted small" style="margin:4px 0 0">لو ما وصلك آخر تحديث، اضغط الزر. ألعابك ما تنمسح.</p></div>
    <button class="btn ghost" data-act="forceUpdate" style="flex:none">تحديث الموقع</button></div></div>

  <div class="card" id="notesCard"><h3>${I('pencil')} ملاحظات اللعبة</h3>
    <textarea id="gNote" rows="4" placeholder="مثلا: القوانين اللي متفقين عليها، أو: وقفنا والدور على محمد">${esc(G.notes || '')}</textarea>
    <p class="muted small note-saved" id="gNoteSaved">تنحفظ لحالها وتطلع لك لما ترجّع اللعبة</p></div>

  <div class="card"><h3>${I('camera')} صور الطاولة</h3>
    <p class="muted small">صوّر اللوحة قبل لا توقفون عشان تعرفون كل واحد وين كان، والصورة تنحفظ مع اللعبة.</p>
    <button class="btn gold" data-act="photo" style="width:100%">${I('camera')} صوّر الطاولة الحين</button>
    <div class="photos" id="photos" style="margin-top:10px">${G.photos.map(ph => `
      <button class="photo" data-act="viewPhoto" data-id="${ph.id}"><img data-photo="${ph.id}" alt=""><span>${dateStr(ph.t)}</span></button>`).join('')}
    </div></div>

  <div class="card"><h3>${I('dice')} الألعاب المحفوظة</h3>
    ${games.map(g => `<div class="game-item ${g.id === G.id ? 'cur' : ''}">
      <div class="info"><b>${esc(g.name)}</b><div class="muted small">${g.players.length} لاعب · ${dateStr(g.updated)}</div></div>
      ${g.id === G.id ? '' : `<button class="btn sm" data-act="openGame" data-id="${g.id}">فتح</button>`}
      <button class="btn ghost sm" data-act="delGame" data-id="${g.id}">${I('trash')}</button></div>`).join('')}
    <button class="btn" data-act="newGame" style="width:100%;margin-top:10px">${I('plus')} لعبة جديدة</button>
    <p class="muted small">اللعبة الجديدة تاخذ نفس البطاقات والأسعار اللي عدلتها هنا، بس تبدأ من الصفر.</p></div>

  <div class="card"><h3>${I('monitor')} الجهاز</h3>
    <p class="muted small" style="margin-top:0">الموقع عرف إنك فاتح من: <b>${DEVICES[window.AUTO_DEVICE]}</b>. إذا غلط، اختر جهازك:</p>
    <div class="chips">${[['auto', 'تلقائي'], ...Object.entries(DEVICES)].map(([k, v]) => `<button class="chip ${curDeviceSetting() === k ? 'on' : ''}" data-act="device" data-v="${k}">${I(k === 'auto' ? 'sparkle' : k)}${v}</button>`).join('')}</div>
  </div>

  <div class="card"><h3>${I('settings')} الإعدادات</h3>
    <label class="f">اسم اللعبة</label><input id="setName" value="${esc(G.name)}">
    <div class="row">
      <div><label class="f">فلوس البداية</label><input id="setStart" type="number" inputmode="numeric" value="${G.startMoney}"></div>
      <div><label class="f">مبلغ خط البداية</label><input id="setGo" type="number" inputmode="numeric" value="${G.goAmount}"></div>
    </div>
    <label class="f">العملة (اختياري، مثل: ج أو $)</label><input id="setCur" value="${esc(G.currency)}" maxlength="6">
    <button class="btn" data-act="saveSettings" style="width:100%;margin-top:12px">${I('save')} حفظ الإعدادات</button></div>

  <div class="card backup"><h3>${I('save')} النسخة الاحتياطية</h3>
    <p class="muted small" style="margin-top:0">كل شي ينحفظ في هذا الجهاز لحاله. بس لو تبي تنقل اللعبة لجهاز ثاني، أو تحتفظ فيها بأمان، احفظ نسخة في ملف.</p>
    <button class="btn" data-act="export" style="width:100%">${I('download')} احفظ نسخة في ملف</button>
    <button class="btn blue" data-act="import" style="width:100%;margin-top:8px">${I('folder')} افتح نسخة محفوظة</button>
    <p class="muted small">لما تفتح النسخة، يرجع كل شي مثل ما كان: اللاعبين والفلوس والبطاقات وصور الطاولة.</p></div>

  <div class="card"><h3>${I('sparkle')} أخرى</h3>
    <div class="row wrap">
      <button class="btn ghost" data-act="resetGame">${I('refresh')} إعادة اللعبة من الصفر</button>
      <button class="btn danger" data-act="wipeGame" style="flex-basis:100%">${I('trash')} حذف كل شي (حتى اللاعبين)</button>
      <button class="btn ghost" data-act="resetProps">${I('card')} رجّع البطاقات الأصلية</button>
    </div></div></div>`;
}

/* ---------------- النوافذ (Sheet) ---------------- */
function openSheet(title, body) {
  $('#sheet').innerHTML = `<div class="sheet-h"><h2>${title}</h2><button class="x" data-act="close">${I('x')}</button></div>${body}`;
  $('#sheetOverlay').classList.add('show');
  $('#sheet').scrollTop = 0;
}
function closeSheet() {
  const wasNote = !!$('#pNote');
  $('#sheetOverlay').classList.remove('show'); lastAmountInput = null;
  if (wasNote) { clearTimeout(noteTimer); save(); render(); }
}

function amountField(id, val = '') {
  return `<input id="${id}" class="big-amount" type="number" inputmode="numeric" placeholder="0" value="${val}" data-amount>
    <div class="chips">${[10, 20, 50, 100, 200, 500].map(v => `<button class="chip" data-act="addAmt" data-v="${v}" data-for="${id}">+${v}</button>`).join('')}
    <button class="chip" data-act="clrAmt" data-for="${id}">مسح</button></div>`;
}
function playerSelect(id, exclude, withBank, selected) {
  const opts = active().filter(p => p.id !== exclude).map(p => `<option value="${p.id}" ${p.id === selected ? 'selected' : ''}>${esc(p.name)} (${fmt(p.balance)})</option>`);
  if (withBank) opts.unshift(`<option value="bank">${I('bank')} البنك</option>`);
  return `<select id="${id}">${opts.join('')}</select>`;
}

function sheetMoney(mode, pid) {
  const p = player(pid);
  const notes = mode === 'in'
    ? ['بطاقة حظ', 'صندوق الجماعة', 'رهن', 'بيع']
    : mode === 'out' ? ['بطاقة حظ', 'صندوق الجماعة', 'شراء', 'السجن'] : ['إيجار', 'شراء', 'بطاقة حظ', 'دين'];
  const title = mode === 'in' ? `${I('plus')} البنك يعطي ${esc(p.name)}` : mode === 'out' ? `${I('minus')} ${esc(p.name)} يدفع للبنك` : `${I('swap')} ${esc(p.name)} يحوّل`;
  if (mode === 'pay' && active().length < 2) return toast('لازم يكون فيه لاعب ثاني');
  openSheet(title, `
    <div class="card">
      <p class="muted small" style="margin-top:0">رصيد ${esc(p.name)} الحين: <b>${fmt(p.balance)}</b></p>
      ${mode === 'pay' ? `<label class="f">إلى</label>${playerSelect('mTo', pid, false)}` : ''}
      <label class="f">المبلغ</label>${amountField('mAmt')}
      <label class="f">ملاحظة (اختياري)</label><input id="mNote" placeholder="مثلا: إيجار">
      <div class="chips">${notes.map(n => `<button class="chip" data-act="note" data-v="${n}">${n}</button>`).join('')}</div>
      ${mode === 'out' ? `<div class="chips">${TAXES.map(t => `<button class="chip on" data-act="tax" data-v="${t.amount}" data-n="${t.name}">${t.name} ${fmt(t.amount)}</button>`).join('')}</div>` : ''}
    </div>
    <button class="btn ${mode === 'out' ? 'danger' : mode === 'pay' ? 'blue' : ''}" style="width:100%" data-act="doMoney" data-mode="${mode}" data-id="${pid}">${I('check')} تأكيد</button>`);
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
      <div class="muted small" style="margin-top:8px">${I('card')} ${st.props.length} بطاقة · ${I('house')} ${st.houses} بيت · ${I('hotel')} ${st.hotels} فندق</div>
    </div>
    <div class="card"><h3>البطاقات</h3>${list || '<p class="muted">ما عنده بطاقات</p>'}</div>
    <button class="quick-btn" data-act="quick" data-from="${pid}">${I('zap')} عملية لـ ${esc(p.name)}</button>
    <div class="card"><h3>${I('lock')} السجن</h3>
      ${p.jail ? `<p style="margin-top:0"><b>في السجن</b> · الدور ${p.jail} من 3</p>` : '<p class="muted small" style="margin-top:0">مو في السجن</p>'}
      <div class="row wrap">
        ${p.jail ? `<button class="btn ghost" data-act="jailOut" data-id="${pid}">${I('unlock')} طلع (جاب دبل)</button>` : `<button class="btn ghost" data-act="jailIn" data-id="${pid}">${I('lock')} دخل السجن</button>`}
      </div>
      <label class="f">بطاقات الخروج من السجن مجانا</label>
      <div class="lvl"><button class="btn danger" data-act="freeCard" data-d="-1" data-id="${pid}" ${(p.freeCards || 0) <= 0 ? 'disabled' : ''}>${I('minus')}</button>
        <span class="show">${p.freeCards || 0}</span>
        <button class="btn" data-act="freeCard" data-d="1" data-id="${pid}">${I('plus')}</button></div>
    </div>
    ${p.balance < 0 ? `<button class="btn danger" style="width:100%;margin-bottom:14px" data-act="debt" data-id="${pid}">${I('alert')} عليه ${fmt(-p.balance)} — سدّد الدين</button>` : ''}
    <div class="card"><h3>${I('pencil')} ملاحظات عن ${esc(p.name)}</h3>
      <textarea id="pNote" data-id="${pid}" rows="3" placeholder="مثلا: متفق مع خالد ما ياخذ منه إيجار على المحطات">${esc(p.note || '')}</textarea>
      <p class="muted small note-saved" id="pNoteSaved">تنحفظ لحالها وأنت تكتب</p></div>
    <div class="card"><h3>تعديل</h3>
      <label class="f">الاسم</label><input id="pName" value="${esc(p.name)}">
      <label class="f">اللون</label>
      <div class="chips">${PCOLORS.map(c => `<button class="chip ${c === p.color ? 'on' : ''}" data-act="pColor" data-v="${c}" style="background:${c};border-color:${c};width:34px;height:34px"></button>`).join('')}</div>
      <label class="f">تعديل الرصيد مباشرة (لو صار غلط)</label>
      <input id="pBal" type="number" inputmode="numeric" value="${p.balance}" data-amount>
      <button class="btn" style="width:100%;margin-top:10px" data-act="savePlayer" data-id="${pid}">${I('save')} حفظ</button>
      <button class="btn danger" style="width:100%;margin-top:8px" data-act="delPlayer" data-id="${pid}">${I('trash')} حذف اللاعب</button>
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
    body += `<div class="card"><h3>${I('bank')} البطاقة عند البنك</h3>
      ${G.players.length ? `
      <label class="f">مين اشتراها؟</label>${playerSelect('bBuyer')}
      <label class="f">المبلغ (لو مزاد غيّره)</label>${amountField('bPrice', p.price)}
      <button class="btn" style="width:100%;margin-top:12px" data-act="buy" data-id="${id}">${I('check')} تم البيع</button>
      <button class="btn ghost" style="width:100%;margin-top:8px" data-act="give" data-id="${id}">${I('gift')} تسليمها بدون فلوس</button>`
      : '<p class="muted">أضف لاعبين أول</p>'}</div>`;
  } else {
    const r = rentOf(p);
    body += `<div class="card"><h3>${I('user')} المالك: <span style="color:${o.color}">${esc(o.name)}</span></h3>
      ${p.mortgaged ? '<p class="badge" style="font-size:14px">البطاقة مرهونة — ما فيها إيجار</p>' : ''}
      ${!p.mortgaged && active().length > 1 ? `
      <div class="section" style="border:0;margin:0;padding:0">
        <label class="f">${I('coins')} دفع الإيجار — مين وقف عليها؟</label>${playerSelect('rPayer', p.owner)}
        ${type === 'utility' ? `<label class="f">كم مجموع النرد؟</label><input id="rDice" type="number" inputmode="numeric" placeholder="مثلا 7">` : ''}
        <button class="btn gold" style="width:100%;margin-top:10px" data-act="rent" data-id="${id}">
          ${I('coins')} دفع الإيجار ${r !== null ? '(' + fmt(r) + ')' : ''}</button>
      </div>` : ''}

      ${type === 'street' ? `<div class="section"><h3>${I('house')} البيوت والفنادق</h3>
        <div class="lvl"><button class="btn danger" data-act="lvl" data-d="-1" data-id="${id}" ${p.level <= 0 ? 'disabled' : ''}>−</button>
        <span class="show">${levelText(p.level) || 'ولا بيت'}</span>
        <button class="btn" data-act="lvl" data-d="1" data-id="${id}" ${p.level >= 5 ? 'disabled' : ''}>+</button></div>
        <label class="row small muted" style="justify-content:center;gap:6px"><input type="checkbox" id="lvlPay" checked style="flex:none;width:20px;height:20px"> خصم/إرجاع الفلوس تلقائيا (البيت ${fmt(p.house)}، البيع بالنص)</label>
      </div>` : ''}

      <div class="section"><h3>${I('tag')} الرهن</h3>
        ${p.mortgaged
          ? `<button class="btn" style="width:100%" data-act="unmort" data-id="${id}">فك الرهن (يدفع ${fmt(Math.round(p.mortgage * 1.1))})</button>`
          : `<button class="btn ghost" style="width:100%" data-act="mort" data-id="${id}" ${p.level ? 'disabled' : ''}>رهن البطاقة (ياخذ ${fmt(p.mortgage)})</button>
             ${p.level ? '<p class="muted small">لازم يبيع البيوت أول</p>' : ''}`}
      </div>

      <div class="section"><h3>${I('swap')} نقلها للاعب ثاني</h3>
        ${active().length > 1 ? `${playerSelect('tTo', p.owner)}
        <label class="f">بكم؟ (0 لو تبادل بدون فلوس)</label>${amountField('tPrice', 0)}
        <button class="btn blue" style="width:100%;margin-top:10px" data-act="trade" data-id="${id}">${I('check')} تم النقل</button>` : '<p class="muted small">ما فيه لاعب ثاني</p>'}
        <button class="btn ghost" style="width:100%;margin-top:8px" data-act="toBank" data-id="${id}">${I('bank')} رجّعها للبنك</button>
      </div></div>`;
  }
  body += `<button class="btn ghost" style="width:100%" data-act="editProp" data-id="${id}">${I('pencil')} تعديل بيانات البطاقة</button>`;
  openSheet(`${g.name}`, body);
}

function sheetEditProp(id) {
  const isNew = !id;
  const p = isNew ? { group: 'brown', name: '', en: '', price: 100, rent: [0, 0, 0, 0, 0, 0], house: 50, mortgage: 50 } : prop(id);
  const type = groupOf(p.group).type;
  const labels = type === 'street' ? ['أرض فاضية', 'بيت', 'بيتين', '3 بيوت', '4 بيوت', 'فندق']
    : type === 'station' ? ['محطة وحدة', 'محطتين', '3 محطات', '4 محطات'] : ['مضاعف النرد (شركة وحدة)', 'مضاعف النرد (الشركتين)'];
  openSheet(isNew ? 'بطاقة جديدة' : 'تعديل البطاقة', `<div class="card">
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
  <button class="btn" style="width:100%" data-act="saveProp" data-id="${id || ''}">${I('save')} حفظ</button>
  ${isNew ? '' : `<button class="btn danger" style="width:100%;margin-top:8px" data-act="delProp" data-id="${id}">${I('trash')} حذف البطاقة</button>`}`);
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
    G.log.unshift({ id: uid(), t: Date.now(), text: 'تم حفظ صورة للطاولة', icon: 'camera' });
    save(); render(); toast('انحفظت الصورة');
  } catch (e) { toast('ما قدرت أحفظ الصورة'); }
}
async function viewPhoto(id) {
  const ph = G.photos.find(p => p.id === id);
  openSheet('' + dateStr(ph.t), `<img class="full-photo" src="${await photoURL(id)}" alt="">
    <button class="btn danger" style="width:100%;margin-top:10px" data-act="delPhoto" data-id="${id}">${I('trash')} حذف الصورة</button>`);
}

/* ---------------- النسخ الاحتياطي ---------------- */
const blobToData = b => new Promise(r => { const f = new FileReader(); f.onload = () => r(f.result); f.readAsDataURL(b); });
async function exportAll() {
  const photos = {};
  for (const g of Object.values(store.games)) for (const ph of g.photos) {
    const b = await idb.get(ph.id); if (b) photos[ph.id] = await blobToData(b);
  }
  const data = JSON.stringify({ app: 'bankhelper', v: 1, saved: Date.now(), store, photos });
  const d = new Date(), pad = n => String(n).padStart(2, '0');
  const name = `bank-backup-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}.json`;
  const blob = new Blob([data], { type: 'application/json' });
  // في الجوال والآيباد: نافذة المشاركة (احفظ في الملفات، واتساب، AirDrop...)
  try {
    const file = new File([blob], name, { type: 'application/json' });
    if (device() !== 'laptop' && navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: 'نسخة ' + G.name });
      return toast('انحفظت النسخة');
    }
  } catch (e) { if (e && e.name === 'AbortError') return; }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  toast('انحفظت النسخة في التنزيلات');
}
async function importAll(file) {
  try {
    const d = JSON.parse(await file.text());
    if (d.app !== 'bankhelper') throw 0;
    for (const [id, url] of Object.entries(d.photos || {})) await idb.put(id, await (await fetch(url)).blob());
    // نشيل اللعبة الفاضية اللي ما فيها لاعبين عشان ما تزحم القائمة
    if (G && !G.players.length && !G.log.length) delete store.games[G.id];
    Object.assign(store.games, d.store.games);
    const cur = d.store.games[d.store.currentId] ? d.store.currentId : Object.keys(d.store.games)[0];
    G = store.games[cur]; store.currentId = cur; tab = 'players';
    save(); render(); window.scrollTo(0, 0);
    showRestored(d, Object.keys(d.store.games).length);
  } catch (e) { toast('هذا الملف مو نسخة من الموقع'); }
}
async function showRestored(d, count) {
  const ph = G.photos[0];
  const rows = G.players.slice().sort((x, y) => y.balance - x.balance).map(p => {
    const st = playerStats(p.id);
    return `<div class="rs-row" style="--c:${p.color}"><span class="avatar" style="width:36px;height:36px;font-size:17px;border-radius:12px">${esc(p.name.trim()[0] || '?')}</span>
      <b>${esc(p.name)}</b><span class="muted small">${I('card')} ${st.props.length} · ${I('house')} ${st.houses} · ${I('hotel')} ${st.hotels}</span><span class="bal" style="font-size:19px;margin-inline-start:auto">${fmt(p.balance)}</span></div>`;
  }).join('');
  const last = G.log.find(l => l.icon !== 'camera');
  openSheet('رجعت اللعبة!', `
    <div class="card"><h3 style="margin-bottom:4px">${esc(G.name)}</h3>
      <p class="muted small" style="margin:0 0 10px">آخر مرة لعبتوا: ${dateStr(G.updated)}${count > 1 ? ` · وفي الملف ${count} ألعاب (تلقاها في المزيد)` : ''}</p>
      ${rows || '<p class="muted">ما فيها لاعبين</p>'}
      ${last ? `<p class="small" style="margin:12px 0 0">${I('list')} آخر عملية: <b>${esc(last.text)}</b></p>` : ''}</div>
    ${(G.notes && G.notes.trim()) || G.players.some(p => p.note) ? `<div class="card"><h3>${I('pencil')} الملاحظات</h3>
      ${G.notes && G.notes.trim() ? `<p class="note-text">${esc(G.notes)}</p>` : ''}
      ${G.players.filter(p => p.note).map(p => `<p class="note-text small"><b style="color:${p.color}">${esc(p.name)}:</b> ${esc(p.note)}</p>`).join('')}</div>` : ''}
    ${ph ? `<div class="card"><h3>${I('camera')} هذي آخر صورة للطاولة</h3><p class="muted small" style="margin-top:0">رجّعوا القطع مكانها مثل الصورة</p>
      <img class="full-photo" src="${await photoURL(ph.id)}" alt=""></div>` : `<p class="muted small">ما فيه صورة للطاولة في هذي النسخة. المرة الجاية صوّروا الطاولة من المزيد قبل لا توقفون.</p>`}
    <button class="btn" data-act="close" style="width:100%;font-size:18px">يلا نكمّل ${I('dice')}</button>`);
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


/* ---------------- ⚡ عملية جديدة (من ← إلى + السبب + البطاقة) ---------------- */
const REASONS = [
  { id: 'rent', icon: 'coins', name: 'إيجار' },
  { id: 'mort', icon: 'tag', name: 'رهن' },
  { id: 'unmort', icon: 'unlock', name: 'فك رهن' },
  { id: 'buy', icon: 'cart', name: 'شراء' },
  { id: 'go', icon: 'flag', name: 'البداية' },
  { id: 'custom', icon: 'pencil', name: 'مبلغ' },
];
let Q = null;

// وش ينفع لكل سبب: مين يدفع، مين ياخذ، وأي بطاقات تطلع
function qRules(r) {
  const players = active().map(p => p.id);
  const all = ['bank', ...players];
  switch (r) {
    case 'rent': return { from: players, to: players, needCard: true };
    case 'mort': return { from: ['bank'], to: players, needCard: true };
    case 'unmort': return { from: players, to: ['bank'], needCard: true };
    case 'buy': return { from: players, to: ['bank'], needCard: true };
    case 'go': return { from: ['bank'], to: players, needCard: false };
    default: return { from: all, to: all, needCard: false };
  }
}
// ليش البطاقة ما تنفع لهذي العملية؟ (فاضي = تنفع)
function qWhyNot(p) {
  const r = Q.reason, own = p.owner ? 'حق ' + nameOf(p.owner) : 'عند البنك';
  if (r === 'rent') {
    if (!p.owner) return 'عند البنك';
    if (p.owner === Q.from) return 'حقه هو';
    if (p.mortgaged) return 'مرهونة';
    if (Q.to && p.owner !== Q.to) return own;
    return '';
  }
  if (r === 'mort') {
    if (!Q.to) return 'اختر اللاعب';
    if (p.owner !== Q.to) return own;
    if (p.mortgaged) return 'مرهونة';
    if (p.level) return 'عليها بيوت';
    return '';
  }
  if (r === 'unmort') {
    if (!Q.from) return 'اختر اللاعب';
    if (p.owner !== Q.from) return own;
    if (!p.mortgaged) return 'مو مرهونة';
    return '';
  }
  if (r === 'buy') return p.owner ? own : '';
  return 'x';
}
function qCards() { return G.props.filter(p => !qWhyNot(p)); }
function qAmount() {
  const p = Q.card && prop(Q.card);
  switch (Q.reason) {
    case 'rent': return p ? rentOf(p, num(Q.dice)) : null;
    case 'mort': return p ? p.mortgage : null;
    case 'unmort': return p ? Math.round(p.mortgage * 1.1) : null;
    case 'buy': return Q.amount !== '' ? num(Q.amount) : (p ? p.price : null);
    case 'go': return G.goAmount;
    default: return Q.amount !== '' ? num(Q.amount) : null;
  }
}
// يعبي الأشياء الواضحة لحاله
function qAuto() {
  const R = qRules(Q.reason);
  if (!R.from.includes(Q.from)) Q.from = null;
  if (!R.to.includes(Q.to)) Q.to = null;
  if (R.from.length === 1) Q.from = R.from[0];
  if (R.to.length === 1) Q.to = R.to[0];
  if (Q.from && Q.from === Q.to) Q.to = null;
  if (Q.card && !qCards().some(p => p.id === Q.card)) Q.card = null;
  if (Q.reason === 'rent' && Q.card) Q.to = prop(Q.card).owner;
}

function sheetQuick(pre = {}) {
  if (!G.players.length) return toast('أضف لاعبين أول');
  Q = { reason: 'rent', from: null, to: null, card: null, amount: '', dice: '', note: '', ...pre };
  qAuto();
  renderQuick();
}
function renderQuick() {
  const R = qRules(Q.reason);
  const who = (side, list, sel, other) => `<div class="who">${['bank', ...active().map(p => p.id)].map(id => {
    const ok = list.includes(id) && id !== other;
    const p = id === 'bank' ? { name: 'البنك', color: '#0e4d2f' } : player(id);
    return `<button class="${sel === id ? 'on' : ''}" style="--c:${p.color}" data-act="qPick" data-side="${side}" data-v="${id}" ${ok ? '' : 'disabled'}>
      <span class="av" style="background:${p.color}">${id === 'bank' ? I('bank') : esc(p.name.trim()[0] || '?')}</span>${esc(p.name)}</button>`;
  }).join('')}</div>`;

  const cards = qCards();
  const cardTitle = {
    rent: Q.to ? `وين وقف؟ (بطاقات ${esc(nameOf(Q.to))})` : 'وين وقف؟',
    mort: Q.to ? `أي بطاقة يرهن؟ (بطاقات ${esc(nameOf(Q.to))})` : 'أي بطاقة يرهن؟',
    unmort: Q.from ? `أي بطاقة يفك رهنها؟` : 'أي بطاقة يفك رهنها؟',
    buy: 'أي بطاقة يشتري؟',
  }[Q.reason];
  const emptyMsg = {
    rent: Q.from ? 'ما فيه بطاقات لغيره عليها إيجار' : 'اختر اللي يدفع أول',
    mort: Q.to ? 'ما عنده بطاقات ينفع يرهنها (لازم تكون بدون بيوت وغير مرهونة)' : 'اختر اللاعب أول',
    unmort: Q.from ? 'ما عنده بطاقات مرهونة' : 'اختر اللاعب أول',
    buy: 'كل البطاقات انباعت',
    _: '',
  }[Q.reason];
  const cardStep = R.needCard ? `
    <div class="step"><span class="n">4</span>${cardTitle}</div>
    ${cards.length ? '' : `<p class="muted small">${emptyMsg}</p>`}
    <div class="qcards">${DEFAULT_GROUPS.map(g => G.props.filter(p => p.group === g.id).map(p => {
      const why = qWhyNot(p), o = p.owner && player(p.owner);
      return `<button class="prop ${Q.card === p.id ? 'on' : ''} ${why ? 'no' : ''}" style="--c:${g.color}" data-act="qCard" data-v="${p.id}" ${why ? 'disabled' : ''}>
        <span class="deed-h ${isLight(p.group) ? 'light' : ''}"><span>${esc(p.name)}</span></span>
        <span class="body"><span class="pr">${fmt(p.price)}</span><span class="houses">${levelText(p.level)}</span>
        ${why ? `<span class="why">${esc(why)}</span>` : (o && Q.reason === 'rent' && !Q.to ? `<span class="owner-chip" style="--oc:${o.color}"><span class="od"></span>${esc(o.name)}</span>` : '')}</span></button>`;
    }).join('')).join('')}</div>` : '';

  const card = Q.card && prop(Q.card);
  const needDice = Q.reason === 'rent' && card && groupOf(card.group).type === 'utility';
  const extra = needDice
    ? `<label class="f">${I('dice')} كم مجموع النرد؟</label><input id="qDice" type="number" inputmode="numeric" placeholder="مثلا 7" value="${esc(Q.dice)}">`
    : (Q.reason === 'custom' || Q.reason === 'buy')
      ? `<label class="f">${Q.reason === 'buy' ? 'السعر (غيّره لو مزاد)' : 'المبلغ'}</label>
         <input id="qAmt" class="big-amount" type="number" inputmode="numeric" placeholder="${Q.reason === 'buy' && card ? card.price : '0'}" value="${esc(Q.amount)}" data-amount>
         ${Q.reason === 'custom' ? `<div class="chips">${[10, 20, 50, 100, 200, 500].map(v => `<button class="chip" data-act="qAdd" data-v="${v}">+${v}</button>`).join('')}</div>
         <label class="f">ملاحظة (اختياري)</label><input id="qNote" value="${esc(Q.note)}" placeholder="مثلا: بطاقة حظ">
         <div class="chips">${['بطاقة حظ', 'صندوق الجماعة', 'السجن', 'دين', ...TAXES.map(t => t.name)].map(n => `<button class="chip" data-act="qNoteSet" data-v="${n}">${n}</button>`).join('')}</div>` : ''}`
      : '';

  const amt = qAmount();
  const ready = Q.from && Q.to && Q.from !== Q.to && (!R.needCard || Q.card) && amt !== null && (amt > 0 || Q.reason === 'buy');
  const note = {
    rent: card ? `إيجار ${card.name}${card.level ? ' مع ' + levelWords(card.level) : ''}${!card.level && groupOf(card.group).type === 'street' && ownsFullSet(card) ? ' (ضعف — اللون كامل)' : ''}` : '',
    mort: card ? `${card.name} بتصير مرهونة` : '',
    unmort: card ? `فك رهن ${card.name} (القيمة + 10%)` : '',
    buy: card ? `${card.name} بتصير لـ ${nameOf(Q.from)}` : '',
    go: 'مرّ على خط البداية',
    custom: Q.note,
  }[Q.reason];
  const result = `<div class="qresult ${ready ? 'ready' : ''}">
    <div class="flow"><span>${Q.from ? esc(nameOf(Q.from)) : '؟'}</span><span>${I('arrow')}</span><span>${Q.to ? esc(nameOf(Q.to)) : '؟'}</span></div>
    <div class="amt">${amt === null ? '—' : fmt(amt)}</div>
    <small>${ready ? esc(note || '') + (Q.reason !== 'custom' && Q.reason !== 'buy' ? ' — الموقع حسبها لحاله' : '') : needDice && !num(Q.dice) ? 'اكتب مجموع النرد' : 'كمّل الاختيارات فوق'}</small></div>`;

  const scroll = $('#sheetOverlay').classList.contains('show') ? $('#sheet').scrollTop : 0;
  openSheet('عملية جديدة', `
    <div class="step"><span class="n">1</span>وش السبب؟</div>
    <div class="reasons">${REASONS.map(r => `<button class="${Q.reason === r.id ? 'on' : ''}" data-act="qReason" data-v="${r.id}">${I(r.icon)}<span>${r.name}</span></button>`).join('')}</div>
    <div class="step"><span class="n">2</span>من؟ <small>(اللي يدفع)</small></div>
    ${who('from', R.from, Q.from, Q.to)}
    <div class="arrow">${I('arrowDown')}</div>
    <div class="step"><span class="n">3</span>إلى؟ <small>(اللي ياخذ)</small></div>
    ${who('to', R.to, Q.to, Q.from)}
    ${cardStep}
    ${extra}
    ${result}
    <button class="btn" style="width:100%;margin-top:12px;font-size:18px" data-act="qDo" ${ready ? '' : 'disabled'}>${I('check')} تأكيد</button>`);
  $('#sheet').scrollTop = scroll;
}
function qDo() {
  const amt = qAmount(), p = Q.card && prop(Q.card), f = Q.from, t = Q.to;
  let ok = false;
  switch (Q.reason) {
    case 'rent': ok = transfer(f, t, amt, 'إيجار ' + p.name); break;
    case 'go': ok = transfer('bank', t, amt, 'خط البداية'); break;
    case 'custom': ok = transfer(f, t, amt, Q.note.trim()); break;
    case 'mort': ok = act(`${nameOf(t)} رهن ${p.name} وأخذ ${fmt(amt)}`, 'tag', () => { move('bank', t, amt); p.mortgaged = true; hint(`${I('tag')} اقلب بطاقة <b>${esc(p.name)}</b> على وجه «مرهونة»`); }); break;
    case 'unmort': ok = act(`${nameOf(f)} فك رهن ${p.name} ودفع ${fmt(amt)}`, 'unlock', () => { move(f, 'bank', amt); p.mortgaged = false; hint(`${I('unlock')} اقلب بطاقة <b>${esc(p.name)}</b> على الوجه العادي`); }); break;
    case 'buy': ok = act(`${nameOf(f)} اشترى ${p.name} من البنك بـ ${fmt(amt)}`, 'card', () => { move(f, 'bank', amt); p.owner = f; hint(`${I('card')} وأعطه بطاقة <b>${esc(p.name)}</b>`); }); break;
  }
  if (ok) closeSheet();
}
// نحفظ الكتابة بدون ما نعيد رسم الشاشة (عشان الكيبورد ما يسكر)
let noteTimer = null;
document.addEventListener('input', e => {
  const t = e.target;
  if (t.id !== 'pNote' && t.id !== 'gNote') return;
  if (t.id === 'pNote') { const p = player(t.dataset.id); if (p) p.note = t.value; }
  else G.notes = t.value;
  const hintEl = $(t.id === 'pNote' ? '#pNoteSaved' : '#gNoteSaved');
  if (hintEl) hintEl.textContent = 'يحفظ…';
  clearTimeout(noteTimer);
  noteTimer = setTimeout(() => { save(); if (hintEl) hintEl.textContent = 'انحفظت'; }, 500);
});
document.addEventListener('input', e => {
  if (!Q || !$('#sheetOverlay').classList.contains('show')) return;
  if (e.target.id === 'qAmt') { Q.amount = e.target.value; qRefreshResult(); }
  if (e.target.id === 'qNote') Q.note = e.target.value;
  if (e.target.id === 'qDice') { Q.dice = e.target.value; qRefreshResult(); }
});
function qRefreshResult() {
  const box = $('.qresult'); if (!box) return;
  const amt = qAmount(), R = qRules(Q.reason);
  const ready = Q.from && Q.to && Q.from !== Q.to && (!R.needCard || Q.card) && amt !== null && amt > 0;
  box.classList.toggle('ready', !!ready);
  box.querySelector('.amt').textContent = amt === null ? '—' : fmt(amt);
  $('[data-act=qDo]').disabled = !ready;
}

/* ---------------- السجن ---------------- */
function jailBar(p) {
  if (p.jail) {
    const last = p.jail >= 3;
    return `<div class="jail-bar ${last ? 'last' : ''}">
      <div class="jb-h">${I('lock')}<b>في السجن</b><span class="jb-turns">${[1, 2, 3].map(i => `<i class="${i <= p.jail ? 'on' : ''}"></i>`).join('')}</span>
        <small>${last ? 'آخر دور — لو ما جاب دبل يدفع ويطلع' : `الدور ${p.jail} من 3`}</small></div>
      <div class="jb-btns">
        ${last ? '' : `<button class="chip" data-act="jailTurn" data-id="${p.id}">${I('dice')} ما جاب دبل</button>`}
        <button class="chip" data-act="jailOut" data-id="${p.id}">${I('unlock')} جاب دبل</button>
        <button class="chip gold" data-act="jailPay" data-id="${p.id}">${I('cash')} دفع ${fmt(JAIL_FEE)} وطلع</button>
        ${p.note ? '' : `<button class="chip" data-act="playerNote" data-id="${p.id}">${I('pencil')} ملاحظة</button>`}
        ${p.freeCards ? `<button class="chip blue" data-act="jailCard" data-id="${p.id}">${I('card')} استخدم بطاقة الخروج (${p.freeCards})</button>` : ''}
      </div></div>`;
  }
  return `<div class="jail-mini">
    <button class="chip" data-act="jailIn" data-id="${p.id}">${I('lock')} دخل السجن</button>
    ${p.note ? '' : `<button class="chip" data-act="playerNote" data-id="${p.id}">${I('pencil')} ملاحظة</button>`}
    ${p.freeCards ? `<span class="chip on">${I('card')} معه بطاقة خروج ×${p.freeCards}</span>` : ''}</div>`;
}

/* ---------------- الدين والإفلاس ---------------- */
// قيمة البيت لما ينباع = نص سعره
const sellValue = q => Math.round(q.house / 2);
function canRaise(pid) {
  const mine = G.props.filter(q => q.owner === pid);
  const houses = mine.reduce((s, q) => s + (q.level ? q.level * sellValue(q) : 0), 0);
  const morts = mine.filter(q => !q.mortgaged).reduce((s, q) => s + q.mortgage, 0);
  return houses + morts;
}
function sheetDebt(pid) {
  const p = player(pid);
  if (!p || p.out) return;
  if (p.balance >= 0) { closeSheet(); return toast(`${p.name} سدّد الدين`); }
  const mine = G.props.filter(q => q.owner === pid);
  const withHouses = mine.filter(q => q.level > 0);
  const groupHasHouses = q => G.props.some(x => x.group === q.group && x.owner === pid && x.level > 0);
  const mortable = mine.filter(q => !q.mortgaged && !q.level);
  const raise = canRaise(pid), need = -p.balance;
  const to = p.debtTo || 'bank';
  const row = (q, btn) => `<div class="debt-row" style="--c:${groupOf(q.group).color}"><span class="dot"></span><span class="nm">${esc(q.name)} ${levelText(q.level)}</span>${btn}</div>`;
  openSheet(`${I('alert')} ${esc(p.name)} ما يكفيه`, `
    <div class="card debt-card">
      <div class="debt-big">عليه <b>${fmt(need)}</b></div>
      <p class="muted small" style="margin:4px 0 0">الدين لـ <b>${esc(nameOf(to))}</b> · يقدر يجمع لين <b>${fmt(raise)}</b> لو رهن وباع كل شي</p>
      ${raise < need ? `<p class="debt-warn">${I('alert')} حتى لو باع كل شي ما يكفيه — غالبا لازم يعلن إفلاسه</p>` : ''}
    </div>
    ${withHouses.length ? `<div class="card"><h3>${I('house')} يبيع بيوت <small class="muted">(البيت بنص سعره)</small></h3>
      ${withHouses.map(q => row(q, `<button class="btn sm" data-act="debtSell" data-id="${q.id}">بيع ${q.level === 5 ? 'الفندق' : 'بيت'} +${fmt(sellValue(q))}</button>`)).join('')}</div>` : ''}
    <div class="card"><h3>${I('tag')} يرهن بطاقة</h3>
      ${mortable.length ? mortable.map(q => row(q, groupHasHouses(q)
        ? `<span class="muted small">بيع بيوت اللون أول</span>`
        : `<button class="btn sm" data-act="debtMort" data-id="${q.id}">ارهن +${fmt(q.mortgage)}</button>`)).join('')
      : '<p class="muted small">ما عنده بطاقات ينفع يرهنها</p>'}</div>
    <div class="card bankrupt-card"><h3>${I('alert')} يعلن إفلاسه</h3>
      <p class="muted small" style="margin-top:0">يطلع من اللعبة، وكل فلوسه وبطاقاته تروح للي عليه الدين.</p>
      <label class="f">الدين لمين؟</label>${playerSelect('bkTo', pid, true, to)}
      <button class="btn danger" style="width:100%;margin-top:10px" data-act="bankrupt" data-id="${pid}">${I('alert')} أعلن إفلاس ${esc(p.name)}</button>
    </div>`);
  if (to === 'bank') $('#bkTo').value = 'bank';
}
function doBankrupt(pid, to) {
  const p = player(pid), c = to === 'bank' ? null : player(to);
  const mine = G.props.filter(q => q.owner === pid);
  const nCards = mine.length, nHouses = mine.reduce((s, q) => s + (q.level === 5 ? 0 : q.level), 0), nHotels = mine.filter(q => q.level === 5).length;
  act(`${p.name} أعلن إفلاسه${c ? ' لـ ' + c.name : ' للبنك'}`, 'alert', () => {
    // البيوت ترجع للبنك بنص سعرها
    mine.forEach(q => { if (q.level) { p.balance += q.level * sellValue(q); q.level = 0; } });
    if (c) {
      c.balance += p.balance;           // ياخذ كل اللي عنده (والناقص من الدين يروح)
      mine.forEach(q => { q.owner = c.id; });
    } else {
      mine.forEach(q => Object.assign(q, { owner: null, level: 0, mortgaged: false }));
    }
    p.balance = 0; p.out = true; p.outAt = Date.now(); p.outTo = to; p.jail = 0; p.debtTo = null;
    if (c && p.freeCards) { c.freeCards = (c.freeCards || 0) + p.freeCards; }
    p.freeCards = 0;
    const left = active();
    hint(`${c
      ? `خلّ <b>${esc(p.name)}</b> يعطي <b>${esc(c.name)}</b> كل فلوسه و${nCards} بطاقة${nCards ? ' (المرهونة تبقى مرهونة)' : ''}`
      : `خذ من <b>${esc(p.name)}</b> كل فلوسه و${nCards} بطاقة ورجّعها للبنك`}${nHouses || nHotels ? `، ورجّع ${nHouses ? nHouses + ' بيت' : ''}${nHouses && nHotels ? ' و' : ''}${nHotels ? nHotels + ' فندق' : ''} للبنك` : ''}
      ${left.length === 1 ? `<br><span class="winner">${I('crown')} <b>${esc(left[0].name)}</b> فاز باللعبة!</span>` : ''}`);
  });
}

/* ---------------- الأحداث ---------------- */
const val = id => $('#' + id)?.value ?? '';

const actions = {
  close: closeSheet,
  debt: d => sheetDebt(d.id),
  debtSell(d) {
    const q = prop(d.id), v = sellValue(q), owner = q.owner;
    act(`${nameOf(owner)} باع ${q.level === 5 ? 'الفندق' : 'بيت'} من ${q.name} عشان يسدد (+${fmt(v)})`, 'minus', () => {
      move('bank', owner, v); q.level -= 1;
      hint(q.level === 4 ? `خذ منه الفندق وأعطه 4 بيوت` : `خذ منه بيت من <b>${esc(q.name)}</b>`);
    });
    pendingDebt = null; hideInstructionLater(owner);
  },
  debtMort(d) {
    const q = prop(d.id), owner = q.owner;
    act(`${nameOf(owner)} رهن ${q.name} عشان يسدد (+${fmt(q.mortgage)})`, 'tag', () => {
      move('bank', owner, q.mortgage); q.mortgaged = true;
      hint(`اقلب بطاقة <b>${esc(q.name)}</b> على وجه «مرهونة»`);
    });
    pendingDebt = null; hideInstructionLater(owner);
  },
  bankrupt(d) {
    const p = player(d.id), to = val('bkTo') || 'bank';
    if (!confirm(`متأكد ${p.name} يعلن إفلاسه؟\nيطلع من اللعبة وكل شي عنده يروح لـ ${nameOf(to)}.\n(تقدر تتراجع بعدين)`)) return;
    closeSheet(); doBankrupt(d.id, to);
  },
  jailIn(d) {
    const p = player(d.id);
    act(`${p.name} دخل السجن`, 'lock', () => { p.jail = 1; });
  },
  jailTurn(d) {
    const p = player(d.id);
    act(`${p.name} ما جاب دبل — الدور ${p.jail + 1} في السجن`, 'lock', () => { p.jail = Math.min(3, p.jail + 1); });
  },
  jailOut(d) {
    const p = player(d.id);
    act(`${p.name} طلع من السجن`, 'unlock', () => { p.jail = 0; });
    if ($('#sheetOverlay').classList.contains('show')) sheetPlayer(d.id);
  },
  jailPay(d) {
    const p = player(d.id);
    act(`${p.name} دفع ${fmt(JAIL_FEE)} وطلع من السجن`, 'unlock', () => { move(p.id, 'bank', JAIL_FEE); p.jail = 0; });
  },
  jailCard(d) {
    const p = player(d.id);
    act(`${p.name} استخدم بطاقة الخروج من السجن`, 'unlock', () => {
      p.jail = 0; p.freeCards = Math.max(0, (p.freeCards || 0) - 1);
      hint(`خذ منه بطاقة «الخروج من السجن مجانا» ورجّعها تحت الكومة`);
    });
  },
  freeCard(d) {
    const p = player(d.id), dir = num(d.d);
    act(dir > 0 ? `${p.name} أخذ بطاقة خروج من السجن مجانا` : `${p.name} رجّع بطاقة الخروج من السجن`, 'card', () => {
      p.freeCards = Math.max(0, (p.freeCards || 0) + dir);
    });
    sheetPlayer(d.id);
  },
  quick: d => sheetQuick(d.from ? { from: d.from } : {}),
  qReason(d) { Q.reason = d.v; Q.card = null; Q.amount = ''; Q.dice = ''; qAuto(); renderQuick(); },
  qPick(d) {
    const side = d.side;
    Q[side] = Q[side] === d.v ? null : d.v;
    if (Q.reason === 'rent' && side === 'to') Q.card = null;
    qAuto(); renderQuick();
  },
  qCard(d) { Q.card = Q.card === d.v ? null : d.v; Q.amount = ''; qAuto(); renderQuick(); },
  qAdd(d) { Q.amount = String(num(Q.amount) + num(d.v)); renderQuick(); },
  qNoteSet(d) {
    Q.note = d.v;
    const t = TAXES.find(x => x.name === d.v);
    if (t) { Q.amount = String(t.amount); if (!Q.to) Q.to = 'bank'; }
    renderQuick();
  },
  qDo,
  undo,
  addPlayer() {
    const name = val('newPlayer').trim();
    if (!name) return toast('اكتب اسم اللاعب');
    const color = PCOLORS.find(c => !G.players.some(p => p.color === c)) || PCOLORS[G.players.length % PCOLORS.length];
    act(`انضم ${name} برصيد ${fmt(G.startMoney)}`, 'user', () => { G.players.push({ id: uid(), name, color, balance: G.startMoney }); });
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
    act(parts.join(' · ') || `تعديل ${name}`, 'pencil', () => { p.name = name; p.color = color; p.balance = bal; });
    closeSheet();
  },
  delPlayer(d) {
    const p = player(d.id);
    if (!confirm(`متأكد تحذف ${p.name}؟ بطاقاته ترجع للبنك.`)) return;
    act(`حذف اللاعب ${p.name} ورجعت بطاقاته للبنك`, 'trash', () => {
      G.props.forEach(q => { if (q.owner === p.id) Object.assign(q, { owner: null, level: 0, mortgaged: false }); });
      G.players = G.players.filter(x => x.id !== p.id);
    });
    closeSheet();
  },
  prop: d => sheetProp(d.id),
  buy(d) {
    const p = prop(d.id), b = val('bBuyer'), amt = num(val('bPrice'));
    act(`${nameOf(b)} اشترى ${p.name} من البنك بـ ${fmt(amt)}`, 'card', () => { move(b, 'bank', amt); p.owner = b; hint(`${I('card')} وأعطه بطاقة <b>${esc(p.name)}</b>`); });
    sheetProp(d.id);
  },
  give(d) {
    const p = prop(d.id), b = val('bBuyer');
    act(`البنك سلّم ${p.name} لـ ${nameOf(b)} بدون فلوس`, 'gift', () => { p.owner = b; hint(`${I('gift')} أعطِ ${esc(nameOf(b))} بطاقة <b>${esc(p.name)}</b>`); });
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
    act(`${nameOf(p.owner)} ${what} ${p.name}${pay ? ` (${dir > 0 ? '-' : '+'}${fmt(cost)})` : ''}`, dir > 0 ? 'house' : 'minus', () => {
      if (pay) dir > 0 ? move(p.owner, 'bank', cost) : move('bank', p.owner, cost);
      p.level = nl;
      hint(dir > 0
        ? (nl === 5 ? `${I('hotel')} أعطه فندق، وخذ منه الـ4 بيوت، وحطه على <b>${esc(p.name)}</b>` : `${I('house')} أعطه بيت يحطه على <b>${esc(p.name)}</b>`)
        : (nl === 4 ? `${I('hotel')} خذ منه الفندق، وأعطه 4 بيوت` : `${I('house')} خذ منه بيت من <b>${esc(p.name)}</b>`));
    });
    sheetProp(d.id);
  },
  mort(d) {
    const p = prop(d.id);
    act(`${nameOf(p.owner)} رهن ${p.name} وأخذ ${fmt(p.mortgage)}`, 'tag', () => { move('bank', p.owner, p.mortgage); p.mortgaged = true; hint(`${I('tag')} اقلب بطاقة <b>${esc(p.name)}</b> على وجه «مرهونة»`); });
    sheetProp(d.id);
  },
  unmort(d) {
    const p = prop(d.id), c = Math.round(p.mortgage * 1.1);
    act(`${nameOf(p.owner)} فك رهن ${p.name} ودفع ${fmt(c)}`, 'unlock', () => { move(p.owner, 'bank', c); p.mortgaged = false; hint(`${I('unlock')} اقلب بطاقة <b>${esc(p.name)}</b> على الوجه العادي`); });
    sheetProp(d.id);
  },
  trade(d) {
    const p = prop(d.id), to = val('tTo'), amt = num(val('tPrice')), from = p.owner;
    act(`انتقلت ${p.name} من ${nameOf(from)} إلى ${nameOf(to)}${amt ? ` مقابل ${fmt(amt)}` : ''}`, 'swap', () => {
      if (amt > 0) move(to, from, amt);
      p.owner = to;
      hint(`${I('card')} خلّ ${esc(nameOf(from))} يعطي بطاقة <b>${esc(p.name)}</b> لـ ${esc(nameOf(to))}`);
    });
    sheetProp(d.id);
  },
  toBank(d) {
    const p = prop(d.id);
    if (!confirm(`ترجع ${p.name} للبنك بدون فلوس؟`)) return;
    act(`رجعت ${p.name} من ${nameOf(p.owner)} للبنك`, 'bank', () => { hint(`${I('bank')} خذ بطاقة <b>${esc(p.name)}</b> من ${esc(nameOf(p.owner))} ورجعها للبنك`); Object.assign(p, { owner: null, level: 0, mortgaged: false }); });
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
      act(`تعديل بيانات ${name}`, 'pencil', () => { Object.assign(p, data); if (type !== 'street') p.level = 0; });
      changedType ? sheetEditProp(d.id) : sheetProp(d.id);
    } else {
      const id = uid();
      act(`إضافة بطاقة جديدة: ${name}`, 'plus', () => { G.props.push({ id, ...data, owner: null, level: 0, mortgaged: false }); });
      sheetProp(id);
    }
  },
  delProp(d) {
    const p = prop(d.id);
    if (!confirm(`تحذف بطاقة ${p.name}؟`)) return;
    act(`حذف بطاقة ${p.name}`, 'trash', () => { G.props = G.props.filter(q => q.id !== p.id); });
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
  openGame(d) { G = null; store.currentId = d.id; openGame(d.id); tab = 'players'; render(); toast('فتحت' + G.name); },
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
    save(); render(); toast('بدأت لعبة جديدة');
  },
  saveSettings() {
    G.name = val('setName').trim() || G.name;
    G.startMoney = num(val('setStart')) || G.startMoney;
    G.goAmount = num(val('setGo')) || G.goAmount;
    G.currency = val('setCur').trim();
    save(); render(); toast('انحفظت الإعدادات');
  },
  device(d) { setDevice(d.v); render(); toast('صار الشكل على: ' + (d.v === 'auto' ? 'تلقائي (' + DEVICES[window.AUTO_DEVICE] + ')' : DEVICES[d.v])); },
  export: exportAll,
  import: () => $('#importInput').click(),
  async forceUpdate() {
    toast('يجيب آخر نسخة…');
    try {
      if ('serviceWorker' in navigator) for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
      if (window.caches) for (const k of await caches.keys()) await caches.delete(k);
    } catch (e) { }
    location.replace(location.pathname + '?u=' + Date.now());
  },
  playerNote(d) {
    sheetPlayer(d.id);
    setTimeout(() => { const t = $('#pNote'); if (t) { t.scrollIntoView({ block: 'center' }); t.focus(); } }, 80);
  },
  gotoNotes() { tab = 'more'; render(); setTimeout(() => { $('#notesCard')?.scrollIntoView({ block: 'center' }); $('#gNote')?.focus(); }, 50); },
  gotoGames() { tab = 'more'; render(); setTimeout(() => $('.game-item')?.scrollIntoView({ block: 'center' }), 50); },
  async wipeGame() {
    const n = G.players.length;
    if (!confirm(`تحذف كل شي في "${G.name}"؟\n\nبينحذف: ${n} لاعب، وكل الفلوس، والبطاقات ترجع للبنك، والسجل، والملاحظات، وصور الطاولة.\n\nنصيحة: احفظ نسخة في ملف قبل.`)) return;
    if (!confirm('متأكد؟ ما تقدر ترجعها بعدين.')) return;
    for (const ph of G.photos) await idb.del(ph.id).catch(() => { });
    G.players = []; G.log = []; G.photos = []; G.notes = '';
    G.props.forEach(p => Object.assign(p, { owner: null, level: 0, mortgaged: false }));
    setUndo([]);
    tab = 'players'; save(); render(); window.scrollTo(0, 0);
    toast('انحذف كل شي — اللعبة صارت فاضية');
  },
  resetGame() {
    if (!confirm('ترجع كل اللاعبين لفلوس البداية وكل البطاقات للبنك؟ (تقدر تتراجع)')) return;
    act('إعادة اللعبة من الصفر', 'refresh', () => {
      G.players.forEach(p => p.balance = G.startMoney);
      G.props.forEach(p => Object.assign(p, { owner: null, level: 0, mortgaged: false }));
    });
  },
  resetProps() {
    if (!confirm('ترجع البطاقات للأسماء والأسعار الأصلية؟ تعديلاتك على البطاقات بتروح، والبطاقات ترجع للبنك.')) return;
    act('رجعت البطاقات الأصلية', 'card', () => {
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
  if ($('#instrOverlay').classList.contains('show') && (e.key === 'Escape' || e.key === 'Enter')) { e.preventDefault(); return hideInstruction(); }
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

$$('[data-ic]').forEach(e => { e.innerHTML = I(e.dataset.ic); });
calcInit();
render();

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  // لما تنزل نسخة جديدة من الموقع، الصفحة تتحدث لحالها مرة وحدة
  const hadController = !!navigator.serviceWorker.controller;
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController && !reloaded) { reloaded = true; location.reload(); }
  });
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(r => r.update()).catch(() => { });
}
