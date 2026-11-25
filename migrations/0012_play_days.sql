-- 每位學生哪幾天有練習（老師後台「這週練習幾天」用，不用每次掃一週的作答紀錄）
CREATE TABLE play_days (
  class_code TEXT NOT NULL,
  seat       INTEGER NOT NULL,
  day        TEXT NOT NULL,
  PRIMARY KEY (class_code, seat, day)
);
-- 用最近兩週的作答紀錄補上
INSERT OR IGNORE INTO play_days (class_code, seat, day)
  SELECT DISTINCT class_code, seat, day FROM logs WHERE day >= date('now', '-14 days');
