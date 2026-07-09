use chrono::NaiveDate;
use serde::{Deserialize, Serialize};
use sqlx::FromRow;

// ─── User ─────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, FromRow)]
pub struct User {
    pub id: i64,
    pub username: String,
    pub display_name: String,
    pub role: String,
    pub password_hash: String,
    pub email: Option<String>,
    pub avatar: Option<String>,
}

// ─── Year Course ─────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, FromRow)]
pub struct YearCourse {
    pub id: i64,
    pub name: String,
    pub year: i32,
    pub grade: Option<String>,
    pub is_archived: bool,
}

#[derive(Debug, Deserialize)]
pub struct CreateYearCourse {
    pub name: String,
    pub year: i32,
    pub grade: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateYearCourse {
    pub name: Option<String>,
    pub year: Option<i32>,
    pub grade: Option<String>,
    pub is_archived: Option<bool>,
}

// ─── Topic ───────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, FromRow)]
pub struct Topic {
    pub id: i64,
    pub year_course_id: i64,
    pub name: String,
    pub r#type: Option<String>,
    pub lessons: Option<i32>,
    pub fee: Option<f64>,
    pub unit_price_new: Option<f64>,
    pub unit_price_insert: Option<f64>,
    pub makeup_fee: Option<f64>,
    pub sort: Option<i32>,
    pub is_archived: bool,
}

#[derive(Debug, Deserialize)]
pub struct CreateTopic {
    pub year_course_id: i64,
    pub name: String,
    pub r#type: Option<String>,
    pub lessons: Option<i32>,
    pub fee: Option<f64>,
    pub unit_price_new: Option<f64>,
    pub unit_price_insert: Option<f64>,
    pub makeup_fee: Option<f64>,
    pub sort: Option<i32>,
}

// ─── Class ───────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, FromRow)]
pub struct Class {
    pub id: i64,
    pub topic_id: i64,
    pub name: Option<String>,
    pub week: Option<String>,
    pub start: Option<String>,
    pub end: Option<String>,
    pub first_lesson: Option<NaiveDate>,
    pub seat: Option<i32>,
    pub is_completed: bool,
}

#[derive(Debug, Deserialize)]
pub struct CreateClass {
    pub topic_id: i64,
    pub name: Option<String>,
    pub week: Option<String>,
    pub first_lesson: Option<NaiveDate>,
    pub seat: Option<i32>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateClass {
    pub name: Option<String>,
    pub week: Option<String>,
    pub first_lesson: Option<NaiveDate>,
    pub seat: Option<i32>,
    pub is_completed: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateTopic {
    pub name: Option<String>,
    pub r#type: Option<String>,
    pub lessons: Option<i32>,
    pub fee: Option<f64>,
    pub unit_price_new: Option<f64>,
    pub unit_price_insert: Option<f64>,
    pub makeup_fee: Option<f64>,
    pub sort: Option<i32>,
    pub is_archived: Option<bool>,
}

// ─── Lesson ──────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, FromRow)]
pub struct Lesson {
    pub id: i64,
    pub class_id: i64,
    pub num: i32,
    pub date: Option<NaiveDate>,
    pub start: Option<String>,
    pub end: Option<String>,
    pub video_url: Option<String>,
    pub status: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateLesson {
    pub date: Option<NaiveDate>,
    pub start: Option<String>,
    pub end: Option<String>,
}

// ─── Student ─────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, FromRow)]
pub struct Student {
    pub id: i64,
    pub surname: String,
    pub given_name: String,
    pub school: Option<String>,
    #[serde(skip_serializing)]
    pub password: Option<String>,
    pub phone: Option<String>,
    pub parent_phone: Option<String>,
    pub email: Option<String>,
    pub note: Option<String>,
    pub dse_year: Option<i32>,
    pub enroll_date: Option<String>,
    pub avatar: Option<String>,
    pub is_deleted: bool,
    pub create_time: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct CreateStudent {
    pub surname: String,
    pub given_name: String,
    pub school: Option<String>,
    pub email: Option<String>,
    pub password: Option<String>,
    pub phone: Option<String>,
    pub parent_phone: Option<String>,
    pub note: Option<String>,
    pub dse_year: Option<i32>,
    pub enroll_date: Option<String>,
}

// ─── Enrollment ──────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, FromRow)]
pub struct Enrollment {
    pub id: i64,
    pub student_id: i64,
    pub class_id: i64,
    pub pay_status: String,
    pub pay_amount: Option<f64>,
    pub pay_method: Option<String>,
    pub purchase: Option<i32>,
    pub used: Option<i32>,
    pub remaining: Option<i32>,
    pub is_deleted: bool,
}

#[derive(Debug, Deserialize)]
pub struct CreateEnrollment {
    pub student_id: i64,
    pub class_id: i64,
    pub pay_status: Option<String>,
    pub pay_amount: Option<f64>,
    pub purchase: Option<i32>,
}

#[derive(Debug, Deserialize)]
pub struct UpdatePayment {
    pub pay_status: String,
    pub pay_amount: Option<f64>,
    pub pay_method: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct TransferEnrollment {
    pub new_class_id: i64,
}

// ─── Lesson Checkin (lesson-based) ─────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, FromRow)]
pub struct LessonCheckin {
    pub id: i64,
    pub lesson_id: i64,
    pub student_id: i64,
    pub enrollment_id: Option<i64>,
    pub makeup_lesson_id: Option<i64>,
    pub status: String,
    pub checkin_time: Option<String>,
    pub source: String,
}

#[derive(Debug, Deserialize)]
pub struct UpdateCheckin {
    pub lesson_id: i64,
    pub student_id: i64,
    pub status: Option<String>,
}

// ─── Makeup ──────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, FromRow)]
pub struct MakeupLesson {
    pub id: i64,
    pub student_id: i64,
    pub original_class_id: Option<i64>,
    pub original_topic: Option<String>,
    pub lesson_num: Option<String>,
    pub absent_date: Option<String>,
    pub makeup_type: Option<String>,
    pub makeup_class: Option<String>,
    pub target_lesson_id: Option<i64>,
    pub status: Option<String>,
    pub is_deleted: bool,
}

#[derive(Debug, Deserialize)]
pub struct CreateMakeup {
    pub student_id: i64,
    pub original_class_id: Option<i64>,
    pub original_topic: Option<String>,
    pub lesson_num: Option<String>,
    pub absent_date: Option<String>,
    pub makeup_type: Option<String>,
    pub makeup_class: Option<String>,
    pub target_lesson_id: Option<i64>,
    pub status: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateMakeup {
    pub status: Option<String>,
    pub makeup_type: Option<String>,
    pub makeup_class: Option<String>,
    pub target_lesson_id: Option<i64>,
}

// ─── Invoice ─────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, FromRow)]
pub struct Invoice {
    pub id: i64,
    pub enrollment_id: i64,
    pub student_id: i64,
    pub topic_id: Option<i64>,
    pub r#type: String,
    pub amount: f64,
    pub makeup_fee: f64,
    pub status: String,
    pub pay_method: Option<String>,
    pub note: Option<String>,
    pub created_at: Option<String>,
    pub paid_at: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct CreateInvoice {
    pub enrollment_id: i64,
    pub student_id: i64,
    pub topic_id: Option<i64>,
    pub r#type: Option<String>,
    pub amount: f64,
    pub makeup_fee: Option<f64>,
    pub note: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateInvoice {
    pub status: Option<String>,
    pub pay_method: Option<String>,
    pub note: Option<String>,
}

// ─── Lesson Standby ─────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, FromRow)]
pub struct LessonStandby {
    pub id: i64,
    pub class_id: i64,
    pub student_id: i64,
    pub status: String,
    pub trigger_time: String,
    pub confirmed_at: Option<String>,
    pub confirmed_by: Option<i64>,
    pub note: Option<String>,
    pub is_deleted: bool,
    pub created_at: Option<String>,
}

// ─── Product ─────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, FromRow)]
pub struct Product {
    pub id: i64,
    pub name: String,
    pub description: Option<String>,
    pub price: f64,
    pub is_archived: bool,
    pub is_system: bool,
    pub is_deleted: bool,
    pub updated_at: Option<String>,
    pub updated_by: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct CreateProduct {
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    pub price: f64,
}

#[derive(Debug, Deserialize)]
pub struct UpdateProduct {
    pub name: Option<String>,
    pub description: Option<String>,
    pub price: Option<f64>,
    pub is_archived: Option<bool>,
}

// ─── Product Purchase ────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, FromRow)]
pub struct ProductPurchase {
    pub id: i64,
    pub student_id: i64,
    pub product_id: i64,
    pub quantity: i32,
    pub total_price: f64,
    pub pay_status: String,
    pub note: Option<String>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
    pub updated_by: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct CreateProductPurchase {
    pub student_id: i64,
    pub product_id: i64,
    pub quantity: Option<i32>,
    pub total_price: f64,
    pub note: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateProductPurchase {
    pub pay_status: Option<String>,
    pub note: Option<String>,
}
