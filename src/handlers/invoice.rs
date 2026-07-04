use axum::{extract::{Path, State}, http::HeaderMap, Json};
use serde_json::json;

use crate::auth;
use crate::error::AppResultJson;
use crate::models::*;
use crate::AppState;

pub async fn list_by_student(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(student_id): Path<i64>,
) -> AppResultJson {
    auth::get_current_user_id(&headers)?;
    let items = sqlx::query_as::<_, Invoice>(
        "SELECT * FROM invoices WHERE student_id = ? ORDER BY created_at DESC"
    )
    .bind(student_id)
    .fetch_all(&state.db)
    .await?;
    Ok(Json(json!({"ok": true, "data": items})))
}

pub async fn list_by_enrollment(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(enrollment_id): Path<i64>,
) -> AppResultJson {
    auth::get_current_user_id(&headers)?;
    let items = sqlx::query_as::<_, Invoice>(
        "SELECT * FROM invoices WHERE enrollment_id = ? ORDER BY created_at DESC"
    )
    .bind(enrollment_id)
    .fetch_all(&state.db)
    .await?;
    Ok(Json(json!({"ok": true, "data": items})))
}

pub async fn create(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<CreateInvoice>,
) -> AppResultJson {
    let uid = auth::get_current_user_id(&headers)?;
    let r#type = req.r#type.unwrap_or_else(|| "tuition".into());
    let makeup_fee = req.makeup_fee.unwrap_or(0.0);

    let result = sqlx::query(
        "INSERT INTO invoices (enrollment_id, student_id, topic_id, type, amount, makeup_fee, note, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    )
    .bind(req.enrollment_id)
    .bind(req.student_id)
    .bind(req.topic_id)
    .bind(&r#type)
    .bind(req.amount)
    .bind(makeup_fee)
    .bind(&req.note)
    .bind(uid)
    .execute(&state.db)
    .await?;

    let inv = sqlx::query_as::<_, Invoice>("SELECT * FROM invoices WHERE id = ?")
        .bind(result.last_insert_rowid())
        .fetch_one(&state.db)
        .await?;

    Ok(Json(json!({"ok": true, "data": inv})))
}

pub async fn update(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<i64>,
    Json(req): Json<UpdateInvoice>,
) -> AppResultJson {
    let uid = auth::get_current_user_id(&headers)?;

    // Build dynamic update
    let mut sets = vec!["updated_at = datetime('now')"];
    let mut binds: Vec<String> = vec![];

    if let Some(ref status) = req.status {
        sets.push("status = ?");
        binds.push(status.clone());
        if status == "paid" {
            sets.push("paid_at = datetime('now')");
        }
    }
    if let Some(ref pay_method) = req.pay_method {
        sets.push("pay_method = ?");
        binds.push(pay_method.clone());
    }
    if let Some(ref note) = req.note {
        sets.push("note = ?");
        binds.push(note.clone());
    }
    binds.push(uid.to_string());
    binds.push(id.to_string());

    let sql = format!(
        "UPDATE invoices SET {} WHERE id = ?",
        sets.join(", ")
    );

    // Build sqlx query with dynamic bindings
    // Use raw execute for simplicity
    let mut q = sqlx::query(&sql);
    for b in &binds[..binds.len()-2] {
        q = q.bind(b);
    }
    q = q.bind(uid);
    q = q.bind(id);
    q.execute(&state.db).await?;

    let inv = sqlx::query_as::<_, Invoice>("SELECT * FROM invoices WHERE id = ?")
        .bind(id)
        .fetch_optional(&state.db)
        .await?
        .ok_or_else(|| crate::error::AppError::NotFound("invoice not found".into()))?;

    Ok(Json(json!({"ok": true, "data": inv})))
}

pub async fn delete(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<i64>,
) -> AppResultJson {
    auth::get_current_user_id(&headers)?;
    let rows = sqlx::query("DELETE FROM invoices WHERE id = ?")
        .bind(id)
        .execute(&state.db)
        .await?
        .rows_affected();
    if rows == 0 {
        return Err(crate::error::AppError::NotFound("invoice not found".into()));
    }
    Ok(Json(json!({"ok": true})))
}

/// Create an invoice automatically from an enrollment
/// Used when enrolling: auto-generate invoice based on topic fee
pub async fn auto_create_from_enrollment(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<serde_json::Value>,
) -> AppResultJson {
    auth::get_current_user_id(&headers)?;
    let enrollment_id = req["enrollment_id"].as_i64()
        .ok_or_else(|| crate::error::AppError::BadRequest("enrollment_id required".into()))?;
    let student_id = req["student_id"].as_i64()
        .ok_or_else(|| crate::error::AppError::BadRequest("student_id required".into()))?;
    let amount = req["amount"].as_f64()
        .ok_or_else(|| crate::error::AppError::BadRequest("amount required".into()))?;
    let topic_id = req["topic_id"].as_i64();
    let makeup_fee = req["makeup_fee"].as_f64().unwrap_or(0.0);
    let note = req["note"].as_str().map(|s| s.to_string());
    let r#type = req["type"].as_str().unwrap_or("tuition").to_string();

    let result = sqlx::query(
        "INSERT INTO invoices (enrollment_id, student_id, topic_id, type, amount, makeup_fee, note, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    )
    .bind(enrollment_id)
    .bind(student_id)
    .bind(topic_id)
    .bind(&r#type)
    .bind(amount)
    .bind(makeup_fee)
    .bind(&note)
    .bind(auth::get_current_user_id(&headers)?)
    .execute(&state.db)
    .await?;

    let inv = sqlx::query_as::<_, Invoice>("SELECT * FROM invoices WHERE id = ?")
        .bind(result.last_insert_rowid())
        .fetch_one(&state.db)
        .await?;

    Ok(Json(json!({"ok": true, "data": inv})))
}
