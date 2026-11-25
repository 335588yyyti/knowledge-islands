-- 限定特價期間每人限買幾樣：記錄這次特價（以特價開始日區分）已經買了幾樣
ALTER TABLE students ADD COLUMN sale_key TEXT NOT NULL DEFAULT '';
ALTER TABLE students ADD COLUMN sale_buys INTEGER NOT NULL DEFAULT 0;
