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
  const browser = await chromium.launch({ env: { ...process.env, LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' } });  // 中文檔名需要 UTF-8 語系
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
    assert.match(t, /過關/); assert.match(t, /金幣\+3/); assert.match(t, /今日印章/);
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
    // 版本是下拉式選單，可以新增其他版本
    assert.deepEqual(await t.$$eval('#iVer option', o => o.map(x => x.textContent)), ['南一', '康軒', '翰林', '通用', '＋ 其他版本…']);
    t.once('dialog', d => d.accept('部編'));
    await t.selectOption('#iVer', '__new__');
    assert.equal(await t.inputValue('#iVer'), '部編');
    assert.ok((await t.$$eval('#nVer option', o => o.map(x => x.value))).includes('部編'));
    await t.selectOption('#iVer', '南一');
    await t.fill('#iImport', '題目\t題型\t答案\t年級\t學期\t科目\t單元\t觀念\t選項A\t選項B\t選項C\t選項D\t版本\n1/2 + 1/3 = ?\t選擇\tB\t6\t上\t數學\t分數加減\t通分\t2/5\t5/6\t1/6\t2/6\t南一\n2/3 + 1/4 = ?\t填空\t11/12\t6\t上\t數學\t分數加減\t通分\t\t\t\t\t南一\n5 公尺 = ? 公分\t填空\t500\t6\t上\t數學\t長度\t單位換算\t\t\t\t\t康軒\n壞掉的\t選擇\tE\t6\t上\t數學\tX\t\t1\t2\t\t\t南一');
    await t.click('#bImport'); await t.waitForFunction(() => document.querySelector('#importMsg').textContent.includes('成功'));
    const m = await t.textContent('#importMsg');
    assert.match(m, /成功匯入 3 題/); assert.match(m, /第 5 行/);
  });
  await step('班級改成南一版，只看得到南一和通用單元', async () => {
    await t.click('[data-tab="tClass"]'); await t.selectOption('#eVer', '南一'); await t.click('#bSaveCls'); await toastHas(t, '已儲存');
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
  await step('建立新的一屆', async () => {
    await t.fill('#nCode', '115a601'); await t.fill('#nName', '115 學年 六年一班'); await t.selectOption('#nVer', '康軒'); await t.fill('#nCount', '25');
    await t.click('#bNewCls'); await toastHas(t, '建立好了');
    assert.equal(await t.inputValue('#selClass'), '115A601');
    assert.equal((await call('tDashboard', 'new-pass-1', '115A601')).ok.students.length, 25);
  });
  await step('手機寬度不會左右捲動', async () => {
    const m = await page('/?c=DEMO', 390);
    await m.fill('#iSeat', '1'); await m.fill('#iPin', '1234'); await m.click('#bLogin'); await m.waitForSelector('#vMap:not(.hidden)');
    assert.equal(await m.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
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
