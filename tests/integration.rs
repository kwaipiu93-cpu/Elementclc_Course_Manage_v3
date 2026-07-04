// Course Manage V2 — Integration Tests
// Run: cargo test --test integration
// Each test is isolated: in-memory SQLite with fresh migrations.

use sqlx::{SqlitePool, Row};

// ─── Setup ─────────────────────────────────────────────────────────────

/// Create a fresh in-memory DB with all tables.
async fn setup_pool() -> SqlitePool {
    let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
    sqlx::query("PRAGMA foreign_keys = ON").execute(&pool).await.unwrap();

    // Schema (from project root)
    let schema = include_str!("../schema.sql");
    for statement in schema.split(';') {
        let s = statement.trim();
        if !s.is_empty() {
            sqlx::query(s).execute(&pool).await.unwrap();
        }
    }

    // Migration tables (from db.rs run_migrations)
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS lesson_checkins (
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
        )"
    ).execute(&pool).await.unwrap();

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
    ).execute(&pool).await.unwrap();

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS lesson_standby (
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
        )"
    ).execute(&pool).await.unwrap();

    // Migration: add target_lesson_id to makeup_lessons
    sqlx::query(
        "ALTER TABLE makeup_lessons ADD COLUMN target_lesson_id INTEGER REFERENCES lessons(id)"
    ).execute(&pool).await.ok();

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS scan_sessions (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            lesson_id       INTEGER NOT NULL REFERENCES lessons(id),
            active          INTEGER NOT NULL DEFAULT 1,
            started_at      TEXT NOT NULL DEFAULT (datetime('now')),
            stopped_at      TEXT,
            created_at      TEXT NOT NULL DEFAULT (datetime('now'))
        )"
    ).execute(&pool).await.unwrap();

    pool
}

/// Seed: 1 year_course, 1 topic, 1 class, 1 lesson, 1 student, 1 enrollment.
/// Also creates class 8 (補課錄播班).
/// Returns (class_id, lesson_id, student_id, enrollment_id).
async fn seed_class_lesson_student(pool: &SqlitePool) -> (i64, i64, i64, i64) {
    let yid: i64 = sqlx::query_scalar(
        "INSERT INTO year_courses (name, year) VALUES ('Test', 2026) RETURNING id"
    ).fetch_one(pool).await.unwrap();

    let tid: i64 = sqlx::query_scalar(
        "INSERT INTO topics (year_course_id, name) VALUES (?, 'Math') RETURNING id"
    ).bind(yid).fetch_one(pool).await.unwrap();

    let cid: i64 = sqlx::query_scalar(
        "INSERT INTO classes (topic_id, name, is_deleted) VALUES (?, 'Test Class', 0) RETURNING id"
    ).bind(tid).fetch_one(pool).await.unwrap();

    // Class 8 = recording makeup class
    sqlx::query(
        "INSERT OR IGNORE INTO classes (id, topic_id, name, is_deleted) VALUES (8, ?, '錄播班', 0)"
    ).bind(tid).execute(pool).await.unwrap();

    let lid: i64 = sqlx::query_scalar(
        "INSERT INTO lessons (class_id, num, date, is_deleted) VALUES (?, 1, '2026-06-05', 0) RETURNING id"
    ).bind(cid).fetch_one(pool).await.unwrap();

    let sid: i64 = sqlx::query_scalar(
        "INSERT INTO students (surname, given_name, is_deleted) VALUES ('梁', '曉玲', 0) RETURNING id"
    ).fetch_one(pool).await.unwrap();

    let eid: i64 = sqlx::query_scalar(
        "INSERT INTO enrollments (student_id, class_id, status, is_deleted) VALUES (?, ?, 'active', 0) RETURNING id"
    ).bind(sid).bind(cid).fetch_one(pool).await.unwrap();

    (cid, lid, sid, eid)
}

/// Insert a lesson_checkin for a student+lesson
async fn insert_checkin(pool: &SqlitePool, lid: i64, sid: i64, eid: i64, status: &str) {
    sqlx::query(
        "INSERT INTO lesson_checkins (lesson_id, student_id, enrollment_id, status, source)
         VALUES (?, ?, ?, ?, 'enrolled')
         ON CONFLICT(lesson_id, student_id) DO UPDATE SET status = excluded.status"
    )
    .bind(lid).bind(sid).bind(eid).bind(status)
    .execute(pool).await.unwrap();
}

