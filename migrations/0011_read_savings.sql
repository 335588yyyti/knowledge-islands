-- 減少資料庫讀取（Cloudflare D1 免費方案每天有讀取上限）

-- 全班每一題的累計答對數與作答數（老師後台的弱點統計用，不用每次掃全部作答紀錄）
CREATE TABLE qstats (
  class_code TEXT NOT NULL,
  qid        TEXT NOT NULL,
  right      INTEGER NOT NULL DEFAULT 0,
  total      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (class_code, qid)
);
INSERT INTO qstats (class_code, qid, right, total)
  SELECT l.class_code, l.qid, SUM(l.ok), COUNT(*) FROM logs l
  WHERE NOT EXISTS (SELECT 1 FROM students t WHERE t.class_code = l.class_code AND t.seat = l.seat AND t.is_test = 1)
  GROUP BY l.class_code, l.qid;

-- 個別學生最近的作答紀錄、目前答錯的題目
CREATE INDEX logs_class_seat ON logs(class_code, seat, id);
CREATE INDEX progress_class_wrong ON progress(class_code, last_ok);
