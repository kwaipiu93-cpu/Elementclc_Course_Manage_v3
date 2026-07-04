use axum::{extract::{Multipart, Path, Query, State}, http::HeaderMap, Json};
use chrono::NaiveDate;
use serde::Deserialize;
use serde_json::json;

use crate::auth;
use crate::error::{AppError, AppResultJson};
use crate::models::*;
use crate::services::student_service;
use crate::AppState;

#[derive(Deserialize)]
pub struct StudentListQuery {
    pub dse_year: Option<i32>,
}

pub async fn list(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<StudentListQuery>,
) -> AppResultJson {
    let _uid = auth::get_current_user_id(&headers)?;
    let students = match query.dse_year {
        Some(year) => student_service::list_by_dse_year(&state.db, year).await?,
        None => student_service::list_all(&state.db).await?,
    };
    Ok(Json(json!({"ok": true, "data": students})))
}

pub async fn get(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<i64>,
) -> AppResultJson {
    let _uid = auth::get_current_user_id(&headers)?;
    let student = student_service::get_by_id(&state.db, id).await?;
    Ok(Json(json!({"ok": true, "data": student})))
}

pub async fn create(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<CreateStudent>,
) -> AppResultJson {
    let _uid = auth::get_current_user_id(&headers)?;
    let student = student_service::create(&state.db, req).await?;
    Ok(Json(json!({"ok": true, "data": student})))
}

pub async fn update(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<i64>,
    Json(req): Json<CreateStudent>,
) -> AppResultJson {
    let _uid = auth::get_current_user_id(&headers)?;
    let student = student_service::update(&state.db, id, req).await?;
    Ok(Json(json!({"ok": true, "data": student})))
}

pub async fn delete(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<i64>,
) -> AppResultJson {
    let _uid = auth::get_current_user_id(&headers)?;
    student_service::soft_delete(&state.db, id).await?;
    Ok(Json(json!({"ok": true})))
}

// ─── Student Detail (all classes + lesson status) ─────────────────────

#[derive(serde::Serialize)]
struct LessonStatus {
    lesson_id: i64,
    lesson_num: i32,
    lesson_date: Option<NaiveDate>,
    lesson_start: Option<String>,
    lesson_end: Option<String>,
    status: String,
    checkin_time: Option<String>,
}

#[derive(serde::Serialize)]
struct ClassEnrollmentDetail {
    class_id: i64,
    class_name: Option<String>,
    class_week: Option<String>,
    class_time: String,
    enrollment_id: i64,
    pay_status: String,
    lessons: Vec<LessonStatus>,
}

#[derive(serde::Serialize)]
struct StudentDetailResponse {
    student: Student,
    enrollments: Vec<ClassEnrollmentDetail>,
}

