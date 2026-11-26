-- 延伸冒險：學生按過「出發」才能按「我完成了」
CREATE TABLE IF NOT EXISTS link_open (
  class_code TEXT NOT NULL,
  seat       INTEGER NOT NULL,
  link_id    TEXT NOT NULL,
  PRIMARY KEY (class_code, seat, link_id)
);