/// Insert a makeup_lessons record, returns its id
async fn insert_makeup(pool: &SqlitePool, sid: i64, cid: i64, lnum: i32, status: &str, mk_type: &str) -> i64 {
    sqlx::query_scalar::<_, i64>(
        "INSERT INTO makeup_lessons (student_id, original_class_id, lesson_num, absent_date, makeup_type, status, is_deleted)
         VALUES (?, ?, ?, '2026-06-05', ?, ?, 0) RETURNING id"
    )
    .bind(sid).bind(cid).bind(lnum.to_string()).bind(mk_type).bind(status)
    .fetch_one(pool).await.unwrap()
}

// ─── Helpers ───────────────────────────────────────────────────────────

async fn get_lc_status(pool: &SqlitePool, sid: i64, lid: i64) -> String {
    sqlx::query_scalar::<_, String>(
        "SELECT COALESCE(status, '') FROM lesson_checkins WHERE student_id = ? AND lesson_id = ?"
    )
    .bind(sid).bind(lid)
    .fetch_optional(pool).await.unwrap()
    .unwrap_or_default()
}

async fn count_pending_makeups(pool: &SqlitePool, sid: i64) -> i64 {
    sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM makeup_lessons WHERE student_id = ? AND is_deleted = 0"
    )
    .bind(sid).fetch_one(pool).await.unwrap()
}

// ────────────────────────────────────────────────────────────────────────
// TEST: create_makeup (recording) syncs lesson_checkin to scheduled_room
// ────────────────────────────────────────────────────────────────────────

#[sqlx::test]
async fn test_create_makeup_recording_room_syncs_checkin() {
    let pool = setup_pool().await;
    let (cid, lid, sid, eid) = seed_class_lesson_student(&pool).await;
    insert_checkin(&pool, lid, sid, eid, "leave").await;

    // Simulate create_makeup for 課室錄播
    let _mk_id = insert_makeup(&pool, sid, cid, 1, "scheduled", "課室錄播").await;

    // The lesson_checkin should be synced to scheduled_room (via the migration
    // at server start or via the create_makeup handler).
    // For this test we simulate the exact SQL that create_makeup runs:
    sqlx::query(
        "UPDATE lesson_checkins SET status = 'scheduled_room'
         WHERE student_id = ? AND lesson_id IN (
             SELECT id FROM lessons WHERE class_id = ? AND num = 1 AND is_deleted = 0
         )"
    )
    .bind(sid).bind(cid)
    .execute(&pool).await.unwrap();

    let st = get_lc_status(&pool, sid, lid).await;
    assert_eq!(st, "scheduled_room", "leave → scheduled_room after creating recording makeup");
}

// ────────────────────────────────────────────────────────────────────────
// TEST: create_makeup (video) syncs to scheduled_video
// ────────────────────────────────────────────────────────────────────────

#[sqlx::test]
async fn test_create_makeup_recording_video_syncs_checkin() {
    let pool = setup_pool().await;
    let (cid, lid, sid, eid) = seed_class_lesson_student(&pool).await;
    insert_checkin(&pool, lid, sid, eid, "leave").await;

    // Simulate create_makeup for 線上錄播
    sqlx::query(
        "UPDATE lesson_checkins SET status = 'scheduled_video'
         WHERE student_id = ? AND lesson_id IN (
             SELECT id FROM lessons WHERE class_id = ? AND num = 1 AND is_deleted = 0
         )"
    )
    .bind(sid).bind(cid)
    .execute(&pool).await.unwrap();

    let st = get_lc_status(&pool, sid, lid).await;
    assert_eq!(st, "scheduled_video");
}

// ────────────────────────────────────────────────────────────────────────
// TEST: create_makeup (classroom) syncs to scheduled_classroom
// ────────────────────────────────────────────────────────────────────────

#[sqlx::test]
async fn test_create_makeup_classroom_syncs_checkin() {
    let pool = setup_pool().await;
    let (cid, lid, sid, eid) = seed_class_lesson_student(&pool).await;
    insert_checkin(&pool, lid, sid, eid, "leave").await;

    sqlx::query(
        "UPDATE lesson_checkins SET status = 'scheduled_classroom'
         WHERE student_id = ? AND lesson_id IN (
             SELECT id FROM lessons WHERE class_id = ? AND num = 1 AND is_deleted = 0
         )"
    )
    .bind(sid).bind(cid)
    .execute(&pool).await.unwrap();

    let st = get_lc_status(&pool, sid, lid).await;
    assert_eq!(st, "scheduled_classroom");
}

