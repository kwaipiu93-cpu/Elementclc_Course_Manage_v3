use axum::{extract::Path, extract::State, http::HeaderMap, Json};
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::auth;
use crate::error::{AppError, AppResultJson};
use crate::AppState;

// ─── Request types ──────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct CreateUserRequest {
    pub display_name: Option<String>,
    pub email: String,
    pub password: String,
    pub role: Option<String>,
    pub avatar: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateUserRequest {
    pub display_name: Option<String>,
    pub email: Option<String>,
    pub password: Option<String>,
    pub role: Option<String>,
    pub avatar: Option<String>,
}

// ─── List all users (excluding deleted) ─────────────────────────────────────
pub async fn list(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> AppResultJson {
    let _uid = auth::get_current_user_id(&headers)?;

    #[derive(Debug, sqlx::FromRow, Serialize)]
    struct UserRow {
        id: i64,
        username: String,
        display_name: String,
        role: String,
        email: Option<String>,
        avatar: Option<String>,
        create_time: Option<String>,
        updated_at: Option<String>,
        updated_by: Option<i64>,
    }

    let users: Vec<UserRow> = sqlx::query_as(
        "SELECT id, username, display_name, role, email, avatar, create_time, updated_at, updated_by \
         FROM users WHERE is_deleted = 0 ORDER BY id"
    )
    .fetch_all(&state.db)
    .await?;

    Ok(Json(json!({"ok": true, "data": users})))
}

// ─── Get single user ────────────────────────────────────────────────────────

pub async fn get(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<i64>,
) -> AppResultJson {
    let _uid = auth::get_current_user_id(&headers)?;

    #[derive(Debug, sqlx::FromRow, Serialize)]
    struct UserRow {
        id: i64,
        username: String,
        display_name: String,
        role: String,
        email: Option<String>,
        avatar: Option<String>,
        create_time: Option<String>,
        updated_at: Option<String>,
        updated_by: Option<i64>,
    }

    let user: UserRow = sqlx::query_as(
        "SELECT id, username, display_name, role, email, avatar, create_time, updated_at, updated_by \
         FROM users WHERE id = ? AND is_deleted = 0"
    )
    .bind(id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("user not found".into()))?;

    Ok(Json(json!({"ok": true, "data": user})))
}

// ─── Create user ────────────────────────────────────────────────────────────

pub async fn create(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<CreateUserRequest>,
) -> AppResultJson {
    let _uid = auth::get_current_user_id(&headers)?;

    if req.email.trim().is_empty() {
        return Err(AppError::BadRequest("email is required".into()));
    }
    if req.password.is_empty() {
        return Err(AppError::BadRequest("password is required".into()));
    }

    let display_name = req.display_name.unwrap_or_default();
    let avatar = req.avatar.unwrap_or_default();
    let role = req.role.unwrap_or_else(|| "user".into());
    let password_hash = auth::hash_password(&req.password)?;

    let result = sqlx::query(
        "INSERT INTO users (username, display_name, email, password_hash, role, avatar) \
         VALUES (?, ?, ?, ?, ?, ?)"
    )
    .bind(&req.email)
    .bind(&display_name)
    .bind(&req.email)
    .bind(&password_hash)
    .bind(&role)
    .bind(&avatar)
    .execute(&state.db)
    .await;

    match result {
        Ok(r) => {
            let new_id = r.last_insert_rowid();

            #[derive(Debug, sqlx::FromRow, Serialize)]
            struct UserRow {
                id: i64,
                username: String,
                display_name: String,
                role: String,
                email: Option<String>,
                avatar: Option<String>,
                create_time: Option<String>,
                updated_at: Option<String>,
                updated_by: Option<i64>,
            }

            let user: UserRow = sqlx::query_as(
                "SELECT id, username, display_name, role, email, avatar, create_time, updated_at, updated_by \
                 FROM users WHERE id = ?"
            )
            .bind(new_id)
            .fetch_one(&state.db)
            .await?;

            Ok(Json(json!({"ok": true, "data": user})))
        }
        Err(e) => {
            if let Some(ref db_err) = e.as_database_error() {
                if db_err.message().contains("UNIQUE") {
                    return Err(AppError::BadRequest("email already exists".into()));
                }
            }
            Err(AppError::Internal(e.to_string()))
        }
    }
}

// ─── Update user ────────────────────────────────────────────────────────────

pub async fn update(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<i64>,
    Json(req): Json<UpdateUserRequest>,
) -> AppResultJson {
    let uid = auth::get_current_user_id(&headers)?;

    // Verify user exists
    let existing = sqlx::query_as::<_, crate::models::User>(
        "SELECT * FROM users WHERE id = ? AND is_deleted = 0"
    )
    .bind(id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("user not found".into()))?;

    let new_display_name = req.display_name.unwrap_or(existing.display_name);
    let new_email = req.email.unwrap_or(existing.email.unwrap_or_default());
    let new_avatar = req.avatar.unwrap_or(existing.avatar.unwrap_or_default());
    let new_role = req.role.unwrap_or(existing.role);

    let new_password_hash = if let Some(pw) = &req.password {
        if pw.is_empty() {
            existing.password_hash
        } else {
            auth::hash_password(pw)?
        }
    } else {
        existing.password_hash
    };

    sqlx::query(
        "UPDATE users SET display_name = ?, email = ?, avatar = ?, role = ?, \
         password_hash = ?, updated_at = datetime('now'), updated_by = ? WHERE id = ?"
    )
    .bind(&new_display_name)
    .bind(&new_email)
    .bind(&new_avatar)
    .bind(&new_role)
    .bind(&new_password_hash)
    .bind(uid)
    .bind(id)
    .execute(&state.db)
    .await?;

    #[derive(Debug, sqlx::FromRow, Serialize)]
    struct UserRow {
        id: i64,
        username: String,
        display_name: String,
        role: String,
        email: Option<String>,
        avatar: Option<String>,
        create_time: Option<String>,
        updated_at: Option<String>,
        updated_by: Option<i64>,
    }

    let user: UserRow = sqlx::query_as(
        "SELECT id, username, display_name, role, email, avatar, create_time, updated_at, updated_by \
         FROM users WHERE id = ?"
    )
    .bind(id)
    .fetch_one(&state.db)
    .await?;

    Ok(Json(json!({"ok": true, "data": user})))
}

// ─── Soft delete user ───────────────────────────────────────────────────────

pub async fn delete(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<i64>,
) -> AppResultJson {
    let uid = auth::get_current_user_id(&headers)?;

    // Don't allow deleting yourself
    if uid == id {
        return Err(AppError::BadRequest("cannot delete yourself".into()));
    }

    let affected = sqlx::query(
        "UPDATE users SET is_deleted = 1, updated_at = datetime('now'), updated_by = ? WHERE id = ? AND is_deleted = 0"
    )
    .bind(uid)
    .bind(id)
    .execute(&state.db)
    .await?
    .rows_affected();

    if affected == 0 {
        return Err(AppError::NotFound("user not found".into()));
    }

    Ok(Json(json!({"ok": true})))
}
