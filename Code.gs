/**
 * 知識群島：班級個人挑戰系統（Google 試算表 + Apps Script）
 *
 * 試算表就是資料庫：
 *   設定      老師密碼、每回合題數、過關門檻
 *   班級      每一屆／每一班一列，記錄已教單元
 *   學生      每位學生一列：金幣、星星、印章、連續天數
 *   題庫      所有題目，依 年級＋學期＋科目＋單元 分類，每一屆共用
 *   作答紀錄  每一題作答都記一列，用來算錯題本與弱點單元
 *   加點紀錄  老師兌換印章（日常加點）的紀錄
 *
 * 第一次使用：在 Apps Script 編輯器選擇函式 setup 並執行。
 */

const SH = { SET: '設定', CLS: '班級', STU: '學生', Q: '題庫', LOG: '作答紀錄', PTS: '加點紀錄' };
const HEAD = {
  '班級': ['班級代碼', '班級名稱', '年級', '學期', '已教單元', '狀態', '建立日期'],
  '學生': ['班級代碼', '座號', '暱稱', '密碼', '金幣', '星星', '印章', '已兌換印章', '連續天數', '最後完成日', '總答題', '答對題'],
  '題庫': ['題號', '年級', '學期', '科目', '單元', '題型', '題目', '選項A', '選項B', '選項C', '選項D', '答案', '解析', '來源', '啟用'],
  '作答紀錄': ['時間', '日期', '班級代碼', '座號', '題號', '科目', '單元', '作答', '對錯'],
  '加點紀錄': ['時間', '班級代碼', '座號', '兌換印章數', '備註']
};
// 這些欄位一律存成純文字，避免 0123、3/4 被試算表自動轉成數字或日期
const TEXT_COLS = {
  '班級': ['班級代碼', '班級名稱', '學期', '已教單元', '狀態', '建立日期'],
  '學生': ['班級代碼', '暱稱', '密碼', '最後完成日'],
  '題庫': HEAD['題庫'].filter(h => h !== '年級'),
  '作答紀錄': ['時間', '日期', '班級代碼', '題號', '作答'],
  '加點紀錄': ['時間', '班級代碼', '備註']
};
const SUBJECTS = ['國語', '數學', '自然', '社會', '英文'];
const TZ = 'Asia/Taipei';

/* ---------- 網頁入口 ---------- */

function doGet(e) {
  const teacher = e && e.parameter && e.parameter.page === 'teacher';
  return HtmlService.createHtmlOutputFromFile(teacher ? 'Teacher' : 'Index')
    .setTitle(teacher ? '知識群島 教師後台' : '知識群島')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
}

/* ---------- 初始化 ---------- */

function setup() {
  const ss = ss_();
  Object.keys(HEAD).forEach(name => {
    let sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    if (sh.getLastRow() === 0) sh.getRange(1, 1, 1, HEAD[name].length).setValues([HEAD[name]]);
    sh.setFrozenRows(1);
    (TEXT_COLS[name] || []).forEach(col => {
      const c = HEAD[name].indexOf(col) + 1;
      sh.getRange(1, c, sh.getMaxRows(), 1).setNumberFormat('@');
    });
  });
  let set = ss.getSheetByName(SH.SET);
  if (!set) set = ss.insertSheet(SH.SET, 0);
  if (set.getLastRow() === 0) {
    set.getRange(1, 1, 4, 3).setValues([
      ['項目', '值', '說明'],
      ['老師密碼', 'teacher' + Math.floor(1000 + Math.random() * 9000), '進入教師後台用，請改成自己的密碼'],
      ['每回合題數', 10, '每次上島挑戰的題數'],
      ['過關門檻', 0.7, '答對比例達到這個值才算過關（得星星和今日印章）']
    ]);
    set.getRange('B2').setNumberFormat('@');
  }
  if (table_(SH.Q).rows.length === 0) append_(SH.Q, sampleQuestions_());
  if (!table_(SH.CLS).rows.some(r => r['班級代碼'] === 'DEMO')) {
    const units = unitCatalog_().map(u => u.key);
    append_(SH.CLS, [{ '班級代碼': 'DEMO', '班級名稱': '示範班', '年級': 6, '學期': '上', '已教單元': JSON.stringify(units), '狀態': '進行中', '建立日期': today_() }]);
    append_(SH.STU, [1, 2, 3].map(n => newStudent_('DEMO', n)));
  }
  const pw = settings_()['老師密碼'];
  Logger.log('完成！老師密碼是：' + pw + '（可以在「設定」分頁修改）');
}

