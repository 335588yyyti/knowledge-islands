-- 更新公告：記錄學生看過哪一版的「這次更新了什麼」（換裝置也不會重複跳出）
ALTER TABLE students ADD COLUMN news_seen TEXT NOT NULL DEFAULT '';
