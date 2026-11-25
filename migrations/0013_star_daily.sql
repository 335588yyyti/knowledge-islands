-- 星星每天最多算幾顆：記錄今天已經拿了幾顆
ALTER TABLE students ADD COLUMN star_day TEXT NOT NULL DEFAULT '';
ALTER TABLE students ADD COLUMN star_today INTEGER NOT NULL DEFAULT 0;
