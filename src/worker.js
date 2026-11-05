/**
 * 知識群島：Cloudflare Worker 後端
 *
 * 網頁（public/）由 Cloudflare 直接提供；/api/<名稱> 由這支程式處理。
 * 計分、金幣、買東西、換點都在這裡計算，學生無法從瀏覽器竄改。
 *
 * 呼叫方式：POST /api/<名稱>，內容為 JSON：{ "args": [...] }
 * 回覆：{ "ok": 結果 } 或 { "err": "錯誤訊息" }
 */

const SUBJECTS = ['國語', '數學', '自然', '社會', '英文'];
const COMMON = '通用';
const MAX_FAILS = 5;          // 密碼連續錯幾次就暫時鎖住
const LOCK_MS = 10 * 60e3;    // 鎖住 10 分鐘
const TEACHER_MAX_FAILS = 10; // 老師密碼：同一個網路位址錯 10 次才鎖，而且只鎖那個位址

/** 金幣商店：幫船長波波換裝。價格只在這裡設定 */
const SHOP = {
  hat_sailor: { slot: 'hat', name: '水手帽', price: 0 },
  hat_flower: { slot: 'hat', name: '小花髮夾', price: 20 },
  hat_bow: { slot: 'hat', name: '蝴蝶結', price: 25 },
  hat_straw: { slot: 'hat', name: '草帽', price: 30 },
  hat_pirate: { slot: 'hat', name: '海盜帽', price: 60 },
  hat_crown: { slot: 'hat', name: '小皇冠', price: 80 },
  hat_wizard: { slot: 'hat', name: '魔法帽', price: 100 },
  acc_none: { slot: 'acc', name: '不戴配件', price: 0 },
  acc_bowtie: { slot: 'acc', name: '領結', price: 30 },
  acc_scarf: { slot: 'acc', name: '圍巾', price: 35 },
  acc_glasses: { slot: 'acc', name: '圓眼鏡', price: 40 },
  acc_medal: { slot: 'acc', name: '金牌', price: 120 },
  color_blue: { slot: 'color', name: '海豹藍', price: 0 },
  color_pink: { slot: 'color', name: '草莓粉', price: 50 },
  color_mint: { slot: 'color', name: '薄荷綠', price: 50 },
  color_cocoa: { slot: 'color', name: '奶茶色', price: 50 },
  color_lav: { slot: 'color', name: '薰衣草', price: 50 },
  color_gold: { slot: 'color', name: '閃亮金', price: 150 }
};
const DEFAULT_OUTFIT = { hat: 'hat_sailor', acc: 'acc_none', color: 'color_blue' };

class UserError extends Error {}
const fail = msg => { throw new UserError(msg); };

/* ================= 入口 ================= */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    const name = url.pathname.slice(5);
    const fn = API[name];
    if (!fn || request.method !== 'POST') return json({ err: '找不到這個功能。' }, 404);
    let args = [];
    try { args = ((await request.json()) || {}).args || []; } catch (e) { return json({ err: '資料格式不對。' }, 400); }
    try {
      const ctx = new Ctx(env);
      ctx.ip = request.headers.get('cf-connecting-ip') || 'local';
      return json({ ok: (await fn(ctx, ...args)) ?? null });
    } catch (e) {
      if (e instanceof UserError) return json({ err: e.message }, 200);
      console.error(name, e && e.stack || e);
      return json({ err: '系統發生錯誤，請稍後再試。' }, 500);
    }
  }
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
}

/* ================= 共用 ================= */

class Ctx {
  constructor(env) { this.env = env; this.db = env.DB; this._set = null; }
  all(sql, ...p) { return this.db.prepare(sql).bind(...p).all().then(r => r.results); }
  first(sql, ...p) { return this.db.prepare(sql).bind(...p).first(); }
  run(sql, ...p) { return this.db.prepare(sql).bind(...p).run(); }
  stmt(sql, ...p) { return this.db.prepare(sql).bind(...p); }
  async batch(list) { for (let i = 0; i < list.length; i += 50) await this.db.batch(list.slice(i, i + 50)); }
  async settings() {
    if (!this._set) {
      this._set = {};
      (await this.all('SELECT key, value FROM settings')).forEach(r => this._set[r.key] = r.value);
    }
    return this._set;
  }
}

// 臺灣時間
const twNow = () => new Date(Date.now() + 8 * 3600e3);
const today = () => twNow().toISOString().slice(0, 10);
const yesterday = () => new Date(Date.now() + 8 * 3600e3 - 864e5).toISOString().slice(0, 10);
const stampNow = () => twNow().toISOString().slice(0, 19).replace('T', ' ');
const num = v => { const n = Number(v); return isNaN(n) ? 0 : n; };
const jsonp = (v, d) => { try { const x = JSON.parse(v || ''); return x == null ? d : x; } catch (e) { return d; } };
const str = (v, max = 500) => String(v == null ? '' : v).trim().slice(0, max);
const up = s => str(s, 40).toUpperCase();
const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const unitKey = q => (str(q.version) || COMMON) + '｜' + q.grade + q.sem + '｜' + q.subject + '｜' + q.unit;
const concepts = c => String(c || '').split(/[、,，|]/).map(x => x.trim()).filter(Boolean);

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
function safeEqual(a, b) {
  a = String(a); b = String(b);
  let d = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) d |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return d === 0;
}

async function rate(ctx) {
  const s = await ctx.settings();
  const v = (k, d) => (s[k] === undefined || s[k] === '') ? d : Math.max(0, num(s[k]));
  return { perStamp: v('per_stamp', 1), coinsPerPoint: v('coins_per_point', 20), perMastery: v('per_mastery', 0) };
}

/* ---------- 老師登入 ---------- */

/**
 * 老師密碼檢查。輸錯會依「網路位址」分開計算：學生在自己的裝置亂試，
 * 只會鎖住那台裝置，不會讓老師也進不去。
 */
