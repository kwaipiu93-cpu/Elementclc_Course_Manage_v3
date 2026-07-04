use axum::{extract::{Path, State}, http::HeaderMap, Json};
use serde_json::json;
use serde::Deserialize;

use crate::auth;
use crate::error::AppResultJson;
use crate::models::*;
use crate::services::enrollment_service;
use crate::AppState;
use sqlx::Row;

// ─── Year Courses ───────────────────────────────────────────────────────────

pub async fn list_year_courses(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> AppResultJson {
    auth::get_current_user_id(&headers)?;
    let items = sqlx::query_as::<_, YearCourse>(
        "SELECT * FROM year_courses WHERE is_deleted = 0 ORDER BY year DESC"
    )
    .fetch_all(&state.db)
    .await?;
    Ok(Json(json!({"ok": true, "data": items})))
}

pub async fn create_year_course(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<CreateYearCourse>,
) -> AppResultJson {
    let uid = auth::get_current_user_id(&headers)?;
    let result = sqlx::query(
        "INSERT INTO year_courses (name, year, grade, updated_by) VALUES (?, ?, ?, ?)"
    )
    .bind(&req.name)
    .bind(req.year)
    .bind(&req.grade)
    .bind(uid)
    .execute(&state.db)
    .await?;
    Ok(Json(json!({"ok": true, "id": result.last_insert_rowid()})))
}

pub async fn update_year_course(
    State(state): State<AppState>,
    headers: HeaderMap,
    axum::extract::Path(id): axum::extract::Path<i64>,
    Json(req): Json<UpdateYearCourse>,
) -> AppResultJson {
    let uid = auth::get_current_user_id(&headers)?;
    sqlx::query(
        "UPDATE year_courses SET name = COALESCE(?, name), year = COALESCE(?, year), grade = COALESCE(?, grade), is_archived = COALESCE(?, is_archived), updated_at = datetime('now'), updated_by = ? WHERE id = ? AND is_deleted = 0"
    )
    .bind(&req.name)
    .bind(req.year)
    .bind(&req.grade)
    .bind(req.is_archived)
    .bind(uid)
    .bind(id)
    .execute(&state.db)
    .await?;
    Ok(Json(json!({"ok": true})))
}

pub async fn delete_year_course(
    State(state): State<AppState>,
    headers: HeaderMap,
    axum::extract::Path(id): axum::extract::Path<i64>,
) -> AppResultJson {
    let uid = auth::get_current_user_id(&headers)?;
    sqlx::query(
        "UPDATE year_courses SET is_deleted = 1, updated_at = datetime('now'), updated_by = ? WHERE id = ?"
    )
    .bind(uid)
    .bind(id)
    .execute(&state.db)
    .await?;
    Ok(Json(json!({"ok": true})))
}

// ─── Topics ─────────────────────────────────────────────────────────────────

pub async fn list_topics(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> AppResultJson {
    auth::get_current_user_id(&headers)?;
    let items = sqlx::query_as::<_, Topic>(
        "SELECT * FROM topics WHERE is_deleted = 0 AND is_archived = 0 ORDER BY sort"
    )
    .fetch_all(&state.db)
    .await?;
    Ok(Json(json!({"ok": true, "data": items})))
}

pub async fn create_topic(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<CreateTopic>,
) -> AppResultJson {
    let uid = auth::get_current_user_id(&headers)?;
    let result = sqlx::query(
        "INSERT INTO topics (year_course_id, name, type, lessons, fee, unit_price_new, unit_price_insert, sort, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    )
    .bind(req.year_course_id)
    .bind(&req.name)
    .bind(&req.r#type)
    .bind(req.lessons)
    .bind(req.fee)
    .bind(req.unit_price_new)
    .bind(req.unit_price_insert)
    .bind(req.sort)
    .bind(uid)
    .execute(&state.db)
    .await?;
    Ok(Json(json!({"ok": true, "id": result.last_insert_rowid()})))
}

// ─── Classes ────────────────────────────────────────────────────────────────

pub async fn list_classes(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> AppResultJson {
    auth::get_current_user_id(&headers)?;
    let items = sqlx::query_as::<_, Class>(
        "SELECT * FROM classes WHERE is_deleted = 0 AND is_completed = 0 ORDER BY id"
    )
    .fetch_all(&state.db)
    .await?;
    Ok(Json(json!({"ok": true, "data": items})))
}

pub async fn create_class(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<CreateClass>,
) -> AppResultJson {
    let uid = auth::get_current_user_id(&headers)?;
    let result = sqlx::query(
        "INSERT INTO classes (topic_id, name, week, first_lesson, seat, updated_by) VALUES (?, ?, ?, ?, ?, ?)"
    )
    .bind(req.topic_id)
    .bind(&req.name)
    .bind(&req.week)
    .bind(req.first_lesson)
    .bind(req.seat)
    .bind(uid)
    .execute(&state.db)
    .await?;
    let class_id = result.last_insert_rowid();

    // Auto-generate lessons from topic count + week schedule
    if let (Some(first_date), Some(ref week_str)) = (req.first_lesson, &req.week) {
        // Get topic lesson count
        let topic_lessons: Option<i32> = sqlx::query_scalar::<_, i32>(
            "SELECT COALESCE(lessons, 0) FROM topics WHERE id = ?"
        )
        .bind(req.topic_id)
        .fetch_optional(&state.db)
        .await?;

        if let Some(count) = topic_lessons {
            if count > 0 {
                // Parse weekday from "逢X" pattern
                let weekday_map: [(char, u32); 7] = [
                    ('日', 0), ('一', 1), ('二', 2), ('三', 3),
                    ('四', 4), ('五', 5), ('六', 6),
                ];

                let target_dow = week_str.chars()
                    .skip_while(|&c| c != '逢')
                    .nth(1)
                    .and_then(|c| weekday_map.iter().find(|(ch, _)| *ch == c).map(|(_, n)| *n));

                // Parse time range "HH:MM-HH:MM"
                let (start_time, end_time) = {
                    let parts: Vec<&str> = week_str.split(' ').collect();
                    if parts.len() >= 2 {
                        let times: Vec<&str> = parts[1].split('-').collect();
                        (times.first().map(|s| s.to_string()), times.get(1).map(|s| s.to_string()))
                    } else {
                        (None, None)
                    }
                };

                if let Some(dow) = target_dow {
                    use chrono::{Datelike, Duration};
                    let mut current = first_date;

                    // Find the first occurrence of the target weekday
                    while current.weekday().num_days_from_sunday() != dow {
                        current = current + Duration::try_days(1).unwrap();
                    }

                    for n in 1..=count {
                        sqlx::query(
                            "INSERT INTO lessons (class_id, num, date, start, end, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))"
                        )
                        .bind(class_id)
                        .bind(n as i32)
                        .bind(current)
                        .bind(&start_time)
                        .bind(&end_time)
                        .bind(uid)
                        .execute(&state.db)
                        .await?;
                        current = current + Duration::try_days(7).unwrap();
                    }
                }
            }
        }
    }

    Ok(Json(json!({"ok": true, "id": class_id})))
}


pub async fn update_class(
    State(state): State<AppState>,
    headers: HeaderMap,
    axum::extract::Path(id): axum::extract::Path<i64>,
    Json(req): Json<UpdateClass>,
) -> AppResultJson {
    let uid = auth::get_current_user_id(&headers)?;
    sqlx::query(
        "UPDATE classes SET name = COALESCE(?, name), week = COALESCE(?, week), first_lesson = COALESCE(?, first_lesson), seat = COALESCE(?, seat), is_completed = COALESCE(?, is_completed), updated_at = datetime('now'), updated_by = ? WHERE id = ? AND is_deleted = 0"
    )
    .bind(&req.name)
    .bind(&req.week)
    .bind(req.first_lesson)
    .bind(req.seat)
    .bind(req.is_completed)
    .bind(uid)
    .bind(id)
    .execute(&state.db)
    .await?;
    Ok(Json(json!({"ok": true})))
}

pub async fn delete_class(
    State(state): State<AppState>,
    headers: HeaderMap,
    axum::extract::Path(id): axum::extract::Path<i64>,
) -> AppResultJson {
    let uid = auth::get_current_user_id(&headers)?;
    sqlx::query(
        "UPDATE classes SET is_deleted = 1, updated_at = datetime('now'), updated_by = ? WHERE id = ?"
    )
    .bind(uid)
    .bind(id)
    .execute(&state.db)
    .await?;
    Ok(Json(json!({"ok": true})))
}

pub async fn update_topic(
    State(state): State<AppState>,
    headers: HeaderMap,
    axum::extract::Path(id): axum::extract::Path<i64>,
    Json(req): Json<UpdateTopic>,
) -> AppResultJson {
    let uid = auth::get_current_user_id(&headers)?;
    sqlx::query(
        "UPDATE topics SET name = COALESCE(?, name), type = COALESCE(?, type), lessons = COALESCE(?, lessons), fee = COALESCE(?, fee), unit_price_new = COALESCE(?, unit_price_new), unit_price_insert = COALESCE(?, unit_price_insert), sort = COALESCE(?, sort), is_archived = COALESCE(?, is_archived), updated_at = datetime('now'), updated_by = ? WHERE id = ? AND is_deleted = 0"
    )
    .bind(&req.name)
    .bind(&req.r#type)
    .bind(req.lessons)
    .bind(req.fee)
    .bind(req.unit_price_new)
    .bind(req.unit_price_insert)
    .bind(req.sort)
    .bind(req.is_archived)
    .bind(uid)
    .bind(id)
    .execute(&state.db)
    .await?;
    Ok(Json(json!({"ok": true})))
}

pub async fn delete_topic(
    State(state): State<AppState>,
    headers: HeaderMap,
    axum::extract::Path(id): axum::extract::Path<i64>,
) -> AppResultJson {
    let uid = auth::get_current_user_id(&headers)?;
    sqlx::query(
        "UPDATE topics SET is_deleted = 1, updated_at = datetime('now'), updated_by = ? WHERE id = ?"
    )
    .bind(uid)
    .bind(id)
    .execute(&state.db)
    .await?;
    Ok(Json(json!({"ok": true})))
}

// ─── Lessons ────────────────────────────────────────────────────────────────

pub async fn list_lessons(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(class_id): Path<i64>,
) -> AppResultJson {
    auth::get_current_user_id(&headers)?;
    let items = sqlx::query_as::<_, Lesson>(
        "SELECT * FROM lessons WHERE class_id = ? AND is_deleted = 0 ORDER BY num"
    )
    .bind(class_id)
    .fetch_all(&state.db)
    .await?;
    Ok(Json(json!({"ok": true, "data": items})))
}

pub async fn update_lesson(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<i64>,
    Json(req): Json<UpdateLesson>,
) -> AppResultJson {
    let uid = auth::get_current_user_id(&headers)?;
    sqlx::query(
        "UPDATE lessons SET date = COALESCE(?, date), start = COALESCE(?, start), end = COALESCE(?, end), updated_at = datetime('now'), updated_by = ? WHERE id = ?"
    )
    .bind(req.date)
    .bind(&req.start)
    .bind(&req.end)
    .bind(uid)
    .bind(id)
    .execute(&state.db)
    .await?;
    Ok(Json(json!({"ok": true})))
}

// ─── Enrollments ────────────────────────────────────────────────────────────

pub async fn list_enrollments(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(class_id): Path<i64>,
) -> AppResultJson {
    auth::get_current_user_id(&headers)?;
    let items = sqlx::query_as::<_, Enrollment>(
        "SELECT e.* FROM enrollments e WHERE e.class_id = ? AND e.is_deleted = 0 ORDER BY e.id"
    )
    .bind(class_id)
    .fetch_all(&state.db)
    .await?;
    Ok(Json(json!({"ok": true, "data": items})))
}

pub async fn list_checkins(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(class_id): Path<i64>,
) -> AppResultJson {
    auth::get_current_user_id(&headers)?;

    let checkins = sqlx::query(
        "SELECT lc.lesson_id, lc.student_id, lc.status, lc.checkin_time, COALESCE(lc.homework_done,1)
         FROM lesson_checkins lc
         JOIN lessons l ON lc.lesson_id = l.id
         WHERE l.class_id = ? AND l.is_deleted = 0"
    )
    .bind(class_id)
    .fetch_all(&state.db)
    .await?
    .into_iter()
    .map(|row: sqlx::sqlite::SqliteRow| {
        json!({
            "lesson_id": row.get::<i64, _>(0),
            "student_id": row.get::<i64, _>(1),
            "status": row.get::<String, _>(2),
            "checkin_time": row.get::<Option<String>, _>(3),
            "homework_done": row.get::<i32, _>(4) == 1,
        })
    })
    .collect::<Vec<_>>();

    let makeups = sqlx::query(
        "SELECT student_id, lesson_num, status, makeup_class, makeup_type, id
         FROM makeup_lessons
         WHERE original_class_id = ? AND is_deleted = 0"
    )
    .bind(class_id)
    .fetch_all(&state.db)
    .await?
    .into_iter()
    .map(|row: sqlx::sqlite::SqliteRow| {
        json!({
            "student_id": row.get::<i64, _>(0),
            "lesson_num": row.get::<String, _>(1),
            "status": row.get::<String, _>(2),
            "makeup_class": row.get::<Option<String>, _>(3),
            "makeup_type": row.get::<Option<String>, _>(4),
            "id": row.get::<i64, _>(5),
        })
    })
    .collect::<Vec<_>>();

    let standby = sqlx::query(
        "SELECT sb.id, sb.student_id, sb.status, sb.trigger_time
         FROM lesson_standby sb
         WHERE sb.class_id = ? AND sb.is_deleted = 0
         ORDER BY sb.id"
    )
    .bind(class_id)
    .fetch_all(&state.db)
    .await?
    .into_iter()
    .map(|row: sqlx::sqlite::SqliteRow| {
        json!({
            "id": row.get::<i64, _>(0),
            "student_id": row.get::<i64, _>(1),
            "status": row.get::<String, _>(2),
            "trigger_time": row.get::<Option<String>, _>(3),
        })
    })
    .collect::<Vec<_>>();

    // Attendance change logs for this class
    let logs = sqlx::query(
        r#"SELECT al.lesson_num, al.old_status, al.new_status, al.created_at,
                  e.student_id
           FROM attendance_log al
           JOIN enrollments e ON al.enrollment_id = e.id
           WHERE al.lesson_num IN (SELECT num FROM lessons WHERE class_id = ? AND is_deleted = 0)
           ORDER BY al.id DESC
           LIMIT 200"#
    )
    .bind(class_id)
    .fetch_all(&state.db)
    .await?
    .into_iter()
    .map(|row: sqlx::sqlite::SqliteRow| {
        json!({
            "lesson_id": row.get::<i64, _>(0),
            "student_id": row.get::<i64, _>(4),
            "old_status": row.get::<String, _>(1),
            "new_status": row.get::<String, _>(2),
            "created_at": row.get::<String, _>(3),
        })
    })
    .collect::<Vec<_>>();

    Ok(Json(json!({
        "ok": true,
        "data": { "checkins": checkins, "makeups": makeups, "standby": standby, "logs": logs }
    })))
}

pub async fn create_enrollment(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<CreateEnrollment>,
) -> AppResultJson {
    auth::get_current_user_id(&headers)?;
    let enr = enrollment_service::create(&state.db, req).await?;
    Ok(Json(json!({"ok": true, "data": enr})))
}

pub async fn delete_enrollment(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<i64>,
) -> AppResultJson {
    auth::get_current_user_id(&headers)?;
    enrollment_service::soft_delete(&state.db, id).await?;
    Ok(Json(json!({"ok": true})))
}

pub async fn update_payment(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<i64>,
    Json(req): Json<UpdatePayment>,
) -> AppResultJson {
    auth::get_current_user_id(&headers)?;
    enrollment_service::update_payment(&state.db, id, req).await?;
    Ok(Json(json!({"ok": true})))
}

pub async fn transfer_enrollment(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<i64>,
    Json(req): Json<TransferEnrollment>,
) -> AppResultJson {
    auth::get_current_user_id(&headers)?;
    enrollment_service::transfer_class(&state.db, id, req.new_class_id).await?;
    Ok(Json(json!({"ok": true})))
}

// ─── AI Enrollment Parser ────────────────────────────────────────────


#[derive(Deserialize)]
pub struct AiParseReq {
    pub text: String,
}

#[derive(serde::Serialize, serde::Deserialize)]
pub struct ParsedStudent {
    pub surname: String,
    pub given_name: String,
    pub school: String,
    pub email: String,
    pub phone: String,
    pub parent_phone: String,
    pub grade: String,
    pub dse_year: i32,
    pub note: String,
    pub raw: String,
}

fn parse_single_line(line: &str) -> ParsedStudent {
    let line = line.trim();
    let raw = line.to_string();
    let mut surname = String::new();
    let mut given_name = String::new();
    let mut school = String::new();
    let mut phone = String::new();
    let mut parent_phone = String::new();
    let mut grade = String::new();
    let mut dse_year = 0i32;

    // Extract phone numbers (8 digits)
    let phone_re = regex::Regex::new(r"\b(\d{8})\b").unwrap();
    let phones: Vec<String> = phone_re.find_iter(line).map(|m| m.as_str().to_string()).collect();
    if phones.len() >= 1 { phone = phones[0].clone(); }
    if phones.len() >= 2 { parent_phone = phones[1].clone(); }

    // Remove phones from text for further processing
    let cleaned = phone_re.replace_all(line, "").trim().to_string();

    // Extract grade: F.1-F.6, Form 1-6, 中一-中六, F1-F6
    let grade_re = regex::Regex::new(r"(?i)(?:F(?:orm)?[\.\s]?([1-6])|中([一二三四五六]))").unwrap();
    if let Some(caps) = grade_re.captures(&cleaned) {
        grade = if let Some(n) = caps.get(1) {
            format!("F.{}", n.as_str())
        } else if let Some(_) = caps.get(2) {
            // Map Chinese numerals
            let cn = caps.get(2).unwrap().as_str();
            grade = match cn {
                "一" => "F.1",
                "二" => "F.2",
                "三" => "F.3",
                "四" => "F.4",
                "五" => "F.5",
                "六" => "F.6",
                _ => "",
            }.to_string();
            grade.clone()
        } else { String::new() };
    }

    // Remove grade from text
    let cleaned2 = grade_re.replace_all(&cleaned, "").trim().to_string();

    // Extract DSE year: 20XX or XX (2 digits after cleaning)
    let year_re = regex::Regex::new(r"\b(20\d{2})\b").unwrap();
    if let Some(caps) = year_re.captures(&cleaned2) {
        dse_year = caps.get(1).unwrap().as_str().parse().unwrap_or(0);
    }

    // Known HK schools list (can be expanded)
    let known_schools = vec![
        "皇仁", "喇沙", "拔萃", "男拔", "女拔", "協恩", "瑪利諾", "聖保羅",
        "聖士提反", "華仁", "英皇", "英華", "張祝珊", "香港華仁", "九龍華仁",
        "培正", "民生", "浸信會", "崇真", "迦密", "銘賢", "順德聯誼",
        "聖公會", "天主教", "真光", "寶血", "德望", "聖心", "嘉諾撒",
        "伊利沙伯", "賽馬會", "皇仁書院", "喇沙書院", "拔萃男書院", "拔萃女書院",
        "協恩中學", "瑪利諾修院", "聖保羅男女", "聖保祿", "華仁書院",
        "英皇書院", "英華書院", "張祝珊英文中學", "培正中學", "民生書院",
        "迦密中學", "銘賢書院", "真光中學", "德望學校", "聖心書院",
    ];

    // Try to match school names first
    for s in &known_schools {
        if cleaned2.contains(s) {
            school = s.to_string();
            break;
        }
    }

    // Extract name: everything before school/garbage
    // After removing phone, grade, school, what's left should be the name
    let cleaned3 = if !school.is_empty() {
        school_replacen(&cleaned2, &school, "")
    } else { cleaned2.clone() };
    let cleaned3 = cleaned3.trim();

    // Clean up remaining non-Chinese chars
    let name_str: String = cleaned3.chars().filter(|&c| c.is_ascii_alphabetic() || c.is_ascii_whitespace() || {
        let code = c as u32;
        (code >= 0x4E00 && code <= 0x9FFF) || // CJK Unified
        (code >= 0x3400 && code <= 0x4DBF) || // CJK Extension A
        code == 0x2022 || code == 0x00B7
    }).collect();
    let name_str = name_str.trim().to_string();

    // Chinese name: first char is surname, rest is given name
    let chars: Vec<char> = name_str.chars().collect();
    if chars.len() >= 2 {
        // Check if first char is a common Chinese surname
        let common_surnames = ['陳','李','張','王','劉','黃','楊','吳','林','周',
            '鄭','何','梁','謝','馬','鄧','朱','徐','胡','孫','宋','蔡','郭',
            '曾','余','蕭','羅','葉','盧','譚','潘','蘇','方','石','廖','梁',
            '黎','馮','袁','許','彭','陸','韋','蔣','程','傅','沈','范','古',
            '邱','任','田','溫','曹','姜','嚴','唐','韓','賈','丁','魏','薛',
            '姚','潘','石','賴','蔡','侯','邵','孟','錢','白','段','孔','毛',
            '祁','毛','狄','萬','黎','龍','龔','洪','關','童','顏','倪','湯',
            '簡','尤','符','季','辜','陶','夏','屈','蒙','聶','翁','車','湛'];
        if common_surnames.contains(&chars[0]) {
            surname = chars[0].to_string();
            given_name = chars[1..].iter().collect();
        } else {
            // Assume 2-char surname or first 2 chars as surname
            surname = chars[..2].iter().collect();
            given_name = if chars.len() > 2 { chars[2..].iter().collect() } else { String::new() };
        }
    } else if chars.len() == 1 {
        surname = chars[0].to_string();
    }

    // Auto-calculate DSE year from grade + current year (2026)
    if dse_year == 0 && !grade.is_empty() {
        if let Some(n) = grade.strip_prefix("F.").or_else(|| grade.strip_prefix("F")) {
            if let Ok(g) = n.parse::<i32>() {
                dse_year = 2026 + (6 - g);
            }
        }
    }

    // Extract email
    let email_re = regex::Regex::new(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b").unwrap();
    let email = email_re.find(line).map(|m| m.as_str().to_string()).unwrap_or_default();

    // Extract note: remaining text after all other fields removed
    let cleaned4 = email_re.replace_all(&cleaned3, "").trim().to_string();
    let note = if cleaned4.len() > 0 && cleaned4 != name_str {
        cleaned4.clone()
    } else {
        String::new()
    };

    ParsedStudent { surname, given_name, school, email, phone, parent_phone, grade, dse_year, note, raw }
}

// Simple replace utility (Rust doesn't have replace_n)
fn school_replacen(s: &str, pattern: &str, replacement: &str) -> String {
    s.replacen(pattern, replacement, 1)
}

// ─── DeepSeek AI Parsing ─────────────────────────────────────────────────

#[derive(Deserialize)]
struct DeepSeekMessage {
    role: String,
    content: String,
}

#[derive(Deserialize)]
struct DeepSeekChoice {
    message: DeepSeekMessage,
}

#[derive(Deserialize)]
struct DeepSeekResponse {
    choices: Vec<DeepSeekChoice>,
}

#[derive(Deserialize)]
struct LlmStudent {
    surname: String,
    given_name: String,
    school: String,
    email: String,
    phone: String,
    parent_phone: String,
    grade: String,
    dse_year: i32,
    note: String,
}

async fn deepseek_parse(
    client: &reqwest::Client,
    api_key: &str,
    text: &str,
) -> Result<Vec<ParsedStudent>, String> {
    let lines: Vec<&str> = text.lines()
        .map(|l| l.trim())
        .filter(|l| !l.is_empty())
        .collect();

    if lines.is_empty() {
        return Ok(Vec::new());
    }

    let system_prompt = r#"你是一個香港補習社學生資料解析器。將每行學生資料解析為結構化JSON。

每行可能包含：中文姓名、8位電話、學校名稱、年級(F.1-F.6/中一至中六)、DSE年份。

回傳JSON陣列，每個元素：
{
  "surname": "姓氏",
  "given_name": "名字",
  "school": "學校名稱",
  "email": "電郵地址(或空字串)",
  "phone": "第一個8位電話",
  "parent_phone": "第二個8位電話(或空字串)",
  "grade": "年級如F.4",
  "dse_year": 數值,可從年級推算,不確定為0,
  "note": "備註(或空字串)"
}

規則：
- 中文姓名首字為姓，後為名
- 電話為8位連續數字
- 年級統一轉換為F.1-F.6格式（例如 中五→F.5, Form 5→F.5, 中六→F.6）
- DSE年份：如無明確年份，從年級推算（F.6=2026, F.5=2027, F.4=2028）
- 電郵：@前後的完整電郵地址
- 備註：其他無法分類的資訊
- 只回傳JSON陣列，勿加markdown"#;

    let user_content = format!("請解析以下學生資料（每行一位學生）：\n\n{}", lines.join("\n"));

    let body = json!({
        "model": "deepseek-chat",
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_content}
        ],
        "temperature": 0.1,
        "max_tokens": 2000,
    });

    let resp = client
        .post("https://api.deepseek.com/v1/chat/completions")
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("DeepSeek請求失敗: {}", e))?;

    let status = resp.status();
    let resp_text = resp.text().await.map_err(|e| format!("讀取回應失敗: {}", e))?;

    if !status.is_success() {
        return Err(format!("DeepSeek錯誤({}): {}", status, resp_text));
    }

    let deepseek_resp: DeepSeekResponse = serde_json::from_str(&resp_text)
        .map_err(|e| format!("解析回應JSON失敗: {}", e))?;

    let content = deepseek_resp.choices.first()
        .map(|c| c.message.content.clone())
        .ok_or_else(|| "無回傳內容".to_string())?;

    // Strip markdown code fences
    let cleaned = content
        .trim()
        .strip_prefix("```json")
        .or_else(|| content.trim().strip_prefix("```"))
        .map(|s| s.trim_end().strip_suffix("```").unwrap_or(s.trim_end()))
        .map(|s| s.trim())
        .unwrap_or(content.trim());

    let llm_students: Vec<LlmStudent> = serde_json::from_str(cleaned)
        .map_err(|e| format!("解析學生JSON失敗: {} (原始: {})", e, &cleaned[..200]))?;

    let results: Vec<ParsedStudent> = llm_students.into_iter().map(|s| {
        ParsedStudent {
            surname: s.surname,
            given_name: s.given_name,
            school: s.school,
            email: s.email,
            phone: s.phone,
            parent_phone: s.parent_phone,
            grade: s.grade,
            dse_year: if s.dse_year > 2000 { s.dse_year } else { 0 },
            note: s.note,
            raw: String::new(),
        }
    }).collect();

    Ok(results)
}

pub async fn ai_parse(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(class_id): Path<i64>,
    Json(req): Json<AiParseReq>,
) -> AppResultJson {
    auth::get_current_user_id(&headers)?;

    // Try DeepSeek API first
    if let Some(api_key) = &state.cfg.deepseek_api_key {
        match deepseek_parse(&state.http_client, api_key, &req.text).await {
            Ok(results) if !results.is_empty() => {
                return Ok(Json(json!({"ok": true, "data": results, "source": "ai"})));
            }
            Ok(_) => { /* empty results, fall through */ }
            Err(e) => {
                tracing::warn!("DeepSeek parse failed, falling back to regex: {}", e);
            }
        }
    }

    // Fallback to regex
    let lines: Vec<&str> = req.text.lines()
        .map(|l| l.trim())
        .filter(|l| !l.is_empty())
        .collect();

    let mut results: Vec<ParsedStudent> = Vec::new();
    for line in &lines {
        let parsed = parse_single_line(line);
        results.push(parsed);
    }

    Ok(Json(json!({"ok": true, "data": results, "source": "regex"})))
}

#[derive(Deserialize)]
pub struct AiEnrollReq {
    pub students: Vec<ParsedStudent>,
}

pub async fn ai_enroll(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(class_id): Path<i64>,
    Json(req): Json<AiEnrollReq>,
) -> AppResultJson {
    let _uid = auth::get_current_user_id(&headers)?;
    let mut enrolled = 0i32;
    let mut errors: Vec<String> = Vec::new();

    for st in &req.students {
        // Check if student already exists by phone, email, or surname+given_name
        let existing: Option<(i64,)> = if !st.phone.is_empty() {
            sqlx::query_as(
                "SELECT id FROM students WHERE phone = ? AND is_deleted = 0"
            )
            .bind(&st.phone)
            .fetch_optional(&state.db)
            .await?
        } else if !st.email.is_empty() {
            sqlx::query_as(
                "SELECT id FROM students WHERE email = ? AND is_deleted = 0"
            )
            .bind(&st.email)
            .fetch_optional(&state.db)
            .await?
        } else if !st.surname.is_empty() && !st.given_name.is_empty() {
            sqlx::query_as(
                "SELECT id FROM students WHERE surname = ? AND given_name = ? AND is_deleted = 0"
            )
            .bind(&st.surname)
            .bind(&st.given_name)
            .fetch_optional(&state.db)
            .await?
        } else {
            None
        };

        let student_id = if let Some((sid,)) = existing {
            sid
        } else {
            // Create new student
            let result = sqlx::query(
                r#"INSERT INTO students (surname, given_name, school, email, phone, parent_phone, dse_year, note, is_deleted)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)"#
            )
            .bind(&st.surname)
            .bind(&st.given_name)
            .bind(&st.school)
            .bind(&st.email)
            .bind(&st.phone)
            .bind(&st.parent_phone)
            .bind(st.dse_year)
            .bind(&st.note)
            .execute(&state.db)
            .await?;
            result.last_insert_rowid()
        };

        // Create enrollment
        match sqlx::query(
            r#"INSERT INTO enrollments (student_id, class_id, pay_status, purchase, used, remaining, status)
               VALUES (?, ?, 'Unpaid', 12, 0, 12, 'active')"#
        )
        .bind(student_id)
        .bind(class_id)
        .execute(&state.db)
        .await
        {
            Ok(_) => enrolled += 1,
            Err(e) => errors.push(format!("{} {}: {}", st.surname, st.given_name, e)),
        }
    }

    Ok(Json(json!({"ok": true, "enrolled": enrolled, "errors": errors})))
}

// ─── Init Data ──────────────────────────────────────────────────────────────

pub async fn init_data(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> AppResultJson {
    auth::get_current_user_id(&headers)?;
    let year_courses = sqlx::query_as::<_, YearCourse>(
        "SELECT * FROM year_courses WHERE is_deleted = 0 ORDER BY year DESC"
    )
    .fetch_all(&state.db)
    .await?;

    let topics = sqlx::query_as::<_, Topic>(
        "SELECT * FROM topics WHERE is_deleted = 0 ORDER BY sort"
    )
    .fetch_all(&state.db)
    .await?;

    let classes = sqlx::query_as::<_, Class>(
        "SELECT * FROM classes WHERE is_deleted = 0 ORDER BY id"
    )
    .fetch_all(&state.db)
    .await?;

    Ok(Json(json!({
        "ok": true,
        "data": {
            "year_courses": year_courses,
            "topics": topics,
            "classes": classes,
        }
    })))
}