/* ---------- 學生 API ---------- */

function studentLogin(cred) {
  return withLock_(() => {
    const { cls, s } = auth_(cred, true);
    return state_(cls, s);
  });
}

function getRound(cred, island) {
  const { cls, s } = auth_(cred, false);
  const n = Number(settings_()['每回合題數']) || 10;
  const pool = pool_(cls);
  const hist = history_(cls['班級代碼'], s['座號']);
  let picked;
  if (SUBJECTS.indexOf(island) >= 0) {
    const sub = pool.filter(q => q['科目'] === island);
    const wrong = shuffle_(sub.filter(q => hist[q['題號']] && !hist[q['題號']].last));
    const fresh = shuffle_(sub.filter(q => !hist[q['題號']]));
    const done = shuffle_(sub.filter(q => hist[q['題號']] && hist[q['題號']].last));
    picked = wrong.slice(0, 3).concat(fresh, wrong.slice(3), done).slice(0, n);
  } else if (island === '錯題') {
    picked = shuffle_(pool.filter(q => hist[q['題號']] && !hist[q['題號']].last)).slice(0, n);
  } else if (island === '綜合') {
    const by = SUBJECTS.map(sj => shuffle_(pool.filter(q => q['科目'] === sj)));
    picked = [];
    for (let i = 0; picked.length < n && by.some(b => b.length); i = (i + 1) % by.length) {
      if (by[i].length) picked.push(by[i].shift());
    }
  } else {
    throw new Error('沒有這座島。');
  }
  if (!picked.length) throw new Error(island === '錯題' ? '錯題本是空的，太厲害了！' : '這座島還沒有開放的題目，等老師上完課再來。');
  return shuffle_(picked).map(publicQ_);
}

function submitRound(cred, island, responses) {
  return withLock_(() => {
    const { cls, s, t } = auth_(cred, false);
    const set = settings_();
    const qmap = {};
    table_(SH.Q).rows.forEach(q => qmap[q['題號']] = q);
    const now = new Date();
    const stamp = Utilities.formatDate(now, TZ, 'yyyy-MM-dd HH:mm:ss');
    const day = today_();
    const logs = [];
    let correct = 0;
    (responses || []).slice(0, 50).forEach(r => {
      const q = qmap[r.id];
      if (!q) return;
      const ok = grade_(q, r.answer);
      if (ok) correct++;
      logs.push({ '時間': stamp, '日期': day, '班級代碼': cls['班級代碼'], '座號': s['座號'], '題號': q['題號'], '科目': q['科目'], '單元': q['單元'], '作答': String(r.answer == null ? '' : r.answer).slice(0, 100), '對錯': ok ? 1 : 0 });
    });
    const total = logs.length;
    if (!total) throw new Error('沒有收到作答。');
    append_(SH.LOG, logs);

    const passed = correct / total >= (Number(set['過關門檻']) || 0.7);
    const last = normDate_(s['最後完成日']);
    let gotStamp = false;
    if (passed && last !== day) {
      gotStamp = true;
      s['連續天數'] = last === yesterday_() ? num_(s['連續天數']) + 1 : 1;
      s['最後完成日'] = day;
      s['印章'] = num_(s['印章']) + 1;
    }
    s['金幣'] = num_(s['金幣']) + correct;
    if (passed) s['星星'] = num_(s['星星']) + 1;
    s['總答題'] = num_(s['總答題']) + total;
    s['答對題'] = num_(s['答對題']) + correct;
    writeRow_(t, s);
    return { correct, total, passed, coins: correct, star: passed, stamp: gotStamp, state: state_(cls, s) };
  });
}

/* ---------- 老師 API ---------- */

function tLogin(pw) {
  checkPw_(pw);
  return {
    classes: table_(SH.CLS).rows.map(c => ({ code: c['班級代碼'], name: c['班級名稱'], grade: c['年級'], sem: c['學期'], status: c['狀態'] })),
    url: ScriptApp.getService().getUrl()
  };
}

