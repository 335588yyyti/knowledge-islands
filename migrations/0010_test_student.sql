-- 測試帳號：老師自己試玩用，不算進全班統計、精熟人數、排行榜和加點
ALTER TABLE students ADD COLUMN is_test INTEGER NOT NULL DEFAULT 0;
