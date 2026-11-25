-- 自己畫的旗子（8×8）：送審通過才扣金幣、才會顯示
CREATE TABLE flags (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  ts         TEXT NOT NULL,
  class_code TEXT NOT NULL,
  seat       INTEGER NOT NULL,
  grid       TEXT NOT NULL,                   -- 64 個 0～f，每格一個顏色
  status     TEXT NOT NULL DEFAULT 'pending', -- pending 審核中、approved 通過、rejected 不通過
  note       TEXT NOT NULL DEFAULT '',
  decided    TEXT NOT NULL DEFAULT '',
  seen       INTEGER NOT NULL DEFAULT 0       -- 學生看過審核結果了
);
CREATE INDEX flags_seat ON flags(class_code, seat, id);
CREATE INDEX flags_status ON flags(class_code, status, id);

-- 衣櫃許願池：寫字或畫圖＋說明，老師審核後公開給全班集氣
CREATE TABLE wishes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  ts         TEXT NOT NULL,
  week       TEXT NOT NULL,                   -- 那一週的週一（每人每週 1 個願望）
  class_code TEXT NOT NULL,
  seat       INTEGER NOT NULL,
  text       TEXT NOT NULL,
  image      TEXT NOT NULL DEFAULT '',        -- 畫的圖（images 表的 id）
  status     TEXT NOT NULL DEFAULT 'pending', -- pending 審核中、public 公開集氣、done 實現了、declined 沒有採用
  note       TEXT NOT NULL DEFAULT '',
  votes      INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX wishes_class ON wishes(class_code, status, id);
CREATE INDEX wishes_seat ON wishes(class_code, seat, week);
CREATE TABLE wish_votes (
  wish_id    INTEGER NOT NULL,
  class_code TEXT NOT NULL,
  seat       INTEGER NOT NULL,
  PRIMARY KEY (wish_id, class_code, seat)
);

ALTER TABLE students ADD COLUMN flag TEXT NOT NULL DEFAULT '';          -- 通過審核的旗子
ALTER TABLE students ADD COLUMN custom_color TEXT NOT NULL DEFAULT '';  -- 自訂顏色（#rrggbb）
ALTER TABLE students ADD COLUMN saved TEXT NOT NULL DEFAULT '[]';       -- 造型存檔
ALTER TABLE students ADD COLUMN save_slots INTEGER NOT NULL DEFAULT 0;  -- 已解鎖幾格存檔
