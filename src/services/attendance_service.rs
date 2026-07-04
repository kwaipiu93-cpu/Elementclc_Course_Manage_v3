use crate::error::AppResult;
use crate::models::*;
use sqlx::SqlitePool;

pub async fn upsert_checkin(pool: &SqlitePool, req: UpdateCheckin) -> AppResult<()> {
    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();

    // Lesson prerequisite check: must complete previous lesson
    let lesson_info: Option<(i32, i64)> = sqlx::query_as(
        "SELECT num, class_id FROM lessons WHERE id = ?"
    )
    .bind(req.lesson_id)
    .fetch_optional(pool)
    .await?;

    let (lesson_num, class_id) = lesson_info.unwrap_or((0, 0));

    // 補課錄播班 (class 8) skips all prerequisite checks
    if class_id != 8 {
        let is_clearing = req.status.as_deref().map_or(true, |s| s.is_empty());

        // Forward check: must complete lesson N-1 before setting lesson N
        if !is_clearing && lesson_num > 1 {
            let prev_lesson_id: Option<i64> = sqlx::query_scalar(
                "SELECT id FROM lessons WHERE class_id = ? AND num = ?"
            )
            .bind(class_id)
            .bind(lesson_num - 1)
            .fetch_optional(pool)
            .await?;

            if let Some(prev_id) = prev_lesson_id {
                let prev_status: Option<String> = sqlx::query_scalar(
                    "SELECT status FROM lesson_checkins WHERE lesson_id = ? AND student_id = ?"
                )
                .bind(prev_id)
                .bind(req.student_id)
                .fetch_optional(pool)
                .await?
                .flatten();

                let is_completed = matches!(
                    prev_status.as_deref(),
                    Some("present") | Some("makeup") | Some("recording_room_present") | Some("video_makeup")
                );
                if !is_completed {
                    return Err(crate::error::AppError::BadRequest(
                        format!("學生 {} 未完成第{}課，無法簽到第{}課", req.student_id, lesson_num - 1, lesson_num)
                    ));
                }
            }
        }

        // Reverse (backward) check: can't modify or clear lesson N if lesson N+1 has data
        // Clearing must go from the highest lesson downward
        let later_exists: Option<i32> = sqlx::query_scalar(
            r#"SELECT 1 FROM lesson_checkins lc
               JOIN lessons l ON lc.lesson_id = l.id
               WHERE l.class_id = ? AND lc.student_id = ? AND l.num > ? AND lc.status != '' AND lc.status IS NOT NULL
               LIMIT 1"#
        )
        .bind(class_id)
        .bind(req.student_id)
        .bind(lesson_num)
        .fetch_optional(pool)
        .await?;

        if later_exists.is_some() {
            let action = if is_clearing { "清除" } else { "修改" };
            return Err(crate::error::AppError::BadRequest(
                format!("第{}課之後已有記錄，無法{}第{}課。請先{}第{}課之後的狀態", lesson_num, action, lesson_num, action, lesson_num)
            ));
        }
    }

    // Check if exists
    let existing = sqlx::query_as::<_, LessonCheckin>(
        "SELECT * FROM lesson_checkins WHERE lesson_id = ? AND student_id = ?"
    )
    .bind(req.lesson_id)
    .bind(req.student_id)
    .fetch_optional(pool)
    .await?;

    // Look up enrollment_id for this student+class (if any)
    let enrollment_id: Option<i64> = sqlx::query_scalar(
        r#"SELECT e.id FROM enrollments e
           JOIN lessons l ON l.class_id = e.class_id
           WHERE l.id = ? AND e.student_id = ? AND e.is_deleted = 0"#
    )
    .bind(req.lesson_id)
    .bind(req.student_id)
    .fetch_optional(pool)
    .await?;

    if let Some(ref old) = existing {
        let old_status = old.status.clone();

        // If clearing the checkin (empty status), delete the row
        if req.status.as_deref().map_or(true, |s| s.is_empty()) {
            sqlx::query("DELETE FROM lesson_checkins WHERE lesson_id = ? AND student_id = ?")
                .bind(req.lesson_id)
                .bind(req.student_id)
                .execute(pool)
                .await?;
            // Log the clearing
            sqlx::query(
                "INSERT INTO attendance_log (enrollment_id, lesson_num, old_status, new_status, created_at) VALUES (?, ?, ?, 'cleared', ?)"
            )
            .bind(enrollment_id)
            .bind(lesson_num)
            .bind(&old_status)
            .bind(&now)
            .execute(pool)
            .await?;
            return Ok(());
        }

        sqlx::query(
            "UPDATE lesson_checkins SET status = COALESCE(?, status), checkin_time = COALESCE(?, checkin_time) WHERE lesson_id = ? AND student_id = ?"
        )
        .bind(&req.status)
        .bind(&now)
        .bind(req.lesson_id)
        .bind(req.student_id)
        .execute(pool)
        .await?;
        // Log the change
        sqlx::query(
            "INSERT INTO attendance_log (enrollment_id, lesson_num, old_status, new_status, created_at) VALUES (?, ?, ?, ?, ?)"
        )
        .bind(enrollment_id)
        .bind(lesson_num)
        .bind(&old_status)
        .bind(&req.status)
        .bind(&now)
        .execute(pool)
        .await?;
    } else {
        let source = if enrollment_id.is_some() { "enrolled" } else { "makeup" };
        sqlx::query(
            "INSERT INTO lesson_checkins (lesson_id, student_id, enrollment_id, status, checkin_time, source) VALUES (?, ?, ?, ?, ?, ?)"
        )
        .bind(req.lesson_id)
        .bind(req.student_id)
        .bind(enrollment_id)
        .bind(&req.status)
        .bind(&now)
        .bind(source)
        .execute(pool)
        .await?;
        // Log initial create
        sqlx::query(
            "INSERT INTO attendance_log (enrollment_id, lesson_num, old_status, new_status, created_at) VALUES (?, ?, '', ?, ?)"
        )
        .bind(enrollment_id)
        .bind(lesson_num)
        .bind(&req.status)
        .bind(&now)
        .execute(pool)
        .await?;
    }

    Ok(())
}

/// For QR code checkin — also accepts enrollment_id + lesson_num for backward compat
pub async fn legacy_checkin(pool: &SqlitePool, enrollment_id: i64, lesson_num: i32, status: &str) -> AppResult<()> {
    // Resolve enrollment → student_id + lesson_id
    let row: Option<(i64, i64)> = sqlx::query_as(
        r#"SELECT e.student_id, l.id
           FROM enrollments e
           JOIN lessons l ON l.class_id = e.class_id AND l.num = ? AND l.is_deleted = 0
           WHERE e.id = ? AND e.is_deleted = 0"#
    )
    .bind(lesson_num)
    .bind(enrollment_id)
    .fetch_optional(pool)
    .await?;

    if let Some((student_id, lesson_id)) = row {
        upsert_checkin(pool, UpdateCheckin {
            lesson_id,
            student_id,
            status: Some(status.to_string()),
        }).await?;
    }

    Ok(())
}