async function checkPw(ctx, pw) {
  const s = await ctx.settings();
  const now = Date.now();
  const who = (await sha256('ip:' + ctx.ip)).slice(0, 16);
  const kFails = 'tfails_' + who, kLock = 'tlock_' + who;
  if (num(s[kLock]) > now) fail('這台裝置輸錯太多次，請 10 分鐘後再試。');
  pw = String(pw || '');
  let ok;
  if (s.teacher_pw_hash) ok = safeEqual(await sha256(s.teacher_pw_salt + pw), s.teacher_pw_hash);
  else ok = !!ctx.env.TEACHER_PASSWORD && safeEqual(pw, ctx.env.TEACHER_PASSWORD);
  const put = (k, v) => ctx.stmt('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', k, String(v));
  if (!ok) {
    const fails = num(s[kFails]) + 1;
    await ctx.batch(fails >= TEACHER_MAX_FAILS ? [put(kFails, 0), put(kLock, now + LOCK_MS)] : [put(kFails, fails)]);
    ctx._set = null;
    if (!s.teacher_pw_hash && !ctx.env.TEACHER_PASSWORD) fail('還沒設定老師密碼，請依照使用說明在 GitHub 設定 TEACHER_PASSWORD。');
    fail(fails >= TEACHER_MAX_FAILS ? '這台裝置輸錯太多次，請 10 分鐘後再試。' : '老師密碼不正確。');
  }
  if (s[kFails] !== undefined || s[kLock] !== undefined) {
    await ctx.run('DELETE FROM settings WHERE key IN (?, ?)', kFails, kLock);
    ctx._set = null;
  }
}

/* ---------- 學生登入 ---------- */

async function findClass(ctx, code) {
  const c = await ctx.first('SELECT * FROM classes WHERE code = ?', up(code));
  if (!c) fail('找不到班級代碼「' + str(code, 20) + '」。');
  return c;
}

async function auth(ctx, cred, allowSetPin) {
  cred = cred || {};
  const cls = await findClass(ctx, cred.code);
  if (cls.status !== '進行中') fail('這個班級已經結業封存了。');
  const seat = Math.floor(num(cred.seat));
  const s = await ctx.first('SELECT * FROM students WHERE class_code = ? AND seat = ?', cls.code, seat);
  if (!s) fail('這個班級沒有 ' + seat + ' 號，請跟老師確認。');
  const now = Date.now();
  if (s.locked_until > now) fail('密碼錯太多次了，請 ' + Math.ceil((s.locked_until - now) / 60e3) + ' 分鐘後再試，或請老師幫你重設。');
  const given = str(cred.pin, 10);
  if (!s.pin) {
    if (!allowSetPin) fail('請重新登入。');
    if (!/^\d{4}$/.test(given)) fail('第一次登入請自己設定 4 位數字密碼。');
    s.pin = given;
    s.nick = str(cred.nick, 10) || s.nick;
    await ctx.run('UPDATE students SET pin = ?, nick = ? WHERE class_code = ? AND seat = ?', s.pin, s.nick, cls.code, seat);
  } else if (!safeEqual(s.pin, given)) {
    const fails = s.fails + 1;
    if (fails >= MAX_FAILS) await ctx.run('UPDATE students SET fails = 0, locked_until = ? WHERE class_code = ? AND seat = ?', now + LOCK_MS, cls.code, seat);
    else await ctx.run('UPDATE students SET fails = ? WHERE class_code = ? AND seat = ?', fails, cls.code, seat);
    fail(fails >= MAX_FAILS ? '密碼錯太多次了，請 10 分鐘後再試，或請老師幫你重設。' : '密碼不對喔。忘記的話請老師幫你重設。');
  }
  if (s.fails) await ctx.run('UPDATE students SET fails = 0 WHERE class_code = ? AND seat = ?', cls.code, seat);
  return { cls, s };
}

const owned = s => jsonp(s.owned, []).filter(id => SHOP[id]);
function outfit(s) {
  const o = jsonp(s.outfit, {});
  const out = {};
  Object.keys(DEFAULT_OUTFIT).forEach(k => out[k] = SHOP[o[k]] ? o[k] : DEFAULT_OUTFIT[k]);
  return out;
}
function liveStreak(s) { return (s.last_day === today() || s.last_day === yesterday()) ? s.streak : 0; }

/** 題目池：在這些單元裡、已啟用的題目 */
function poolFor(ctx, units) {
  if (!units || !units.length) return Promise.resolve([]);
  return ctx.all('SELECT * FROM questions WHERE enabled = 1 AND unit_key IN (SELECT value FROM json_each(?))', JSON.stringify(units));
}

/** 每一題的作答狀況：last 最近一次對錯、days 答對過的不同日子數、rday 最後答對日、day 最後作答日 */
async function history(ctx, code, seat) {
  const h = {};
  (await ctx.all('SELECT qid, last_ok, right_days, last_right_day, last_day FROM progress WHERE class_code = ? AND seat = ?', code, seat))
    .forEach(r => h[r.qid] = { last: r.last_ok === 1, days: r.right_days, rday: r.last_right_day, day: r.last_day });
  return h;
}

/* ---------- 精熟制度 ----------
 * 一題「記住了」：在兩個不同的日子都答對過，而且最近一次是答對的。
 * 單元等級：
 *   精熟 🌳  9 成以上的題目記住了
 *   熟練 🌿  7 成以上的題目最近一次答對
 *   初學 🌱  有練習過
 * 已精熟的單元超過 21 天沒練習，會提醒複習（等級不會被扣）。
 */
const MASTER_RATIO = 0.9, SKILLED_RATIO = 0.7, REVIEW_DAYS = 21;
const remembered = h => !!h && h.last && h.days >= 2;
function unitLevels(pool, hist) {
  const by = {};
  pool.forEach(q => {
    const u = by[q.unit_key] = by[q.unit_key] || { key: q.unit_key, subject: q.subject, unit: q.unit, total: 0, tried: 0, right: 0, remembered: 0, lastDay: '' };
    const h = hist[q.id];
    u.total++;
    if (h) { u.tried++; if (h.last) u.right++; if (remembered(h)) u.remembered++; if (h.day > u.lastDay) u.lastDay = h.day; }
  });
  const reviewBefore = new Date(Date.now() + 8 * 3600e3 - REVIEW_DAYS * 864e5).toISOString().slice(0, 10);
  return Object.keys(by).map(k => {
    const u = by[k];
    u.level = u.total && u.remembered / u.total >= MASTER_RATIO ? 3 : u.total && u.right / u.total >= SKILLED_RATIO ? 2 : u.tried ? 1 : 0;
    u.review = u.level === 3 && !!u.lastDay && u.lastDay < reviewBefore;
    return u;
  });
}