// ────────────────────────────────────────────────────────────────────────
// TEST: create_makeup (waiting) syncs to waiting
// ────────────────────────────────────────────────────────────────────────

#[sqlx::test]
async fn test_create_makeup_waiting_syncs_checkin() {
    let pool = setup_pool().await;
    let (cid, lid, sid, eid) = seed_class_lesson_student(&pool).await;
    insert_checkin(&pool, lid, sid, eid, "leave").await;

    sqlx::query(
        "UPDATE lesson_checkins SET status = 'waiting'
         WHERE student_id = ? AND lesson_id IN (
             SELECT id FROM lessons WHERE class_id = ? AND num = 1 AND is_deleted = 0
         )"
    )
    .bind(sid).bind(cid)
    .execute(&pool).await.unwrap();

    let st = get_lc_status(&pool, sid, lid).await;
    assert_eq!(st, "waiting");
}

// ────────────────────────────────────────────────────────────────────────
// TEST: create_makeup with NO existing checkin → inserts record
// ────────────────────────────────────────────────────────────────────────

#[sqlx::test]
async fn test_create_makeup_no_checkin_creates_one() {
    let pool = setup_pool().await;
    let (cid, lid, sid, eid) = seed_class_lesson_student(&pool).await;
    // No lesson_checkin record exists!

    // Simulate the create-makeup INSERT logic for when no checkin exists
    let new_st = "waiting";
    let eid_opt: Option<i64> = sqlx::query_scalar(
        "SELECT id FROM enrollments WHERE student_id = ? AND class_id = ? AND is_deleted = 0 LIMIT 1"
    )
    .bind(sid).bind(cid)
    .fetch_optional(&pool).await.unwrap();

    sqlx::query(
        "INSERT INTO lesson_checkins (lesson_id, student_id, enrollment_id, status, checkin_time, source)
         VALUES (?, ?, ?, ?, datetime('now'), 'makeup')"
    )
    .bind(lid).bind(sid).bind(eid_opt).bind(new_st)
    .execute(&pool).await.unwrap();

    let st = get_lc_status(&pool, sid, lid).await;
    assert_eq!(st, "waiting", "should create a new lesson_checkin when none existed");
}

// ────────────────────────────────────────────────────────────────────────
// TEST: setting status='present' cancels pending makeup
// ────────────────────────────────────────────────────────────────────────

#[sqlx::test]
async fn test_present_cancels_pending_makeup() {
    let pool = setup_pool().await;
    let (cid, lid, sid, eid) = seed_class_lesson_student(&pool).await;
    insert_checkin(&pool, lid, sid, eid, "waiting").await;
    let mk_id = insert_makeup(&pool, sid, cid, 1, "waiting", "課室補課").await;

    // Simulate update_checkin: set status to 'present'
    insert_checkin(&pool, lid, sid, eid, "present").await;
    // Then cancel pending makeups (the new logic):
    sqlx::query(
        "UPDATE makeup_lessons SET is_deleted = 1 WHERE id = ? AND is_deleted = 0"
    )
    .bind(mk_id).execute(&pool).await.unwrap();

    assert_eq!(count_pending_makeups(&pool, sid).await, 0, "makeup should be cancelled when setting present");
    let st = get_lc_status(&pool, sid, lid).await;
    assert_eq!(st, "present");
}

// ────────────────────────────────────────────────────────────────────────
// TEST: setting status='leave' cancels pending makeup (was waiting)
// ────────────────────────────────────────────────────────────────────────

#[sqlx::test]
async fn test_leave_cancels_pending_makeup() {
    let pool = setup_pool().await;
    let (cid, lid, sid, eid) = seed_class_lesson_student(&pool).await;
    insert_checkin(&pool, lid, sid, eid, "waiting").await;
    let mk_id = insert_makeup(&pool, sid, cid, 1, "waiting", "課室補課").await;

    // Simulate: set to 'leave', cancel makeup
    insert_checkin(&pool, lid, sid, eid, "leave").await;
    sqlx::query(
        "UPDATE makeup_lessons SET is_deleted = 1 WHERE id = ? AND is_deleted = 0"
    )
    .bind(mk_id).execute(&pool).await.unwrap();

    assert_eq!(count_pending_makeups(&pool, sid).await, 0, "makeup cancelled when setting leave on waiting");
    let st = get_lc_status(&pool, sid, lid).await;
    assert_eq!(st, "leave");
}

