// 端對端測試：用全新的本機資料庫啟動 wrangler dev，再用瀏覽器操作學生端與教師後台
import { spawn, execSync } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
mkdirSync('test-results', { recursive: true });
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const PORT = 8788, BASE = `http://127.0.0.1:${PORT}`, PW = 'test-pass-123', IMPORT_TOKEN = 'test-import-token-0123456789';
const dir = mkdtempSync(join(tmpdir(), 'ki-'));
let current = '啟動';
// 保險：整個測試超過 4 分鐘就印出卡在哪裡並結束，不會一直卡住
const watchdog = setTimeout(() => { console.error('\n測試超時，卡在：' + current + '\n--- wrangler 輸出 ---\n' + log.slice(-4000)); stop(); process.exit(1); }, 240e3);
console.log('套用資料表…');
execSync(`npx wrangler d1 migrations apply DB --local --persist-to ${dir}`, { stdio: ['ignore', 'ignore', 'inherit'], timeout: 120e3 });
console.log('啟動 wrangler dev…');
const dev = spawn('npx', ['wrangler', 'dev', '--port', String(PORT), '--ip', '127.0.0.1', '--persist-to', dir, '--var', 'TEACHER_PASSWORD:' + PW, '--var', 'SHOP_DAY:2026-11-27', '--var', 'IMPORT_TOKEN:' + IMPORT_TOKEN], { stdio: ['ignore', 'pipe', 'pipe'], detached: true });
let log = ''; dev.stdout.on('data', d => log += d); dev.stderr.on('data', d => log += d);
const stop = () => { try { process.kill(-dev.pid); } catch (e) {} rmSync(dir, { recursive: true, force: true }); };

async function waitUp() {
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(BASE + '/', { signal: AbortSignal.timeout(3000) })).ok) return; } catch (e) {}
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error('wrangler dev 沒有啟動：\n' + log);
}
const call = async (fn, ...args) => (await (await fetch(BASE + '/api/' + fn, { method: 'POST', body: JSON.stringify({ args }), signal: AbortSignal.timeout(15000) })).json());

// 學生第一次登入會跳出更新公告：捲到最下面再關掉
async function closeNews(p) {
  if (!(await p.$('#news'))) return;
  await p.$eval('#news .box', b => { b.scrollTop = b.scrollHeight; });
  await p.waitForFunction(() => !document.querySelector('#bNewsOk').disabled);
  await p.click('#bNewsOk');
}
let passed = 0;
// 等畫面出現某段提示文字（取代固定等待時間，網路慢也不會誤判）
const toastHas = (p, text) => p.waitForFunction(t => document.querySelector('#toast').textContent.includes(t), text);
const pages = [];
async function step(name, fn) {
  current = name;
  try { await fn(); } catch (e) {
    console.error('  ✗ ' + name);
    for (const [i, p] of pages.entries()) await p.screenshot({ path: `test-results/fail-${i}.png`, fullPage: true }).catch(() => {});
    throw e;
  }
  passed++; console.log('  ✓ ' + name);
}

