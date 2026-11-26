-- 題目回報：記下學生選了什麼、老師的回覆和處理結果（亂回報扣金幣），學生看得到回饋；Claude 可以先寫審核建議
ALTER TABLE reports ADD COLUMN answer TEXT NOT NULL DEFAULT '';
ALTER TABLE reports ADD COLUMN reply TEXT NOT NULL DEFAULT '';
ALTER TABLE reports ADD COLUMN result TEXT NOT NULL DEFAULT '';        -- confirmed 真的有問題、ok 沒問題、junk 亂回報
ALTER TABLE reports ADD COLUMN penalty INTEGER NOT NULL DEFAULT 0;
ALTER TABLE reports ADD COLUMN seen INTEGER NOT NULL DEFAULT 1;        -- 學生看過處理結果了（舊的回報當作看過）
ALTER TABLE reports ADD COLUMN draft TEXT NOT NULL DEFAULT '';
ALTER TABLE reports ADD COLUMN draft_kind TEXT NOT NULL DEFAULT '';
ALTER TABLE reports ADD COLUMN draft_note TEXT NOT NULL DEFAULT '';
CREATE INDEX reports_seat ON reports(class_code, seat, id);

-- 題目提示：答錯時先給提示、再答一次（提示不能直接寫出答案）
ALTER TABLE questions ADD COLUMN hint TEXT NOT NULL DEFAULT '';