function tDashboard(pw, code) {
  checkPw_(pw);
  const cls = findClass_(code);
  const students = table_(SH.STU).rows.filter(r => sameCode_(r['班級代碼'], code));
  const logs = table_(SH.LOG).rows.filter(r => sameCode_(r['班級代碼'], code));
  const week = Utilities.formatDate(new Date(Date.now() - 6 * 864e5), TZ, 'yyyy-MM-dd');
  const qmap = {};
  table_(SH.Q).rows.forEach(q => qmap[q['題號']] = q);

  const per = {}, unitStat = {}, qStat = {};
  logs.forEach(l => {
    const seat = Number(l['座號']);
    const p = per[seat] = per[seat] || { days: {}, latest: {} };
    const d = normDate_(l['日期']);
    if (d >= week) p.days[d] = 1;
    p.latest[l['題號']] = Number(l['對錯']) === 1;
    const uk = l['科目'] + '｜' + l['單元'];
    const u = unitStat[uk] = unitStat[uk] || { unit: uk, right: 0, total: 0 };
    u.total++; u.right += Number(l['對錯']) === 1 ? 1 : 0;
    const qs = qStat[l['題號']] = qStat[l['題號']] || { wrong: 0, total: 0 };
    qs.total++; if (Number(l['對錯']) !== 1) qs.wrong++;
  });

  return {
    cls: classOut_(cls),
    url: ScriptApp.getService().getUrl() + '?c=' + encodeURIComponent(cls['班級代碼']),
    students: students.map(s => {
      const p = per[Number(s['座號'])] || { days: {}, latest: {} };
      return {
        seat: Number(s['座號']), nick: s['暱稱'] || '', hasPin: !!String(s['密碼']).trim(),
        coins: num_(s['金幣']), stars: num_(s['星星']),
        stamps: num_(s['印章']) - num_(s['已兌換印章']), stampsTotal: num_(s['印章']),
        streak: liveStreak_(s), last: normDate_(s['最後完成日']),
        weekDays: Object.keys(p.days).length,
        total: num_(s['總答題']), right: num_(s['答對題']),
        wrongNow: Object.keys(p.latest).filter(k => !p.latest[k]).length
      };
    }).sort((a, b) => a.seat - b.seat),
    units: unitCatalog_(),
    weakUnits: Object.keys(unitStat).map(k => unitStat[k]).filter(u => u.total >= 5)
      .sort((a, b) => a.right / a.total - b.right / b.total).slice(0, 6),
    hardQs: Object.keys(qStat).filter(id => qmap[id] && qStat[id].total >= 3)
      .map(id => ({ id, text: qmap[id]['題目'], subject: qmap[id]['科目'], unit: qmap[id]['單元'], answer: qmap[id]['答案'], wrong: qStat[id].wrong, total: qStat[id].total }))
      .sort((a, b) => b.wrong / b.total - a.wrong / a.total).slice(0, 8)
  };
}

function tSaveClass(pw, code, data) {
  checkPw_(pw);
  return withLock_(() => {
    const t = table_(SH.CLS);
    const c = t.rows.find(r => sameCode_(r['班級代碼'], code));
    if (!c) throw new Error('找不到班級。');
    if (data.units) c['已教單元'] = JSON.stringify(data.units);
    if (data.name) c['班級名稱'] = data.name;
    if (data.grade) c['年級'] = Number(data.grade);
    if (data.sem) c['學期'] = data.sem;
    if (data.status) c['狀態'] = data.status;
    writeRow_(t, c);
    return classOut_(c);
  });
}

function tCreateClass(pw, data) {
  checkPw_(pw);
  return withLock_(() => {
    const code = String(data.code || '').trim().toUpperCase();
    if (!/^[A-Z0-9]{3,12}$/.test(code)) throw new Error('班級代碼請用 3 到 12 個英文字母或數字，例如 115A601。');
    if (table_(SH.CLS).rows.some(r => sameCode_(r['班級代碼'], code))) throw new Error('這個班級代碼已經有人用了。');
    const count = Math.min(Math.max(Number(data.count) || 0, 1), 60);
    append_(SH.CLS, [{ '班級代碼': code, '班級名稱': data.name || code, '年級': Number(data.grade) || 6, '學期': data.sem || '上', '已教單元': '[]', '狀態': '進行中', '建立日期': today_() }]);
    const list = [];
    for (let i = 1; i <= count; i++) list.push(newStudent_(code, i));
    append_(SH.STU, list);
    return tLogin(pw);
  });
}

