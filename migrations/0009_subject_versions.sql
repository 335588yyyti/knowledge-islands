-- 班級的課本版本改成每一科各自設定，例如國語南一、數學翰林
-- versions：{"國語":"南一","數學":"翰林",...}；沒設定的科目沿用 classes.version
ALTER TABLE classes ADD COLUMN versions TEXT NOT NULL DEFAULT '{}';

-- 老師自己管理的單元表（課程進度），還沒有題目的單元也能列出來；sort 是課本裡的順序
CREATE TABLE units (
  unit_key TEXT PRIMARY KEY,
  version  TEXT NOT NULL,
  grade    INTEGER NOT NULL,
  sem      TEXT NOT NULL,
  subject  TEXT NOT NULL,
  unit     TEXT NOT NULL,
  sort     INTEGER NOT NULL DEFAULT 0,
  created  TEXT NOT NULL
);
