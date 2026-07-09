use axum::{extract::{Path, State}, http::HeaderMap, Json};
use serde_json::json;

use crate::auth;
use crate::error::AppResultJson;
use crate::models::*;
use crate::AppState;

// ─── Products CRUD ──────────────────────────────────────────────────────────

pub async fn list_products(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> AppResultJson {
    auth::get_current_user_id(&headers)?;
    let items = sqlx::query_as::<_, Product>(
        "SELECT * FROM products WHERE is_deleted = 0 ORDER BY is_archived ASC, id DESC"
    )
    .fetch_all(&state.db)
    .await?;
    Ok(Json(json!({"ok": true, "data": items})))
}

pub async fn create_product(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<CreateProduct>,
) -> AppResultJson {
    let uid = auth::get_current_user_id(&headers)?;
    let result = sqlx::query(
        "INSERT INTO products (name, description, price, updated_by) VALUES (?, ?, ?, ?)"
    )
    .bind(&req.name)
    .bind(&req.description)
    .bind(req.price)
    .bind(uid)
    .execute(&state.db)
    .await?;
    let id = result.last_insert_rowid();
    Ok(Json(json!({"ok": true, "data": {"id": id}})))
}

pub async fn update_product(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<i64>,
    Json(req): Json<UpdateProduct>,
) -> AppResultJson {
    let uid = auth::get_current_user_id(&headers)?;
    if let Some(name) = &req.name {
        sqlx::query("UPDATE products SET name = ?, updated_by = ?, updated_at = datetime('now') WHERE id = ?")
            .bind(name).bind(uid).bind(id).execute(&state.db).await?;
    }
    if let Some(desc) = &req.description {
        sqlx::query("UPDATE products SET description = ?, updated_by = ?, updated_at = datetime('now') WHERE id = ?")
            .bind(desc).bind(uid).bind(id).execute(&state.db).await?;
    }
    if let Some(price) = req.price {
        sqlx::query("UPDATE products SET price = ?, updated_by = ?, updated_at = datetime('now') WHERE id = ?")
            .bind(price).bind(uid).bind(id).execute(&state.db).await?;
    }
    if let Some(archived) = req.is_archived {
        sqlx::query("UPDATE products SET is_archived = ?, updated_by = ?, updated_at = datetime('now') WHERE id = ?")
            .bind(archived).bind(uid).bind(id).execute(&state.db).await?;
    }
    Ok(Json(json!({"ok": true})))
}

pub async fn delete_product(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<i64>,
) -> AppResultJson {
    auth::get_current_user_id(&headers)?;
    sqlx::query("UPDATE products SET is_deleted = 1 WHERE id = ?")
        .bind(id).execute(&state.db).await?;
    Ok(Json(json!({"ok": true})))
}

// ─── Product Purchases ──────────────────────────────────────────────────────

pub async fn list_purchases_by_student(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(student_id): Path<i64>,
) -> AppResultJson {
    auth::get_current_user_id(&headers)?;
    let items = sqlx::query_as::<_, ProductPurchase>(
        "SELECT * FROM product_purchases WHERE student_id = ? ORDER BY created_at DESC"
    )
    .bind(student_id)
    .fetch_all(&state.db)
    .await?;

    // Also fetch product names for display
    let products = sqlx::query_as::<_, Product>(
        "SELECT * FROM products WHERE is_deleted = 0"
    )
    .fetch_all(&state.db)
    .await?;

    Ok(Json(json!({"ok": true, "data": {"purchases": items, "products": products}})))
}

pub async fn create_purchase(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<CreateProductPurchase>,
) -> AppResultJson {
    let uid = auth::get_current_user_id(&headers)?;
    let qty = req.quantity.unwrap_or(1);
    let result = sqlx::query(
        "INSERT INTO product_purchases (student_id, product_id, quantity, total_price, note, updated_by) VALUES (?, ?, ?, ?, ?, ?)"
    )
    .bind(req.student_id)
    .bind(req.product_id)
    .bind(qty)
    .bind(req.total_price)
    .bind(&req.note)
    .bind(uid)
    .execute(&state.db)
    .await?;
    let id = result.last_insert_rowid();
    Ok(Json(json!({"ok": true, "data": {"id": id}})))
}

pub async fn update_purchase(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<i64>,
    Json(req): Json<UpdateProductPurchase>,
) -> AppResultJson {
    let uid = auth::get_current_user_id(&headers)?;
    if let Some(status) = &req.pay_status {
        sqlx::query("UPDATE product_purchases SET pay_status = ?, updated_by = ?, updated_at = datetime('now') WHERE id = ?")
            .bind(status).bind(uid).bind(id).execute(&state.db).await?;
    }
    if let Some(note) = &req.note {
        sqlx::query("UPDATE product_purchases SET note = ?, updated_by = ?, updated_at = datetime('now') WHERE id = ?")
            .bind(note).bind(uid).bind(id).execute(&state.db).await?;
    }
    Ok(Json(json!({"ok": true})))
}

pub async fn delete_purchase(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<i64>,
) -> AppResultJson {
    auth::get_current_user_id(&headers)?;
    sqlx::query("DELETE FROM product_purchases WHERE id = ?")
        .bind(id).execute(&state.db).await?;
    Ok(Json(json!({"ok": true})))
}