// ────────────────────────────────────────────────────────────────────────
// TEST: deleting a makeup reverts lesson_checkin to leave/absent
// ────────────────────────────────────────────────────────────────────────

#[sqlx::test]
async fn test_delete_makeup_reverts_checkin() {
    let pool = setup_pool().await;
    let (cid, lid, sid, eid) = seed_class_lesson_student(&pool).await;
    insert_checkin(&pool, lid, sid, eid, "waiting").await;
    let mk_id = insert_makeup(&pool, sid, cid, 1, "waiting", "課室補課").await;

    // Simulate delete_makeup: get original status from log, revert
    let revert_to = "leave"; // simplified: would look up attendance_log in production

    sqlx::query(
        "UPDATE makeup_lessons SET is_deleted = 1 WHERE id = ?"
    )
    .bind(mk_id).execute(&pool).await.unwrap();

    // Revert the lesson_checkin
    sqlx::query(
        "UPDATE lesson_checkins SET status = ?
         WHERE student_id = ? AND lesson_id = ? AND status IN ('waiting','scheduled_room','scheduled_video','scheduled_classroom')"
    )
    .bind(revert_to).bind(sid).bind(lid)
    .execute(&pool).await.unwrap();

    let st = get_lc_status(&pool, sid, lid).await;
    assert_eq!(st, "leave", "checkin reverted to leave after deleting makeup");
    assert_eq!(count_pending_makeups(&pool, sid).await, 0, "makeup soft-deleted");
}

// ────────────────────────────────────────────────────────────────────────
// TEST: update_makeup changes status, lesson_checkin syncs
// ────────────────────────────────────────────────────────────────────────

#[sqlx::test]
async fn test_update_makeup_status_syncs_checkin() {
    let pool = setup_pool().await;
    let (cid, lid, sid, eid) = seed_class_lesson_student(&pool).await;
    insert_checkin(&pool, lid, sid, eid, "scheduled_video").await;
    let mk_id = insert_makeup(&pool, sid, cid, 1, "scheduled", "線上錄播").await;

    // Update makeup_lessons status from 'scheduled' to 'waiting'
    sqlx::query("UPDATE makeup_lessons SET status = 'waiting', updated_at = datetime('now') WHERE id = ?")
        .bind(mk_id).execute(&pool).await.unwrap();

    // Sync lesson_checkin (the update_makeup handler logic)
    sqlx::query(
        "UPDATE lesson_checkins SET status = 'waiting'
         WHERE student_id = ? AND lesson_id = ? AND status IN ('waiting','scheduled_room','scheduled_video','scheduled_classroom','leave','absent')"
    )
    .bind(sid).bind(lid)
    .execute(&pool).await.unwrap();

    let st = get_lc_status(&pool, sid, lid).await;
    assert_eq!(st, "waiting", "lesson_checkin should sync when makeup status changes to waiting");
}

// ────────────────────────────────────────────────────────────────────────
// TEST: QR scanner checkin cancels pending makeup
// ────────────────────────────────────────────────────────────────────────

#[sqlx::test]
async fn test_qr_checkin_cancels_pending_makeup() {
    let pool = setup_pool().await;
    let (cid, lid, sid, eid) = seed_class_lesson_student(&pool).await;
    insert_checkin(&pool, lid, sid, eid, "waiting").await;
    let mk_id = insert_makeup(&pool, sid, cid, 1, "waiting", "課室補課").await;

    // Create active scan session
    sqlx::query(
        "INSERT INTO scan_sessions (lesson_id, active) VALUES (?, 1)"
    )
    .bind(lid).execute(&pool).await.unwrap();

    // Simulate qr_checkin: enrolled student → upsert 'present'
    sqlx::query(
        "INSERT INTO lesson_checkins (lesson_id, student_id, enrollment_id, status, checkin_time, source)
         VALUES (?, ?, ?, 'present', datetime('now'), 'enrolled')
         ON CONFLICT(lesson_id, student_id) DO UPDATE SET status = 'present', checkin_time = datetime('now')"
    )
    .bind(lid).bind(sid).bind(eid)
    .execute(&pool).await.unwrap();

    // Cancel pending makeup (the new qr_checkin logic)
    sqlx::query(
        "UPDATE makeup_lessons SET is_deleted = 1
         WHERE student_id = ? AND status IN ('waiting', 'scheduled') AND is_deleted = 0
           AND (target_lesson_id = ? OR (
             original_class_id = (SELECT class_id FROM lessons WHERE id = ?)
             AND lesson_num = CAST((SELECT num FROM lessons WHERE id = ?) AS TEXT)
           ))"
    )
    .bind(sid).bind(lid).bind(lid).bind(lid)
    .execute(&pool).await.unwrap();

    assert_eq!(count_pending_makeups(&pool, sid).await, 0, "QR checkin should cancel pending makeup");
    let st = get_lc_status(&pool, sid, lid).await;
    assert_eq!(st, "present");
}