function tAddStudents(pw, code, count) {
  checkPw_(pw);
  return withLock_(() => {
    findClass_(code);
    const seats = table_(SH.STU).rows.filter(r => sameCode_(r['班級代碼'], code)).map(r => Number(r['座號']));
    const start = seats.length ? Math.max.apply(null, seats) + 1 : 1;
    const list = [];
    for (let i = 0; i < Math.min(Number(count) || 1, 20); i++) list.push(newStudent_(code, start + i));
    append_(SH.STU, list);
    return list.length;
  });
}

function tResetPin(pw, code, seat) {
  checkPw_(pw);
  return withLock_(() => {
    const t = table_(SH.STU);
    const s = t.rows.find(r => sameCode_(r['班級代碼'], code) && Number(r['座號']) === Number(seat));
    if (!s) throw new Error('找不到這位學生。');
    s['密碼'] = '';
    writeRow_(t, s);
    return true;
  });
}

/** 兌換印章：把學生目前累積、還沒加過點的印章歸零，並記到「加點紀錄」 */
function tRedeem(pw, code, seats, note) {
  checkPw_(pw);
  return withLock_(() => {
    const t = table_(SH.STU);
    const want = (seats || []).map(Number);
    const stamp = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss');
    const out = [];
    t.rows.forEach(s => {
      if (!sameCode_(s['班級代碼'], code) || want.indexOf(Number(s['座號'])) < 0) return;
      const n = num_(s['印章']) - num_(s['已兌換印章']);
      if (n <= 0) return;
      s['已兌換印章'] = num_(s['印章']);
      writeRow_(t, s);
      out.push({ '時間': stamp, '班級代碼': s['班級代碼'], '座號': s['座號'], '兌換印章數': n, '備註': note || '' });
    });
    append_(SH.PTS, out);
    return out.map(o => ({ seat: Number(o['座號']), n: o['兌換印章數'] }));
  });
}

/**
 * 匯入題目。可貼上 CSV 或從試算表複製的表格（Tab 分隔）。
 * 欄位順序：年級, 學期, 科目, 單元, 題型, 題目, 選項A, 選項B, 選項C, 選項D, 答案, 解析
 */
function tImport(pw, text, source) {
  checkPw_(pw);
  return withLock_(() => {
    const lines = parseTable_(String(text || ''));
    const rows = [], errors = [];
    const base = Utilities.formatDate(new Date(), TZ, 'yyMMddHHmmss');
    lines.forEach((cells, i) => {
      if (!cells.join('').trim()) return;
      if (i === 0 && String(cells[0]).indexOf('年級') >= 0) return; // 標題列
      const [grade, sem, subject, unit, type, text, a, b, c, d, answer, explain] = cells.map(x => String(x == null ? '' : x).trim());
      const msg = validateQ_({ grade, sem, subject, unit, type, text, a, b, answer });
      if (msg) { errors.push('第 ' + (i + 1) + ' 行：' + msg); return; }
      rows.push({ '題號': 'Q' + base + ('00' + rows.length).slice(-3), '年級': Number(grade), '學期': sem.replace('學期', ''), '科目': subject, '單元': unit, '題型': type, '題目': text, '選項A': a, '選項B': b, '選項C': c, '選項D': d, '答案': answer, '解析': explain || '', '來源': source || '老師', '啟用': 'Y' });
    });
    append_(SH.Q, rows);
    return { added: rows.length, errors: errors.slice(0, 30) };
  });
}

/* ---------- 內部工具 ---------- */

function ss_() { return SpreadsheetApp.getActive(); }

function table_(name) {
  const sh = ss_().getSheetByName(name);
  if (!sh) throw new Error('找不到「' + name + '」分頁，請先執行 setup。');
  const v = sh.getDataRange().getValues();
  const h = (v.shift() || []).map(String);
  return { sh, h, rows: v.map((r, i) => { const o = { _row: i + 2 }; h.forEach((k, j) => o[k] = r[j]); return o; }) };
}

function writeRow_(t, o) {
  t.sh.getRange(o._row, 1, 1, t.h.length).setValues([t.h.map(k => o[k] === undefined || o[k] === null ? '' : o[k])]);
}