pub async fn detail(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<i64>,
) -> AppResultJson {
    let _uid = auth::get_current_user_id(&headers)?;

    let student = student_service::get_by_id(&state.db, id).await?;

    // Get all enrollments for this student with class info
    #[derive(sqlx::FromRow)]
    struct EnrRow {
        id: i64,
        class_id: i64,
        class_name: Option<String>,
        class_week: Option<String>,
        class_start: Option<String>,
        class_end: Option<String>,
        pay_status: String,
    }

    let enrollments: Vec<EnrRow> = sqlx::query_as(
        "SELECT e.id, e.class_id, c.name AS class_name, c.week AS class_week,
                c.start AS class_start, c.end AS class_end, e.pay_status
         FROM enrollments e
         JOIN classes c ON e.class_id = c.id
         WHERE e.student_id = ? AND e.is_deleted = 0 AND c.is_deleted = 0
         ORDER BY c.id"
    )
    .bind(id)
    .fetch_all(&state.db)
    .await?;

    use std::collections::HashMap;

    // Get all checkins for this student
    #[derive(sqlx::FromRow)]
    struct ChkRow {
        lesson_id: i64,
        status: String,
        checkin_time: Option<String>,
    }

    let all_checkins: Vec<ChkRow> = sqlx::query_as(
        "SELECT lc.lesson_id, lc.status, lc.checkin_time
         FROM lesson_checkins lc
         JOIN lessons l ON lc.lesson_id = l.id
         WHERE lc.student_id = ? AND l.is_deleted = 0"
    )
    .bind(id)
    .fetch_all(&state.db)
    .await?;

    let checkin_map: HashMap<i64, (String, Option<String>)> = all_checkins
        .into_iter()
        .map(|c| (c.lesson_id, (c.status, c.checkin_time)))
        .collect();

    // Build response
    let mut result = Vec::new();
    for enr in enrollments {
        let lessons: Vec<Lesson> = sqlx::query_as(
            "SELECT * FROM lessons WHERE class_id = ? AND is_deleted = 0 ORDER BY num"
        )
        .bind(enr.class_id)
        .fetch_all(&state.db)
        .await?;

        let lesson_statuses: Vec<LessonStatus> = lessons
            .into_iter()
            .map(|l| {
                let (status, checkin_time) = checkin_map
                    .get(&l.id)
                    .map(|(s, t)| (s.clone(), t.clone()))
                    .unwrap_or((String::new(), None));
                LessonStatus {
                    lesson_id: l.id,
                    lesson_num: l.num,
                    lesson_date: l.date,
                    lesson_start: l.start,
                    lesson_end: l.end,
                    status,
                    checkin_time,
                }
            })
            .collect();

        let time_str = match (&enr.class_start, &enr.class_end) {
            (Some(s), Some(e)) => format!("{} - {}", s, e),
            (Some(s), None) => s.clone(),
            (None, Some(e)) => e.clone(),
            (None, None) => String::new(),
        };

        result.push(ClassEnrollmentDetail {
            class_id: enr.class_id,
            class_name: enr.class_name,
            class_week: enr.class_week,
            class_time: time_str,
            enrollment_id: enr.id,
            pay_status: enr.pay_status,
            lessons: lesson_statuses,
        });
    }

    Ok(Json(json!({"ok": true, "data": {
        "student": student,
        "enrollments": result
    }})))
}

// ─── Avatar upload ─────────────────────────────────────────────────────

pub async fn upload_avatar(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<i64>,
    mut multipart: Multipart,
) -> AppResultJson {
    let _uid = auth::get_current_user_id(&headers)?;

    // Get student to find email
    let student = student_service::get_by_id(&state.db, id).await?;

    // Process multipart — find the "avatar" field
    let mut saved = false;
    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|e| AppError::BadRequest(e.to_string()))?
    {
        if field.name() != Some("avatar") {
            continue;
        }

        // Save content_type before consuming field
        let content_type = field.content_type().unwrap_or("image/png").to_string();

        let file_data = field
            .bytes()
            .await
            .map_err(|e| AppError::BadRequest(e.to_string()))?;

        if file_data.is_empty() {
            return Err(AppError::BadRequest("空的檔案".into()));
        }

        // Determine extension from content-type
        let ext = match content_type.as_str() {
            "image/jpeg" | "image/jpg" => "jpg",
            "image/png" => "png",
            "image/gif" => "gif",
            "image/webp" => "webp",
            _ => return Err(AppError::BadRequest(
                "只支援 PNG / JPG / GIF / WebP 格式".into(),
            )),
        };

        // Sanitize email to safe filename: chanming@example.com → chanming_at_example_com
        let email = student.email.as_deref().unwrap_or("unknown");
        let safe_name = email.replace('@', "_at_").replace('.', "_");
        let filename = format!("{}.{}", safe_name, ext);
        let filepath = format!("uploads/avatars/{}", filename);

        // Ensure directory + save
        tokio::fs::create_dir_all("uploads/avatars")
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;
        tokio::fs::write(&filepath, &file_data)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;

        // Update avatar field in DB
        let avatar_url = format!("/uploads/avatars/{}", filename);
        sqlx::query("UPDATE students SET avatar = ?, updated_at = datetime('now') WHERE id = ?")
            .bind(&avatar_url)
            .bind(id)
            .execute(&state.db)
            .await?;

        saved = true;
        break;
    }

    if !saved {
        return Err(AppError::BadRequest("請上傳 avatar 圖片檔案".into()));
    }

    let updated = student_service::get_by_id(&state.db, id).await?;
    Ok(Json(json!({"ok": true, "data": updated})))
}
