pub mod config;
pub mod db;
pub mod error;
pub mod auth;
pub mod models;
pub mod handlers;
pub mod services;

use std::net::SocketAddr;
use axum::{
    extract::State,
    response::IntoResponse,
    routing::get,
    Router,
    body::Body,
};
use sqlx::Row;
use tower_http::services::ServeDir;

use axum::response::Response;

#[tokio::main]
async fn main() -> color_eyre::Result<()> {
    color_eyre::install()?;
    tracing_subscriber::fmt::init();

    let cfg = config::Config::from_env()?;
    let db = db::init_pool(&cfg.database_url).await?;
    db::run_migrations(&db).await?;

    // Ensure upload directory exists
    tokio::fs::create_dir_all("uploads/avatars").await?;

    let app_state = AppState { db, cfg: cfg.clone(), http_client: reqwest::Client::new() };

    let app = Router::new()
        .nest("/api", api_routes())
        .nest_service("/assets", ServeDir::new("frontend/dist/assets"))
        .nest_service("/uploads", ServeDir::new("uploads"))
        // Root-level Vite output files (favicon etc.)
        .route_service("/favicon.svg", ServeDir::new("frontend/dist/favicon.svg"))
        // Diagrams: Excalidraw + HTML viewers
        .nest_service("/diagrams", ServeDir::new("diagrams"))
        // SPA: all remaining routes serve the React app
        .fallback(get(spa_fallback))
        .with_state(app_state);

    let addr = SocketAddr::from(([0, 0, 0, 0], cfg.port));
    tracing::info!("Listening on {addr}");
    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;
    Ok(())
}

// ─── SPA fallback ──────────────────────────────────────────────────────────

async fn spa_fallback() -> impl IntoResponse {
    match tokio::fs::read_to_string("frontend/dist/index.html").await {
        Ok(html) => Response::builder()
            .header("content-type", "text/html; charset=utf-8")
            .header("cache-control", "no-cache, no-store, must-revalidate")
            .body(Body::from(html))
            .unwrap(),
        Err(_) => (
            axum::http::StatusCode::NOT_FOUND,
            "Frontend not built. Run: cd frontend && npm run build",
        )
            .into_response(),
    }
}

// ─── Class tree API ─────────────────────────────────────────────────────────

async fn api_class_tree(
    State(s): State<AppState>,
    headers: axum::http::HeaderMap,
) -> crate::error::AppResultJson {
    crate::auth::get_current_user_id(&headers)?;

    let year_courses = sqlx::query_as::<_, crate::models::YearCourse>(
        "SELECT * FROM year_courses WHERE is_deleted = 0 ORDER BY year DESC, id"
    )
    .fetch_all(&s.db)
    .await?;

    let topics = sqlx::query_as::<_, crate::models::Topic>(
        "SELECT * FROM topics WHERE is_deleted = 0 AND is_archived = 0 ORDER BY sort, id"
    )
    .fetch_all(&s.db)
    .await?;

    let classes = sqlx::query_as::<_, crate::models::Class>(
        "SELECT * FROM classes WHERE is_deleted = 0 AND is_completed = 0 ORDER BY id"
    )
    .fetch_all(&s.db)
    .await?;

    // Enrollment stats per class
    #[derive(Debug, sqlx::FromRow, serde::Serialize)]
    struct EnrollStat {
        class_id: i64,
        total: i64,
        paid: i64,
        unpaid: i64,
    }
    let enroll_stats: Vec<EnrollStat> = sqlx::query_as(
        r#"SELECT
            e.class_id as class_id,
            COUNT(*) as total,
            SUM(CASE WHEN e.pay_status = '已繳' THEN 1 ELSE 0 END) as paid,
            SUM(CASE WHEN e.pay_status = '未繳' THEN 1 ELSE 0 END) as unpaid
        FROM enrollments e
        WHERE e.is_deleted = 0
        GROUP BY e.class_id"#
    )
    .fetch_all(&s.db)
    .await?;

    Ok(axum::Json(serde_json::json!({
        "ok": true,
        "data": {
            "year_courses": year_courses,
            "topics": topics,
            "classes": classes,
            "enroll_stats": enroll_stats,
        }
    })))
}

// ─── API routes ────────────────────────────────────────────────────────────