function exam(cls) {
  const units = jsonp(cls.exam_units, []);
  if (!cls.exam_date || !units.length || cls.exam_date < today()) return null;
  const days = Math.round((Date.parse(cls.exam_date + 'T00:00:00Z') - Date.parse(today() + 'T00:00:00Z')) / 864e5);
  return { name: cls.exam_name || '段考', date: cls.exam_date, units, days };
}

async function state(ctx, cls, s) {
  const pool = await poolFor(ctx, jsonp(cls.units, []));
  const hist = await history(ctx, cls.code, s.seat);
  const islands = {};
  SUBJECTS.forEach(sj => islands[sj] = { total: 0, mastered: 0 });
  let wrong = 0;
  pool.forEach(q => {
    const it = islands[q.subject], h = hist[q.id];
    if (it) { it.total++; if (h && h.last) it.mastered++; }
    if (h && !h.last) wrong++;
  });
  let ex = exam(cls);
  if (ex) {
    const ep = await poolFor(ctx, ex.units);
    ex = { name: ex.name, date: ex.date, days: ex.days, total: ep.length, mastered: ep.filter(q => hist[q.id] && hist[q.id].last).length };
  }
  const set = await ctx.settings();
  const units = unitLevels(pool, hist).map(u => ({ key: u.key, subject: u.subject, unit: u.unit, level: u.level, review: u.review, total: u.total, remembered: u.remembered, right: u.right }));
  SUBJECTS.forEach(sj => {
    const us = units.filter(u => u.subject === sj);
    islands[sj].units = us.length; islands[sj].masteredUnits = us.filter(u => u.level === 3).length;
  });
  return {
    units,
    className: cls.name, seat: s.seat, nick: s.nick,
    coins: s.coins, earned: s.earned, stars: s.stars, stamps: s.stamps,
    streak: liveStreak(s), todayDone: s.last_day === today(),
    islands, wrong, exam: ex, perRound: num(set.per_round) || 10, passRatio: num(set.pass_ratio) || 0.7,
    owned: owned(s), outfit: outfit(s), shop: SHOP
  };
}

// 選項有「以上皆是」這類依位置的寫法時，不打亂順序
const FIXED_ORDER = /以上|皆是|皆非|都對|都不對|都是|都不是|all of the above|none of the above/i;

/** 給學生的題目：選擇題每次打亂選項順序，答案字母跟著換 */
function publicQ(q) {
  const out = { id: q.id, subject: q.subject, unit: q.unit, concept: q.concept, type: q.type, text: q.text, answer: q.answer, explain: q.explain };
  if (q.type !== '選擇') return Object.assign(out, { options: [] });
  let opts = ['A', 'B', 'C', 'D'].map(k => ({ k, t: q[k.toLowerCase()] })).filter(o => o.t);
  if (!opts.some(o => FIXED_ORDER.test(o.t))) opts = shuffle(opts);
  out.options = opts.map(o => o.t);
  out.answer = 'ABCD'[Math.max(0, opts.findIndex(o => o.k === String(q.answer).toUpperCase()))];
  return out;
}

function normAns(v) {
  return String(v == null ? '' : v).replace(/[！-～]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0)).replace(/\s+/g, '').toLowerCase();
}
function tf(v) {
  const s = normAns(v);
  if (['o', '○', '對', '是', 't', 'true', 'y', '⭕'].includes(s)) return 'O';
  if (['x', '╳', '×', '錯', '否', 'f', 'false', 'n', '❌'].includes(s)) return 'X';
  return null;
}
function grade(q, ans) {
  // 選擇題：學生送回選項的文字（因為每個人看到的順序不同），比對正確選項的內容
  if (q.type === '選擇') {
    const right = q[String(q.answer).toLowerCase()];
    if (right == null || right === '') return false;
    // 舊版頁面（還沒重新整理）送的是原始順序的字母
    if (/^[A-Da-d]$/.test(String(ans).trim()) && ![q.a, q.b, q.c, q.d].some(t => normAns(t) === normAns(ans))) return normAns(ans).toUpperCase() === normAns(q.answer).toUpperCase();
    return normAns(ans) === normAns(right);
  }
  if (q.type === '是非') return tf(ans) !== null && tf(ans) === tf(q.answer);
  return String(q.answer).split('|').some(r => normAns(r) !== '' && normAns(r) === normAns(ans));
}

/* ================= API ================= */

const API = {};

/* ---------- 學生 ---------- */

API.studentLogin = async (ctx, cred) => {
  const { cls, s } = await auth(ctx, cred, true);
  return state(ctx, cls, s);
};

API.getRound = async (ctx, cred, island) => {
  const { cls, s } = await auth(ctx, cred, false);
  const set = await ctx.settings();
  const n = Math.min(30, num(set.per_round) || 10);
  const hist = await history(ctx, cls.code, s.seat);
  const isWrong = q => hist[q.id] && !hist[q.id].last;
  const td = today();
  // 出題順序：錯題（最多 3 題）→ 之前答對過一天、今天還沒答對的（換一天再答對就記住了）→ 新題目 → 其他錯題 → 已記住的
  const prioritized = list => {
    const wrong = shuffle(list.filter(isWrong));
    const second = shuffle(list.filter(q => { const h = hist[q.id]; return h && h.last && h.days < 2 && h.rday !== td; }));
    const fresh = shuffle(list.filter(q => !hist[q.id]));
    const rest = shuffle(list.filter(q => { const h = hist[q.id]; return h && h.last && !(h.days < 2 && h.rday !== td); }));
    const out = [], seen = new Set();
    [wrong.slice(0, 3), second, fresh, wrong.slice(3), rest].forEach(g => g.forEach(q => { if (!seen.has(q.id)) { seen.add(q.id); out.push(q); } }));
    return out.slice(0, n);
  };
  let picked;
  if (SUBJECTS.includes(island)) {
    picked = prioritized((await poolFor(ctx, jsonp(cls.units, []))).filter(q => q.subject === island));
  } else if (island === '錯題') {
    picked = shuffle((await poolFor(ctx, jsonp(cls.units, []))).filter(isWrong)).slice(0, n);
  } else if (island === '綜合') {
    const pool = await poolFor(ctx, jsonp(cls.units, []));
    const by = SUBJECTS.map(sj => shuffle(pool.filter(q => q.subject === sj)));
    picked = [];
    for (let i = 0; picked.length < n && by.some(b => b.length); i = (i + 1) % by.length) if (by[i].length) picked.push(by[i].shift());
  } else if (island === '段考') {
    const ex = exam(cls);
    if (!ex) fail('目前沒有要準備的考試。');
    picked = prioritized(await poolFor(ctx, ex.units));
  } else fail('沒有這座島。');
  if (!picked.length) fail(island === '錯題' ? '錯題本是空的，太厲害了！' : '這座島還沒有開放的題目，等老師上完課再來。');
  return shuffle(picked).map(publicQ);
};