try {
  await waitUp();
  const browser = await chromium.launch({ channel: process.env.CI ? 'chrome' : undefined, env: { ...process.env, LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' } });  // 中文檔名需要 UTF-8 語系
  const errors = [];
  const page = async (path, w = 900) => {
    const p = await browser.newPage({ viewport: { width: w, height: 1000 } });
    p.on('pageerror', e => errors.push(path + ': ' + e.message));
    await p.goto(BASE + path);
    pages.push(p);
    return p;
  };

  // 答題輔助：wrongAt 裡的題目故意答錯
  // wrongAt：這幾題答錯（有第二次機會的題目，第二次也答錯）；retryAt：第一次答錯、看提示後第二次答對
  async function play(p, island, wrongAt = [], retryAt = []) {
    await p.click(`[data-island="${island}"]`);
    if (await p.$('#pick')) await p.click('#pick [data-go]');  // 科目島先選「全部單元混合」
    await p.waitForSelector('#vQuiz:not(.hidden)');
    const give = async (q, a) => {
      if (q.type === '填空') { await p.fill('#iFill', a); await p.click('#fFill button'); }
      else await p.click(`#qBody .opt[data-a="${a}"]`);
    };
    for (let i = 0; ; i++) {
      const q = await p.evaluate(() => round.qs[round.i]);
      const right = q.answer.split('|')[0];
      const wrong = (not = []) => q.type === '選擇' ? 'ABCD'.split('').find(x => x !== right && !not.includes(x) && q.options['ABCD'.indexOf(x)]) : q.type === '是非' ? (right === 'O' ? 'X' : 'O') : 'zzz' + not.length;
      if (wrongAt.includes(i) || retryAt.includes(i)) {
        const w1 = wrong();
        await give(q, w1);
        if (q.type !== '是非') {  // 第一次答錯：先出現提示，再答一次
          await p.waitForFunction(() => document.querySelector('#qFb').textContent.includes('提示'));
          await give(q, retryAt.includes(i) ? right : wrong([w1]));
        }
      } else await give(q, right);
      const last = await p.evaluate(() => round.i === round.qs.length - 1);
      await p.click('#bNext');
      if (last) break;
    }
    await p.waitForSelector('#vResult:not(.hidden)');
    const text = (await p.textContent('#resultBox')).replace(/\s+/g, ' ');
    await p.click('#bBack');
    return text;
  }

  console.log('學生端');
  const s = await page('/?c=demo');
  await step('第一次登入會設定密碼', async () => {
    assert.equal(await s.inputValue('#iCode'), 'DEMO');
    await s.fill('#iSeat', '1'); await s.fill('#iPin', '1234'); await s.fill('#iNick', '小海');
    await s.click('#bLogin'); await s.waitForSelector('#vMap:not(.hidden)');
    assert.match(await s.textContent('#whoName'), /小海/);
  });
  await step('更新公告：登入跳出，看完才能關，之後不再跳出（換裝置也一樣）', async () => {
    await s.waitForSelector('#news');
    assert.match(await s.textContent('#news'), /這次更新了什麼/);
    assert.match(await s.textContent('#news'), /國語、數學是主力島/);  // 主力科目自動帶入公告
    assert.ok(!(await s.textContent('#news')).includes('{F}'));
    await s.setViewportSize({ width: 360, height: 500 });  // 小螢幕：要往下捲才看得完
    await s.waitForFunction(() => document.querySelector('#bNewsOk').disabled);
    await s.$eval('#news .box', b => { b.scrollTop = b.scrollHeight; });
    await s.waitForFunction(() => !document.querySelector('#bNewsOk').disabled);
    await s.click('#bNewsOk'); assert.equal(await s.locator('#news').count(), 0);
    await s.setViewportSize({ width: 900, height: 1000 });
    const st = await (async () => { for (let i = 0; i < 20; i++) { const x = (await call('studentLogin', { code: 'DEMO', seat: 1, pin: '1234' })).ok; if (x && x.newsSeen) return x; await new Promise(r => setTimeout(r, 200)); } })();
    assert.ok(st && st.newsSeen, '看完的版本沒有記下來');
    // 航海手冊最下面可以再打開來看
    await s.click('#bGuide2'); await s.click('#bNewsAgain'); await s.waitForSelector('#news');
    assert.equal(await s.locator('#bNewsOk').isDisabled(), false);
    await s.click('#bNewsOk'); await s.click('#bGuideBack');
  });
  await step('密碼錯誤會被擋下，錯 5 次會鎖住', async () => {
    for (let i = 0; i < 4; i++) assert.match((await call('studentLogin', { code: 'DEMO', seat: 1, pin: '0000' })).err, /密碼不對/);
    assert.match((await call('studentLogin', { code: 'DEMO', seat: 1, pin: '0000' })).err, /錯太多次/);
    assert.match((await call('studentLogin', { code: 'DEMO', seat: 1, pin: '1234' })).err, /錯太多次/);
  });
  await step('過關得到金幣、星星、今日印章', async () => {
    await call('tResetPin', PW, 'DEMO', 1);  // 老師解鎖
    await call('studentLogin', { code: 'DEMO', seat: 1, pin: '1234' });
    const t = await play(s, '數學', [0]);
    assert.match(t, /過關/); assert.match(t, /今日印章/);
    const m = t.match(/(\d+) \/ (\d+) 金幣\+(\d+)/); assert.ok(m); assert.equal(Number(m[3]), Math.round((Number(m[2]) - 1) * 1.5));  // 錯 1 題；數學是主力島，金幣 ×1.5
    assert.match(t, /主力島加成/);
    assert.equal(await s.textContent('#cStreak'), '1');
    assert.match(await s.textContent('[data-island="錯題"] .meta'), /1 題/);
  });
  await step('錯題礁答對後會移除錯題', async () => {
    const t = await play(s, '錯題');
    assert.match(t, /1 \/ 1/);
    assert.match(await s.textContent('[data-island="錯題"] .meta'), /沒有錯題/);
  });
  await step('伺服器重新計分，送假答案拿不到金幣', async () => {
    const qs = (await call('getRound', { code: 'DEMO', seat: 1, pin: '1234' }, '國語')).ok;
    const r = (await call('submitRound', { code: 'DEMO', seat: 1, pin: '1234' }, '國語', qs.map(q => ({ id: q.id, answer: 'nope' })).concat(qs.map(q => ({ id: q.id, answer: 'nope' }))))).ok;
    assert.equal(r.correct, 0); assert.equal(r.total, qs.length);  // 重複送同一題只算一次
  });
  await step('選擇題每次換選項順序，答案也跟著換', async () => {
    const cred = { code: 'DEMO', seat: 1, pin: '1234' };
    const orders = new Set();
    for (let i = 0; i < 8; i++) {
      const q = (await call('getRound', cred, '社會')).ok.find(x => x.id === 'S015');  // 臺灣最高的山
      orders.add(q.options.join('/'));
      assert.equal(q.options['ABCD'.indexOf(q.answer)], '玉山');
    }
    assert.ok(orders.size > 1, '選項順序都一樣');
  });
  for (const isl of ['自然', '社會', '英文', '綜合']) await play(s, isl);
  await step('商店：金幣不夠買不了，夠了可以買和穿', async () => {
    await s.click('#bShop'); await s.waitForSelector('#vShop:not(.hidden)');
    // 上架行事曆：只有文字，列出之後每週的新品
    assert.match(await s.textContent('#vShop .sched'), /上架行事曆[\s\S]*動物朋友[\s\S]*畢業典禮與皇家/);
    assert.equal(await s.locator('#vShop .sched svg').count(), 0);
    const coins = Number(await s.textContent('#shopCoins'));
    assert.ok(coins >= 20 && coins < 150, 'coins=' + coins);
    await s.click('.item[data-id="color_gold"]'); assert.match(await s.textContent('#bShopAct'), /還差/);
    assert.match((await call('buyItem', { code: 'DEMO', seat: 1, pin: '1234' }, 'color_gold')).err, /不夠/);
    // 星星特別款：星星不夠，就算金幣夠也買不了
    await s.click('.item[data-id="hat_stars"]'); assert.match(await s.textContent('#bShopAct'), /顆星星/);
    assert.match(await s.textContent('.item[data-id="hat_stars"]'), /解鎖/);
    assert.match((await call('buyItem', { code: 'DEMO', seat: 1, pin: '1234' }, 'hat_stars')).err, /星星/);
    // 套裝：關鍵物品的星星＋徽章不夠，整套買不了；單品可以單買
    await s.click('.item[data-set="set_space"]'); assert.match(await s.textContent('#bShopAct'), /顆星星/);
    assert.match(await s.textContent('#shopMsg'), /單買/);
    assert.match((await call('buySet', { code: 'DEMO', seat: 1, pin: '1234' }, 'set_space')).err, /星星/);
    assert.match((await call('buyItem', { code: 'DEMO', seat: 1, pin: '1234' }, 'hat_astro')).err, /星星/);
    assert.match(await s.textContent('.item[data-id="glove_space"]'), /太空人/);
    await s.click('.item[data-id="hat_flower"]'); await s.click('#bShopAct');
    await s.waitForFunction(() => document.querySelector('#shopMsg').textContent.includes('買到了'));
    assert.equal(Number(await s.textContent('#shopCoins')), coins - 20);
    await s.click('.item[data-id="hat_sailor"]'); await s.click('#bShopAct');
    await s.waitForFunction(() => document.querySelector('#shopMsg').textContent.includes('換好了'));
    // 脫下：穿著的東西按鈕變「脫下」，再點一次那件也能脫掉；「全部脫下」一次脫光
    assert.equal((await s.textContent('#bShopAct')).trim(), '脫下');
    await s.click('.item[data-id="hat_sailor"]');
    await s.waitForFunction(() => document.querySelector('#shopMsg').textContent.includes('脫下「水手帽」'));
    assert.equal((await call('studentLogin', { code: 'DEMO', seat: 1, pin: '1234' })).ok.outfit.hat, 'hat_none');
    await s.click('#bShopBare'); await s.waitForFunction(() => document.querySelector('#shopMsg').textContent.includes('都脫下了'));
    // 耳朵顏色：海豹試穿時借小兔給大家看
    await s.click('.item[data-id="ear_red"]'); assert.match(await s.textContent('#shopMsg'), /借小兔/);
    // 背景：新的欄位，試穿時舞台上看得到；還沒買的不能穿
    await s.click('.item[data-id="bg_beach"]'); assert.ok(await s.locator('#shopStage clipPath').count() >= 1, '試穿背景沒有畫出來');
    assert.equal((await call('setOutfit', { code: 'DEMO', seat: 1, pin: '1234' }, { bg: 'bg_beach' })).ok.outfit.bg, 'bg_none');
    await s.click('#bShopBack');
  });

  console.log('教師後台');
  const t = await page('/teacher', 1200);
  await step('老師密碼錯誤會被擋下', async () => {
    await t.fill('#iPw', 'wrong'); await t.click('#fLogin button');
    await t.waitForFunction(() => document.querySelector('#loginErr').textContent.length > 0);
  });
  await step('學生登入頁有老師登入連結', async () => {
    const p = await page('/');
    await p.click('#teacherLink'); await p.waitForSelector('#fLogin');
    assert.match(p.url(), /\/teacher$/);
  });
  await step('學生亂試老師密碼只會鎖住自己的裝置', async () => {
    const tryPw = async (pw, ip) => (await (await fetch(BASE + '/api/tLogin', { method: 'POST', headers: { 'cf-connecting-ip': ip }, body: JSON.stringify({ args: [pw] }) })).json());
    for (let i = 0; i < 9; i++) assert.match((await tryPw('guess' + i, '10.0.0.9')).err, /不正確/);
    assert.match((await tryPw('guess9', '10.0.0.9')).err, /太多次/);
    assert.match((await tryPw(PW, '10.0.0.9')).err, /太多次/);   // 被鎖的裝置連正確密碼也進不去
    assert.ok((await tryPw(PW, '10.0.0.10')).ok);                 // 老師的裝置不受影響
  });
  await step('登入後看到學生與可加點數', async () => {
    await t.fill('#iPw', PW); await t.click('#fLogin button'); await t.waitForSelector('#vApp:not(.hidden)');
    await t.waitForSelector('.cStu[value="1"]');
    const row = (await t.textContent('#stuTbl tbody tr')).replace(/\s+/g, ' ');
    assert.match(row, /小海/);
  });
  await step('換點：花掉的金幣照樣算，剩下的留到下次', async () => {
    const before = (await call('tDashboard', PW, 'DEMO')).ok.students[0];
    assert.equal(before.coins, before.earned - 20);   // 商店花了 20
    const expect = before.stamps + Math.floor(before.earned / 20);
    await t.check('.cStu[value="1"]'); await t.fill('#iNote', '測試加點'); await t.click('#bRedeem');
    await t.waitForSelector('#lastRedeem:not(.hidden)');
    assert.match(await t.textContent('#lastRedeem'), new RegExp('共 1 人、' + expect + ' 點'));
    const after = (await call('tDashboard', PW, 'DEMO')).ok.students[0];
    assert.equal(after.coinsPending, before.earned % 20); assert.equal(after.coins, before.coins);
  });
  await step('匯入題目（有標題列、欄位順序不同、含錯誤行）', async () => {
    await t.click('[data-tab="tImport"]');
    // 版本是下拉式選單，可以新增其他版本（先取消「依這班各科的版本」才會出現）
    await t.uncheck('#iVerAuto');
    assert.deepEqual(await t.$$eval('#iVer option', o => o.map(x => x.textContent)), ['南一', '康軒', '翰林', '通用', '＋ 其他版本…']);
    t.once('dialog', d => d.accept('部編'));
    await t.selectOption('#iVer', '__new__');
    assert.equal(await t.inputValue('#iVer'), '部編');
    assert.ok((await t.$$eval('#nV0 option', o => o.map(x => x.value))).includes('部編'));
    await t.selectOption('#iVer', '南一'); await t.check('#iVerAuto');
    await t.fill('#iImport', '題目\t題型\t答案\t年級\t學期\t科目\t單元\t觀念\t選項A\t選項B\t選項C\t選項D\t版本\n1/2 + 1/3 = ?\t選擇\tB\t6\t上\t數學\t分數加減\t通分\t2/5\t5/6\t1/6\t2/6\t南一\n2/3 + 1/4 = ?\t填空\t11/12\t6\t上\t數學\t分數加減\t通分\t\t\t\t\t南一\n5 公尺 = ? 公分\t填空\t500\t6\t上\t數學\t長度\t單位換算\t\t\t\t\t康軒\n壞掉的\t選擇\tE\t6\t上\t數學\tX\t\t1\t2\t\t\t南一');
    await t.click('#bImport'); await t.waitForFunction(() => document.querySelector('#importMsg').textContent.includes('成功'));
    const m = await t.textContent('#importMsg');
    assert.match(m, /成功匯入 3 題/); assert.match(m, /第 5 行/);
  });
  await step('班級改成南一版，只看得到南一和通用單元', async () => {
    await t.click('[data-tab="tClass"]'); await t.selectOption('#eVAll', '南一'); await t.click('#bSaveCls'); await toastHas(t, '已儲存');
    await t.click('[data-tab="tUnits"]');
    await t.waitForSelector('#unitBox .semhead h3:text-is("南一版・6年級上學期")', { timeout: 5000 });
    const groups = await t.$$eval('#unitBox .semhead h3', e => e.map(x => x.textContent));
    assert.deepEqual(groups, ['南一版・6年級上學期', '通用・6年級上學期']);
    await t.click('#unitBox [data-all="南一版・6年級上學期"]'); await t.click('#bSaveUnits'); await toastHas(t, '進度已儲存');
  });
  await step('設定段考，學生地圖出現倒數和衝刺島', async () => {
    const d = new Date(Date.now() + 8 * 3600e3 + 8 * 864e5).toISOString().slice(0, 10);
    await t.fill('#exName', '第一次段考'); await t.fill('#exDate', d);
    await t.click('#examBox [data-all="南一版・6年級上學期"]'); await t.click('#bSaveExam'); await toastHas(t, '考試設定已儲存');
    await s.reload(); await s.fill('#iSeat', '1'); await s.fill('#iPin', '1234'); await s.click('#bLogin'); await s.waitForSelector('#vMap:not(.hidden)'); await closeNews(s);
    assert.match(await s.textContent('#exam'), /倒數8天/);
    const r = await play(s, '段考', [0, 1]);
    assert.match(r, /波波建議多練習：通分/);
  });
  await step('弱點觀念出現在後台', async () => {
    const d = (await call('tDashboard', PW, 'DEMO')).ok;
    assert.ok(d.students[0].weak.includes('通分'));
  });
  await step('精熟：同一題在兩個不同的日子答對才算記住', async () => {
    const c2 = { code: 'DEMO', seat: 2, pin: '2222' };
    await call('studentLogin', c2);
    const answerAll = async () => {
      const qs = (await call('getRound', c2, '英文')).ok;
      return (await call('submitRound', c2, '英文', qs.map(q => ({ id: q.id, answer: q.type === '選擇' ? q.options['ABCD'.indexOf(q.answer)] : q.answer.split('|')[0] })))).ok;
    };
    let r = await answerAll();
    let en = r.state.units.filter(u => u.subject === '英文');
    assert.ok(en.every(u => u.level === 1), '同一天全對，題目都只答對過一天：還是發芽');
    r = await answerAll();  // 同一天再答對一次，還是不算
    assert.ok(r.state.units.filter(u => u.subject === '英文').every(u => u.level === 1 && u.remembered === 0), '同一天答兩次也不算記住');
    // 模擬「換一天」：把上次答對的日期改成以前的某一天（直接改資料庫時也要讓 total 變，伺服器暫存的作答紀錄才會重讀）
    execSync(`npx wrangler d1 execute DB --local --persist-to ${dir} --command "UPDATE progress SET last_right_day = '2026-01-01' WHERE seat = 2; UPDATE students SET total = total + 1 WHERE seat = 2"`, { stdio: 'ignore' });
    r = await answerAll();
    en = r.state.units.filter(u => u.subject === '英文');
    assert.ok(en.every(u => u.level === 4), '換一天再答對 = 精熟');
    assert.equal(r.mastered.length, en.length);
    assert.match(r.mastered.join(), /英文・Unit 1 單字/);
    r = await answerAll();
    assert.equal(r.mastered.length, 0, '徽章只給一次');
  });
  await step('精熟總覽與精熟加點', async () => {
    await call('tSaveSettings', PW, { perMastery: 2 });
    const g = (await call('tMastery', PW, 'DEMO')).ok;
    const s2 = g.students.find(x => x.seat === 2);
    assert.equal(Object.values(s2.levels).filter(v => v === 4).length, 2);
    await t.click('[data-tab="tMastery"]'); await t.waitForSelector('#mTbl td.lvc.l4'); assert.match(await t.textContent('#mTbl'), /精熟/); assert.doesNotMatch(await t.textContent('#mTbl'), /🌳/);
    const before = (await call('tDashboard', PW, 'DEMO')).ok.students.find(x => x.seat === 2);
    assert.equal(before.masteryPending, 2);
    const out = (await call('tRedeem', PW, 'DEMO', [2], '精熟測試')).ok;
    assert.equal(out[0].mastery, 2); assert.equal(out[0].points, before.points);
    assert.equal((await call('tDashboard', PW, 'DEMO')).ok.students.find(x => x.seat === 2).masteryPending, 0);
    await call('tSaveSettings', PW, { perMastery: 0 });
  });
  await step('學生的精熟圖鑑', async () => {
    const p = await page('/?c=DEMO');
    await p.fill('#iSeat', '2'); await p.fill('#iPin', '2222'); await p.click('#bLogin'); await p.waitForSelector('#vMap:not(.hidden)'); await closeNews(p);
    assert.match(await p.textContent('[data-island="英文"]'), /精熟 2 \/ 2 單元/);
    await p.click('#bMastery'); await p.waitForSelector('#vMastery:not(.hidden)');
    assert.equal(await p.locator('.mrow.lv4').count(), 2);
    assert.match(await p.textContent('#vMastery'), /已經精熟了/);
    assert.match(await p.textContent('#vMastery'), /兩個不同的日子/);
    // 還沒精熟的單元會寫出「還要再記住幾題」，數字和 9 成門檻一致
    const st = (await call('studentLogin', { code: 'DEMO', seat: 2, pin: '2222' })).ok;
    st.units.forEach(u => assert.equal(u.needMaster, Math.max(0, Math.ceil(u.total * 0.9) - u.remembered)));
    const notYet = st.units.find(u => u.level < 3);
    if (notYet) assert.match(await p.textContent('#vMastery'), new RegExp('精熟還要再記住 ' + notYet.needMaster + ' 題'));
    // 精熟過就一直是精熟：之後答錯，等級不掉，只提醒還有幾題要再答對
    const c2 = { code: 'DEMO', seat: 2, pin: '2222' };
    const q = (await call('getRound', c2, '英文')).ok[0];
    await call('submitRound', c2, '英文', [{ id: q.id, answer: 'zzz' }]);
    const after = (await call('studentLogin', c2)).ok.units.filter(u => u.subject === '英文');
    assert.ok(after.every(u => u.level === 4), '答錯後還是精熟');
    assert.ok(after.some(u => u.again > 0 && u.wrong > 0), '提醒有題目要再答對、錯題在錯題礁');
  });
  await step('素養題：情境題組排在一起，畫面顯示閱讀情境', async () => {
    const c3 = { code: 'DEMO', seat: 3, pin: '3333' };
    await call('studentLogin', c3);
    assert.ok((await call('getRound', c3, '數學')).ok.every(q => !q.passage), '素養題不出現在科目島');
    const st3 = (await call('studentLogin', c3)).ok;
    assert.ok(st3.literacy['數學'].groups >= 1, '素養島列出數學題組');
    const qs = (await call('getRound', c3, '素養:數學')).ok;
    assert.ok(qs.length && qs.every(q => q.passage && q.subject === '數學'), '素養島只出所選科目的題組');
    const idx = qs.map((q, i) => q.passage ? i : -1).filter(i => i >= 0);
    assert.ok(idx.length >= 2, '應該有素養題');
    assert.equal(idx[idx.length - 1] - idx[0], idx.length - 1, '同一段情境要連在一起');
    const p = await page('/?c=DEMO');
    await p.fill('#iSeat', '3'); await p.fill('#iPin', '3333'); await p.click('#bLogin'); await p.waitForSelector('#vMap:not(.hidden)'); await closeNews(p);
    await p.click('[data-island="素養"]'); await p.click('#pick [data-go="素養:數學"]'); await p.waitForSelector('#vQuiz:not(.hidden)');
    let seen = false;
    for (let i = 0; i < 10 && !seen; i++) {
      const q = await p.evaluate(() => round.qs[round.i]);
      if (q.passage) {
        seen = true;
        assert.match(await p.textContent('#qPassage'), /同樂會/); assert.match(await p.textContent('#qTag'), /素養題/);
        assert.match(await p.textContent('#qPassage'), /題組 1 \/ \d/);
        // 答完按下一題：同一組的下一題還是看得到情境，而且畫面回到上面
        const a1 = q.answer.split('|')[0];
        if (q.type === '填空') { await p.fill('#iFill', a1); await p.click('#fFill button'); } else await p.click(`#qBody .opt[data-a="${a1}"]`);
        await p.click('#bNext');
        assert.match(await p.textContent('#qPassage'), /題組 2 \/ \d/);
        assert.ok(await p.isVisible('#qPassage'));
        assert.equal(await p.evaluate(() => scrollY), 0);
        break;
      }
      const a = q.answer.split('|')[0];
      if (q.type === '填空') { await p.fill('#iFill', a); await p.click('#fFill button'); } else await p.click(`#qBody .opt[data-a="${a}"]`);
      await p.click('#bNext');
    }
    assert.ok(seen);
  });
  await step('單課練習：科目島可以選全部混合或只練一課', async () => {
    const c3 = { code: 'DEMO', seat: 3, pin: '3333' };
    const st = (await call('studentLogin', c3)).ok;
    const u = st.units.find(x => x.subject === '數學' && x.practice);
    const qs = (await call('getRound', c3, '單元:' + u.key)).ok;
    assert.ok(qs.length && qs.every(q => q.unit === u.unit && !q.passage), '只出這一課');
    assert.match((await call('getRound', c3, '單元:通用｜6上｜數學｜沒教過')).err, /還沒開放/);
    // 單元照課本順序（匯入單元表的順序）排列，不是照字串排
    const cat = Object.fromEntries((await call('tDashboard', PW, 'DEMO')).ok.units.map(x => [x.key, x.sort]));
    st.units.forEach((x, i) => { const y = st.units[i + 1]; if (y && y.subject === x.subject) assert.ok((cat[x.key] ?? 1e6) <= (cat[y.key] ?? 1e6), x.unit + ' 應該排在 ' + y.unit + ' 前面'); });
    assert.ok(st.islands['數學'].practice > 0 && st.islands['數學'].total === st.islands['數學'].practice, '科目島的題數不含素養題組');
    assert.ok(st.literacy['數學'].total > 0, '素養題組在素養島另外計算');
    assert.equal(st.units.filter(x => x.subject === '數學').reduce((a, x) => a + x.total, 0), st.islands['數學'].total, '單元精熟也不含素養題組');
    const p = await page('/?c=DEMO');
    await p.fill('#iSeat', '3'); await p.fill('#iPin', '3333'); await p.click('#bLogin'); await p.waitForSelector('#vMap:not(.hidden)'); await closeNews(p);
    await p.click('[data-island="數學"]'); await p.waitForSelector('#pick');
    assert.match(await p.textContent('#pick'), /全部單元混合/);
    await p.click(`#pick [data-go="單元:${u.key}"]`); await p.waitForSelector('#vQuiz:not(.hidden)');
    assert.match(await p.textContent('#qTag'), new RegExp(u.unit));
  });
  await step('AI 出題：選單可以選素養題，複製出素養題提示詞', async () => {
    await t.click('[data-tab="tImport"]');
    await t.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
    await t.selectOption('#aMode', 'literacy');
    assert.match(await t.textContent('#aModeHint'), /生活情境/);
    await t.fill('#aUnit', '分數除法'); await t.click('#bPrompt');
    const clip = await t.evaluate(() => navigator.clipboard.readText());
    assert.match(clip, /素養導向/); assert.match(clip, /情境/);
    await t.selectOption('#aMode', 'normal');
  });
  await step('匯入素養題（第 15 欄是情境）', async () => {
    const pass = '小明家的花園長 6 公尺、寬 4 公尺。';
    const r = (await call('tImport', PW, `通用\t6\t上\t數學\t面積\t長方形面積\t填空\t花園面積是幾平方公尺？\t\t\t\t\t24\t6×4\t${pass}\n通用\t6\t上\t數學\t面積\t單位換算\t是非\t花園面積大於 20 平方公尺\t\t\t\t\tO\t\t${pass}`, 'AI', '通用')).ok;
    assert.equal(r.added, 2);
    const b = (await call('tQuestions', PW, { q: '花園' })).ok.rows;
    assert.ok(b.length === 2 && b.every(q => q.passage === pass));
  });
  await step('手冊：學生版在登入頁，老師版在後台', async () => {
    const p = await page('/');
    await p.click('#bGuide1'); await p.waitForSelector('#vGuide:not(.hidden)');
    assert.match(await p.textContent('#vGuide'), /換一天再答對一次/);
    await p.click('#bGuideBack'); await p.waitForSelector('#vLogin:not(.hidden)');
    assert.equal(await p.locator('text=領航員手冊').count(), 0);
    await t.click('[data-tab="tGuide"]'); await t.waitForSelector('#tGuide:not(.hidden)');
    assert.match(await t.textContent('#tGuide'), /記住了幾成/);
  });
  await step('徽章：達成有意義的事才拿得到，只拿一次', async () => {
    const c4 = { code: 'DEMO', seat: 3, pin: '3333' };
    const play4 = async (isl, wrong = 0) => {
      const qs = (await call('getRound', c4, isl)).ok;
      return (await call('submitRound', c4, isl, qs.map((q, i) => ({ id: q.id, answer: i < wrong ? 'zzz' : q.type === '選擇' ? q.options['ABCD'.indexOf(q.answer)] : q.answer.split('|')[0] })))).ok;
    };
    let r = await play4('國語', 4);           // 全錯，沒過關
    assert.equal(r.passed, false);
    assert.equal(r.badges.length, 0);
    r = await play4('國語');                  // 同一天再挑戰並過關
    const ids = r.badges.map(b => b.id);
    assert.ok(ids.includes('comeback'), '越挫越勇');
    r = await play4('國語');
    assert.ok(!r.badges.some(b => b.id === 'comeback'), '不會重複拿');
    // 段考衝刺島過關 + 一回合 8 題以上全對
    r = await play4('段考');
    assert.ok(r.badges.some(b => b.id === 'exam'));
    const st = (await call('studentLogin', c4)).ok;
    assert.ok(st.badges.includes('comeback') && st.badges.includes('exam'));
    assert.equal(st.badgeList.length, 60);
    const d = (await call('tDashboard', PW, 'DEMO')).ok.students.find(x => x.seat === 3);
    assert.ok(d.badges.length >= 2);
  });
  await step('精熟過的學生登入時補發精熟徽章、徽章牆顯示', async () => {
    const st = (await call('studentLogin', { code: 'DEMO', seat: 2, pin: '2222' })).ok;
    assert.ok(st.badges.includes('master1'), '第一棵樹');
    assert.ok(st.badges.includes('isle_英文'), '英文島主');
    const p = await page('/?c=DEMO');
    await p.fill('#iSeat', '2'); await p.fill('#iPin', '2222'); await p.click('#bLogin'); await p.waitForSelector('#vMap:not(.hidden)'); await closeNews(p);
    await p.click('#bBadges'); await p.waitForSelector('#vBadges:not(.hidden)');
    assert.ok(await p.locator('.bcard.got').count() >= 2);
    assert.equal(await p.locator('.bcard').count(), 31);  // 60 個徽章，系列合成一張卡片後是 31 張
    assert.ok(await p.locator('.bcard.series .pips i.on').count() >= 1);
    // 點徽章跳出說明，系列徽章列出每一階
    await p.click('.bcard.series.got'); await p.waitForSelector('.bpop');
    assert.ok(await p.locator('.bpop .bp').count() >= 2); assert.match(await p.textContent('.bpop'), /已經拿到/);
    await p.click('.bpop [data-close]'); assert.equal(await p.locator('.bpop').count(), 0);
  });
  await step('老師公告與指定任務：學生地圖最上方出現公告，任務島排第一', async () => {
    await t.click('[data-tab="tUnits"]');
    await t.fill('#nText', '本週先練數學，記得去錯題礁！'); await t.selectOption('#nMission', '數學');
    await t.click('#bSaveNotice'); await toastHas(t, '公告與任務已儲存');
    const p = await page('/?c=DEMO');
    await p.fill('#iSeat', '3'); await p.fill('#iPin', '3333'); await p.click('#bLogin'); await p.waitForSelector('#vMap:not(.hidden)'); await closeNews(p);
    assert.match(await p.textContent('#notice'), /本週先練數學/);
    assert.equal(await p.getAttribute('#map .island:first-child', 'data-island'), '數學');
    assert.match(await p.textContent('#map .island:first-child'), /老師的任務/);
    // 公告可以設定顯示到哪一天：過期就自動不顯示
    const c3n = { code: 'DEMO', seat: 3, pin: '3333' };
    await t.fill('#nUntil', '2020-01-01'); await t.click('#bSaveNotice');
    await t.waitForFunction(() => document.querySelector('#nUntilMsg').textContent.includes('已經過期'));
    assert.equal((await call('studentLogin', c3n)).ok.notice, '');
    await t.fill('#nUntil', '2099-12-31'); await t.click('#bSaveNotice');
    await t.waitForFunction(() => document.querySelector('#nUntilMsg').textContent === '');
    assert.match((await call('studentLogin', c3n)).ok.notice, /本週先練數學/);
  });
  await step('學生回報題目，老師在待檢查題目處理', async () => {
    const p = await page('/?c=DEMO');
    await p.fill('#iSeat', '3'); await p.fill('#iPin', '3333'); await p.click('#bLogin'); await p.waitForSelector('#vMap:not(.hidden)'); await closeNews(p);
    await p.click('[data-island="社會"]'); await p.click('#pick [data-go="社會"]'); await p.waitForSelector('#vQuiz:not(.hidden)');
    const q = await p.evaluate(() => round.qs[round.i]);
    const ra = q.answer.split('|')[0];
    if (q.type === '填空') { await p.fill('#iFill', ra); await p.click('#fFill button'); } else await p.click(`#qBody .opt[data-a="${ra}"]`);
    assert.match(await p.textContent('#qFb'), /查/);  // 公布答案後有「查查看」
    // 回報前先提醒：看解析、查一查，亂回報扣 30 金幣
    await p.click('#bReport');
    assert.match(await p.textContent('#rBox'), /扣 30 金幣/);
    await p.click('#rGo'); await p.click('.rchip[data-r="答案好像錯了"]');
    await p.waitForFunction(() => document.querySelector('#rBox').textContent.includes('謝謝'));
    const reps = (await call('tReports', PW)).ok;
    const g = reps.find(x => x.q.id === q.id);
    assert.ok(g && g.reports[0].reason === '答案好像錯了');
    assert.ok(g.reports[0].answer, '看得到學生選了什麼');
    assert.ok((await call('tDashboard', PW, 'DEMO')).ok.openReports >= 1);
    // Claude 先寫審核建議（匯入鑰匙）
    const x = async (fn, ...args) => (await (await fetch(BASE + '/api/' + fn, { method: 'POST', headers: { 'x-import-token': IMPORT_TOKEN }, body: JSON.stringify({ args }) })).json());
    assert.ok((await x('xReports')).ok.some(r => r.qid === q.id && r.reports[0].answer));
    assert.ok((await x('xDraftReport', q.id, 'ok', '老師檢查過了，答案沒有錯。', '題目和答案一致')).ok);
    const c3r = { code: 'DEMO', seat: 3, pin: '3333' }, coins0 = (await call('studentLogin', c3r)).ok.coins;
    await t.reload(); await t.waitForSelector('#vApp:not(.hidden)');
    await t.click('[data-tab="tBank"]'); await t.waitForSelector(`[data-rep-ok="${q.id}"]`);
    assert.match(await t.textContent('#repList'), /Claude 建議/);
    // 勾「亂回報」→ 沒問題：扣 30 金幣，學生看得到回饋
    await t.check(`#repList [data-junk="${g.reports[0].id}"]`);
    await t.click(`[data-rep-ok="${q.id}"]`); await toastHas(t, '亂回報的已扣金幣');
    assert.ok(!(await call('tReports', PW)).ok.some(x => x.q.id === q.id));
    const after = (await call('studentLogin', c3r)).ok;
    assert.equal(after.coins, Math.max(0, coins0 - 30));
    assert.equal(after.askNews.reps[0].result, 'junk');
    assert.equal((await call('myAsks', c3r)).ok.reps[0].result, 'junk');
  });
  await step('圖片題：上傳、顯示在題目上方', async () => {
    // 產生一張 300x200 的 PNG 檔，從編輯器上傳
    const png = Buffer.from((await t.evaluate(() => { const c = document.createElement('canvas'); c.width = 300; c.height = 200; const g = c.getContext('2d'); g.fillStyle = '#7cc2ff'; g.fillRect(0, 0, 300, 200); return c.toDataURL('image/png'); })).split(',')[1], 'base64');
    await t.fill('#fQ', '最高的山'); await t.click('#bFind'); await t.waitForFunction(() => document.querySelectorAll('#bankTbl tbody tr').length === 1);
    await t.click('[data-edit]');
    await t.setInputFiles('#qImgFile', { name: 'm.png', mimeType: 'image/png', buffer: png });
    await t.waitForFunction(() => document.querySelector('#qImgMsg').textContent.includes('已附圖片'));
    await t.click('#bSaveQ'); await toastHas(t, '題目已更新');
    const q = (await call('tQuestions', PW, { q: '最高的山' })).ok.rows[0];
    assert.ok(q.image);
    const img = await fetch(BASE + '/img/' + q.image);
    assert.equal(img.status, 200); assert.match(img.headers.get('content-type'), /image\/jpeg/);
    const round = (await call('getRound', { code: 'DEMO', seat: 3, pin: '3333' }, '社會')).ok;
    assert.equal(round.find(x => x.id === q.id).image, '/img/' + q.image);
    assert.match((await call('tUploadImage', PW, 'data:text/html;base64,PGI+')).err, /格式/);
  });
  await step('徽章排行榜：只比徽章數，老師可以關掉', async () => {
    const r = (await call('leaderboard', { code: 'DEMO', seat: 3, pin: '3333' })).ok;
    assert.equal(r.total, 60);
    assert.ok(r.rows.some(x => x.me));
    assert.ok(r.rows.every((x, i) => i === 0 || r.rows[i - 1].n >= x.n));
    const p = await page('/?c=DEMO');
    await p.fill('#iSeat', '3'); await p.fill('#iPin', '3333'); await p.click('#bLogin'); await p.waitForSelector('#vMap:not(.hidden)'); await closeNews(p);
    await p.click('#bBadges'); await p.click('[data-bt="rank"]'); await p.waitForSelector('.rank li.me');
    await call('tSaveSettings', PW, { showLeaderboard: false });
    assert.match((await call('leaderboard', { code: 'DEMO', seat: 3, pin: '3333' })).err, /沒有開放/);
    await call('tSaveSettings', PW, { showLeaderboard: true });
  });
  await step('題目偵探：回報被老師確認（停用）後，學生拿到徽章', async () => {
    const c3 = { code: 'DEMO', seat: 3, pin: '3333' };
    const q = (await call('getRound', c3, '自然')).ok[0];
    assert.ok((await call('reportQuestion', c3, q.id, '答案好像錯了', '')).ok.ok);
    await t.reload(); await t.waitForSelector('#vApp:not(.hidden)');
    await t.click('[data-tab="tBank"]'); await t.waitForSelector(`[data-rep-off="${q.id}"]`);
    await t.click(`[data-rep-off="${q.id}"]`); await toastHas(t, '題目偵探');
    const st = (await call('studentLogin', c3)).ok;
    assert.ok(st.badges.includes('detective1'));
    await call('tSetEnabled', PW, [q.id], true);
  });
  await step('老師頒發的徽章：建立、頒發、學生看到原因、收回', async () => {
    await t.click('[data-tab="tOverview"]');
    await t.fill('#cbName', '熱心助人'); await t.fill('#cbDesc', '主動幫助同學'); await t.click('#bCbNew'); await toastHas(t, '徽章建立好了');
    await t.click('[data-cb-give]'); await t.check('#cbSeats input[value="3"]'); await t.fill('#cbNote', '幫忙整理圖書角');
    await t.click('#bCbGive'); await toastHas(t, '已頒發給 1 位學生');
    const st = (await call('studentLogin', { code: 'DEMO', seat: 3, pin: '3333' })).ok;
    const cid = st.badges.find(x => x.startsWith('c:'));
    assert.ok(cid); assert.equal(st.badgeNotes[cid], '幫忙整理圖書角');
    assert.equal(st.badgeList.length, 61);
    const p = await page('/?c=DEMO');
    await p.fill('#iSeat', '3'); await p.fill('#iPin', '3333'); await p.click('#bLogin'); await p.waitForSelector('#vMap:not(.hidden)'); await closeNews(p);
    await p.click('#bBadges'); await p.waitForSelector('#vBadges:not(.hidden)');
    assert.match(await p.textContent('#badgeWall'), /老師說：幫忙整理圖書角/);
    await t.click('[data-cb-revoke="3"]'); await toastHas(t, '已收回');
    assert.ok(!(await call('studentLogin', { code: 'DEMO', seat: 3, pin: '3333' })).ok.badges.includes(cid));
    assert.match((await call('tRevokeBadge', PW, 'DEMO', 3, 'master1')).err, /不能收回/);
  });
  await step('新徽章：題組全對、燈塔全對', async () => {
    const c1 = { code: 'DEMO', seat: 1, pin: '1234' };
    const all = async isl => { const qs = (await call('getRound', c1, isl)).ok; return (await call('submitRound', c1, isl, qs.map(q => ({ id: q.id, answer: q.type === '選擇' ? q.options['ABCD'.indexOf(q.answer)] : q.answer.split('|')[0] })))).ok; };
    let got = new Set((await call('studentLogin', c1)).ok.badges);
    for (const isl of ['素養:數學', '素養', '綜合', '錯題', '錯題']) { const r = await all(isl).catch(() => null); if (r && r.badges) r.badges.forEach(b => got.add(b.id)); }
    got = new Set((await call('studentLogin', c1)).ok.badges);
    assert.ok(got.has('groupall'), '題組全對');
    assert.ok(got.has('lighthouse'), '燈塔全對');
  });
  await step('延伸冒險：老師加連結，學生出發、完成得星星（只一次）', async () => {
    await t.click('[data-tab="tUnits"]');
    await t.waitForFunction(() => document.querySelectorAll('#lkUnit option').length > 1);
    await t.selectOption('#lkUnit', '通用｜6上｜數學｜分數除法');
    await t.fill('#lkTitle', '分數除法動畫'); await t.fill('#lkUrl', 'javascript:alert(1)'); await t.click('#bLkSave');
    await t.waitForFunction(() => document.querySelector('#lkErr').textContent.includes('http'));
    await t.fill('#lkUrl', 'https://example.org/fraction'); await t.fill('#lkNote', '看完想一想：為什麼要顛倒相乘？'); await t.check('#lkStar');
    await t.click('#bLkSave'); await toastHas(t, '已新增延伸冒險');
    const c = { code: 'DEMO', seat: 3, pin: '3333' };
    const p = await page('/?c=DEMO');
    await p.fill('#iSeat', '3'); await p.fill('#iPin', '3333'); await p.click('#bLogin'); await p.waitForSelector('#vMap:not(.hidden)'); await closeNews(p);
    assert.match(await p.textContent('[data-island="數學"]'), /1 個延伸冒險/);
    await p.click('#bLinks'); await p.waitForSelector('.lcard');
    assert.equal(await p.getAttribute('.lcard a', 'href'), 'https://example.org/fraction');
    assert.equal(await p.getAttribute('.lcard a', 'target'), '_blank');
    const before = (await call('studentLogin', c)).ok.stars;
    // 還沒按出發：按鈕不能按，直接呼叫也會被擋
    assert.ok(await p.locator('[data-ldone]').isDisabled());
    const lid = (await call('getLinks', c)).ok[0].id;
    assert.match((await call('completeLink', c, lid)).err, /出發/);
    const [pop] = await Promise.all([p.waitForEvent('popup'), p.click('[data-lgo]')]); await pop.close();
    await p.waitForFunction(() => !document.querySelector('[data-ldone]').disabled);
    await p.click('[data-ldone]'); await p.waitForSelector('.ldone');
    const id = (await call('getLinks', c)).ok[0].id;
    const r2 = (await call('completeLink', c, id)).ok;
    assert.equal(r2.first, false);
    assert.equal((await call('studentLogin', c)).ok.stars, before + 1, '星星只給一次');
    const tl = (await call('tLinks', PW, 'DEMO')).ok;
    assert.equal(tl[0].doneN, 1);
    // 整個科目的連結：那一科有教過的課就看得到，單元顯示「全部單元」
    await t.selectOption('#lkUnit', '通用｜6上｜數學｜＊全部單元');
    await t.fill('#lkTitle', '數學遊戲網站'); await t.fill('#lkUrl', 'https://example.org/math-all'); await t.fill('#lkNote', ''); await t.uncheck('#lkStar');
    await t.click('#bLkSave'); await toastHas(t, '已新增延伸冒險');
    const all = (await call('getLinks', c)).ok.find(l => l.url === 'https://example.org/math-all');
    assert.ok(all, '全部單元的連結看得到'); assert.equal(all.unit, '全部單元');
    await call('tDeleteLink', PW, all.id);
  });
  await step('各科不同版本：國語南一、數學翰林，只列出對應版本的單元', async () => {
    await call('tImport', PW, '翰林\t6\t上\t數學\t翰林單元\t\t是非\t翰林題\t\t\t\t\tO\t', '老師', '通用');
    await t.click('[data-tab="tClass"]');
    await t.selectOption('#eV0', '南一'); await t.selectOption('#eV1', '翰林'); await t.click('#bSaveCls'); await toastHas(t, '已儲存');
    const d = (await call('tDashboard', PW, 'DEMO')).ok.cls;
    assert.equal(d.versions['國語'], '南一'); assert.equal(d.versions['數學'], '翰林');
    await t.click('[data-tab="tUnits"]');
    const txt = await t.textContent('#unitBox');
    assert.match(txt, /翰林單元/);
    assert.doesNotMatch(txt, /康軒/);
    await t.click('[data-tab="tClass"]'); await t.selectOption('#eVAll', '南一'); await t.click('#bSaveCls'); await toastHas(t, '已儲存');
  });
  await step('教學進度：匯入單元表、改名（題目跟著改）、只能刪沒有題目的單元', async () => {
    await t.click('[data-tab="tUnits"]');
    await t.click('#uMgr summary');
    await t.fill('#uImport', '年級\t學期\t科目\t單元\n6\t上\t國語\t第一課 我的志願\n6\t上\t國語\t第二課 夢想起飛\n6\t上\t理化\tX');
    await t.click('#bUImport'); await t.waitForFunction(() => document.querySelector('#uImportMsg').textContent.includes('新增'));
    assert.match(await t.textContent('#uImportMsg'), /新增 2 個單元/);
    assert.match(await t.textContent('#unitBox'), /第一課 我的志願[\s\S]*還沒有題目/);
    const cat = (await call('tDashboard', PW, 'DEMO')).ok.units;
    const k1 = cat.find(u => u.unit === '第一課 我的志願').key;
    // 有題目的單元改名：題目跟著改
    const qk = cat.find(u => u.unit === '分數加減').key;
    assert.ok((await call('tRenameUnit', PW, qk, '第三單元 分數加減')).ok);
    const qs = (await call('tQuestions', PW, { q: '1/2 + 1/3' })).ok.rows;
    assert.equal(qs[0].unit, '第三單元 分數加減');
    assert.ok((await call('tDashboard', PW, 'DEMO')).ok.cls.units.some(u => u.endsWith('第三單元 分數加減')), '班級進度也跟著改');
    assert.match((await call('tDeleteUnit', PW, qs[0].unit_key)).err, /還有/);
    assert.ok((await call('tDeleteUnit', PW, k1)).ok);
    // 介面：新增一個單元
    await t.reload(); await t.waitForSelector('#vApp:not(.hidden)'); await t.click('[data-tab="tUnits"]'); await t.click('#uMgr summary');
    await t.selectOption('#uSubj', '自然'); await t.fill('#uName', '第四單元 電磁作用'); await t.click('#bUAdd'); await toastHas(t, '已新增單元');
    assert.match(await t.textContent('#unitBox'), /第四單元 電磁作用/);
    // 介面：按 ✎ 直接改名、刪除（不用打字輸入「刪除」）
    const key4 = (await call('tDashboard', PW, 'DEMO')).ok.units.find(u => u.unit === '第四單元 電磁作用').key;
    await t.click(`#unitBox [data-ued="${key4}"]`);
    await t.fill('.uedit input', '第四單元 電與磁'); await t.click('.uedit [data-uact="rename"]'); await toastHas(t, '已改名');
    assert.match(await t.textContent('#unitBox'), /第四單元 電與磁/);
    const key5 = (await call('tDashboard', PW, 'DEMO')).ok.units.find(u => u.unit === '第四單元 電與磁').key;
    await t.click(`#unitBox [data-ued="${key5}"]`);
    await t.click('.uedit [data-uact="del"]'); assert.match(await t.textContent('.uedit [data-uact="del"]'), /確定刪除/);
    await t.click('.uedit [data-uact="del"]'); await toastHas(t, '已刪除單元');
    assert.doesNotMatch(await t.textContent('#unitBox'), /第四單元 電與磁/);
    // 有題目的單元沒有刪除按鈕
    await t.click(`#unitBox [data-ued="${qk.replace('分數加減', '第三單元 分數加減')}"]`);
    assert.equal(await t.$('.uedit [data-uact="del"]'), null);
    await t.click('.uedit [data-uact="cancel"]');
  });
  await step('上傳檔案：Word 課文放進課本重點、Excel 匯入題目與單元', async () => {
    await t.click('[data-tab="tImport"]');
    // 在瀏覽器裡產生測試用的 Word 與 Excel 檔
    const files = await t.evaluate(async () => {
      await loadLib('jszip', 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js');
      await loadLib('xlsx', 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js');
      const z = new JSZip();
      z.file('word/document.xml', '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>五、測試課文</w:t></w:r></w:p><w:p><w:r><w:t>小島上住著一隻愛讀書的海豹。</w:t></w:r></w:p></w:body></w:document>');
      const docx = await z.generateAsync({type:'base64'});
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['年級','學期','科目','單元'],['6','上','社會','上傳的單元']]), '單元表');
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['版本','年級','學期','科目','單元','觀念','題型','題目','選項A','選項B','選項C','選項D','答案','解析','情境'],['通用','6','上','社會','上傳的單元','','是非','Excel 上傳的題目','','','','','O','','']]), '題目一');
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['版本','年級','學期','科目','單元','觀念','題型','題目','選項A','選項B','選項C','選項D','答案','解析','情境'],['通用','6','上','社會','上傳的單元','','是非','第二個分頁的題目','','','','','X','','']]), '題目二');
      return { docx, xlsx: XLSX.write(wb, {type:'base64', bookType:'xlsx'}) };
    });
    await t.fill('#aUnit', ''); await t.fill('#aNotes', '');
    await t.setInputFiles('#aFile', { name: '課文.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: Buffer.from(files.docx, 'base64') });
    await t.waitForFunction(() => document.querySelector('#aFileMsg').textContent.includes('讀到'));
    assert.match(await t.inputValue('#aNotes'), /愛讀書的海豹/);
    assert.equal(await t.inputValue('#aUnit'), '第五課 測試課文');
    const xbuf = Buffer.from(files.xlsx, 'base64');
    await t.setInputFiles('#iFile', { name: '題目.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: xbuf });
    await t.waitForFunction(() => document.querySelector('#iFileMsg').textContent.includes('已讀入'));
    assert.match(await t.textContent('#iFileMsg'), /題目一、題目二/);
    await t.click('#bImport'); await t.waitForFunction(() => document.querySelector('#importMsg').textContent.includes('成功'));
    assert.match(await t.textContent('#importMsg'), /成功匯入 2 題/);
    await t.click('[data-tab="tUnits"]'); await t.click('#uMgr summary');
    await t.setInputFiles('#uFile', { name: '單元.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: xbuf });
    await t.waitForFunction(() => document.querySelector('#uFileMsg').textContent.includes('已讀入'));
    assert.match(await t.inputValue('#uImport'), /上傳的單元/);
    assert.doesNotMatch(await t.inputValue('#uImport'), /題目/);
    await t.setInputFiles('#aFile', { name: 'photo.png', mimeType: 'image/png', buffer: Buffer.from('x') });
  });
  await step('匯入專用鑰匙：只能新增單元與題目，重複的題目會略過', async () => {
    const x = async (fn, token, ...args) => (await (await fetch(BASE + '/api/' + fn, { method: 'POST', headers: token ? { 'x-import-token': token } : {}, body: JSON.stringify({ args }) })).json());
    assert.match((await x('xClasses', '')).err, /鑰匙不正確/);
    assert.match((await x('xClasses', 'wrong-token-wrong-token')).err, /鑰匙不正確/);
    const cls = (await x('xClasses', IMPORT_TOKEN)).ok;
    assert.ok(cls.some(c => c.code === 'DEMO') && cls[0].versions['國語']);
    assert.ok(!('students' in cls[0]), '看不到學生資料');
    assert.match((await x('tDashboard', IMPORT_TOKEN, 'DEMO')).err, /老師密碼/, '鑰匙不能當老師密碼用');
    const u = (await x('xImportUnits', IMPORT_TOKEN, '6\t上\t英文\tUnit 9 鑰匙測試', { 英文: '通用' })).ok;
    assert.equal(u.added, 1);
    const tsv = '版本\t年級\t學期\t科目\t單元\t觀念\t題型\t題目\t選項A\t選項B\t選項C\t選項D\t答案\t解析\t情境\n\t6\t上\t英文\tUnit 9 鑰匙測試\t\t是非\tKey test question\t\t\t\t\tO\t\t';
    let r = (await x('xImportQuestions', IMPORT_TOKEN, tsv, { 英文: '通用' })).ok;
    assert.equal(r.added, 1);
    r = (await x('xImportQuestions', IMPORT_TOKEN, tsv, { 英文: '通用' })).ok;
    assert.equal(r.added, 0); assert.equal(r.skipped, 1);
    assert.ok((await x('xUnits', IMPORT_TOKEN)).ok.some(v => v.unit === 'Unit 9 鑰匙測試' && v.count === 1));
    // 後台已經開著：切到「教學進度」就看得到新單元，切到「題庫管理」就看得到新題目
    await t.click('[data-tab="tBank"]'); await t.click('[data-tab="tUnits"]');
    await t.waitForSelector('#unitBox label:has-text("Unit 9 鑰匙測試")', { timeout: 5000 });
    await t.click('[data-tab="tBank"]');
    await t.waitForSelector('#bankTbl td:has-text("Key test question")', { timeout: 5000 });
  });
  await step('題庫快取：匯入、停用題目後，學生端馬上看到新的題庫', async () => {
    const c1 = { code: 'DEMO', seat: 1, pin: '1234' };
    const count = async () => (await call('studentLogin', c1)).ok.units.reduce((a, u) => a + u.total, 0);
    const n0 = await count();
    const key = (await call('studentLogin', c1)).ok.units[0].key, [ver, gs, sj, unit] = key.split('｜');
    const tsv = '版本\t年級\t學期\t科目\t單元\t觀念\t題型\t題目\t選項A\t選項B\t選項C\t選項D\t答案\t解析\t情境\n' +
      [ver, gs[0], gs.slice(1), sj, unit, '', '是非', '快取測試題', '', '', '', '', 'O', '', ''].join('\t');
    assert.equal((await call('tImport', PW, tsv, '老師', '')).ok.added, 1);
    assert.equal(await count(), n0 + 1, '匯入後馬上算進單元題數');
    const id = (await call('tQuestions', PW, { q: '快取測試題' })).ok.rows[0].id;
    await call('tSetEnabled', PW, [id], false);
    assert.equal(await count(), n0, '停用後馬上不算');
    await call('tDeleteQuestions', PW, [id]);
  });
  await step('關於與版權：顯示老師設定的署名', async () => {
    await call('tSaveSettings', PW, { credit: '測試國小 測試老師' });
    const p = await page('/');
    await p.click('#aboutLink'); await p.waitForFunction(() => document.querySelector('#aboutCredit').textContent.includes('測試國小'));
    assert.match(await p.textContent('#vAbout'), /教科書內容的著作權屬各出版社所有/);
  });
  await step('題庫管理：查詢、編輯、停用、刪除', async () => {
    await t.click('[data-tab="tBank"]'); await t.waitForSelector('#bankTbl tbody tr');
    await t.fill('#fQ', '長度'); await t.click('#bFind'); await t.waitForFunction(() => document.querySelectorAll('#bankTbl tbody tr').length === 1);
    await t.click('[data-edit]'); await t.fill('#qAns', '500|五百'); await t.click('#bSaveQ');
    await t.waitForFunction(() => document.querySelector('#bankTbl').textContent.includes('500|五百'));
    await t.check('.cQ'); await t.click('#bQOff'); await t.waitForFunction(() => document.querySelector('#bankTbl').textContent.includes('停用'));
    await t.check('.cQ'); await t.click('#bQDel'); await t.click('#bQDel');
    await t.waitForFunction(() => document.querySelectorAll('#bankTbl tbody tr').length === 0);
  });
  await step('星星一天最多 5 顆、徽章限定款要拿到指定徽章', async () => {
    const c = { code: 'DEMO', seat: 2, pin: '2222' };
    const right = q => q.type === '選擇' ? q.options['ABCD'.indexOf(q.answer)] : String(q.answer).split('|')[0];
    let last;
    for (let i = 0; i < 7; i++) {
      const qs = (await call('getRound', c, '綜合')).ok;
      last = (await call('submitRound', c, '綜合', qs.map(q => ({ id: q.id, answer: right(q) })))).ok;
      assert.ok(last.passed, '全對應該過關');
    }
    assert.equal(last.star, false); assert.equal(last.starFull, true);  // 超過 5 顆：照樣過關、有金幣，只是不加星星
    assert.ok(last.coins > 0);
    assert.equal((await call('studentLogin', c)).ok.starToday, 5);
    // 特價期間每人限買 5 樣（免費款不算）
    for (const id of ['eye_brown', 'eye_blue', 'eye_green', 'eye_gray', 'cheek_rose']) assert.ok((await call('buyItem', c, id)).ok, '買 ' + id);
    assert.match((await call('buyItem', c, 'cheek_peach')).err, /限買 5 樣/);
    assert.equal((await call('studentLogin', c)).ok.saleLeft, 0);
    assert.ok((await call('setOutfit', c, { ear: 'ear_same' })).ok, '免費款照樣可以換');
    // 偵探帽要「題目偵探」徽章，金幣夠也買不了
    assert.match((await call('buyItem', c, 'hat_detective')).err, /題目偵探/);
  });
  await step('常見問答與學生提問：先找答案、附截圖提問、老師回覆（公開、獎勵、扣分）', async () => {
    const c3 = { code: 'DEMO', seat: 3, pin: '3333' }, c1 = { code: 'DEMO', seat: 1, pin: '1234' };
    const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
    const f = await page('/?c=demo');
    await f.fill('#iSeat', '3'); await f.fill('#iPin', '3333'); await f.click('#bLogin'); await f.waitForSelector('#vMap:not(.hidden)'); await closeNews(f);
    await f.click('#bFaq'); await f.waitForSelector('#vFaq:not(.hidden)');
    assert.ok(await f.locator('#faqList details').count() >= 15, '常見問答有列出來');
    await f.fill('#askText', '我今天過關星星沒加');
    assert.match(await f.textContent('#askHint'), /沒加星星/);   // 提問前先找到相關答案
    assert.ok(await f.locator('#bAsk').isDisabled(), '沒有截圖、沒勾「找不到」不能送出');
    // 送出前會跳出提醒：亂提問會扣金幣；按「再想想」不會送出
    await f.setInputFiles('#askFile', { name: 'shot.png', mimeType: 'image/png', buffer: Buffer.from(PNG.split(',')[1], 'base64') });
    await f.check('#askChk'); await f.waitForFunction(() => !document.querySelector('#bAsk').disabled);
    await f.click('#bAsk'); await f.waitForSelector('#pick [data-yes]');
    assert.match(await f.textContent('#pick'), /亂提問.*扣金幣/);
    await f.click('#pick [data-no]'); assert.equal(await f.locator('#pick').count(), 0);
    assert.equal((await call('myAsks', c3)).ok.mine.length, 0, '按再想想不會送出');
    // 提問：一天最多 3 題，要附截圖
    assert.match((await call('askQuestion', c3, '衣櫃按買下沒反應', '')).err, /截圖/);
    for (let i = 0; i < 3; i++) assert.ok((await call('askQuestion', c3, '衣櫃按買下沒反應 ' + i, PNG)).ok);
    assert.match((await call('askQuestion', c3, '再問一題可以嗎', PNG)).err, /最多問 3 題/);
    // Claude 用匯入鑰匙讀提問、寫草稿
    const x = async (fn, ...args) => (await (await fetch(BASE + '/api/' + fn, { method: 'POST', headers: { 'x-import-token': IMPORT_TOKEN }, body: JSON.stringify({ args }) })).json());
    const open = (await x('xAsks')).ok;
    assert.equal(open.length, 3); assert.match(open[0].image, /^\/img\/S/);
    assert.ok((await x('xDraftAsk', open[0].id, 'bug', '謝謝你找到問題！已經修好了。', '衣櫃按鈕的問題')).ok);
    const ta = (await call('tAsks', PW, 'DEMO')).ok;
    assert.equal(ta.find(a => a.id === open[0].id).draftKind, 'bug');
    // 老師處理：系統問題（公開＋獎勵）、亂提問（扣金幣）
    const before = (await call('studentLogin', c3)).ok;
    assert.ok((await call('tAnswerAsk', PW, open[0].id, { kind: 'bug', reply: '謝謝你找到問題！已經修好了。', pub: true, coins: 20, stars: 1 })).ok);
    assert.ok((await call('tAnswerAsk', PW, open[1].id, { kind: 'junk', reply: '請不要重複問一樣的問題喔。', coins: 10 })).ok);
    assert.match((await call('tAnswerAsk', PW, open[1].id, { kind: 'answered', reply: '再一次' })).err, /處理過/);
    const after = (await call('studentLogin', c3)).ok;
    assert.equal(after.coins, before.coins + 20 - 10);
    assert.equal(after.stars, before.stars + 1);
    assert.ok(after.badges.includes('bughunt1'), '系統偵探徽章');
    assert.equal(after.askNews.mine.length, 2);
    // 全班下次登入看到公開的回覆（匿名），看過就不再跳
    const n1 = (await call('studentLogin', c1)).ok.askNews;
    assert.equal(n1.pub.length, 1); assert.equal(n1.mine.length, 0); assert.ok(!('seat' in n1.pub[0]));
    await call('seenAsks', c1, n1.pub[0].id);
    assert.equal((await call('studentLogin', c1)).ok.askNews.pub.length, 0);
    await f.close();
  });
  await step('主力島：今日印章只在主力島拿得到、國數金幣 1.5 倍、每日任務', async () => {
    const st0 = (await call('tDashboard', PW, 'DEMO')).ok.students;
    await call('tAddStudents', PW, 'DEMO', 1);
    const seat = Math.max(...(await call('tDashboard', PW, 'DEMO')).ok.students.filter(x => !x.isTest).map(x => x.seat));
    assert.ok(!st0.some(x => x.seat === seat));
    const c = { code: 'DEMO', seat, pin: '7777' };
    await call('studentLogin', c);
    await call('tSaveSettings', PW, { outsideRate: 1 });  // 先不打折，單純看主力島加成
    const right = q => q.type === '選擇' ? q.options['ABCD'.indexOf(q.answer)] : String(q.answer).split('|')[0];
    const play1 = async isl => { const qs = (await call('getRound', c, isl)).ok; return (await call('submitRound', c, isl, qs.map(q => ({ id: q.id, answer: right(q) })))).ok; };
    const e = await play1('英文');
    assert.ok(e.passed && !e.stamp && e.stampNeedFocus, '英文島過關不蓋印章');
    assert.equal(e.coins, e.correct, '英文題金幣不加成');
    const z = await play1('國語');
    assert.ok(z.stamp, '國語島過關蓋印章'); assert.equal(z.focusBonus, 0);
    assert.equal(z.coins, Math.round(z.correct * 1.5));
    const m = await play1('數學');
    assert.equal(m.focusBonus, 5, '國語、數學都過關：每日任務 +5');
    assert.equal(m.coins, Math.round(m.correct * 1.5) + 5);
    assert.deepEqual(m.state.focus.done.sort(), ['★', '國語', '數學'].sort());
    const lit = await play1('素養:數學');
    assert.equal(lit.coins, Math.round(lit.correct * 2), '數學素養島金幣 2 倍');
    // 看提示後第二次答對：拿一半金幣，但精熟照第一次（答錯）算
    await call('tSaveSettings', PW, { outsideRate: 1 });
    const qs2 = (await call('getRound', c, '英文')).ok.filter(q => q.type === '選擇');
    if (qs2.length) {
      const q0 = qs2[0], wrongOpt = q0.options.find((o, i) => 'ABCD'[i] !== q0.answer);
      const rr = (await call('submitRound', c, '英文', [{ id: q0.id, first: wrongOpt, answer: right(q0) }])).ok;
      assert.equal(rr.correct, 0); assert.equal(rr.retryOk, 1); assert.equal(rr.coins, 1);  // 0.5 四捨五入
    }
    // 考試範圍為主：範圍外（這裡是通用版的英文）金幣打 5 折
    await call('tSaveSettings', PW, { outsideRate: 0.5 });
    assert.equal((await call('tGetSettings', PW)).ok.outsideRate, 0.5);
    const e2 = await play1('英文');
    assert.ok(e2.outside > 0, '英文不在考試範圍');
    assert.equal(e2.coins, Math.round(e2.correct * 0.5));
    // 老師可以關掉「印章只算主力島」、換主力科目
    await call('tSaveSettings', PW, { focusSubjects: ['自然'], focusStamp: false });
    const g = (await call('tGetSettings', PW)).ok;
    assert.deepEqual(g.focusSubjects, ['自然']); assert.equal(g.focusStamp, false);
    await call('tSaveSettings', PW, { focusSubjects: ['國語', '數學'], focusStamp: true });
  });
  await step('系統設定與修改密碼', async () => {
    await t.click('[data-tab="tClass"]'); await t.waitForFunction(() => document.querySelector('#sRound').value !== '');
    await t.fill('#sCoin', '10'); await t.click('#bSaveSet'); await toastHas(t, '設定已儲存');
    assert.equal((await call('tGetSettings', PW)).ok.coinsPerPoint, 10);
    await t.fill('#sPw1', 'new-pass-1'); await t.fill('#sPw2', 'new-pass-1'); await t.click('#bSavePw'); await toastHas(t, '老師密碼已修改');
    assert.ok((await call('tGetSettings', PW)).err);
    assert.ok((await call('tGetSettings', 'new-pass-1')).ok);
  });
  await step('匯出 CSV', async () => {
    const [dl] = await Promise.all([t.waitForEvent('download'), t.click('[data-exp="students"]')]);
    assert.match(dl.suggestedFilename(), /學生成績/);
  });
  await step('退出後台會回到學生登入頁，要重新輸入密碼', async () => {
    const p = await page('/teacher');
    await p.fill('#iPw', 'new-pass-1'); await p.click('#fLogin button'); await p.waitForSelector('#vApp:not(.hidden)');
    await p.click('#bLogout'); await p.waitForSelector('#vLogin:not(.hidden)');
    assert.ok(!p.url().includes('/teacher'));
    await p.goto(BASE + '/teacher'); await p.waitForTimeout(500);
    assert.ok(await p.isVisible('#fLogin'));
  });
  await step('測試帳號：不算進全班統計、精熟人數、排行榜和加點', async () => {
    const pw = 'new-pass-1', c2 = { code: 'DEMO', seat: 2, pin: '2222' };
    for (let i = 0; i < 3; i++) {  // 2 號故意答錯幾回，讓英文單元出現在「需要加強的單元」
      const qs = (await call('getRound', c2, '英文')).ok;
      await call('submitRound', c2, '英文', qs.map(q => ({ id: q.id, answer: 'zzz' })));
    }
    const before = (await call('tDashboard', pw, 'DEMO')).ok;
    const m0 = (await call('tMastery', pw, 'DEMO')).ok;
    const lb = async () => (await call('leaderboard', { code: 'DEMO', seat: 3, pin: '3333' })).ok.rows.length;
    const n0 = await lb();
    await t.click('[data-tab="tOverview"]'); await t.click('#stuTbl [data-test="2"]'); await toastHas(t, '設為測試帳號');
    await t.waitForSelector('#stuTbl tr:last-child .pill:text-is("測試帳號")');
    const d = (await call('tDashboard', pw, 'DEMO')).ok, s2 = d.students.find(x => x.seat === 2);
    assert.ok(s2.isTest); assert.equal(s2.points, 0);
    const en = before.weakUnits.filter(u => u.unit.startsWith('英文'));
    assert.ok(en.length, '2 號答錯後英文單元變弱');
    assert.ok(en.every(u => { const a = d.weakUnits.find(v => v.unit === u.unit); return !a || a.total < u.total; }), '測試帳號的作答不算進單元統計');
    assert.ok(d.weakConcepts.every(c => !c.people.includes(2)));
    const m1 = (await call('tMastery', pw, 'DEMO')).ok;
    assert.ok(m1.students.find(x => x.seat === 2).isTest);
    assert.ok(m1.units.every(u => u.mastered <= m0.units.find(v => v.key === u.key).mastered));
    assert.equal(await lb(), n0 - 1, '排行榜不列出測試帳號');
    assert.equal((await call('tRedeem', pw, 'DEMO', [2], '')).ok.length, 0, '測試帳號不能換點');
    // 老師試玩：測試帳號金幣、星星、徽章都不限，高級款和套裝直接拿來穿，不扣金幣
    const t0 = (await call('studentLogin', c2)).ok;
    assert.ok(t0.isTest);
    const got = (await call('buyItem', c2, 'pet_phoenix')).ok;
    assert.ok(got.owned.includes('pet_phoenix') && got.outfit.pet === 'pet_phoenix');
    assert.equal(got.coins, t0.coins);
    assert.ok((await call('buySet', c2, 'set_magic')).ok.owned.includes('coat_robe'));
    // 神秘角色：上架前只有陰影、不給名字，誰都不能買（測試帳號也一樣）；行事曆只寫「神秘角色」
    const sh = (await call('studentLogin', c2)).ok;
    assert.equal(sh.shop.sp_full_cat.mystery, true); assert.match(sh.shop.sp_full_cat.name, /神秘/);
    assert.match((await call('buyItem', c2, 'sp_full_cat')).err, /神秘角色/);
    assert.ok(sh.shopInfo.schedule.some(w => w.items.includes('🎁 ？？？神秘角色')));
    assert.ok(!JSON.stringify(sh.shopInfo.schedule).includes('喵大副'), '行事曆不能透露神秘角色的名字');
    // 造型存檔：照順序解鎖，存起來再換上（測試帳號不扣金幣）
    assert.match((await call('saveOutfit', c2, 0)).err, /還沒解鎖/);
    assert.equal((await call('unlockSave', c2)).ok.saves.slots, 1);
    assert.equal((await call('saveOutfit', c2, 0)).ok.saves.list[0].pet, 'pet_blackcat');
    await call('setOutfit', c2, { pet: 'pet_none' });
    assert.equal((await call('loadOutfit', c2, 0)).ok.outfit.pet, 'pet_blackcat');
    // 自訂顏色
    assert.equal((await call('setCustomColor', c2, '#7ad0a0')).ok.customColor, '#7ad0a0');
    // 旗子：送審 → 老師不通過（不扣錢）→ 重送 → 通過才換上
    const g1 = '2'.repeat(32) + '5'.repeat(32);
    assert.ok((await call('submitFlag', c2, g1)).ok.flag.pending);
    const fl = (await call('tFlags', pw, 'DEMO')).ok;
    assert.ok((await call('tReviewFlag', pw, fl[0].id, false, '再畫大一點')).ok);
    assert.equal((await call('studentLogin', c2)).ok.flag.result.status, 'rejected');
    await call('submitFlag', c2, g1);
    const fl2 = (await call('tFlags', pw, 'DEMO')).ok.find(f => f.status === 'pending');
    assert.ok((await call('tReviewFlag', pw, fl2.id, true, '好漂亮')).ok);
    const af = (await call('studentLogin', c2)).ok;
    assert.equal(af.flag.grid, g1); assert.equal(af.outfit.flag, 'flag_mine');
    // 許願池：每週 1 個 → 老師公開 → 別人集氣；Claude 用匯入鑰匙讀得到
    const c1w = { code: 'DEMO', seat: 1, pin: '1234' }, c3w = { code: 'DEMO', seat: 3, pin: '3333' };
    assert.ok((await call('makeWish', c1w, '想要太空貓的頭盔', '')).ok);
    assert.match((await call('makeWish', c1w, '再一個', '')).err, /這週已經許過願/);
    const wl = (await call('tWishes', pw, 'DEMO')).ok;
    assert.equal(wl[0].status, 'pending');
    assert.equal((await call('wishes', c3w)).ok.pub.length, 0, '審核前全班看不到');
    assert.ok((await call('tWish', pw, wl[0].id, 'public', '')).ok);
    assert.equal((await call('voteWish', c3w, wl[0].id)).ok, true);
    assert.equal((await call('wishes', c3w)).ok.pub[0].votes, 1);
    const xw = (await (await fetch(BASE + '/api/xWishes', { method: 'POST', headers: { 'x-import-token': IMPORT_TOKEN }, body: JSON.stringify({ args: [] }) })).json()).ok;
    assert.ok(xw.some(w => w.text === '想要太空貓的頭盔'));
    await call('tSetTest', pw, 'DEMO', 2, false);
    assert.ok(!(await call('tDashboard', pw, 'DEMO')).ok.students.find(x => x.seat === 2).isTest);
    await t.click('[data-tab="tClass"]');
  });
  await step('QR code 可以放大全螢幕，關閉後回到班級管理', async () => {
    await t.click('[data-tab="tClass"]'); await t.waitForSelector('#qr img, #qr canvas', { state: 'attached' });
    await t.click('#bQrBig'); await t.waitForSelector('#qrBig .big img, #qrBig .big canvas', { state: 'attached' });
    assert.match(await t.textContent('#qrBig'), /\?c=DEMO/);
    await t.click('#qrClose'); assert.equal(await t.$('#qrBig'), null);
  });
  await step('建立新的一屆', async () => {
    await t.click('#newClsBox summary');
    await t.fill('#nCode', '115a601'); await t.fill('#nName', '115 學年 六年一班'); await t.selectOption('#nVAll', '康軒'); await t.fill('#nCount', '25');
    await t.click('#bNewCls'); await toastHas(t, '建立好了');
    assert.equal(await t.inputValue('#selClass'), '115A601');
    const st = (await call('tDashboard', 'new-pass-1', '115A601')).ok.students;
    assert.equal(st.length, 26);
    assert.ok(st.find(x => x.seat === 30).isTest, '25 人的班，測試帳號是 30 號');
    assert.match((await call('tAddStudents', 'new-pass-1', '115A601', 6)).err, /30 號目前是測試帳號/);
    assert.equal((await call('tAddStudents', 'new-pass-1', '115A601', 2)).ok, 2);
    assert.ok((await call('tDashboard', 'new-pass-1', '115A601')).ok.students.some(x => x.seat === 27 && !x.isTest), '新增的學生接在 25 號後面');
    await t.waitForSelector('#stuTbl tr:last-child .pill:text-is("測試帳號")', { state: 'attached' });
    const c0 = { code: '115A601', seat: 30, pin: '0000' };
    assert.ok((await call('studentLogin', c0)).ok, '測試帳號可以登入');
  });
  await step('手機寬度不會左右捲動（學生端與後台每個分頁）', async () => {
    const m = await page('/?c=DEMO', 390);
    await m.fill('#iSeat', '1'); await m.fill('#iPin', '1234'); await m.click('#bLogin'); await m.waitForSelector('#vMap:not(.hidden)'); await closeNews(m);
    assert.equal(await m.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    const mt = await page('/teacher', 390);
    await mt.fill('#iPw', 'new-pass-1'); await mt.click('#fLogin button'); await mt.waitForSelector('#vApp:not(.hidden)');
    for (const tab of ['tOverview', 'tUnits', 'tImport', 'tMastery', 'tBank', 'tClass', 'tGuide']) {
      await mt.click(`[data-tab="${tab}"]`); await mt.waitForTimeout(300);
      assert.equal(await mt.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, tab + ' 太寬：' + await mt.evaluate(() => [...document.querySelectorAll('body *')].filter(e => e.getBoundingClientRect().right > innerWidth + 1 && e.offsetParent).slice(0, 4).map(e => e.tagName + '#' + e.id + '.' + e.className + ' ' + Math.round(e.getBoundingClientRect().right)).join(' / ')));
    }
  });
  assert.deepEqual(errors, []);
  await browser.close();
  console.log(`\n全部通過（${passed} 項）`);
} catch (e) {
  console.error('\n測試失敗：', e && e.message || e);
  process.exitCode = 1;
} finally {
  clearTimeout(watchdog);
  stop();
  process.exit(process.exitCode || 0);
}
