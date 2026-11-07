-- 延伸冒險：老師為單元加上外部資源連結（影片、互動網站、其他老師的教學遊戲）

CREATE TABLE links (
  id       TEXT PRIMARY KEY,
  unit_key TEXT NOT NULL,          -- 版本｜6上｜科目｜單元
  title    TEXT NOT NULL,
  url      TEXT NOT NULL,
  note     TEXT NOT NULL DEFAULT '',
  star     INTEGER NOT NULL DEFAULT 0,   -- 完成後給 1 顆星星（每人每個連結一次）
  created  TEXT NOT NULL
);
CREATE INDEX links_unit ON links(unit_key);

CREATE TABLE link_done (
  class_code TEXT NOT NULL,
  seat       INTEGER NOT NULL,
  link_id    TEXT NOT NULL,
  day        TEXT NOT NULL,
  PRIMARY KEY (class_code, seat, link_id)
);
