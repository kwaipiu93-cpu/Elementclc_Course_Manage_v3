use crate::auth::hash_password;
use crate::error::{AppError, AppResult};
use crate::models::*;
use sqlx::SqlitePool;

pub async fn list_all(pool: &SqlitePool) -> AppResult<Vec<Student>> {
    let students = sqlx::query_as::<_, Student>(
        "SELECT * FROM students WHERE is_deleted = 0 ORDER BY surname COLLATE NOCASE, given_name COLLATE NOCASE"
    )
    .fetch_all(pool)
    .await?;
    Ok(students)
}

pub async fn get_by_id(pool: &SqlitePool, id: i64) -> AppResult<Student> {
    sqlx::query_as::<_, Student>("SELECT * FROM students WHERE id = ? AND is_deleted = 0")
        .bind(id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::NotFound("student not found".into()))
}

pub async fn create(pool: &SqlitePool, req: CreateStudent) -> AppResult<Student> {
    // Validate required fields
    if req.email.as_ref().map_or(true, |e| e.trim().is_empty()) {
        return Err(AppError::BadRequest("email is required".into()));
    }
    // Default password = email (hashed), if not provided
    let password_hash = match &req.password {
        Some(pw) if !pw.trim().is_empty() => hash_password(pw)?,
        _ => hash_password(req.email.as_deref().unwrap_or(""))?,
    };
    let result = sqlx::query(
        "INSERT INTO students (surname, given_name, school, email, password, phone, parent_phone, note, dse_year, enroll_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    )
    .bind(&req.surname)
    .bind(&req.given_name)
    .bind(&req.school)
    .bind(&req.email)
    .bind(&password_hash)
    .bind(&req.phone)
    .bind(&req.parent_phone)
    .bind(&req.note)
    .bind(&req.dse_year)
    .bind(&req.enroll_date)
    .execute(pool)
    .await?;
    get_by_id(pool, result.last_insert_rowid()).await
}

pub async fn update(pool: &SqlitePool, id: i64, req: CreateStudent) -> AppResult<Student> {
    // If password provided and non-empty, hash it; otherwise keep existing
    let password_hash = match &req.password {
        Some(pw) if !pw.trim().is_empty() => Some(hash_password(pw)?),
        _ => None,
    };
    if let Some(hash) = &password_hash {
        sqlx::query(
            "UPDATE students SET surname=?, given_name=?, school=?, email=?, password=?, phone=?, parent_phone=?, note=?, dse_year=?, enroll_date=?, updated_at=datetime('now') WHERE id=?"
        )
        .bind(&req.surname)
        .bind(&req.given_name)
        .bind(&req.school)
        .bind(&req.email)
        .bind(hash)
        .bind(&req.phone)
        .bind(&req.parent_phone)
        .bind(&req.note)
        .bind(&req.dse_year)
        .bind(&req.enroll_date)
        .bind(id)
        .execute(pool)
        .await?;
    } else {
        sqlx::query(
            "UPDATE students SET surname=?, given_name=?, school=?, email=?, phone=?, parent_phone=?, note=?, dse_year=?, enroll_date=?, updated_at=datetime('now') WHERE id=?"
        )
        .bind(&req.surname)
        .bind(&req.given_name)
        .bind(&req.school)
        .bind(&req.email)
        .bind(&req.phone)
        .bind(&req.parent_phone)
        .bind(&req.note)
        .bind(&req.dse_year)
        .bind(&req.enroll_date)
        .bind(id)
        .execute(pool)
        .await?;
    }
    get_by_id(pool, id).await
}

pub async fn soft_delete(pool: &SqlitePool, id: i64) -> AppResult<()> {
    let rows = sqlx::query("UPDATE students SET is_deleted = 1, updated_at = datetime('now') WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await?
        .rows_affected();
    if rows == 0 {
        return Err(AppError::NotFound("student not found".into()));
    }
    Ok(())
}
