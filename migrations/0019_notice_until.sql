-- 老師公告可以設定「顯示到哪一天」，過了就自動不顯示（空白代表一直顯示）
ALTER TABLE classes ADD COLUMN notice_until TEXT NOT NULL DEFAULT '';
