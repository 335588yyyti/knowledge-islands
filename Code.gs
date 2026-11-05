/**
 * 知識群島：班級個人挑戰系統（Google 試算表 + Apps Script）
 *
 * 試算表就是資料庫：
 *   設定      老師密碼、每回合題數、過關門檻
 *   班級      每一屆／每一班一列：課本版本、已教單元、段考設定
 *   學生      每位學生一列：金幣餘額、累積金幣、星星、印章、連續天數、波波的裝扮
 *             （金幣餘額可以在商店花掉；加點看「累積金幣」，花掉不影響）
 *   題庫      所有題目，依 版本＋年級＋學期＋科目＋單元 分類，每一屆共用；「觀念」欄用來診斷弱點
 *   作答紀錄  每一題作答都記一列，用來算錯題本、弱點單元與弱點觀念
 *   加點紀錄  老師兌換印章／累積金幣成點數（日常加點）的紀錄
 *
 * 第一次使用：在 Apps Script 編輯器選擇函式 setup 並執行。
 * 更新程式後也請再執行一次 setup，它會補上新版需要的欄位，不會動到原本的資料。
 */

const SH = { SET: '設定', CLS: '班級', STU: '學生', Q: '題庫', LOG: '作答紀錄', PTS: '加點紀錄' };
const HEAD = {
  '班級': ['班級代碼', '班級名稱', '年級', '學期', '版本', '已教單元', '狀態', '建立日期', '考試名稱', '考試日期', '考試範圍'],
  '學生': ['班級代碼', '座號', '暱稱', '密碼', '金幣', '星星', '印章', '已兌換印章', '連續天數', '最後完成日', '總答題', '答對題', '已購買', '裝扮', '累積金幣', '已兌換金幣'],
  '題庫': ['題號', '版本', '年級', '學期', '科目', '單元', '觀念', '題型', '題目', '選項A', '選項B', '選項C', '選項D', '答案', '解析', '來源', '啟用'],
  '作答紀錄': ['時間', '日期', '班級代碼', '座號', '題號', '科目', '單元', '作答', '對錯'],
  '加點紀錄': ['時間', '班級代碼', '座號', '暱稱', '兌換印章數', '兌換金幣數', '換算點數', '備註']
};
// 這些欄位一律存成純文字，避免 0123、3/4 被試算表自動轉成數字或日期
const TEXT_COLS = {
  '班級': ['班級代碼', '班級名稱', '學期', '版本', '已教單元', '狀態', '建立日期', '考試名稱', '考試日期', '考試範圍'],
  '學生': ['班級代碼', '暱稱', '密碼', '最後完成日', '已購買', '裝扮'],
  '題庫': HEAD['題庫'].filter(h => h !== '年級'),
  '作答紀錄': ['時間', '日期', '班級代碼', '題號', '作答'],
  '加點紀錄': ['時間', '班級代碼', '備註']
};
const SUBJECTS = ['國語', '數學', '自然', '社會', '英文'];
const COMMON = '通用';
const TZ = 'Asia/Taipei';

/** 金幣商店：幫船長波波換裝。價格只在這裡設定，學生端無法竄改 */
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

/* ---------- 網頁入口 ---------- */

function doGet(e) {
  const teacher = e && e.parameter && e.parameter.page === 'teacher';
  return HtmlService.createHtmlOutputFromFile(teacher ? 'Teacher' : 'Index')
    .setTitle(teacher ? '知識群島 教師後台' : '知識群島')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
}

/* ---------- 初始化／升級 ---------- */

