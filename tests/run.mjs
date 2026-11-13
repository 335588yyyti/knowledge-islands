// 端對端測試：用全新的本機資料庫啟動 wrangler dev，再用瀏覽器操作學生端與教師後台
import { spawn, execSync } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
mkdirSync('test-results', { recursive: true });
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const PORT = 8788, BASE = `http://127.0.0.1:${PORT}`, PW = 'test-pass-123';
const dir = mkdtempSync(join(tmpdir(), 'ki-'));
let current = '啟動';
// 保險：整個測試超過 4 分鐘就印出卡在哪裡並結束，不會一直卡住
const watchdog = setTimeout(() => { console.error('\n測試超時，卡在：' + current + '\n--- wrangler 輸出 ---\n' + log.slice(-4000)); stop(); process.exit(1); }, 240e3);
console.log('套用資料表…');
execSync(`npx wrangler d1 migrations apply DB --local --persist-to ${dir}`, { stdio: ['ignore', 'ignore', 'inherit'], timeout: 120e3 });
console.log('啟動 wrangler dev…');
const dev = spawn('npx', ['wrangler', 'dev', '--port', String(PORT), '--ip', '127.0.0.1', '--persist-to', dir, '--var', 'TEACHER_PASSWORD:' + PW], { stdio: ['ignore', 'pipe', 'pipe'], detached: true });
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
  async function play(p, island, wrongAt = []) {
    await p.click(`[data-island="${island}"]`);
    await p.waitForSelector('#vQuiz:not(.hidden)');
    for (let i = 0; ; i++) {
      const q = await p.evaluate(() => round.qs[round.i]);
      let a = q.answer.split('|')[0];
      if (wrongAt.includes(i)) a = q.type === '選擇' ? (a === 'A' ? 'B' : 'A') : q.type === '是非' ? (a === 'O' ? 'X' : 'O') : 'zzz';
      if (q.type === '填空') { await p.fill('#iFill', a); await p.click('#fFill button'); }
      else await p.click(`#qBody .opt[data-a="${a}"]`);
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
    const m = t.match(/(\d+) \/ (\d+) 金幣\+(\d+)/); assert.ok(m); assert.equal(Number(m[3]), Number(m[2]) - 1);  // 錯 1 題
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
    const coins = Number(await s.textContent('#shopCoins'));
    assert.ok(coins >= 20 && coins < 150, 'coins=' + coins);
    await s.click('.item[data-id="color_gold"]'); assert.match(await s.textContent('#bShopAct'), /還差/);
    assert.match((await call('buyItem', { code: 'DEMO', seat: 1, pin: '1234' }, 'color_gold')).err, /不夠/);
    await s.click('.item[data-id="hat_flower"]'); await s.click('#bShopAct');
    await s.waitForFunction(() => document.querySelector('#shopMsg').textContent.includes('買到了'));
    assert.equal(Number(await s.textContent('#shopCoins')), coins - 20);
    await s.click('.item[data-id="hat_sailor"]'); await s.click('#bShopAct');
    await s.waitForFunction(() => document.querySelector('#shopMsg').textContent.includes('換好了'));
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
    const groups = await t.$$eval('#unitBox .semhead h3', e => e.map(x => x.textContent));
    assert.deepEqual(groups, ['南一版・6年級上學期', '通用・6年級上學期']);
    await t.click('#unitBox [data-all="南一版・6年級上學期"]'); await t.click('#bSaveUnits'); await toastHas(t, '進度已儲存');
  });
  await step('設定段考，學生地圖出現倒數和衝刺島', async () => {
    const d = new Date(Date.now() + 8 * 3600e3 + 8 * 864e5).toISOString().slice(0, 10);
    await t.fill('#exName', '第一次段考'); await t.fill('#exDate', d);
    await t.click('#examBox [data-all="南一版・6年級上學期"]'); await t.click('#bSaveExam'); await toastHas(t, '考試設定已儲存');
    await s.reload(); await s.fill('#iSeat', '1'); await s.fill('#iPin', '1234'); await s.click('#bLogin'); await s.waitForSelector('#vMap:not(.hidden)');
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
    assert.ok(en.every(u => u.level === 2), '同一天全對只到熟練');
    r = await answerAll();  // 同一天再答對一次，還是不算
    assert.ok(r.state.units.filter(u => u.subject === '英文').every(u => u.level === 2));
    // 模擬「換一天」：把上次答對的日期改成以前的某一天
    execSync(`npx wrangler d1 execute DB --local --persist-to ${dir} --command "UPDATE progress SET last_right_day = '2026-01-01' WHERE seat = 2"`, { stdio: 'ignore' });
    r = await answerAll();
    en = r.state.units.filter(u => u.subject === '英文');
    assert.ok(en.every(u => u.level === 3), '換一天再答對 = 精熟');
    assert.equal(r.mastered.length, en.length);
    assert.match(r.mastered.join(), /英文・Unit 1 單字/);
    r = await answerAll();
    assert.equal(r.mastered.length, 0, '徽章只給一次');
  });
  await step('精熟總覽與精熟加點', async () => {
    await call('tSaveSettings', PW, { perMastery: 2 });
    const g = (await call('tMastery', PW, 'DEMO')).ok;
    const s2 = g.students.find(x => x.seat === 2);
    assert.equal(Object.values(s2.levels).filter(v => v === 3).length, 2);
    await t.click('[data-tab="tMastery"]'); await t.waitForSelector('#mTbl td.lvc.l3'); assert.match(await t.textContent('#mTbl'), /精熟/); assert.doesNotMatch(await t.textContent('#mTbl'), /🌳/);
    const before = (await call('tDashboard', PW, 'DEMO')).ok.students.find(x => x.seat === 2);
    assert.equal(before.masteryPending, 2);
    const out = (await call('tRedeem', PW, 'DEMO', [2], '精熟測試')).ok;
    assert.equal(out[0].mastery, 2); assert.equal(out[0].points, before.points);
    assert.equal((await call('tDashboard', PW, 'DEMO')).ok.students.find(x => x.seat === 2).masteryPending, 0);
    await call('tSaveSettings', PW, { perMastery: 0 });
  });
  await step('學生的精熟圖鑑', async () => {
    const p = await page('/?c=DEMO');
    await p.fill('#iSeat', '2'); await p.fill('#iPin', '2222'); await p.click('#bLogin'); await p.waitForSelector('#vMap:not(.hidden)');
    assert.match(await p.textContent('[data-island="英文"]'), /精熟 2 \/ 2 單元/);
    await p.click('#bMastery'); await p.waitForSelector('#vMastery:not(.hidden)');
    assert.equal(await p.locator('.mrow.lv3').count(), 2);
  });
  await step('素養題：情境題組排在一起，畫面顯示閱讀情境', async () => {
    const c3 = { code: 'DEMO', seat: 3, pin: '3333' };
    await call('studentLogin', c3);
    const qs = (await call('getRound', c3, '數學')).ok;
    const idx = qs.map((q, i) => q.passage ? i : -1).filter(i => i >= 0);
    assert.ok(idx.length >= 2, '應該有素養題');
    assert.equal(idx[idx.length - 1] - idx[0], idx.length - 1, '同一段情境要連在一起');
    const p = await page('/?c=DEMO');
    await p.fill('#iSeat', '3'); await p.fill('#iPin', '3333'); await p.click('#bLogin'); await p.waitForSelector('#vMap:not(.hidden)');
    await p.click('[data-island="數學"]'); await p.waitForSelector('#vQuiz:not(.hidden)');
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
    assert.match(await t.textContent('#tGuide'), /初學和熟練的差別/);
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
    assert.equal(st.badgeList.length, 41);
    const d = (await call('tDashboard', PW, 'DEMO')).ok.students.find(x => x.seat === 3);
    assert.ok(d.badges.length >= 2);
  });
  await step('精熟過的學生登入時補發精熟徽章、徽章牆顯示', async () => {
    const st = (await call('studentLogin', { code: 'DEMO', seat: 2, pin: '2222' })).ok;
    assert.ok(st.badges.includes('master1'), '第一棵樹');
    assert.ok(st.badges.includes('isle_英文'), '英文島主');
    const p = await page('/?c=DEMO');
    await p.fill('#iSeat', '2'); await p.fill('#iPin', '2222'); await p.click('#bLogin'); await p.waitForSelector('#vMap:not(.hidden)');
    await p.click('#bBadges'); await p.waitForSelector('#vBadges:not(.hidden)');
    assert.ok(await p.locator('.bcard.got').count() >= 2);
    assert.equal(await p.locator('.bcard').count(), 25);  // 41 個徽章，系列合成一張卡片後是 25 張
    assert.ok(await p.locator('.bcard.series .pips i.on').count() >= 1);
  });
  await step('老師公告與指定任務：學生地圖最上方出現公告，任務島排第一', async () => {
    await t.click('[data-tab="tUnits"]');
    await t.fill('#nText', '本週先練數學，記得去錯題礁！'); await t.selectOption('#nMission', '數學');
    await t.click('#bSaveNotice'); await toastHas(t, '公告與任務已儲存');
    const p = await page('/?c=DEMO');
    await p.fill('#iSeat', '3'); await p.fill('#iPin', '3333'); await p.click('#bLogin'); await p.waitForSelector('#vMap:not(.hidden)');
    assert.match(await p.textContent('#notice'), /本週先練數學/);
    assert.equal(await p.getAttribute('#map .island:first-child', 'data-island'), '數學');
    assert.match(await p.textContent('#map .island:first-child'), /老師的任務/);
  });
  await step('學生回報題目，老師在待檢查題目處理', async () => {
    const p = await page('/?c=DEMO');
    await p.fill('#iSeat', '3'); await p.fill('#iPin', '3333'); await p.click('#bLogin'); await p.waitForSelector('#vMap:not(.hidden)');
    await p.click('[data-island="社會"]'); await p.waitForSelector('#vQuiz:not(.hidden)');
    const q = await p.evaluate(() => round.qs[round.i]);
    if (q.type === '填空') { await p.fill('#iFill', 'x'); await p.click('#fFill button'); } else await p.click('#qBody .opt >> nth=0');
    await p.click('#bReport'); await p.click('.rchip[data-r="答案好像錯了"]');
    await p.waitForFunction(() => document.querySelector('#rBox').textContent.includes('謝謝'));
    const reps = (await call('tReports', PW)).ok;
    const g = reps.find(x => x.q.id === q.id);
    assert.ok(g && g.reports[0].reason === '答案好像錯了');
    assert.ok((await call('tDashboard', PW, 'DEMO')).ok.openReports >= 1);
    await t.reload(); await t.waitForSelector('#vApp:not(.hidden)');
    await t.click('[data-tab="tBank"]'); await t.waitForSelector(`[data-rep-ok="${q.id}"]`);
    await t.click(`[data-rep-ok="${q.id}"]`); await toastHas(t, '已標記沒問題');
    assert.ok(!(await call('tReports', PW)).ok.some(x => x.q.id === q.id));
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
    assert.equal(r.total, 41);
    assert.ok(r.rows.some(x => x.me));
    assert.ok(r.rows.every((x, i) => i === 0 || r.rows[i - 1].n >= x.n));
    const p = await page('/?c=DEMO');
    await p.fill('#iSeat', '3'); await p.fill('#iPin', '3333'); await p.click('#bLogin'); await p.waitForSelector('#vMap:not(.hidden)');
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
    assert.equal(st.badgeList.length, 42);
    const p = await page('/?c=DEMO');
    await p.fill('#iSeat', '3'); await p.fill('#iPin', '3333'); await p.click('#bLogin'); await p.waitForSelector('#vMap:not(.hidden)');
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
    for (const isl of ['數學', '綜合', '錯題', '錯題']) { const r = await all(isl).catch(() => null); if (r && r.badges) r.badges.forEach(b => got.add(b.id)); }
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
    await p.fill('#iSeat', '3'); await p.fill('#iPin', '3333'); await p.click('#bLogin'); await p.waitForSelector('#vMap:not(.hidden)');
    assert.match(await p.textContent('[data-island="數學"]'), /1 個延伸冒險/);
    await p.click('#bLinks'); await p.waitForSelector('.lcard');
    assert.equal(await p.getAttribute('.lcard a', 'href'), 'https://example.org/fraction');
    assert.equal(await p.getAttribute('.lcard a', 'target'), '_blank');
    const before = (await call('studentLogin', c)).ok.stars;
    await p.click('[data-ldone]'); await p.waitForSelector('.ldone');
    const id = (await call('getLinks', c)).ok[0].id;
    const r2 = (await call('completeLink', c, id)).ok;
    assert.equal(r2.first, false);
    assert.equal((await call('studentLogin', c)).ok.stars, before + 1, '星星只給一次');
    const tl = (await call('tLinks', PW, 'DEMO')).ok;
    assert.equal(tl[0].doneN, 1);
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
  await step('建立新的一屆', async () => {
    await t.fill('#nCode', '115a601'); await t.fill('#nName', '115 學年 六年一班'); await t.selectOption('#nVAll', '康軒'); await t.fill('#nCount', '25');
    await t.click('#bNewCls'); await toastHas(t, '建立好了');
    assert.equal(await t.inputValue('#selClass'), '115A601');
    assert.equal((await call('tDashboard', 'new-pass-1', '115A601')).ok.students.length, 25);
  });
  await step('手機寬度不會左右捲動（學生端與後台每個分頁）', async () => {
    const m = await page('/?c=DEMO', 390);
    await m.fill('#iSeat', '1'); await m.fill('#iPin', '1234'); await m.click('#bLogin'); await m.waitForSelector('#vMap:not(.hidden)');
    assert.equal(await m.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    const mt = await page('/teacher', 390);
    await mt.fill('#iPw', 'new-pass-1'); await mt.click('#fLogin button'); await mt.waitForSelector('#vApp:not(.hidden)');
    for (const tab of ['tOverview', 'tUnits', 'tImport', 'tMastery', 'tBank', 'tClass', 'tGuide']) {
      await mt.click(`[data-tab="${tab}"]`); await mt.waitForTimeout(300);
      assert.equal(await mt.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, tab + ' 太寬');
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
