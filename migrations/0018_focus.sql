-- 主力島（預設國語、數學）：每日任務「國數雙修」
ALTER TABLE students ADD COLUMN focus_day TEXT NOT NULL DEFAULT '';     -- 每日任務是哪一天的
ALTER TABLE students ADD COLUMN focus_done TEXT NOT NULL DEFAULT '[]';  -- 那天已經過關的主力科目（完成全部後加上 ★）
ALTER TABLE students ADD COLUMN focus_days INTEGER NOT NULL DEFAULT 0;  -- 完成每日任務的天數（國數雙修徽章）