function append_(name, objs) {
  if (!objs || !objs.length) return;
  const sh = ss_().getSheetByName(name);
  const h = HEAD[name];
  const last = sh.getLastRow();
  const need = last + objs.length - sh.getMaxRows();
  if (need > 0) sh.insertRowsAfter(sh.getMaxRows(), need + 500);
  sh.getRange(last + 1, 1, objs.length, h.length).setValues(objs.map(o => h.map(k => o[k] === undefined || o[k] === null ? '' : o[k])));
}

function settings_() {
  const sh = ss_().getSheetByName(SH.SET);
  const out = {};
  if (sh) sh.getDataRange().getValues().forEach(r => out[String(r[0]).trim()] = r[1]);
  return out;
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); } finally { lock.releaseLock(); }
}

function checkPw_(pw) {
  const real = String(settings_()['老師密碼'] || '').trim();
  if (!real || String(pw || '').trim() !== real) throw new Error('老師密碼不正確。');
}

function sameCode_(a, b) { return String(a).trim().toUpperCase() === String(b).trim().toUpperCase(); }
function num_(v) { const n = Number(v); return isNaN(n) ? 0 : n; }
function today_() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd'); }
function yesterday_() { return Utilities.formatDate(new Date(Date.now() - 864e5), TZ, 'yyyy-MM-dd'); }
function normDate_(v) { return v instanceof Date ? Utilities.formatDate(v, TZ, 'yyyy-MM-dd') : String(v || '').trim(); }
function cellText_(v) { return v instanceof Date ? Utilities.formatDate(v, TZ, 'M/d') : String(v == null ? '' : v).trim(); }

function findClass_(code) {
  const c = table_(SH.CLS).rows.find(r => sameCode_(r['班級代碼'], code));
  if (!c) throw new Error('找不到班級代碼「' + code + '」。');
  return c;
}

function classOut_(c) {
  let units = [];
  try { units = JSON.parse(c['已教單元'] || '[]'); } catch (e) { }
  return { code: c['班級代碼'], name: c['班級名稱'], grade: c['年級'], sem: c['學期'], status: c['狀態'], units };
}

function newStudent_(code, seat) {
  return { '班級代碼': code, '座號': seat, '暱稱': '', '密碼': '', '金幣': 0, '星星': 0, '印章': 0, '已兌換印章': 0, '連續天數': 0, '最後完成日': '', '總答題': 0, '答對題': 0 };
}

function auth_(cred, allowSetPin) {
  cred = cred || {};
  const cls = findClass_(cred.code);
  if (cls['狀態'] !== '進行中') throw new Error('這個班級已經結業封存了。');
  const t = table_(SH.STU);
  const s = t.rows.find(r => sameCode_(r['班級代碼'], cred.code) && Number(r['座號']) === Number(cred.seat));
  if (!s) throw new Error('這個班級沒有 ' + cred.seat + ' 號，請跟老師確認。');
  const pin = String(s['密碼']).trim();
  const given = String(cred.pin || '').trim();
  if (!pin) {
    if (!allowSetPin) throw new Error('請重新登入。');
    if (!/^\d{4}$/.test(given)) throw new Error('第一次登入請自己設定 4 位數字密碼。');
    s['密碼'] = given;
    if (cred.nick) s['暱稱'] = String(cred.nick).trim().slice(0, 10);
    writeRow_(t, s);
  } else if (pin !== given) {
    throw new Error('密碼不對喔。忘記的話請老師幫你重設。');
  }
  return { cls, s, t };
}

function liveStreak_(s) {
  const last = normDate_(s['最後完成日']);
  return (last === today_() || last === yesterday_()) ? num_(s['連續天數']) : 0;
}

function unitKey_(q) { return q['年級'] + String(q['學期']) + '｜' + q['科目'] + '｜' + q['單元']; }

function unitCatalog_() {
  const m = {};
  table_(SH.Q).rows.forEach(q => {
    if (!q['題號'] || String(q['啟用']).toUpperCase() === 'N') return;
    const k = unitKey_(q);
    m[k] = m[k] || { key: k, grade: Number(q['年級']), sem: String(q['學期']), subject: q['科目'], unit: q['單元'], count: 0 };
    m[k].count++;
  });
  return Object.keys(m).map(k => m[k]).sort((a, b) =>
    a.grade - b.grade || a.sem.localeCompare(b.sem) || SUBJECTS.indexOf(a.subject) - SUBJECTS.indexOf(b.subject));
}

