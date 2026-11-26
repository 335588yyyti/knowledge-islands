-- 停用的題目不公告：拿掉已經建立、還在等隔天公告的停用紀錄
DELETE FROM corrections WHERE kind = 'off';
-- 作答紀錄每寫一題就要更新每個索引；這兩個索引已經沒有查詢在用，拿掉可以少一半寫入
DROP INDEX IF EXISTS logs_class_day;
DROP INDEX IF EXISTS logs_class_q;
