-- 作答紀錄記下第二次的答案（答錯看提示後再答的那一次）
ALTER TABLE logs ADD COLUMN answer2 TEXT NOT NULL DEFAULT '';

-- 題目更正公告：老師確認題目有錯（修改或停用）時記一筆，隔天早上 8 點起全部學生登入時看到（同一天的合在一起）
CREATE TABLE corrections (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  ts      TEXT NOT NULL,
  day     TEXT NOT NULL,            -- 從這天開始公告（處理的隔天）
  qid     TEXT NOT NULL,
  kind    TEXT NOT NULL,            -- edit 已修正、off 已停用
  subject TEXT NOT NULL DEFAULT '',
  unit    TEXT NOT NULL DEFAULT '',
  text    TEXT NOT NULL DEFAULT '',
  answer  TEXT NOT NULL DEFAULT '', -- 修正後的正確答案（給學生看的文字）
  explain TEXT NOT NULL DEFAULT ''
);
CREATE INDEX corrections_day ON corrections(day, id);
ALTER TABLE students ADD COLUMN corr_seen INTEGER NOT NULL DEFAULT 0;  -- 看過的題目更正（最大 id）