function pool_(cls) {
  let units = [];
  try { units = JSON.parse(cls['已教單元'] || '[]'); } catch (e) { }
  const set = {};
  units.forEach(u => set[u] = 1);
  return table_(SH.Q).rows.filter(q => q['題號'] && String(q['啟用']).toUpperCase() !== 'N' && set[unitKey_(q)]);
}

/** 每一題最近一次的作答結果：{ 題號: { last: true/false } } */
function history_(code, seat) {
  const h = {};
  table_(SH.LOG).rows.forEach(l => {
    if (!sameCode_(l['班級代碼'], code) || Number(l['座號']) !== Number(seat)) return;
    h[l['題號']] = { last: Number(l['對錯']) === 1 };
  });
  return h;
}

function state_(cls, s) {
  const pool = pool_(cls);
  const hist = history_(cls['班級代碼'], s['座號']);
  const islands = {};
  SUBJECTS.forEach(sj => islands[sj] = { total: 0, mastered: 0 });
  let wrong = 0;
  pool.forEach(q => {
    const it = islands[q['科目']];
    const h = hist[q['題號']];
    if (it) { it.total++; if (h && h.last) it.mastered++; }
    if (h && !h.last) wrong++;
  });
  return {
    className: cls['班級名稱'], seat: Number(s['座號']), nick: s['暱稱'] || '',
    coins: num_(s['金幣']), stars: num_(s['星星']), stamps: num_(s['印章']),
    streak: liveStreak_(s), todayDone: normDate_(s['最後完成日']) === today_(),
    islands, wrong, perRound: Number(settings_()['每回合題數']) || 10
  };
}

function publicQ_(q) {
  const options = ['選項A', '選項B', '選項C', '選項D'].map(k => cellText_(q[k])).filter(Boolean);
  return { id: q['題號'], subject: q['科目'], unit: q['單元'], type: q['題型'], text: cellText_(q['題目']), options, answer: cellText_(q['答案']), explain: cellText_(q['解析']) };
}

