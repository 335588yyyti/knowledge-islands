-- 徽章：學生達成有意義的目標時獲得，每個徽章只拿一次

CREATE TABLE badges (
  class_code TEXT NOT NULL,
  seat       INTEGER NOT NULL,
  badge      TEXT NOT NULL,
  day        TEXT NOT NULL,
  PRIMARY KEY (class_code, seat, badge)
);

ALTER TABLE students ADD COLUMN rescued INTEGER NOT NULL DEFAULT 0;        -- 從錯題答對救回的題數
ALTER TABLE students ADD COLUMN passage_right INTEGER NOT NULL DEFAULT 0;  -- 答對的素養題數
ALTER TABLE students ADD COLUMN last_fail_day TEXT NOT NULL DEFAULT '';    -- 最後一次沒過關的日期（越挫越勇用）

-- 用既有紀錄補上「答對的素養題數」
UPDATE students SET passage_right = (
  SELECT COUNT(*) FROM logs l JOIN questions q ON q.id = l.qid
  WHERE l.class_code = students.class_code AND l.seat = students.seat AND l.ok = 1 AND q.passage <> ''
);