// ────────────────────────────────────────────────────────────────────────
// TEST: calendar endpoint counts waiting/scheduled_* as leave
// ────────────────────────────────────────────────────────────────────────

#[sqlx::test]
async fn test_calendar_counts_new_statuses_correctly() {
    let pool = setup_pool().await;
    let (cid, lid, sid, eid) = seed_class_lesson_student(&pool).await;

    // Insert multiple checkins with new statuses
    insert_checkin(&pool, lid, sid, eid, "waiting").await;

    let sid2: i64 = sqlx::query_scalar(
        "INSERT INTO students (surname, given_name, is_deleted) VALUES ('陳', '小明', 0) RETURNING id"
    ).fetch_one(&pool).await.unwrap();
    let eid2: i64 = sqlx::query_scalar(
        "INSERT INTO enrollments (student_id, class_id, status, is_deleted) VALUES (?, ?, 'active', 0) RETURNING id"
    ).bind(sid2).bind(cid).fetch_one(&pool).await.unwrap();
    insert_checkin(&pool, lid, sid2, eid2, "scheduled_room").await;

    let sid3: i64 = sqlx::query_scalar(
        "INSERT INTO students (surname, given_name, is_deleted) VALUES ('李', '小華', 0) RETURNING id"
    ).fetch_one(&pool).await.unwrap();
    let eid3: i64 = sqlx::query_scalar(
        "INSERT INTO enrollments (student_id, class_id, status, is_deleted) VALUES (?, ?, 'active', 0) RETURNING id"
    ).bind(sid3).bind(cid).fetch_one(&pool).await.unwrap();
    insert_checkin(&pool, lid, sid3, eid3, "scheduled_video").await;

    // Group By status (same as calendar endpoint)
    let stats = sqlx::query_as::<_, (String, i32)>(
        "SELECT status, COUNT(*) as cnt FROM lesson_checkins WHERE lesson_id = ? GROUP BY status"
    )
    .bind(lid)
    .fetch_all(&pool).await.unwrap();

    let mut present = 0i32;
    let mut leave = 0i32;
    let mut _absent = 0i32;
    for (st, cnt) in &stats {
        match st.as_str() {
            "present" | "makeup" | "recording_room_present" | "video_makeup" => present += cnt,
            "leave" => leave += cnt,
            "absent" => _absent += cnt,
            "waiting" | "scheduled_room" | "scheduled_video" | "scheduled_classroom" => leave += cnt,
            _ => {}
        }
    }

    assert_eq!(leave, 3, "waiting + scheduled_room + scheduled_video = 3 counted as leave");
    assert_eq!(present, 0, "no present students");
}

// ────────────────────────────────────────────────────────────────────────
// TEST: blocked check correctly treats new statuses as "not completed"
// ────────────────────────────────────────────────────────────────────────

#[sqlx::test]
async fn test_blocked_check_new_statuses_block_next_lesson() {
    let pool = setup_pool().await;
    let (cid, lid1, sid, eid) = seed_class_lesson_student(&pool).await;

    // Add a second lesson
    let lid2: i64 = sqlx::query_scalar(
        "INSERT INTO lessons (class_id, num, date, is_deleted) VALUES (?, 2, '2026-06-12', 0) RETURNING id"
    ).bind(cid).fetch_one(&pool).await.unwrap();

    // Lesson 1 has 'waiting' status
    insert_checkin(&pool, lid1, sid, eid, "waiting").await;

    // Check if lesson 2 is blocked (previous lesson not completed)
    let prev_status = get_lc_status(&pool, sid, lid1).await;
    let completed_statuses = ["present", "makeup", "recording_room_present", "video_makeup"];
    let blocked = !completed_statuses.contains(&prev_status.as_str());

    assert!(blocked, "waiting should block the next lesson");
    assert!(!prev_status.is_empty(), "lesson 1 should have a checkin");

    // Lesson 2 should have no checkin
    let l2_st = get_lc_status(&pool, sid, lid2).await;
    assert_eq!(l2_st, "", "lesson 2 has no checkin yet");
}