API.submitRound = async (ctx, cred, island, responses) => {
  const { cls, s } = await auth(ctx, cred, false);
  const set = await ctx.settings();
  const list = (Array.isArray(responses) ? responses : []).slice(0, 30);
  const ids = [...new Set(list.map(r => str(r && r.id, 40)))];
  if (!ids.length) fail('沒有收到作答。');
  const qmap = {};
  (await ctx.all('SELECT * FROM questions WHERE id IN (SELECT value FROM json_each(?))', JSON.stringify(ids))).forEach(q => qmap[q.id] = q);
  const ts = stampNow(), day = today();
  const stmts = [], missed = new Set(), seen = new Set();
  let correct = 0;
  list.forEach(r => {
    const q = qmap[str(r && r.id, 40)];
    if (!q || seen.has(q.id)) return;  // 同一題只算一次
    seen.add(q.id);
    const ok = grade(q, r.answer);
    if (ok) correct++; else concepts(q.concept).forEach(c => missed.add(c));
    stmts.push(ctx.stmt('INSERT INTO logs (ts, day, class_code, seat, qid, subject, unit, answer, ok) VALUES (?,?,?,?,?,?,?,?,?)', ts, day, cls.code, s.seat, q.id, q.subject, q.unit, str(r.answer, 100), ok ? 1 : 0));
    // 答對：如果今天還沒答對過這題，答對的日子數 +1
    stmts.push(ctx.stmt(`INSERT INTO progress (class_code, seat, qid, last_ok, right_days, last_right_day, last_day) VALUES (?,?,?,?,?,?,?)
      ON CONFLICT(class_code, seat, qid) DO UPDATE SET last_ok = excluded.last_ok, last_day = excluded.last_day,
        right_days = right_days + CASE WHEN excluded.last_ok = 1 AND last_right_day <> excluded.last_day THEN 1 ELSE 0 END,
        last_right_day = CASE WHEN excluded.last_ok = 1 THEN excluded.last_day ELSE last_right_day END`,
      cls.code, s.seat, q.id, ok ? 1 : 0, ok ? 1 : 0, ok ? day : '', day));
  });
  const total = seen.size;
  if (!total) fail('沒有收到作答。');
  const passed = correct / total >= (num(set.pass_ratio) || 0.7);
  let gotStamp = false;
  if (passed && s.last_day !== day) {
    gotStamp = true;
    s.streak = s.last_day === yesterday() ? s.streak + 1 : 1;
    s.last_day = day;
    s.stamps += 1;
  }
  s.coins += correct; s.earned += correct;
  if (passed) s.stars += 1;
  s.total += total; s.right_count += correct;
  stmts.push(ctx.stmt(`UPDATE students SET coins = coins + ?, earned = earned + ?, stars = stars + ?, stamps = stamps + ?,
      streak = ?, last_day = ?, total = total + ?, right_count = right_count + ? WHERE class_code = ? AND seat = ?`,
    correct, correct, passed ? 1 : 0, gotStamp ? 1 : 0, s.streak, s.last_day, total, correct, cls.code, s.seat));
  await ctx.db.batch(stmts);
  const st = await state(ctx, cls, s);
  // 新精熟的單元：記錄下來（徽章與加點用），每個單元只記第一次
  const had = new Set((await ctx.all('SELECT unit_key FROM mastery WHERE class_code = ? AND seat = ?', cls.code, s.seat)).map(r => r.unit_key));
  const newly = st.units.filter(u => u.level === 3 && !had.has(u.key));
  if (newly.length) await ctx.batch(newly.map(u => ctx.stmt('INSERT OR IGNORE INTO mastery (class_code, seat, unit_key, day) VALUES (?,?,?,?)', cls.code, s.seat, u.key, day)));
  return { correct, total, passed, coins: correct, star: passed, stamp: gotStamp, missed: [...missed].slice(0, 4), mastered: newly.map(u => u.subject + '・' + u.unit), state: st };
};

API.buyItem = async (ctx, cred, id) => {
  const { cls, s } = await auth(ctx, cred, false);
  const item = SHOP[id];
  if (!item) fail('商店沒有這個東西。');
  const have = owned(s);
  if (have.includes(id)) fail('你已經有這個了。');
  if (s.coins < item.price) fail('金幣還不夠，再去島上挑戰吧！');
  have.push(id);
  const o = outfit(s); o[item.slot] = id;
  const r = await ctx.run('UPDATE students SET coins = coins - ?, owned = ?, outfit = ? WHERE class_code = ? AND seat = ? AND coins >= ?',
    item.price, JSON.stringify(have), JSON.stringify(o), cls.code, s.seat, item.price);
  if (!r.meta.changes) fail('金幣還不夠，再去島上挑戰吧！');
  s.coins -= item.price; s.owned = JSON.stringify(have); s.outfit = JSON.stringify(o);
  return state(ctx, cls, s);
};

API.setOutfit = async (ctx, cred, want) => {
  const { cls, s } = await auth(ctx, cred, false);
  const have = owned(s), o = outfit(s);
  Object.keys(DEFAULT_OUTFIT).forEach(slot => {
    const id = want && want[slot];
    if (id && SHOP[id] && SHOP[id].slot === slot && (SHOP[id].price === 0 || have.includes(id))) o[slot] = id;
  });
  s.outfit = JSON.stringify(o);
  await ctx.run('UPDATE students SET outfit = ? WHERE class_code = ? AND seat = ?', s.outfit, cls.code, s.seat);
  return state(ctx, cls, s);
};

/* ---------- 老師 ---------- */

function classOut(c) {
  return { code: c.code, name: c.name, grade: c.grade, sem: c.sem, version: c.version || COMMON, status: c.status, units: jsonp(c.units, []), exam: { name: c.exam_name, date: c.exam_date, units: jsonp(c.exam_units, []) } };
}

async function versions(ctx) {
  const v = new Set([COMMON, '南一', '康軒', '翰林']);
  (await ctx.all('SELECT DISTINCT version FROM questions UNION SELECT DISTINCT version FROM classes')).forEach(r => r.version && v.add(r.version));
  return [...v];
}

