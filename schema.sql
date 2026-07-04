-- Course Manage V2 Schema
-- SQLite — use CREATE TABLE IF NOT EXISTS for idempotency

CREATE TABLE IF NOT EXISTS users (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    username     TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL DEFAULT '',
    password_hash TEXT NOT NULL,
    role         TEXT NOT NULL DEFAULT 'admin',
    is_deleted   INTEGER NOT NULL DEFAULT 0,
    create_time  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
    updated_by   INTEGER,
    email        TEXT DEFAULT '',
    avatar       TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS year_courses (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    year        INTEGER NOT NULL,
    grade       TEXT DEFAULT '',
    is_archived INTEGER NOT NULL DEFAULT 0,
    is_deleted  INTEGER NOT NULL DEFAULT 0,
    updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_by  INTEGER
);

CREATE TABLE IF NOT EXISTS topics (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    year_course_id    INTEGER NOT NULL REFERENCES year_courses(id),
    name              TEXT NOT NULL,
    type              TEXT DEFAULT 'Live',
    lessons           INTEGER DEFAULT 12,
    fee               REAL DEFAULT 0,
    unit_price_new    REAL DEFAULT 0,
    unit_price_insert REAL DEFAULT 0,
    makeup_fee        REAL DEFAULT 0,
    sort              INTEGER DEFAULT 0,
    is_archived       INTEGER NOT NULL DEFAULT 0,
    is_deleted        INTEGER NOT NULL DEFAULT 0,
    updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
    updated_by        INTEGER
);

CREATE TABLE IF NOT EXISTS classes (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    topic_id     INTEGER NOT NULL REFERENCES topics(id),
    name         TEXT DEFAULT '',
    week         TEXT DEFAULT '',
    start        TEXT DEFAULT '',
    end          TEXT DEFAULT '',
    first_lesson TEXT,
    seat         INTEGER DEFAULT 0,
    is_completed INTEGER NOT NULL DEFAULT 0,
    is_deleted   INTEGER NOT NULL DEFAULT 0,
    updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
    updated_by   INTEGER
);

CREATE TABLE IF NOT EXISTS lessons (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    class_id   INTEGER NOT NULL REFERENCES classes(id),
    num        INTEGER NOT NULL,
    date       TEXT,
    start      TEXT DEFAULT '',
    end        TEXT DEFAULT '',
    video_url  TEXT DEFAULT '',
    status     TEXT DEFAULT '',
    is_deleted INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_by INTEGER
);

CREATE TABLE IF NOT EXISTS students (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    surname       TEXT NOT NULL DEFAULT '',
    given_name    TEXT NOT NULL DEFAULT '',
    school        TEXT DEFAULT '',
    email         TEXT DEFAULT '',
    password      TEXT DEFAULT '',
    phone         TEXT DEFAULT '',
    parent_phone  TEXT DEFAULT '',
    note          TEXT DEFAULT '',
    dse_year      INTEGER,
    enroll_date   TEXT DEFAULT '',
    avatar        TEXT DEFAULT '',
    is_deleted    INTEGER NOT NULL DEFAULT 0,
    create_time   TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
    updated_by    INTEGER
);

CREATE TABLE IF NOT EXISTS enrollments (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id  INTEGER NOT NULL REFERENCES students(id),
    class_id    INTEGER NOT NULL REFERENCES classes(id),
    pay_status  TEXT NOT NULL DEFAULT 'Unpaid',
    pay_amount  REAL DEFAULT 0,
    pay_method  TEXT DEFAULT '',
    purchase    INTEGER DEFAULT 12,
    used        INTEGER DEFAULT 0,
    remaining   INTEGER DEFAULT 12,
    status      TEXT DEFAULT 'active',
    is_deleted  INTEGER NOT NULL DEFAULT 0,
    create_time TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_by  INTEGER,
    UNIQUE(student_id, class_id)
);

CREATE TABLE IF NOT EXISTS attendances (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    enrollment_id INTEGER NOT NULL REFERENCES enrollments(id),
    lesson_num    INTEGER NOT NULL,
    status        TEXT DEFAULT '',
    homework      TEXT DEFAULT '',
    checkin_time  TEXT DEFAULT '',
    updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
    updated_by    INTEGER,
    UNIQUE(enrollment_id, lesson_num)
);

CREATE TABLE IF NOT EXISTS makeup_lessons (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id        INTEGER NOT NULL REFERENCES students(id),
    original_class_id INTEGER REFERENCES classes(id),
    original_topic    TEXT DEFAULT '',
    lesson_num        TEXT DEFAULT '',
    absent_date       TEXT DEFAULT '',
    makeup_type       TEXT DEFAULT '',
    makeup_class      TEXT DEFAULT '',
    status            TEXT DEFAULT '',
    is_deleted        INTEGER NOT NULL DEFAULT 0,
    updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
    updated_by        INTEGER
);

CREATE TABLE IF NOT EXISTS lesson_standby (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    class_id        INTEGER NOT NULL REFERENCES classes(id),
    student_id      INTEGER NOT NULL REFERENCES students(id),
    status          TEXT NOT NULL DEFAULT 'waiting',
    trigger_time    TEXT NOT NULL DEFAULT (datetime('now')),
    confirmed_at    TEXT,
    confirmed_by    INTEGER,
    note            TEXT DEFAULT '',
    is_deleted      INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(class_id, student_id)
);

CREATE TABLE IF NOT EXISTS scan_sessions (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    lesson_id       INTEGER NOT NULL REFERENCES lessons(id),
    active          INTEGER NOT NULL DEFAULT 1,
    started_at      TEXT NOT NULL DEFAULT (datetime('now')),
    stopped_at      TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS attendance_log (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    enrollment_id   INTEGER NOT NULL REFERENCES enrollments(id),
    lesson_num      INTEGER NOT NULL,
    old_status      TEXT DEFAULT '',
    new_status      TEXT DEFAULT '',
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_by      INTEGER
);

CREATE TABLE IF NOT EXISTS invoices (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    enrollment_id   INTEGER NOT NULL REFERENCES enrollments(id),
    student_id      INTEGER NOT NULL REFERENCES students(id),
    topic_id        INTEGER REFERENCES topics(id),
    type            TEXT NOT NULL DEFAULT 'tuition',
    amount          REAL NOT NULL DEFAULT 0,
    makeup_fee      REAL DEFAULT 0,
    status          TEXT NOT NULL DEFAULT 'unpaid',
    pay_method      TEXT DEFAULT '',
    note            TEXT DEFAULT '',
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    paid_at         TEXT,
    updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_by      INTEGER
);