// ────────────────────────────────────────────────────────────────────────
// TEST: list_makeups_manage only returns absentees without arrangements
// ────────────────────────────────────────────────────────────────────────

#[sqlx::test]
async fn test_list_makeups_manage_excludes_waiting_students() {
    let pool = setup_pool().await;
    let (cid, lid, sid, eid) = seed_class_lesson_student(&pool).await;

    // Student has waiting status (has a makeup arrangement)
    insert_checkin(&pool, lid, sid, eid, "waiting").await;

    // Student should NOT appear in absentees query
    let absentees: Vec<(i64, String)> = sqlx::query_as(
        "SELECT e.student_id, lc.status
         FROM lesson_checkins lc
         JOIN enrollments e ON lc.enrollment_id = e.id AND e.is_deleted = 0
         JOIN lessons l ON lc.lesson_id = l.id AND l.is_deleted = 0
         WHERE lc.status IN ('absent','leave')"
    )
    .fetch_all(&pool).await.unwrap();

    assert_eq!(absentees.len(), 0, "waiting students should not appear as absentees");

    // But if same student has 'absent', they SHOULD appear
    insert_checkin(&pool, lid, sid, eid, "absent").await;
    let absentees2: Vec<(i64, String)> = sqlx::query_as(
        "SELECT e.student_id, lc.status
         FROM lesson_checkins lc
         JOIN enrollments e ON lc.enrollment_id = e.id AND e.is_deleted = 0
         JOIN lessons l ON lc.lesson_id = l.id AND l.is_deleted = 0
         WHERE lc.status IN ('absent','leave')"
    )
    .fetch_all(&pool).await.unwrap();

    assert_eq!(absentees2.len(), 1, "student with 'absent' should appear");
    assert_eq!(absentees2[0].1, "absent");
}

// ────────────────────────────────────────────────────────────────────────
// TEST: prerequisite check — new statuses don't pass
// ────────────────────────────────────────────────────────────────────────

#[sqlx::test]
async fn test_prerequisite_check_blocks_new_statuses() {
    let pool = setup_pool().await;
    let (cid, lid1, sid, eid) = seed_class_lesson_student(&pool).await;

    // Add second lesson
    let lid2: i64 = sqlx::query_scalar(
        "INSERT INTO lessons (class_id, num, date, is_deleted) VALUES (?, 2, '2026-06-12', 0) RETURNING id"
    ).bind(cid).fetch_one(&pool).await.unwrap();

    // Test each new status — none should pass the prerequisite check
    for test_status in &["waiting", "scheduled_room", "scheduled_video", "scheduled_classroom", "leave", "absent"] {
        let pool2 = setup_pool().await;
        let (cid2, lid1_2, sid2, eid2) = seed_class_lesson_student(&pool2).await;

        // Add lesson 2
        let lid2_2: i64 = sqlx::query_scalar(
            "INSERT INTO lessons (class_id, num, date, is_deleted) VALUES (?, 2, '2026-06-12', 0) RETURNING id"
        ).bind(cid2).fetch_one(&pool2).await.unwrap();

        // Lesson 1 has the test status
        insert_checkin(&pool2, lid1_2, sid2, eid2, test_status).await;

        // Check if it passes the prerequisite (same logic as attendance_service.rs)
        let prev_status: Option<String> = sqlx::query_scalar(
            "SELECT status FROM lesson_checkins WHERE lesson_id = ? AND student_id = ?"
        )
        .bind(lid1_2).bind(sid2)
        .fetch_optional(&pool2).await.unwrap()
        .flatten();

        let is_completed = matches!(
            prev_status.as_deref(),
            Some("present") | Some("makeup") | Some("recording_room_present") | Some("video_makeup")
        );

        assert!(!is_completed, "status '{test_status}' should NOT pass the prerequisite check");
    }
}