async function unitCatalog(ctx) {
  const rows = await ctx.all('SELECT unit_key AS key, version, grade, sem, subject, unit, COUNT(*) AS count, SUM(enabled) AS enabled FROM questions GROUP BY unit_key');
  return rows.filter(r => r.enabled > 0).map(r => ({ key: r.key, version: r.version, grade: r.grade, sem: r.sem, subject: r.subject, unit: r.unit, count: r.enabled }))
    .sort((a, b) => a.version.localeCompare(b.version) || a.grade - b.grade || a.sem.localeCompare(b.sem) || SUBJECTS.indexOf(a.subject) - SUBJECTS.indexOf(b.subject) || a.unit.localeCompare(b.unit));
}

API.tLogin = async (ctx, pw) => {
  await checkPw(ctx, pw);
  const classes = await ctx.all('SELECT code, name, grade, sem, version, status FROM classes ORDER BY created, code');
  return { classes, versions: await versions(ctx) };
};

API.tDashboard = async (ctx, pw, code) => {
  await checkPw(ctx, pw);
  const cls = await findClass(ctx, code);
  const rt = await rate(ctx);
  const week = new Date(Date.now() + 8 * 3600e3 - 6 * 864e5).toISOString().slice(0, 10);
  const [students, days, units, qs, cs, wrongNow, mPend] = await Promise.all([
    ctx.all('SELECT * FROM students WHERE class_code = ? ORDER BY seat', cls.code),
    ctx.all('SELECT seat, COUNT(DISTINCT day) AS n FROM logs WHERE class_code = ? AND day >= ? GROUP BY seat', cls.code, week),
    ctx.all('SELECT subject, unit, SUM(ok) AS right, COUNT(*) AS total FROM logs WHERE class_code = ? GROUP BY subject, unit', cls.code),
    ctx.all(`SELECT l.qid AS id, q.text, q.subject, q.unit, q.answer, COUNT(*) - SUM(l.ok) AS wrong, COUNT(*) AS total
      FROM logs l JOIN questions q ON q.id = l.qid WHERE l.class_code = ? GROUP BY l.qid
      HAVING total >= 3 AND wrong > 0 ORDER BY wrong * 1.0 / total DESC LIMIT 8`, cls.code),
    ctx.all(`SELECT q.subject, q.concept, SUM(l.ok) AS right, COUNT(*) AS total FROM logs l JOIN questions q ON q.id = l.qid
      WHERE l.class_code = ? AND q.concept <> '' GROUP BY q.subject, q.concept`, cls.code),
    ctx.all(`SELECT p.seat, q.subject, q.concept FROM progress p JOIN questions q ON q.id = p.qid
      WHERE p.class_code = ? AND p.last_ok = 0`, cls.code),
    ctx.all('SELECT seat, COUNT(*) AS n FROM mastery WHERE class_code = ? AND redeemed = 0 GROUP BY seat', cls.code)
  ]);
  const mMap = {}; mPend.forEach(r => mMap[r.seat] = r.n);
  const dayMap = {}; days.forEach(r => dayMap[r.seat] = r.n);
  const weakBy = {}, wrongCount = {}, cPeople = {};
  wrongNow.forEach(r => {
    wrongCount[r.seat] = (wrongCount[r.seat] || 0) + 1;
    concepts(r.concept).forEach(c => {
      const w = weakBy[r.seat] = weakBy[r.seat] || {}; w[c] = (w[c] || 0) + 1;
      const k = r.subject + '｜' + c; (cPeople[k] = cPeople[k] || new Set()).add(r.seat);
    });
  });
  const cStat = {};
  cs.forEach(r => concepts(r.concept).forEach(c => {
    const k = r.subject + '｜' + c;
    const x = cStat[k] = cStat[k] || { concept: c, subject: r.subject, right: 0, total: 0 };
    x.right += r.right; x.total += r.total;
  }));
  return {
    cls: classOut(cls), rate: rt,
    students: students.map(s => {
      const stamps = s.stamps - s.stamps_redeemed, coinsPending = s.earned - s.coins_redeemed;
      const coinPts = rt.coinsPerPoint > 0 ? Math.floor(coinsPending / rt.coinsPerPoint) : 0;
      const w = weakBy[s.seat] || {};
      return {
        seat: s.seat, nick: s.nick, hasPin: !!s.pin, coins: s.coins, earned: s.earned, stars: s.stars,
        stamps, coinsPending, masteryPending: mMap[s.seat] || 0, points: stamps * rt.perStamp + coinPts + (mMap[s.seat] || 0) * rt.perMastery,
        streak: liveStreak(s), last: s.last_day, weekDays: dayMap[s.seat] || 0,
        total: s.total, right: s.right_count, wrongNow: wrongCount[s.seat] || 0,
        weak: Object.keys(w).sort((a, b) => w[b] - w[a]).slice(0, 2),
        locked: s.locked_until > Date.now()
      };
    }),
    units: await unitCatalog(ctx),
    versions: await versions(ctx),
    weakUnits: units.filter(u => u.total >= 5).map(u => ({ unit: u.subject + '｜' + u.unit, right: u.right, total: u.total }))
      .sort((a, b) => a.right / a.total - b.right / b.total).slice(0, 6),
    weakConcepts: Object.keys(cStat).map(k => Object.assign(cStat[k], { people: [...(cPeople[k] || [])].sort((a, b) => a - b) }))
      .filter(c => c.total >= 3).sort((a, b) => a.right / a.total - b.right / b.total).slice(0, 8),
    hardQs: qs
  };
};

API.tSaveClass = async (ctx, pw, code, data) => {
  await checkPw(ctx, pw);
  const c = await findClass(ctx, code);
  data = data || {};
  if (Array.isArray(data.units)) c.units = JSON.stringify(data.units.map(x => str(x, 200)).slice(0, 500));
  if (data.name) c.name = str(data.name, 40);
  if (data.grade) c.grade = Math.min(6, Math.max(1, Math.floor(num(data.grade)))) || c.grade;
  if (data.sem === '上' || data.sem === '下') c.sem = data.sem;
  if (data.version) c.version = str(data.version, 20);
  if (data.status === '進行中' || data.status === '封存') c.status = data.status;
  if (data.exam) {
    const d = str(data.exam.date, 10);
    if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) fail('考試日期格式不對。');
    c.exam_name = str(data.exam.name, 20);
    c.exam_date = d;
    c.exam_units = JSON.stringify((data.exam.units || []).map(x => str(x, 200)).slice(0, 500));
  }
  await ctx.run('UPDATE classes SET name=?, grade=?, sem=?, version=?, units=?, status=?, exam_name=?, exam_date=?, exam_units=? WHERE code=?',
    c.name, c.grade, c.sem, c.version, c.units, c.status, c.exam_name, c.exam_date, c.exam_units, c.code);
  return classOut(c);
};