function normAns_(v) {
  return String(v == null ? '' : v)
    .replace(/[！-～]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
    .replace(/\s+/g, '').toLowerCase();
}

function grade_(q, ans) {
  const type = String(q['題型']).trim();
  const right = cellText_(q['答案']);
  if (type === '選擇') return normAns_(ans).toUpperCase() === normAns_(right).toUpperCase();
  if (type === '是非') return tf_(ans) !== null && tf_(ans) === tf_(right);
  return right.split('|').some(r => normAns_(r) === normAns_(ans) && normAns_(r) !== '');
}

function tf_(v) {
  const s = normAns_(v);
  if (['o', '○', '對', '是', 't', 'true', 'y', '⭕'].indexOf(s) >= 0) return 'O';
  if (['x', '╳', '×', '錯', '否', 'f', 'false', 'n', '❌'].indexOf(s) >= 0) return 'X';
  return null;
}

function validateQ_(q) {
  if (!/^[1-6]$/.test(q.grade)) return '年級要填 1 到 6';
  if (!/^[上下]/.test(q.sem)) return '學期要填「上」或「下」';
  if (SUBJECTS.indexOf(q.subject) < 0) return '科目要是 ' + SUBJECTS.join('、') + ' 其中之一';
  if (!q.unit) return '缺少單元名稱';
  if (!q.text) return '缺少題目';
  if (['選擇', '是非', '填空'].indexOf(q.type) < 0) return '題型要是 選擇、是非、填空';
  if (!q.answer) return '缺少答案';
  if (q.type === '選擇' && (!q.a || !q.b)) return '選擇題至少要有選項A和選項B';
  if (q.type === '選擇' && !/^[A-Da-d]$/.test(q.answer)) return '選擇題答案請填 A、B、C 或 D';
  if (q.type === '是非' && tf_(q.answer) === null) return '是非題答案請填 O 或 X';
  return '';
}

function parseTable_(text) {
  const tab = text.indexOf('\t') >= 0;
  const sep = tab ? '\t' : ',';
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"' && cell === '') q = true;
    else if (ch === sep) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

function shuffle_(a) {
  a = a.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; }
  return a;
}

function sampleQuestions_() {
  const raw = [
    ['國語', '詞語運用', '選擇', '「他做事總是半途而廢」中的「半途而廢」是什麼意思？', '做到一半就放棄', '走路走到一半', '把東西丟掉一半', '只做一半的工作量', 'A', '比喻做事不能堅持到底。'],
    ['國語', '詞語運用', '選擇', '下列哪一個詞語用得正確？', '他的成績一落千丈，大家都很羨慕', '這幅畫栩栩如生，好像真的一樣', '他說話語無倫次，條理分明', '比賽結果出爐，大家都忐忑不安地慶祝', 'B', '栩栩如生：形容藝術作品逼真生動。'],
    ['國語', '修辭', '是非', '「月亮害羞地躲進雲裡」用了擬人法。', '', '', '', '', 'O', '把月亮當成人來寫，會「害羞」。'],
    ['國語', '修辭', '填空', '「時間就像流水，一去不回頭」使用的修辭法是（　）法。', '', '', '', '', '譬喻|明喻', '有「像」把時間比喻成流水，是譬喻（明喻）。'],
    ['數學', '分數除法', '填空', '3/4 ÷ 1/2 = ？（用最簡分數或帶分數作答）', '', '', '', '', '3/2|1又1/2|1 1/2|1.5', '3/4 × 2 = 6/4 = 3/2。'],
    ['數學', '分數除法', '選擇', '一條 5/6 公尺的緞帶，每 1/6 公尺剪一段，可以剪幾段？', '4 段', '5 段', '6 段', '30 段', 'B', '5/6 ÷ 1/6 = 5。'],
    ['數學', '圓面積', '填空', '半徑 10 公分的圓，面積是多少平方公分？（圓周率用 3.14）', '', '', '', '', '314', '10 × 10 × 3.14 = 314。'],
    ['數學', '圓面積', '是非', '圓的直徑是半徑的 2 倍。', '', '', '', '', 'O', ''],
    ['自然', '天氣變化', '選擇', '颱風來臨前，氣壓通常會怎麼變化？', '變高', '變低', '不變', '忽高忽低', 'B', '颱風是低氣壓系統。'],
    ['自然', '天氣變化', '是非', '鋒面通過時，常常會帶來降雨。', '', '', '', '', 'O', ''],
    ['自然', '熱對物質的影響', '選擇', '鐵軌之間要留一點縫隙，主要是為了什麼？', '省材料', '排水', '預留熱脹冷縮的空間', '讓火車跑得更快', 'C', '夏天鐵軌受熱膨脹，需要空間。'],
    ['自然', '熱對物質的影響', '填空', '熱的傳播方式有傳導、對流和（　）。', '', '', '', '', '輻射', ''],
    ['社會', '地方自治', '選擇', '下列哪一位是由人民直接選出來的？', '鄉（鎮、市）長', '學校校長', '警察局長', '法官', 'A', '地方首長由居民投票選出。'],
    ['社會', '地方自治', '是非', '在臺灣，年滿 18 歲就可以參加總統選舉投票。', '', '', '', '', 'X', '總統選舉投票年齡目前是年滿 20 歲。'],
    ['社會', '臺灣的地理', '選擇', '臺灣最高的山是哪一座？', '雪山', '玉山', '阿里山', '合歡山', 'B', '玉山主峰約 3952 公尺。'],
    ['社會', '臺灣的地理', '填空', '臺灣最長的河流是（　）溪。', '', '', '', '', '濁水', ''],
    ['英文', 'Unit 1 單字', '選擇', '"I usually ____ to school by bus."', 'go', 'goes', 'going', 'went', 'A', '主詞 I 用原形動詞。'],
    ['英文', 'Unit 1 單字', '填空', '「圖書館」的英文是？', '', '', '', '', 'library', ''],
    ['英文', 'Unit 2 時態', '選擇', '"She ____ TV last night."', 'watch', 'watches', 'watched', 'watching', 'C', 'last night 表示過去，用過去式。'],
    ['英文', 'Unit 2 時態', '是非', '"He don\'t like apples." 這句話文法正確。', '', '', '', '', 'X', '應該是 He doesn\'t like apples.']
  ];
  return raw.map((r, i) => ({ '題號': 'S' + ('00' + (i + 1)).slice(-3), '年級': 6, '學期': '上', '科目': r[0], '單元': r[1], '題型': r[2], '題目': r[3], '選項A': r[4], '選項B': r[5], '選項C': r[6], '選項D': r[7], '答案': r[8], '解析': r[9], '來源': '範例', '啟用': 'Y' }));
}
