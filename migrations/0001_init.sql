-- 知識群島 資料表

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- 每一屆／每一班一列
CREATE TABLE classes (
  code       TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  grade      INTEGER NOT NULL DEFAULT 6,
  sem        TEXT NOT NULL DEFAULT '上',
  version    TEXT NOT NULL DEFAULT '通用',
  units      TEXT NOT NULL DEFAULT '[]',   -- 已教單元（單元代號 JSON 陣列）
  status     TEXT NOT NULL DEFAULT '進行中', -- 進行中／封存
  created    TEXT NOT NULL,
  exam_name  TEXT NOT NULL DEFAULT '',
  exam_date  TEXT NOT NULL DEFAULT '',
  exam_units TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE students (
  class_code     TEXT NOT NULL,
  seat           INTEGER NOT NULL,
  nick           TEXT NOT NULL DEFAULT '',
  pin            TEXT NOT NULL DEFAULT '',
  coins          INTEGER NOT NULL DEFAULT 0,  -- 金幣餘額（商店可花）
  earned         INTEGER NOT NULL DEFAULT 0,  -- 累積金幣（只增不減，加點用）
  coins_redeemed INTEGER NOT NULL DEFAULT 0,  -- 已換成點數的累積金幣
  stars          INTEGER NOT NULL DEFAULT 0,
  stamps         INTEGER NOT NULL DEFAULT 0,
  stamps_redeemed INTEGER NOT NULL DEFAULT 0,
  streak         INTEGER NOT NULL DEFAULT 0,
  last_day       TEXT NOT NULL DEFAULT '',
  total          INTEGER NOT NULL DEFAULT 0,
  right_count    INTEGER NOT NULL DEFAULT 0,
  owned          TEXT NOT NULL DEFAULT '[]',
  outfit         TEXT NOT NULL DEFAULT '{}',
  fails          INTEGER NOT NULL DEFAULT 0,  -- 連續輸錯密碼次數
  locked_until   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (class_code, seat)
);

-- 題庫：依 版本＋年級＋學期＋科目＋單元 分類，每一屆共用
CREATE TABLE questions (
  id       TEXT PRIMARY KEY,
  version  TEXT NOT NULL DEFAULT '通用',
  grade    INTEGER NOT NULL,
  sem      TEXT NOT NULL,
  subject  TEXT NOT NULL,
  unit     TEXT NOT NULL,
  unit_key TEXT NOT NULL,  -- 版本｜6上｜科目｜單元
  concept  TEXT NOT NULL DEFAULT '',
  type     TEXT NOT NULL,  -- 選擇／是非／填空
  text     TEXT NOT NULL,
  a TEXT NOT NULL DEFAULT '', b TEXT NOT NULL DEFAULT '', c TEXT NOT NULL DEFAULT '', d TEXT NOT NULL DEFAULT '',
  answer   TEXT NOT NULL,
  explain  TEXT NOT NULL DEFAULT '',
  source   TEXT NOT NULL DEFAULT '老師',
  enabled  INTEGER NOT NULL DEFAULT 1,
  created  TEXT NOT NULL DEFAULT ''
);
CREATE INDEX questions_unit ON questions(unit_key);

-- 每一題作答一列
CREATE TABLE logs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  ts         TEXT NOT NULL,
  day        TEXT NOT NULL,
  class_code TEXT NOT NULL,
  seat       INTEGER NOT NULL,
  qid        TEXT NOT NULL,
  subject    TEXT NOT NULL,
  unit       TEXT NOT NULL,
  answer     TEXT NOT NULL,
  ok         INTEGER NOT NULL
);
CREATE INDEX logs_class_day ON logs(class_code, day);
CREATE INDEX logs_class_q ON logs(class_code, qid);

-- 每位學生每一題的最新結果（錯題礁、掌握度、弱點觀念用）
CREATE TABLE progress (
  class_code TEXT NOT NULL,
  seat       INTEGER NOT NULL,
  qid        TEXT NOT NULL,
  last_ok    INTEGER NOT NULL,
  PRIMARY KEY (class_code, seat, qid)
);

-- 日常加點紀錄
CREATE TABLE points_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  ts         TEXT NOT NULL,
  class_code TEXT NOT NULL,
  seat       INTEGER NOT NULL,
  nick       TEXT NOT NULL DEFAULT '',
  stamps     INTEGER NOT NULL,
  coins      INTEGER NOT NULL,
  points     INTEGER NOT NULL,
  note       TEXT NOT NULL DEFAULT ''
);
CREATE INDEX points_class ON points_log(class_code, id);

INSERT INTO settings (key, value) VALUES
  ('per_round', '10'),
  ('pass_ratio', '0.7'),
  ('per_stamp', '1'),
  ('coins_per_point', '20');