API.tCreateClass = async (ctx, pw, data) => {
  await checkPw(ctx, pw);
  data = data || {};
  const code = up(data.code);
  if (!/^[A-Z0-9]{3,12}$/.test(code)) fail('班級代碼請用 3 到 12 個英文字母或數字，例如 115A601。');
  if (await ctx.first('SELECT code FROM classes WHERE code = ?', code)) fail('這個班級代碼已經有人用了。');
  const count = Math.min(Math.max(Math.floor(num(data.count)), 1), 60);
  const stmts = [ctx.stmt('INSERT INTO classes (code, name, grade, sem, version, created) VALUES (?,?,?,?,?,?)',
    code, str(data.name, 40) || code, Math.min(6, Math.max(1, Math.floor(num(data.grade)) || 6)), data.sem === '下' ? '下' : '上', str(data.version, 20) || COMMON, today())];
  for (let i = 1; i <= count; i++) stmts.push(ctx.stmt('INSERT INTO students (class_code, seat) VALUES (?, ?)', code, i));
  await ctx.batch(stmts);
  return API.tLogin(ctx, pw);
};

API.tAddStudents = async (ctx, pw, code, count) => {
  await checkPw(ctx, pw);
  const cls = await findClass(ctx, code);
  const r = await ctx.first('SELECT MAX(seat) AS m FROM students WHERE class_code = ?', cls.code);
  const start = (r && r.m || 0) + 1, n = Math.min(Math.max(Math.floor(num(count)), 1), 20);
  const stmts = [];
  for (let i = 0; i < n; i++) stmts.push(ctx.stmt('INSERT INTO students (class_code, seat) VALUES (?, ?)', cls.code, start + i));
  await ctx.batch(stmts);
  return n;
};

API.tResetPin = async (ctx, pw, code, seat) => {
  await checkPw(ctx, pw);
  const r = await ctx.run("UPDATE students SET pin = '', fails = 0, locked_until = 0 WHERE class_code = ? AND seat = ?", up(code), Math.floor(num(seat)));
  if (!r.meta.changes) fail('找不到這位學生。');
  return true;
};

API.tSetNick = async (ctx, pw, code, seat, nick) => {
  await checkPw(ctx, pw);
  await ctx.run('UPDATE students SET nick = ? WHERE class_code = ? AND seat = ?', str(nick, 10), up(code), Math.floor(num(seat)));
  return true;
};

/** 日常加點：把還沒兌換的印章與累積金幣換成點數。金幣餘額不扣，學生照樣可以在商店用 */
API.tRedeem = async (ctx, pw, code, seats, note) => {
  await checkPw(ctx, pw);
  const cls = await findClass(ctx, code);
  const rt = await rate(ctx);
  const want = new Set((seats || []).map(x => Math.floor(num(x))));
  const ts = stampNow();
  const out = [], stmts = [];
  const mMap = {};
  (await ctx.all('SELECT seat, COUNT(*) AS n FROM mastery WHERE class_code = ? AND redeemed = 0 GROUP BY seat', cls.code)).forEach(r => mMap[r.seat] = r.n);
  (await ctx.all('SELECT * FROM students WHERE class_code = ?', cls.code)).forEach(s => {
    if (!want.has(s.seat)) return;
    const stamps = s.stamps - s.stamps_redeemed, coinsPending = s.earned - s.coins_redeemed;
    const coinPts = rt.coinsPerPoint > 0 ? Math.floor(coinsPending / rt.coinsPerPoint) : 0;
    const masteryN = rt.perMastery > 0 ? (mMap[s.seat] || 0) : 0;
    const coinsUsed = coinPts * rt.coinsPerPoint, stampPts = stamps * rt.perStamp, points = stampPts + coinPts + masteryN * rt.perMastery;
    if (points <= 0) return;
    const usedStamps = stampPts > 0 ? stamps : 0;
    stmts.push(ctx.stmt('UPDATE students SET stamps_redeemed = stamps_redeemed + ?, coins_redeemed = coins_redeemed + ? WHERE class_code = ? AND seat = ?', usedStamps, coinsUsed, cls.code, s.seat));
    if (masteryN) stmts.push(ctx.stmt('UPDATE mastery SET redeemed = 1 WHERE class_code = ? AND seat = ? AND redeemed = 0', cls.code, s.seat));
    stmts.push(ctx.stmt('INSERT INTO points_log (ts, class_code, seat, nick, stamps, coins, points, note, mastery) VALUES (?,?,?,?,?,?,?,?,?)', ts, cls.code, s.seat, s.nick, usedStamps, coinsUsed, points, str(note, 60), masteryN));
    out.push({ seat: s.seat, nick: s.nick, stamps: usedStamps, coins: coinsUsed, mastery: masteryN, points });
  });
  if (stmts.length) await ctx.db.batch(stmts);
  return out;
};

API.tPointsLog = async (ctx, pw, code) => {
  await checkPw(ctx, pw);
  return ctx.all('SELECT ts, seat, nick, stamps, coins, mastery, points, note FROM points_log WHERE class_code = ? ORDER BY id DESC LIMIT 2000', up(code));
};

