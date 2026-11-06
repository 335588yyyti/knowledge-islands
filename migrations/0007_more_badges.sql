-- 更多徽章、老師頒發的徽章、版權署名

ALTER TABLE students ADD COLUMN stamp_days TEXT NOT NULL DEFAULT '[]';  -- 最近拿到今日印章的日期（全勤一週、月月有你用）
ALTER TABLE students ADD COLUMN longmem INTEGER NOT NULL DEFAULT 0;     -- 隔 21 天以上再答仍答對的題數

ALTER TABLE badges ADD COLUMN note TEXT NOT NULL DEFAULT '';            -- 老師頒發時寫的原因

-- 老師自己建立的徽章
CREATE TABLE custom_badges (
  id      TEXT PRIMARY KEY,
  icon    TEXT NOT NULL,
  name    TEXT NOT NULL,
  descr   TEXT NOT NULL DEFAULT '',
  created TEXT NOT NULL
);

-- 回報的處理結果：confirmed＝老師確認有問題（修改或停用），done＝沒問題
-- （沿用 reports.status 欄位，不用改表）

INSERT INTO settings (key, value) VALUES ('credit', '') ON CONFLICT(key) DO NOTHING;
