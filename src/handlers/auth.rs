use axum::{extract::State, http::HeaderMap, Json};
use serde_json::json;

use crate::auth::{self, LoginRequest, UserPublic};
use crate::error::AppResultJson;
use crate::AppState;

pub async fn login(
    State(state): State<AppState>,
    Json(req): Json<LoginRequest>,
) -> AppResultJson {
    let user = sqlx::query_as::<_, crate::auth::User>(
        "SELECT * FROM users WHERE email = ? AND is_deleted = 0",
    )
    .bind(&req.email)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| crate::error::AppError::Unauthorized("帳號或密碼錯誤".into()))?;

    if !auth::verify_password(&req.password, &user.password_hash)? {
        return Err(crate::error::AppError::Unauthorized("帳號或密碼錯誤".into()));
    }

    let token = auth::create_token(user.id, &auth::get_cfg_secret())?;

    Ok(Json(json!({
        "ok": true,
        "token": token,
        "user": UserPublic {
            id: user.id,
            display_name: user.display_name,
            role: user.role,
            email: Some(user.email.unwrap_or_default()),
            avatar: user.avatar,
        }
    })))
}

pub async fn me(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> AppResultJson {
    let uid = auth::get_current_user_id(&headers)?;
    let user = auth::get_user_by_id(&state.db, uid).await?;
    Ok(Json(json!({
        "ok": true,
        "data": UserPublic {
            id: user.id,
            display_name: user.display_name,
            role: user.role,
            email: Some(user.email.unwrap_or_default()),
            avatar: user.avatar,
        }
    })))
}