function setup() {
  const ss = ss_();
  Object.keys(HEAD).forEach(name => {
    let sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    if (sh.getLastRow() === 0) {
      sh.getRange(1, 1, 1, HEAD[name].length).setValues([HEAD[name]]);
    } else {
      // 舊版試算表：把缺少的欄位補在最後面
      const have = headers_(sh);
      const missing = HEAD[name].filter(h => have.indexOf(h) < 0);
      if (missing.length) sh.getRange(1, have.length + 1, 1, missing.length).setValues([missing]);
    }
    sh.setFrozenRows(1);
    const have = headers_(sh);
    (TEXT_COLS[name] || []).forEach(col => {
      const c = have.indexOf(col) + 1;
      if (c > 0) sh.getRange(1, c, sh.getMaxRows(), 1).setNumberFormat('@');
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
  // 新版設定項目：缺少的補在最後
  const setRows = set.getDataRange().getValues().map(r => String(r[0]).trim());
  [['每個印章換幾點', 1, '日常加點：1 個印章換幾點（填 0 表示印章不換點）'],
   ['每幾金幣換1點', 20, '日常加點：累積金幣每滿多少枚換 1 點（填 0 表示金幣不換點）。學生在商店花掉金幣不影響']]
    .forEach(row => { if (setRows.indexOf(row[0]) < 0) set.getRange(set.getLastRow() + 1, 1, 1, 3).setValues([row]); });
  // 舊資料補值：沒有版本的題目與班級視為「通用」
  ['題庫', '班級'].forEach(name => {
    const t = table_(name);
    t.rows.forEach(r => { if (!String(r['版本'] || '').trim()) { r['版本'] = COMMON; writeRow_(t, r); } });
  });
  // 舊版沒有「累積金幣」：用目前餘額加上已買東西的價格推算
  const stt = table_(SH.STU);
  stt.rows.forEach(r => {
    if (String(r['累積金幣']).trim() !== '') return;
    r['累積金幣'] = num_(r['金幣']) + owned_(r).reduce((a, id) => a + SHOP[id].price, 0);
    r['已兌換金幣'] = num_(r['已兌換金幣']);
    writeRow_(stt, r);
  });
  // 舊版的單元代號沒有版本（6上｜科目｜單元），補上「通用｜」
  const ct = table_(SH.CLS);
  ct.rows.forEach(c => {
    const fix = list => list.map(k => String(k).split('｜').length === 3 ? COMMON + '｜' + k : k);
    const u = json_(c['已教單元'], []), e = json_(c['考試範圍'], []);
    const u2 = fix(u), e2 = fix(e);
    if (JSON.stringify(u) !== JSON.stringify(u2) || JSON.stringify(e) !== JSON.stringify(e2)) {
      c['已教單元'] = JSON.stringify(u2); c['考試範圍'] = JSON.stringify(e2); writeRow_(ct, c);
    }
  });
  if (table_(SH.Q).rows.length === 0) append_(SH.Q, sampleQuestions_());
  if (!table_(SH.CLS).rows.some(r => r['班級代碼'] === 'DEMO')) {
    const units = unitCatalog_().map(u => u.key);
    append_(SH.CLS, [{ '班級代碼': 'DEMO', '班級名稱': '示範班', '年級': 6, '學期': '上', '版本': COMMON, '已教單元': JSON.stringify(units), '狀態': '進行中', '建立日期': today_(), '考試範圍': '[]' }]);
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
  const hist = history_(cls['班級代碼'], s['座號']);
  const isWrong = q => hist[q['題號']] && !hist[q['題號']].last;
  const prioritized = list => {
    const wrong = shuffle_(list.filter(isWrong));
    const fresh = shuffle_(list.filter(q => !hist[q['題號']]));
    const done = shuffle_(list.filter(q => hist[q['題號']] && hist[q['題號']].last));
    return wrong.slice(0, 3).concat(fresh, wrong.slice(3), done).slice(0, n);
  };
  let picked;
  if (SUBJECTS.indexOf(island) >= 0) {
    picked = prioritized(pool_(cls).filter(q => q['科目'] === island));
  } else if (island === '錯題') {
    picked = shuffle_(pool_(cls).filter(isWrong)).slice(0, n);
  } else if (island === '綜合') {
    const pool = pool_(cls);
    const by = SUBJECTS.map(sj => shuffle_(pool.filter(q => q['科目'] === sj)));
    picked = [];
    for (let i = 0; picked.length < n && by.some(b => b.length); i = (i + 1) % by.length) {
      if (by[i].length) picked.push(by[i].shift());
    }
  } else if (island === '段考') {
    const ex = exam_(cls);
    if (!ex) throw new Error('目前沒有要準備的考試。');
    picked = prioritized(poolFor_(ex.units));
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
    const stamp = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss');
    const day = today_();
    const logs = [], missed = {};
    let correct = 0;
    (responses || []).slice(0, 50).forEach(r => {
      const q = qmap[r.id];
      if (!q) return;
      const ok = grade_(q, r.answer);
      if (ok) correct++;
      else String(q['觀念'] || '').split(/[、,，|]/).map(x => x.trim()).filter(Boolean).forEach(c => missed[c] = 1);
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
    s['累積金幣'] = num_(s['累積金幣']) + correct;
    if (passed) s['星星'] = num_(s['星星']) + 1;
    s['總答題'] = num_(s['總答題']) + total;
    s['答對題'] = num_(s['答對題']) + correct;
    writeRow_(t, s);
    return { correct, total, passed, coins: correct, star: passed, stamp: gotStamp, missed: Object.keys(missed).slice(0, 4), state: state_(cls, s) };
  });
}

/** 用金幣買波波的裝扮；買了就直接穿上 */
function buyItem(cred, id) {
  return withLock_(() => {
    const { cls, s, t } = auth_(cred, false);
    const item = SHOP[id];
    if (!item) throw new Error('商店沒有這個東西。');
    const owned = owned_(s);
    if (owned.indexOf(id) >= 0) throw new Error('你已經有這個了。');
    if (num_(s['金幣']) < item.price) throw new Error('金幣還不夠，再去島上挑戰吧！');
    s['金幣'] = num_(s['金幣']) - item.price;
    owned.push(id);
    s['已購買'] = JSON.stringify(owned);
    const outfit = outfit_(s);
    outfit[item.slot] = id;
    s['裝扮'] = JSON.stringify(outfit);
    writeRow_(t, s);
    return state_(cls, s);
  });
}

function setOutfit(cred, outfit) {
  return withLock_(() => {
    const { cls, s, t } = auth_(cred, false);
    const owned = owned_(s);
    const next = outfit_(s);
    Object.keys(DEFAULT_OUTFIT).forEach(slot => {
      const id = outfit && outfit[slot];
      if (id && SHOP[id] && SHOP[id].slot === slot && (SHOP[id].price === 0 || owned.indexOf(id) >= 0)) next[slot] = id;
    });
    s['裝扮'] = JSON.stringify(next);
    writeRow_(t, s);
    return state_(cls, s);
  });
}

/* ---------- 老師 API ---------- */

function tLogin(pw) {
  checkPw_(pw);
  return {
    classes: table_(SH.CLS).rows.map(c => ({ code: c['班級代碼'], name: c['班級名稱'], grade: c['年級'], sem: c['學期'], version: c['版本'] || COMMON, status: c['狀態'] })),
    versions: versions_(),
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
  const rate = rate_();
  const concepts = q => String((q && q['觀念']) || '').split(/[、,，|]/).map(x => x.trim()).filter(Boolean);

  const per = {}, unitStat = {}, qStat = {}, cStat = {};
  logs.forEach(l => {
    const seat = Number(l['座號']);
    const ok = Number(l['對錯']) === 1;
    const p = per[seat] = per[seat] || { days: {}, latest: {} };
    const d = normDate_(l['日期']);
    if (d >= week) p.days[d] = 1;
    p.latest[l['題號']] = ok;
    const uk = l['科目'] + '｜' + l['單元'];
    const u = unitStat[uk] = unitStat[uk] || { unit: uk, right: 0, total: 0 };
    u.total++; if (ok) u.right++;
    const qs = qStat[l['題號']] = qStat[l['題號']] || { wrong: 0, total: 0 };
    qs.total++; if (!ok) qs.wrong++;
    const q = qmap[l['題號']];
    concepts(q).forEach(c => {
      const k = q['科目'] + '｜' + c;
      const cs = cStat[k] = cStat[k] || { concept: c, subject: q['科目'], right: 0, total: 0, people: {} };
      cs.total++; if (ok) cs.right++; else cs.people[seat] = 1;
    });
  });

  return {
    cls: classOut_(cls),
    rate,
    url: ScriptApp.getService().getUrl() + '?c=' + encodeURIComponent(cls['班級代碼']),
    students: students.map(s => {
      const p = per[Number(s['座號'])] || { days: {}, latest: {} };
      const weak = {};
      Object.keys(p.latest).forEach(id => { if (!p.latest[id]) concepts(qmap[id]).forEach(c => weak[c] = (weak[c] || 0) + 1); });
      return {
        seat: Number(s['座號']), nick: s['暱稱'] || '', hasPin: !!String(s['密碼']).trim(),
        coins: num_(s['金幣']), stars: num_(s['星星']), earned: num_(s['累積金幣']),
        stamps: num_(s['印章']) - num_(s['已兌換印章']), stampsTotal: num_(s['印章']),
        coinsPending: num_(s['累積金幣']) - num_(s['已兌換金幣']),
        points: pointsFor_(s, rate).points,
        streak: liveStreak_(s), last: normDate_(s['最後完成日']),
        weekDays: Object.keys(p.days).length,
        total: num_(s['總答題']), right: num_(s['答對題']),
        wrongNow: Object.keys(p.latest).filter(k => !p.latest[k]).length,
        weak: Object.keys(weak).sort((a, b) => weak[b] - weak[a]).slice(0, 2)
      };
    }).sort((a, b) => a.seat - b.seat),
    units: unitCatalog_(),
    versions: versions_(),
    weakUnits: Object.keys(unitStat).map(k => unitStat[k]).filter(u => u.total >= 5)
      .sort((a, b) => a.right / a.total - b.right / b.total).slice(0, 6),
    weakConcepts: Object.keys(cStat).map(k => cStat[k]).filter(c => c.total >= 3)
      .map(c => ({ concept: c.concept, subject: c.subject, right: c.right, total: c.total, people: Object.keys(c.people).map(Number).sort((a, b) => a - b) }))
      .sort((a, b) => a.right / a.total - b.right / b.total).slice(0, 8),
    hardQs: Object.keys(qStat).filter(id => qmap[id] && qStat[id].total >= 3 && qStat[id].wrong > 0)
      .map(id => ({ id, text: qmap[id]['題目'], subject: qmap[id]['科目'], unit: qmap[id]['單元'], answer: cellText_(qmap[id]['答案']), wrong: qStat[id].wrong, total: qStat[id].total }))
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
    if (data.version) c['版本'] = String(data.version).trim();
    if (data.status) c['狀態'] = data.status;
    if (data.exam) {
      if (data.exam.date && !/^\d{4}-\d{2}-\d{2}$/.test(data.exam.date)) throw new Error('考試日期格式不對。');
      c['考試名稱'] = String(data.exam.name || '').trim().slice(0, 20);
      c['考試日期'] = data.exam.date || '';
      c['考試範圍'] = JSON.stringify(data.exam.units || []);
    }
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
    append_(SH.CLS, [{ '班級代碼': code, '班級名稱': data.name || code, '年級': Number(data.grade) || 6, '學期': data.sem || '上', '版本': String(data.version || COMMON).trim(), '已教單元': '[]', '狀態': '進行中', '建立日期': today_(), '考試範圍': '[]' }]);
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

/** 加點換算比例（在「設定」分頁調整） */
function rate_() {
  const set = settings_();
  const v = (k, d) => (set[k] === undefined || String(set[k]).trim() === '') ? d : Math.max(0, Number(set[k]) || 0);
  return { perStamp: v('每個印章換幾點', 1), coinsPerPoint: v('每幾金幣換1點', 20) };
}

/** 這位學生現在可以換多少點：還沒兌換的印章 + 還沒兌換的累積金幣（每滿 N 枚換 1 點，餘數留到下次） */
function pointsFor_(s, rate) {
  const stamps = num_(s['印章']) - num_(s['已兌換印章']);
  const coins = num_(s['累積金幣']) - num_(s['已兌換金幣']);
  const coinPts = rate.coinsPerPoint > 0 ? Math.floor(coins / rate.coinsPerPoint) : 0;
  const stampPts = stamps * rate.perStamp;
  return { stamps, coinsUsed: coinPts * rate.coinsPerPoint, coinPts, stampPts, points: stampPts + coinPts };
}

/**
 * 日常加點：把學生還沒兌換的印章與累積金幣換成點數，記到「加點紀錄」。
 * 學生的金幣餘額不會被扣，他們照樣可以在商店使用。
 */
function tRedeem(pw, code, seats, note) {
  checkPw_(pw);
  return withLock_(() => {
    const t = table_(SH.STU);
    const rate = rate_();
    const want = (seats || []).map(Number);
    const stamp = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss');
    const out = [];
    t.rows.forEach(s => {
      if (!sameCode_(s['班級代碼'], code) || want.indexOf(Number(s['座號'])) < 0) return;
      const p = pointsFor_(s, rate);
      if (p.points <= 0) return;
      if (p.stampPts > 0) s['已兌換印章'] = num_(s['印章']);
      s['已兌換金幣'] = num_(s['已兌換金幣']) + p.coinsUsed;
      writeRow_(t, s);
      out.push({ '時間': stamp, '班級代碼': s['班級代碼'], '座號': s['座號'], '暱稱': s['暱稱'] || '', '兌換印章數': p.stampPts > 0 ? p.stamps : 0, '兌換金幣數': p.coinsUsed, '換算點數': p.points, '備註': note || '' });
    });
    append_(SH.PTS, out);
    return out.map(o => ({ seat: Number(o['座號']), nick: o['暱稱'], stamps: o['兌換印章數'], coins: o['兌換金幣數'], points: o['換算點數'] }));
  });
}

/**
 * 匯入題目。可貼上 CSV 或從試算表複製的表格（Tab 分隔）。
 * 有標題列時依標題對應欄位；沒有標題列時欄位順序為：
 *   版本, 年級, 學期, 科目, 單元, 觀念, 題型, 題目, 選項A, 選項B, 選項C, 選項D, 答案, 解析
 */
const IMPORT_COLS = ['版本', '年級', '學期', '科目', '單元', '觀念', '題型', '題目', '選項A', '選項B', '選項C', '選項D', '答案', '解析'];
function tImport(pw, text, source, defaultVersion) {
  checkPw_(pw);
  return withLock_(() => {
    const lines = parseTable_(String(text || ''));
    let cols = IMPORT_COLS, start = 0;
    if (lines.length && lines[0].some(c => String(c).trim() === '題目')) {
      cols = lines[0].map(c => String(c).trim());
      start = 1;
    }
    const rows = [], errors = [];
    const base = Utilities.formatDate(new Date(), TZ, 'yyMMddHHmmss');
    for (let i = start; i < lines.length; i++) {
      const cells = lines[i];
      if (!cells.join('').trim()) continue;
      const v = {};
      cols.forEach((c, j) => v[c] = String(cells[j] == null ? '' : cells[j]).trim());
      v['版本'] = v['版本'] || String(defaultVersion || COMMON).trim();
      v['學期'] = (v['學期'] || '').replace('學期', '');
      const msg = validateQ_(v);
      if (msg) { errors.push('第 ' + (i + 1) + ' 行：' + msg); continue; }
      rows.push({ '題號': 'Q' + base + ('00' + rows.length).slice(-3), '版本': v['版本'], '年級': Number(v['年級']), '學期': v['學期'], '科目': v['科目'], '單元': v['單元'], '觀念': v['觀念'] || '', '題型': v['題型'], '題目': v['題目'], '選項A': v['選項A'] || '', '選項B': v['選項B'] || '', '選項C': v['選項C'] || '', '選項D': v['選項D'] || '', '答案': v['答案'], '解析': v['解析'] || '', '來源': source || '老師', '啟用': 'Y' });
    }
    append_(SH.Q, rows);
    return { added: rows.length, errors: errors.slice(0, 30) };
  });
}

/* ---------- 內部工具 ---------- */

function ss_() { return SpreadsheetApp.getActive(); }

function headers_(sh) {
  const n = sh.getLastColumn();
  return n ? sh.getRange(1, 1, 1, n).getValues()[0].map(String) : [];
}

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
  const h = headers_(sh);
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
function json_(v, def) { try { const x = JSON.parse(v || ''); return x == null ? def : x; } catch (e) { return def; } }

function findClass_(code) {
  const c = table_(SH.CLS).rows.find(r => sameCode_(r['班級代碼'], code));
  if (!c) throw new Error('找不到班級代碼「' + code + '」。');
  return c;
}

function classOut_(c) {
  return {
    code: c['班級代碼'], name: c['班級名稱'], grade: c['年級'], sem: c['學期'], version: c['版本'] || COMMON, status: c['狀態'],
    units: json_(c['已教單元'], []),
    exam: { name: c['考試名稱'] || '', date: normDate_(c['考試日期']), units: json_(c['考試範圍'], []) }
  };
}

function newStudent_(code, seat) {
  return { '班級代碼': code, '座號': seat, '暱稱': '', '密碼': '', '金幣': 0, '星星': 0, '印章': 0, '已兌換印章': 0, '連續天數': 0, '最後完成日': '', '總答題': 0, '答對題': 0, '已購買': '[]', '裝扮': JSON.stringify(DEFAULT_OUTFIT), '累積金幣': 0, '已兌換金幣': 0 };
}

function owned_(s) { return json_(s['已購買'], []).filter(id => SHOP[id]); }
function outfit_(s) {
  const o = json_(s['裝扮'], {});
  const out = {};
  Object.keys(DEFAULT_OUTFIT).forEach(k => out[k] = SHOP[o[k]] ? o[k] : DEFAULT_OUTFIT[k]);
  return out;
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

/** 單元代號：版本｜6上｜科目｜單元。同一個單元名稱在不同出版社會分開 */
function unitKey_(q) { return (String(q['版本'] || '').trim() || COMMON) + '｜' + q['年級'] + String(q['學期']) + '｜' + q['科目'] + '｜' + q['單元']; }

function unitCatalog_() {
  const m = {};
  table_(SH.Q).rows.forEach(q => {
    if (!q['題號'] || String(q['啟用']).toUpperCase() === 'N') return;
    const k = unitKey_(q);
    m[k] = m[k] || { key: k, version: String(q['版本'] || '').trim() || COMMON, grade: Number(q['年級']), sem: String(q['學期']), subject: q['科目'], unit: q['單元'], count: 0 };
    m[k].count++;
  });
  return Object.keys(m).map(k => m[k]).sort((a, b) =>
    a.version.localeCompare(b.version) || a.grade - b.grade || a.sem.localeCompare(b.sem) || SUBJECTS.indexOf(a.subject) - SUBJECTS.indexOf(b.subject));
}

function versions_() {
  const v = {};
  [COMMON, '南一', '康軒', '翰林'].forEach(x => v[x] = 1);
  table_(SH.Q).rows.forEach(q => { const x = String(q['版本'] || '').trim(); if (x) v[x] = 1; });
  table_(SH.CLS).rows.forEach(c => { const x = String(c['版本'] || '').trim(); if (x) v[x] = 1; });
  return Object.keys(v);
}

function poolFor_(units) {
  const set = {};
  (units || []).forEach(u => set[u] = 1);
  return table_(SH.Q).rows.filter(q => q['題號'] && String(q['啟用']).toUpperCase() !== 'N' && set[unitKey_(q)]);
}
function pool_(cls) { return poolFor_(json_(cls['已教單元'], [])); }

function exam_(cls) {
  const date = normDate_(cls['考試日期']);
  const units = json_(cls['考試範圍'], []);
  if (!date || !units.length || date < today_()) return null;
  const days = Math.round((Date.parse(date + 'T00:00:00Z') - Date.parse(today_() + 'T00:00:00Z')) / 864e5);
  return { name: cls['考試名稱'] || '段考', date, units, days };
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
  let exam = exam_(cls);
  if (exam) {
    const ep = poolFor_(exam.units);
    exam = { name: exam.name, date: exam.date, days: exam.days, total: ep.length, mastered: ep.filter(q => hist[q['題號']] && hist[q['題號']].last).length };
  }
  return {
    className: cls['班級名稱'], seat: Number(s['座號']), nick: s['暱稱'] || '',
    coins: num_(s['金幣']), earned: num_(s['累積金幣']), stars: num_(s['星星']), stamps: num_(s['印章']),
    streak: liveStreak_(s), todayDone: normDate_(s['最後完成日']) === today_(),
    islands, wrong, exam, perRound: Number(settings_()['每回合題數']) || 10,
    owned: owned_(s), outfit: outfit_(s), shop: SHOP
  };
}

function publicQ_(q) {
  const options = ['選項A', '選項B', '選項C', '選項D'].map(k => cellText_(q[k])).filter(Boolean);
  return { id: q['題號'], subject: q['科目'], unit: q['單元'], concept: cellText_(q['觀念']), type: q['題型'], text: cellText_(q['題目']), options, answer: cellText_(q['答案']), explain: cellText_(q['解析']) };
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

function validateQ_(v) {
  if (!/^[1-6]$/.test(v['年級'])) return '年級要填 1 到 6';
  if (!/^[上下]$/.test(v['學期'])) return '學期要填「上」或「下」';
  if (SUBJECTS.indexOf(v['科目']) < 0) return '科目要是 ' + SUBJECTS.join('、') + ' 其中之一';
  if (!v['單元']) return '缺少單元名稱';
  if (!v['題目']) return '缺少題目';
  if (['選擇', '是非', '填空'].indexOf(v['題型']) < 0) return '題型要是 選擇、是非、填空';
  if (!v['答案']) return '缺少答案';
  if (v['題型'] === '選擇' && (!v['選項A'] || !v['選項B'])) return '選擇題至少要有選項A和選項B';
  if (v['題型'] === '選擇' && !/^[A-Da-d]$/.test(v['答案'])) return '選擇題答案請填 A、B、C 或 D';
  if (v['題型'] === '是非' && tf_(v['答案']) === null) return '是非題答案請填 O 或 X';
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
    ['國語', '詞語運用', '成語意思', '選擇', '「他做事總是半途而廢」中的「半途而廢」是什麼意思？', '做到一半就放棄', '走路走到一半', '把東西丟掉一半', '只做一半的工作量', 'A', '比喻做事不能堅持到底。'],
    ['國語', '詞語運用', '成語運用', '選擇', '下列哪一個詞語用得正確？', '他的成績一落千丈，大家都很羨慕', '這幅畫栩栩如生，好像真的一樣', '他說話語無倫次，條理分明', '比賽結果出爐，大家都忐忑不安地慶祝', 'B', '栩栩如生：形容藝術作品逼真生動。'],
    ['國語', '修辭', '擬人', '是非', '「月亮害羞地躲進雲裡」用了擬人法。', '', '', '', '', 'O', '把月亮當成人來寫，會「害羞」。'],
    ['國語', '修辭', '譬喻', '填空', '「時間就像流水，一去不回頭」使用的修辭法是（　）法。', '', '', '', '', '譬喻|明喻', '有「像」把時間比喻成流水，是譬喻（明喻）。'],
    ['數學', '分數除法', '分數除以分數', '填空', '3/4 ÷ 1/2 = ？（用最簡分數或帶分數作答）', '', '', '', '', '3/2|1又1/2|1 1/2|1.5', '3/4 × 2 = 6/4 = 3/2。'],
    ['數學', '分數除法', '包含除應用題', '選擇', '一條 5/6 公尺的緞帶，每 1/6 公尺剪一段，可以剪幾段？', '4 段', '5 段', '6 段', '30 段', 'B', '5/6 ÷ 1/6 = 5。'],
    ['數學', '圓面積', '圓面積公式', '填空', '半徑 10 公分的圓，面積是多少平方公分？（圓周率用 3.14）', '', '', '', '', '314', '10 × 10 × 3.14 = 314。'],
    ['數學', '圓面積', '半徑與直徑', '是非', '圓的直徑是半徑的 2 倍。', '', '', '', '', 'O', ''],
    ['自然', '天氣變化', '氣壓', '選擇', '颱風來臨前，氣壓通常會怎麼變化？', '變高', '變低', '不變', '忽高忽低', 'B', '颱風是低氣壓系統。'],
    ['自然', '天氣變化', '鋒面', '是非', '鋒面通過時，常常會帶來降雨。', '', '', '', '', 'O', ''],
    ['自然', '熱對物質的影響', '熱脹冷縮', '選擇', '鐵軌之間要留一點縫隙，主要是為了什麼？', '省材料', '排水', '預留熱脹冷縮的空間', '讓火車跑得更快', 'C', '夏天鐵軌受熱膨脹，需要空間。'],
    ['自然', '熱對物質的影響', '熱的傳播', '填空', '熱的傳播方式有傳導、對流和（　）。', '', '', '', '', '輻射', ''],
    ['社會', '地方自治', '選舉', '選擇', '下列哪一位是由人民直接選出來的？', '鄉（鎮、市）長', '學校校長', '警察局長', '法官', 'A', '地方首長由居民投票選出。'],
    ['社會', '地方自治', '選舉', '是非', '在臺灣，年滿 18 歲就可以參加總統選舉投票。', '', '', '', '', 'X', '總統選舉投票年齡目前是年滿 20 歲。'],
    ['社會', '臺灣的地理', '地形', '選擇', '臺灣最高的山是哪一座？', '雪山', '玉山', '阿里山', '合歡山', 'B', '玉山主峰約 3952 公尺。'],
    ['社會', '臺灣的地理', '河川', '填空', '臺灣最長的河流是（　）溪。', '', '', '', '', '濁水', ''],
    ['英文', 'Unit 1 單字', '第一人稱動詞', '選擇', '"I usually ____ to school by bus."', 'go', 'goes', 'going', 'went', 'A', '主詞 I 用原形動詞。'],
    ['英文', 'Unit 1 單字', '場所單字', '填空', '「圖書館」的英文是？', '', '', '', '', 'library', ''],
    ['英文', 'Unit 2 時態', '過去式', '選擇', '"She ____ TV last night."', 'watch', 'watches', 'watched', 'watching', 'C', 'last night 表示過去，用過去式。'],
    ['英文', 'Unit 2 時態', '第三人稱否定', '是非', '"He don\'t like apples." 這句話文法正確。', '', '', '', '', 'X', '應該是 He doesn\'t like apples.']
  ];
  return raw.map((r, i) => ({ '題號': 'S' + ('00' + (i + 1)).slice(-3), '版本': COMMON, '年級': 6, '學期': '上', '科目': r[0], '單元': r[1], '觀念': r[2], '題型': r[3], '題目': r[4], '選項A': r[5], '選項B': r[6], '選項C': r[7], '選項D': r[8], '答案': r[9], '解析': r[10], '來源': '範例', '啟用': 'Y' }));
}
