-- 精熟制度：同一題在兩個不同的日子都答對，就算精熟（不限定隔天）

ALTER TABLE progress ADD COLUMN right_days INTEGER NOT NULL DEFAULT 0;   -- 答對過的不同日子數
ALTER TABLE progress ADD COLUMN last_right_day TEXT NOT NULL DEFAULT ''; -- 最後一次答對的日期
ALTER TABLE progress ADD COLUMN last_day TEXT NOT NULL DEFAULT '';       -- 最後一次作答的日期

-- 用既有的作答紀錄補上
UPDATE progress SET
  right_days = (SELECT COUNT(DISTINCT day) FROM logs l WHERE l.class_code = progress.class_code AND l.seat = progress.seat AND l.qid = progress.qid AND l.ok = 1),
  last_right_day = COALESCE((SELECT MAX(day) FROM logs l WHERE l.class_code = progress.class_code AND l.seat = progress.seat AND l.qid = progress.qid AND l.ok = 1), ''),
  last_day = COALESCE((SELECT MAX(day) FROM logs l WHERE l.class_code = progress.class_code AND l.seat = progress.seat AND l.qid = progress.qid), '');

-- 學生第一次精熟某個單元的紀錄（徽章與加點用）
CREATE TABLE mastery (
  class_code TEXT NOT NULL,
  seat       INTEGER NOT NULL,
  unit_key   TEXT NOT NULL,
  day        TEXT NOT NULL,
  redeemed   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (class_code, seat, unit_key)
);

INSERT INTO settings (key, value) VALUES ('per_mastery', '0') ON CONFLICT(key) DO NOTHING;

ALTER TABLE points_log ADD COLUMN mastery INTEGER NOT NULL DEFAULT 0;  -- 這次換點用掉的精熟單元數
