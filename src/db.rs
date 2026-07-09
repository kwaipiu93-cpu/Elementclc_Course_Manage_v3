use sqlx::sqlite::SqlitePoolOptions;
use sqlx::SqlitePool;

pub async fn init_pool(database_url: &str) -> color_eyre::Result<SqlitePool> {
    let pool = SqlitePoolOptions::new()
        .max_connections(5)
        .connect(database_url)
        .await?;
    sqlx::query("PRAGMA foreign_keys = ON").execute(&pool).await?;
    Ok(pool)
}

pub async fn run_migrations(pool: &SqlitePool) -> color_eyre::Result<()> {
    sqlx::query(include_str!("../schema.sql"))
        .execute(pool)
        .await?;

    // Migration: attendance_log table (for existing DBs)
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS attendance_log (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            enrollment_id   INTEGER NOT NULL REFERENCES enrollments(id),
            lesson_num      INTEGER NOT NULL,
            old_status      TEXT DEFAULT '',
            new_status      TEXT DEFAULT '',
            created_at      TEXT NOT NULL DEFAULT (datetime('now')),
            updated_by      INTEGER
        )"
    )
    .execute(pool)
    .await?;

    // Migration: lesson_checkins table (lesson-based checkin)
    sqlx::query(
        r#"CREATE TABLE IF NOT EXISTS lesson_checkins (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            lesson_id       INTEGER NOT NULL REFERENCES lessons(id),
            student_id      INTEGER NOT NULL REFERENCES students(id),
            enrollment_id   INTEGER REFERENCES enrollments(id),
            makeup_lesson_id INTEGER REFERENCES makeup_lessons(id),
            status          TEXT NOT NULL DEFAULT 'present',
            checkin_time    TEXT,
            source          TEXT NOT NULL DEFAULT 'enrolled',
            created_at      TEXT NOT NULL DEFAULT (datetime('now')),
            UNIQUE(lesson_id, student_id)
        )"#
    )
    .execute(pool)
    .await?;

    // Migration: add target_lesson_id to makeup_lessons
    sqlx::query(
        "ALTER TABLE makeup_lessons ADD COLUMN target_lesson_id INTEGER REFERENCES lessons(id)"
    )
    .execute(pool)
    .await
    .ok(); // may already exist

    // Migration: migrate existing attendances → lesson_checkins
    sqlx::query(
        r#"INSERT OR IGNORE INTO lesson_checkins (lesson_id, student_id, enrollment_id, status, checkin_time, source)
           SELECT l.id, e.student_id, a.enrollment_id, a.status, a.checkin_time, 'enrolled'
           FROM attendances a
           JOIN enrollments e ON a.enrollment_id = e.id AND e.is_deleted = 0
           JOIN lessons l ON l.class_id = e.class_id AND l.num = a.lesson_num AND l.is_deleted = 0
           WHERE a.status IS NOT NULL AND a.status != ''"#
    )
    .execute(pool)
    .await?;

    // Migration: lesson_standby table (standby/waiting list)
    sqlx::query(
        r#"CREATE TABLE IF NOT EXISTS lesson_standby (
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
        )"#
    )
    .execute(pool)
    .await?;

    // Migration: scan_sessions table (QR scanner session)
    sqlx::query(
        r#"CREATE TABLE IF NOT EXISTS scan_sessions (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            lesson_id       INTEGER NOT NULL REFERENCES lessons(id),
            active          INTEGER NOT NULL DEFAULT 1,
            started_at      TEXT NOT NULL DEFAULT (datetime('now')),
            stopped_at      TEXT,
            created_at      TEXT NOT NULL DEFAULT (datetime('now'))
        )"#
    )
    .execute(pool)
    .await?;

    // Migration: fix attendance_log.lesson_num from lesson_id to actual lesson number
    // Old data stored lesson ID (e.g., 123) instead of lesson number (e.g., 1)
    sqlx::query(
        "UPDATE attendance_log SET lesson_num = (SELECT COALESCE(num, 0) FROM lessons WHERE id = lesson_num) WHERE lesson_num IN (SELECT id FROM lessons)"
    )
    .execute(pool)
    .await?;

    // Migration: add makeup_fee column to topics
    sqlx::query("ALTER TABLE topics ADD COLUMN makeup_fee REAL DEFAULT 0")
        .execute(pool)
        .await
        .ok();

    // Migration: create invoices table
    sqlx::query(
        r#"CREATE TABLE IF NOT EXISTS invoices (
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
        )"#
    )
    .execute(pool)
    .await?;

    // Migration: update leave/absent to new statuses based on makeup_lessons
    // leave/absent + makeup_lessons.status='scheduled' + makeup_type='課室錄播' → scheduled_room
    sqlx::query(
        r#"UPDATE lesson_checkins SET status = 'scheduled_room'
           WHERE status IN ('leave', 'absent')
           AND (student_id, lesson_id) IN (
               SELECT lc.student_id, lc.lesson_id
               FROM lesson_checkins lc
               JOIN lessons l ON lc.lesson_id = l.id AND l.is_deleted = 0
               JOIN makeup_lessons mk ON mk.student_id = lc.student_id
                   AND mk.original_class_id = l.class_id
                   AND mk.lesson_num = CAST(l.num AS TEXT)
                   AND mk.makeup_type = '課室錄播'
                   AND mk.status = 'scheduled'
                   AND mk.is_deleted = 0
           )"#
    )
    .execute(pool)
    .await?;

    // leave/absent + makeup_lessons.status='scheduled' + makeup_type='線上錄播' → scheduled_video
    sqlx::query(
        r#"UPDATE lesson_checkins SET status = 'scheduled_video'
           WHERE status IN ('leave', 'absent')
           AND (student_id, lesson_id) IN (
               SELECT lc.student_id, lc.lesson_id
               FROM lesson_checkins lc
               JOIN lessons l ON lc.lesson_id = l.id AND l.is_deleted = 0
               JOIN makeup_lessons mk ON mk.student_id = lc.student_id
                   AND mk.original_class_id = l.class_id
                   AND mk.lesson_num = CAST(l.num AS TEXT)
                   AND mk.makeup_type = '線上錄播'
                   AND mk.status = 'scheduled'
                   AND mk.is_deleted = 0
           )"#
    )
    .execute(pool)
    .await?;

    // leave/absent + makeup_lessons.status='scheduled' + other type (課室補課) → scheduled_classroom
    sqlx::query(
        r#"UPDATE lesson_checkins SET status = 'scheduled_classroom'
           WHERE status IN ('leave', 'absent')
           AND (student_id, lesson_id) IN (
               SELECT lc.student_id, lc.lesson_id
               FROM lesson_checkins lc
               JOIN lessons l ON lc.lesson_id = l.id AND l.is_deleted = 0
               JOIN makeup_lessons mk ON mk.student_id = lc.student_id
                   AND mk.original_class_id = l.class_id
                   AND mk.lesson_num = CAST(l.num AS TEXT)
                   AND (mk.makeup_type IS NULL OR mk.makeup_type NOT IN ('課室錄播', '線上錄播'))
                   AND mk.status = 'scheduled'
                   AND mk.is_deleted = 0
           )"#
    )
    .execute(pool)
    .await?;

    // leave/absent + makeup_lessons.status='waiting' → waiting
    sqlx::query(
        r#"UPDATE lesson_checkins SET status = 'waiting'
           WHERE status IN ('leave', 'absent')
           AND (student_id, lesson_id) IN (
               SELECT lc.student_id, lc.lesson_id
               FROM lesson_checkins lc
               JOIN lessons l ON lc.lesson_id = l.id AND l.is_deleted = 0
               JOIN makeup_lessons mk ON mk.student_id = lc.student_id
                   AND mk.original_class_id = l.class_id
                   AND mk.lesson_num = CAST(l.num AS TEXT)
                   AND mk.status = 'waiting'
                   AND mk.is_deleted = 0
           )"#
    )
    .execute(pool)
    .await?;

    // leave/absent + lesson_standby.status='waiting' → waiting (face-recog standby)
    sqlx::query(
        r#"UPDATE lesson_checkins SET status = 'waiting'
           WHERE status IN ('leave', 'absent')
           AND (student_id, lesson_id) IN (
               SELECT lc.student_id, lc.lesson_id
               FROM lesson_checkins lc
               JOIN lessons l ON lc.lesson_id = l.id AND l.is_deleted = 0
               JOIN lesson_standby sb ON sb.student_id = lc.student_id
                   AND sb.class_id = l.class_id
                   AND sb.status = 'waiting'
                   AND sb.is_deleted = 0
           )"#
    )
    .execute(pool)
    .await?;

    // Seed default admin if not exists
    let exists: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM users WHERE username = 'admin'",
    )
    .fetch_one(pool)
    .await?;

    // Migration: add avatar column to students
    sqlx::query("ALTER TABLE students ADD COLUMN avatar TEXT DEFAULT ''")
        .execute(pool)
        .await
        .ok();

    // Migration: set default password for students without one (hash = email)
    use crate::auth::hash_password;
    let pwless: Vec<(i64, Option<String>)> = sqlx::query_as(
        "SELECT id, email FROM students WHERE (password IS NULL OR password = '') AND is_deleted = 0"
    )
    .fetch_all(pool)
    .await?;
    for (sid, email) in &pwless {
        let default_pw = email.clone().unwrap_or_else(|| format!("student{}", sid));
        if let Ok(hash) = hash_password(&default_pw) {
            sqlx::query("UPDATE students SET password = ? WHERE id = ?")
                .bind(&hash)
                .bind(sid)
                .execute(pool)
                .await
                .ok();
        }
    }

    // Migration: add email and avatar to users
    sqlx::query("ALTER TABLE users ADD COLUMN email TEXT DEFAULT ''")
        .execute(pool)
        .await
        .ok();
    sqlx::query("ALTER TABLE users ADD COLUMN avatar TEXT DEFAULT ''")
        .execute(pool)
        .await
        .ok();
    // Set email for users that have empty email (use username as default email)
    sqlx::query("UPDATE users SET email = username || '@cm.test' WHERE email IS NULL OR email = ''")
        .execute(pool)
        .await
        .ok();

    if exists.0 == 0 {
        use crate::auth::hash_password;
        let hash = hash_password("admin123")?;
        sqlx::query("INSERT INTO users (username, display_name, email, password_hash, role) VALUES ('admin', 'Admin', 'admin@cm.test', ?, 'superadmin')")
            .bind(&hash)
            .execute(pool)
            .await?;
        tracing::info!("Created default admin user (password: admin123)");
    }

    // Migration: add homework_done column to lesson_checkins (default = 1 = 已交)
    sqlx::query("ALTER TABLE lesson_checkins ADD COLUMN homework_done INTEGER NOT NULL DEFAULT 1")
        .execute(pool)
        .await
        .ok();

    // Migration: products table (貨品)
    sqlx::query(
        r#"CREATE TABLE IF NOT EXISTS products (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            name        TEXT NOT NULL,
            description TEXT DEFAULT '',
            price       REAL NOT NULL DEFAULT 0,
            is_archived INTEGER NOT NULL DEFAULT 0,
            is_system   INTEGER NOT NULL DEFAULT 0,
            is_deleted  INTEGER NOT NULL DEFAULT 0,
            updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
            updated_by  INTEGER
        )"#
    )
    .execute(pool)
    .await?;

    // Migration: add is_system column to existing products (idempotent)
    let _ = sqlx::query("ALTER TABLE products ADD COLUMN is_system INTEGER NOT NULL DEFAULT 0")
        .execute(pool).await;

    // Seed system product: Video補課手續費 (idempotent — only inserts if not exists)
    let _ = sqlx::query(
        "INSERT OR IGNORE INTO products (id, name, description, price, is_system, updated_by) VALUES (3, 'Video補課手續費', '申請影片錄播補課的行政手續費', 50.0, 1, 1)"
    )
    .execute(pool)
    .await;

    // Migration: product_purchases table (學生購買記錄)
    sqlx::query(
        r#"CREATE TABLE IF NOT EXISTS product_purchases (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            student_id  INTEGER NOT NULL REFERENCES students(id),
            product_id  INTEGER NOT NULL REFERENCES products(id),
            quantity    INTEGER NOT NULL DEFAULT 1,
            total_price REAL NOT NULL DEFAULT 0,
            pay_status  TEXT NOT NULL DEFAULT 'Unpaid',
            note        TEXT DEFAULT '',
            created_at  TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
            updated_by  INTEGER
        )"#
    )
    .execute(pool)
    .await?;

    Ok(())

}
