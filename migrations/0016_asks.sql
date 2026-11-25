-- 學生提問：截圖＋文字，老師回覆（可以公開給全班），找到系統問題有獎勵、亂提問會扣金幣
CREATE TABLE asks (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  ts         TEXT NOT NULL,
  day        TEXT NOT NULL,
  class_code TEXT NOT NULL,
  seat       INTEGER NOT NULL,
  text       TEXT NOT NULL,
  image      TEXT NOT NULL DEFAULT '',        -- 截圖（images 表的 id）
  status     TEXT NOT NULL DEFAULT 'open',    -- open 待處理、answered 已回答、bug 系統問題、warn 提醒、junk 亂提問
  reply      TEXT NOT NULL DEFAULT '',
  public     INTEGER NOT NULL DEFAULT 0,      -- 1：回覆公開給全班（匿名）
  reward     TEXT NOT NULL DEFAULT '',        -- 給學生看的加減說明，例如「+20 金幣、+1 星星」
  replied    TEXT NOT NULL DEFAULT '',
  seen       INTEGER NOT NULL DEFAULT 0,      -- 提問的學生看過回覆了
  draft      TEXT NOT NULL DEFAULT '',        -- Claude 先寫好的回覆草稿（老師按送出才會給學生看）
  draft_kind TEXT NOT NULL DEFAULT '',
  draft_note TEXT NOT NULL DEFAULT ''         -- Claude 給老師的說明（例如手冊哪裡有答案）
);
CREATE INDEX asks_class ON asks(class_code, status, id);
CREATE INDEX asks_seat ON asks(class_code, seat, id);
CREATE INDEX asks_pub ON asks(class_code, public, id);

ALTER TABLE students ADD COLUMN asks_seen INTEGER NOT NULL DEFAULT 0;  -- 看過的公開回覆（最大 id）
ALTER TABLE students ADD COLUMN bugs INTEGER NOT NULL DEFAULT 0;       -- 找到系統問題的次數（系統偵探徽章）