/** 精熟總覽：每位學生在每個已教單元的等級 */
API.tMastery = async (ctx, pw, code) => {
  await checkPw(ctx, pw);
  const cls = await findClass(ctx, code);
  const pool = await poolFor(ctx, jsonp(cls.units, []));
  const [students, prog] = await Promise.all([
    ctx.all('SELECT seat, nick FROM students WHERE class_code = ? ORDER BY seat', cls.code),
    ctx.all('SELECT seat, qid, last_ok, right_days, last_right_day, last_day FROM progress WHERE class_code = ?', cls.code)
  ]);
  const hBy = {};
  prog.forEach(r => (hBy[r.seat] = hBy[r.seat] || {})[r.qid] = { last: r.last_ok === 1, days: r.right_days, rday: r.last_right_day, day: r.last_day });
  const base = unitLevels(pool, {});
  const order = base.map(u => u.key).sort((a, b) => {
    const A = base.find(u => u.key === a), B = base.find(u => u.key === b);
    return SUBJECTS.indexOf(A.subject) - SUBJECTS.indexOf(B.subject) || a.localeCompare(b);
  });
  const rows = students.map(st => {
    const lv = {}, review = [];
    unitLevels(pool, hBy[st.seat] || {}).forEach(u => { lv[u.key] = u.level; if (u.review) review.push(u.key); });
    return { seat: st.seat, nick: st.nick, levels: lv, review };
  });
  return {
    units: order.map(k => { const u = base.find(x => x.key === k); return { key: k, subject: u.subject, unit: u.unit, total: u.total, mastered: rows.filter(r => r.levels[k] === 3).length }; }),
    students: rows
  };
};

/* ---------- 題庫 ---------- */

const IMPORT_COLS = ['版本', '年級', '學期', '科目', '單元', '觀念', '題型', '題目', '選項A', '選項B', '選項C', '選項D', '答案', '解析'];

function validateQ(v) {
  if (!/^[1-6]$/.test(v['年級'])) return '年級要填 1 到 6';
  if (!/^[上下]$/.test(v['學期'])) return '學期要填「上」或「下」';
  if (!SUBJECTS.includes(v['科目'])) return '科目要是 ' + SUBJECTS.join('、') + ' 其中之一';
  if (!v['單元']) return '缺少單元名稱';
  if (!v['題目']) return '缺少題目';
  if (!['選擇', '是非', '填空'].includes(v['題型'])) return '題型要是 選擇、是非、填空';
  if (!v['答案']) return '缺少答案';
  if (v['題型'] === '選擇' && (!v['選項A'] || !v['選項B'])) return '選擇題至少要有選項A和選項B';
  if (v['題型'] === '選擇' && !/^[A-Da-d]$/.test(v['答案'])) return '選擇題答案請填 A、B、C 或 D';
  if (v['題型'] === '選擇' && !v['選項' + v['答案'].toUpperCase()]) return '答案指到空白的選項';
  if (v['題型'] === '是非' && tf(v['答案']) === null) return '是非題答案請填 O 或 X';
  return '';
}

function qFromRow(v, id, source) {
  const q = {
    id, version: str(v['版本'], 20) || COMMON, grade: Number(v['年級']), sem: v['學期'], subject: v['科目'], unit: str(v['單元'], 60),
    concept: str(v['觀念'], 60), type: v['題型'], text: str(v['題目'], 1000),
    a: str(v['選項A'], 300), b: str(v['選項B'], 300), c: str(v['選項C'], 300), d: str(v['選項D'], 300),
    answer: v['題型'] === '選擇' ? v['答案'].toUpperCase() : v['題型'] === '是非' ? tf(v['答案']) : str(v['答案'], 300),
    explain: str(v['解析'], 500), source: str(source, 10) || '老師'
  };
  q.unit_key = unitKey(q);
  return q;
}
const Q_COLS = ['id', 'version', 'grade', 'sem', 'subject', 'unit', 'unit_key', 'concept', 'type', 'text', 'a', 'b', 'c', 'd', 'answer', 'explain', 'source', 'enabled', 'created'];

