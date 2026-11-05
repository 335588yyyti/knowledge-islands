-- 學生回報題目、圖片題、老師公告與指定任務、徽章排行榜開關

CREATE TABLE reports (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  ts         TEXT NOT NULL,
  class_code TEXT NOT NULL,
  seat       INTEGER NOT NULL,
  qid        TEXT NOT NULL,
  reason     TEXT NOT NULL,
  note       TEXT NOT NULL DEFAULT '',
  status     TEXT NOT NULL DEFAULT 'open'   -- open：待檢查；done：處理完
);
CREATE INDEX reports_open ON reports(status, qid);

-- 圖片直接存在資料庫（上傳前會在瀏覽器縮小、壓縮），不需要另外開檔案空間
CREATE TABLE images (
  id      TEXT PRIMARY KEY,
  mime    TEXT NOT NULL,
  data    TEXT NOT NULL,   -- base64
  created TEXT NOT NULL
);

ALTER TABLE questions ADD COLUMN image TEXT NOT NULL DEFAULT '';   -- 圖片 id
ALTER TABLE classes ADD COLUMN notice TEXT NOT NULL DEFAULT '';    -- 給學生的公告
ALTER TABLE classes ADD COLUMN mission TEXT NOT NULL DEFAULT '';   -- 老師指定任務島（科目名稱、錯題、綜合、段考）

INSERT INTO settings (key, value) VALUES ('show_leaderboard', '1') ON CONFLICT(key) DO NOTHING;