fn api_routes() -> Router<AppState> {
    use axum::routing::{post, put, delete};
    Router::new()
        .route("/class-tree", get(api_class_tree))
        .route("/auth/login", post(handlers::auth::login))
        .route("/auth/me", get(handlers::auth::me))
        .route("/students", get(handlers::students::list))
        .route("/students", post(handlers::students::create))
        .route("/students/{id}", get(handlers::students::get))
        .route("/students/{id}", put(handlers::students::update))
        .route("/students/{id}", delete(handlers::students::delete))
        .route("/students/{id}/detail", get(handlers::students::detail))
        .route("/students/{id}/avatar", post(handlers::students::upload_avatar))
        .route("/year_courses", get(handlers::classes::list_year_courses))
        .route("/year_courses", post(handlers::classes::create_year_course))
        .route("/year_courses/{id}", put(handlers::classes::update_year_course))
        .route("/year_courses/{id}", delete(handlers::classes::delete_year_course))
        .route("/topics", get(handlers::classes::list_topics))
        .route("/topics", post(handlers::classes::create_topic))
        .route("/topics/{id}", put(handlers::classes::update_topic))
        .route("/topics/{id}", delete(handlers::classes::delete_topic))
        .route("/classes", get(handlers::classes::list_classes))
        .route("/classes", post(handlers::classes::create_class))
        .route("/classes/{id}", put(handlers::classes::update_class))
        .route("/classes/{id}", delete(handlers::classes::delete_class))
        .route("/classes/{id}/lessons", get(handlers::classes::list_lessons))
        .route("/classes/{id}/enrollments", get(handlers::classes::list_enrollments))
        .route("/classes/{id}/checkins", get(handlers::classes::list_checkins))
        .route("/lessons/{id}", put(handlers::classes::update_lesson))
        .route("/enrollments", post(handlers::classes::create_enrollment))
        .route("/enrollments/{id}", delete(handlers::classes::delete_enrollment))
        .route("/enrollments/{id}/payment", put(handlers::classes::update_payment))
        .route("/enrollments/{id}/transfer", put(handlers::classes::transfer_enrollment))
        .route("/classes/{id}/ai-parse", post(handlers::classes::ai_parse))
        .route("/classes/{id}/ai-enroll", post(handlers::classes::ai_enroll))
        .route("/attendance", put(handlers::attendance::update_checkin))
        .route("/attendance/homework", put(handlers::attendance::toggle_homework))
        .route("/makeups", get(handlers::attendance::list_makeups))
        .route("/makeups", post(handlers::attendance::create_makeup))
        .route("/makeups/manage", get(handlers::attendance::list_makeups_manage))
        .route("/makeups/{id}", put(handlers::attendance::update_makeup))
        .route("/makeups/{id}", delete(handlers::attendance::delete_makeup))
        .route("/makeups/{id}/checkin", post(handlers::attendance::checkin_makeup))
        .route("/makeups/available", get(handlers::attendance::available_lessons))
        .route("/standby", get(handlers::attendance::list_standby))
        .route("/standby/confirm", post(handlers::attendance::confirm_standby))
        .route("/classes/{id}/standby-list", get(handlers::attendance::class_standby_students))
        .route("/qr-checkin", post(handlers::attendance::qr_checkin))
        .route("/scan/start", post(handlers::attendance::scan_start))
        .route("/scan/stop", post(handlers::attendance::scan_stop))
        .route("/scan/active", get(handlers::attendance::scan_active))
        .route("/attendance/daily", get(handlers::attendance::daily_checkin))
        .route("/attendance/calendar", get(handlers::attendance::calendar))
        .route("/attendance/student-note", put(handlers::attendance::update_student_note))
        // Invoice routes
        .route("/students/{id}/invoices", get(handlers::invoice::list_by_student))
        .route("/enrollments/{id}/invoices", get(handlers::invoice::list_by_enrollment))
        .route("/invoices", post(handlers::invoice::create))
        .route("/invoices/auto", post(handlers::invoice::auto_create_from_enrollment))
        .route("/invoices/{id}", put(handlers::invoice::update))
        .route("/invoices/{id}", delete(handlers::invoice::delete))
        .route("/init_data", get(handlers::classes::init_data))
        // User management routes
        .route("/users", get(handlers::users::list))
        .route("/users", post(handlers::users::create))
        .route("/users/{id}", get(handlers::users::get))
        .route("/users/{id}", put(handlers::users::update))
        .route("/users/{id}", delete(handlers::users::delete))
        // Product routes
        .route("/products", get(handlers::products::list_products))
        .route("/products", post(handlers::products::create_product))
        .route("/products/{id}", put(handlers::products::update_product))
        .route("/products/{id}", delete(handlers::products::delete_product))
        // Product purchase routes
        .route("/students/{id}/purchases", get(handlers::products::list_purchases_by_student))
        .route("/purchases", post(handlers::products::create_purchase))
        .route("/purchases/{id}", put(handlers::products::update_purchase))
        .route("/purchases/{id}", delete(handlers::products::delete_purchase))
}

#[derive(Clone)]
pub struct AppState {
    pub db: sqlx::SqlitePool,
    pub cfg: config::Config,
    pub http_client: reqwest::Client,
}
