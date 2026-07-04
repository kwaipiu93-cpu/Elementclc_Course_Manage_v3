use crate::error::{AppError, AppResult};
use crate::models::*;
use sqlx::SqlitePool;

pub async fn create(pool: &SqlitePool, req: CreateEnrollment) -> AppResult<Enrollment> {
    let purchase = req.purchase.unwrap_or(12);
    let pay_status = req.pay_status.clone().unwrap_or_else(|| "Unpaid".into());

    // Check if a soft-deleted enrollment already exists for this student+class
    let existing: Option<Enrollment> = sqlx::query_as::<_, Enrollment>(
        "SELECT * FROM enrollments WHERE student_id = ? AND class_id = ?"
    )
    .bind(req.student_id)
    .bind(req.class_id)
    .fetch_optional(pool)
    .await?;

    if let Some(enr) = existing {
        if enr.is_deleted {
            // Restore: undelete + update fields
            sqlx::query(
                "UPDATE enrollments SET is_deleted = 0, status = 'active', pay_status = ?, pay_amount = ?, purchase = ?, used = 0, remaining = ?, updated_at = datetime('now') WHERE id = ?"
            )
            .bind(&pay_status)
            .bind(req.pay_amount)
            .bind(purchase)
            .bind(purchase)
            .bind(enr.id)
            .execute(pool)
            .await?;
            let restored = sqlx::query_as::<_, Enrollment>("SELECT * FROM enrollments WHERE id = ?")
                .bind(enr.id)
                .fetch_one(pool)
                .await?;
            return Ok(restored);
        } else {
            // Already active – just return it
            return Ok(enr);
        }
    }

    // No existing record: fresh insert
    let result = sqlx::query(
        "INSERT INTO enrollments (student_id, class_id, pay_status, pay_amount, purchase, used, remaining) VALUES (?, ?, ?, ?, ?, 0, ?)"
    )
    .bind(req.student_id)
    .bind(req.class_id)
    .bind(&pay_status)
    .bind(req.pay_amount)
    .bind(purchase)
    .bind(purchase)
    .execute(pool)
    .await?;

    let id = result.last_insert_rowid();
    let enr = sqlx::query_as::<_, Enrollment>("SELECT * FROM enrollments WHERE id = ?")
        .bind(id)
        .fetch_one(pool)
        .await?;
    Ok(enr)
}

pub async fn soft_delete(pool: &SqlitePool, id: i64) -> AppResult<()> {
    let rows = sqlx::query("UPDATE enrollments SET is_deleted = 1, updated_at = datetime('now') WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await?
        .rows_affected();
    if rows == 0 {
        return Err(AppError::NotFound("enrollment not found".into()));
    }
    Ok(())
}

pub async fn update_payment(pool: &SqlitePool, id: i64, req: UpdatePayment) -> AppResult<()> {
    sqlx::query(
        "UPDATE enrollments SET pay_status = ?, pay_amount = COALESCE(?, pay_amount), pay_method = COALESCE(?, pay_method), updated_at = datetime('now') WHERE id = ?"
    )
    .bind(&req.pay_status)
    .bind(req.pay_amount)
    .bind(&req.pay_method)
    .bind(id)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn transfer_class(pool: &SqlitePool, id: i64, new_class_id: i64) -> AppResult<()> {
    // Get the current enrollment to verify it exists
    let enr: Option<Enrollment> = sqlx::query_as("SELECT * FROM enrollments WHERE id = ? AND is_deleted = 0")
        .bind(id)
        .fetch_optional(pool)
        .await?;

    let enr = enr.ok_or_else(|| AppError::NotFound("enrollment not found".into()))?;

    // Check target class exists
    let cls_exists: bool = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM classes WHERE id = ? AND is_deleted = 0"
    )
    .bind(new_class_id)
    .fetch_one(pool)
    .await? > 0;

    if !cls_exists {
        return Err(AppError::NotFound("target class not found".into()));
    }

    // Check student isn't already in target class
    let already: bool = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM enrollments WHERE student_id = ? AND class_id = ? AND is_deleted = 0"
    )
    .bind(enr.student_id)
    .bind(new_class_id)
    .fetch_one(pool)
    .await? > 0;

    if already {
        return Err(AppError::BadRequest("student already enrolled in target class".into()));
    }

    // Update the enrollment's class_id (keep used/remaining — checkins follow)
    sqlx::query(
        "UPDATE enrollments SET class_id = ?, updated_at = datetime('now') WHERE id = ?"
    )
    .bind(new_class_id)
    .bind(id)
    .execute(pool)
    .await?;

    // Remap checkins: find lesson in new class with matching num (same topic, same schedule)
    sqlx::query(
        r#"UPDATE lesson_checkins
           SET lesson_id = (
               SELECT nl.id FROM lessons nl
               JOIN lessons ol ON ol.id = lesson_checkins.lesson_id
               WHERE nl.class_id = ? AND nl.num = ol.num AND nl.is_deleted = 0
           )
           WHERE enrollment_id = ?
             AND EXISTS (
                 SELECT 1 FROM lessons nl
                 JOIN lessons ol ON ol.id = lesson_checkins.lesson_id
                 WHERE nl.class_id = ? AND nl.num = ol.num AND nl.is_deleted = 0
             )"#
    )
    .bind(new_class_id)
    .bind(id)
    .bind(new_class_id)
    .execute(pool)
    .await?;

    // Delete any checkins that couldn't be remapped (lesson num doesn't exist in new class)
    sqlx::query(
        "DELETE FROM lesson_checkins
         WHERE enrollment_id = ?
           AND NOT EXISTS (
               SELECT 1 FROM lessons l WHERE l.id = lesson_checkins.lesson_id AND l.class_id = ?
           )"
    )
    .bind(id)
    .bind(new_class_id)
    .execute(pool)
    .await?;

    Ok(())
}
