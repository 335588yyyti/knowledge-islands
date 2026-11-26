-- 願望的處理結果，許願的同學下次登入會跳出通知（以前的結果不再跳）
ALTER TABLE wishes ADD COLUMN seen INTEGER NOT NULL DEFAULT 1;