function parseTable(text) {
  const sep = text.indexOf('\t') >= 0 ? '\t' : ',';
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

API.tImport = async (ctx, pw, text, source, defaultVersion) => {
  await checkPw(ctx, pw);
  const lines = parseTable(String(text || '').replace(/^﻿/, ''));
  if (lines.length > 2001) fail('一次最多匯入 2000 題，請分批貼上。');
  let cols = IMPORT_COLS, start = 0;
  if (lines.length && lines[0].some(c => String(c).trim() === '題目')) { cols = lines[0].map(c => String(c).trim()); start = 1; }
  const errors = [], stmts = [];
  const base = Date.now().toString(36).toUpperCase();
  let added = 0;
  for (let i = start; i < lines.length; i++) {
    if (!lines[i].join('').trim()) continue;
    const v = {};
    cols.forEach((c, j) => v[c] = String(lines[i][j] == null ? '' : lines[i][j]).trim());
    v['版本'] = v['版本'] || str(defaultVersion, 20) || COMMON;
    v['學期'] = (v['學期'] || '').replace('學期', '');
    const msg = validateQ(v);
    if (msg) { errors.push('第 ' + (i + 1) + ' 行：' + msg); continue; }
    const q = qFromRow(v, 'Q' + base + String(added).padStart(4, '0'), source);
    q.enabled = 1; q.created = today();
    stmts.push(ctx.stmt(`INSERT INTO questions (${Q_COLS.join(',')}) VALUES (${Q_COLS.map(() => '?').join(',')})`, ...Q_COLS.map(k => q[k])));
    added++;
  }
  await ctx.batch(stmts);
  return { added, errors: errors.slice(0, 30), moreErrors: Math.max(0, errors.length - 30) };
};

API.tQuestions = async (ctx, pw, filter) => {
  await checkPw(ctx, pw);
  filter = filter || {};
  const where = [], p = [];
  if (filter.version) { where.push('version = ?'); p.push(str(filter.version, 20)); }
  if (filter.subject) { where.push('subject = ?'); p.push(str(filter.subject, 10)); }
  if (filter.unitKey) { where.push('unit_key = ?'); p.push(str(filter.unitKey, 200)); }
  if (filter.q) { where.push("(text LIKE ? OR unit LIKE ? OR concept LIKE ?)"); const k = '%' + str(filter.q, 40) + '%'; p.push(k, k, k); }
  const rows = await ctx.all(`SELECT * FROM questions ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY version, grade, sem, subject, unit, id LIMIT 301`, ...p);
  return { rows: rows.slice(0, 300), more: rows.length > 300 };
};

API.tSaveQuestion = async (ctx, pw, data) => {
  await checkPw(ctx, pw);
  const v = {};
  IMPORT_COLS.forEach(c => v[c] = str(data && data[c], 1000));
  const msg = validateQ(v);
  if (msg) fail(msg);
  const id = str(data.id, 40);
  const q = qFromRow(v, id || ('Q' + Date.now().toString(36).toUpperCase()), data.source || '老師');
  if (id) {
    const r = await ctx.run(`UPDATE questions SET version=?, grade=?, sem=?, subject=?, unit=?, unit_key=?, concept=?, type=?, text=?, a=?, b=?, c=?, d=?, answer=?, explain=? WHERE id=?`,
      q.version, q.grade, q.sem, q.subject, q.unit, q.unit_key, q.concept, q.type, q.text, q.a, q.b, q.c, q.d, q.answer, q.explain, id);
    if (!r.meta.changes) fail('找不到這一題。');
  } else {
    q.enabled = 1; q.created = today();
    await ctx.run(`INSERT INTO questions (${Q_COLS.join(',')}) VALUES (${Q_COLS.map(() => '?').join(',')})`, ...Q_COLS.map(k => q[k]));
  }
  return ctx.first('SELECT * FROM questions WHERE id = ?', q.id);
};

API.tSetEnabled = async (ctx, pw, ids, enabled) => {
  await checkPw(ctx, pw);
  const list = (ids || []).map(x => str(x, 40)).slice(0, 1000);
  await ctx.run('UPDATE questions SET enabled = ? WHERE id IN (SELECT value FROM json_each(?))', enabled ? 1 : 0, JSON.stringify(list));
  return list.length;
};

/** 刪除題目。作答過的題目會保留紀錄，改成停用，以免弄亂統計 */
API.tDeleteQuestions = async (ctx, pw, ids) => {
  await checkPw(ctx, pw);
  const list = JSON.stringify((ids || []).map(x => str(x, 40)).slice(0, 1000));
  const used = await ctx.all('SELECT DISTINCT qid FROM logs WHERE qid IN (SELECT value FROM json_each(?))', list);
  const usedSet = JSON.stringify(used.map(r => r.qid));
  await ctx.db.batch([
    ctx.stmt('UPDATE questions SET enabled = 0 WHERE id IN (SELECT value FROM json_each(?))', usedSet),
    ctx.stmt('DELETE FROM questions WHERE id IN (SELECT value FROM json_each(?)) AND id NOT IN (SELECT value FROM json_each(?))', list, usedSet)
  ]);
  return { deleted: JSON.parse(list).length - used.length, disabled: used.length };
};

/* ---------- 設定與匯出 ---------- */

API.tGetSettings = async (ctx, pw) => {
  await checkPw(ctx, pw);
  const s = await ctx.settings();
  return { perRound: num(s.per_round) || 10, passRatio: num(s.pass_ratio) || 0.7, perStamp: num(s.per_stamp), coinsPerPoint: num(s.coins_per_point), perMastery: num(s.per_mastery), customPw: !!s.teacher_pw_hash };
};

API.tSaveSettings = async (ctx, pw, data) => {
  await checkPw(ctx, pw);
  data = data || {};
  const put = (k, v) => ctx.stmt('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', k, String(v));
  const stmts = [];
  if (data.perRound !== undefined) stmts.push(put('per_round', Math.min(30, Math.max(3, Math.floor(num(data.perRound)) || 10))));
  if (data.passRatio !== undefined) stmts.push(put('pass_ratio', Math.min(1, Math.max(0.1, num(data.passRatio) || 0.7))));
  if (data.perStamp !== undefined) stmts.push(put('per_stamp', Math.min(100, Math.max(0, Math.floor(num(data.perStamp))))));
  if (data.coinsPerPoint !== undefined) stmts.push(put('coins_per_point', Math.min(10000, Math.max(0, Math.floor(num(data.coinsPerPoint))))));
  if (data.perMastery !== undefined) stmts.push(put('per_mastery', Math.min(100, Math.max(0, Math.floor(num(data.perMastery))))));
  if (data.newPw !== undefined) {
    const np = String(data.newPw);
    if (np.length < 6) fail('新密碼至少要 6 個字。');
    const salt = crypto.randomUUID();
    stmts.push(put('teacher_pw_salt', salt), put('teacher_pw_hash', await sha256(salt + np)));
  }
  if (stmts.length) await ctx.db.batch(stmts);
  ctx._set = null;
  return API.tGetSettings(ctx, data.newPw !== undefined ? data.newPw : pw);
};

/** 匯出資料給 Excel（前端轉成 CSV 下載） */
API.tExport = async (ctx, pw, what, code) => {
  await checkPw(ctx, pw);
  if (what === 'questions') return ctx.all('SELECT version AS 版本, grade AS 年級, sem AS 學期, subject AS 科目, unit AS 單元, concept AS 觀念, type AS 題型, text AS 題目, a AS 選項A, b AS 選項B, c AS 選項C, d AS 選項D, answer AS 答案, explain AS 解析, source AS 來源, CASE enabled WHEN 1 THEN \'Y\' ELSE \'N\' END AS 啟用, id AS 題號 FROM questions ORDER BY version, grade, sem, subject, unit, id');
  const cls = await findClass(ctx, code);
  if (what === 'students') {
    const rt = await rate(ctx);
    return (await ctx.all('SELECT * FROM students WHERE class_code = ? ORDER BY seat', cls.code)).map(s => ({
      座號: s.seat, 暱稱: s.nick, 金幣餘額: s.coins, 累積金幣: s.earned, 未換金幣: s.earned - s.coins_redeemed, 星星: s.stars, 印章: s.stamps, 未換印章: s.stamps - s.stamps_redeemed,
      可加點數: (s.stamps - s.stamps_redeemed) * rt.perStamp + (rt.coinsPerPoint > 0 ? Math.floor((s.earned - s.coins_redeemed) / rt.coinsPerPoint) : 0),
      連續天數: liveStreak(s), 最後完成日: s.last_day, 總答題: s.total, 答對題: s.right_count, 正確率: s.total ? Math.round(s.right_count / s.total * 100) + '%' : ''
    }));
  }
  if (what === 'points') return (await API.tPointsLog(ctx, pw, cls.code)).map(r => ({ 時間: r.ts, 座號: r.seat, 暱稱: r.nick, 點數: r.points, 用掉印章: r.stamps, 用掉累積金幣: r.coins, 精熟單元: r.mastery, 備註: r.note }));
  if (what === 'logs') return ctx.all('SELECT ts AS 時間, seat AS 座號, subject AS 科目, unit AS 單元, qid AS 題號, answer AS 作答, CASE ok WHEN 1 THEN \'對\' ELSE \'錯\' END AS 對錯 FROM logs WHERE class_code = ? ORDER BY id DESC LIMIT 20000', cls.code);
  fail('沒有這種匯出。');
};
