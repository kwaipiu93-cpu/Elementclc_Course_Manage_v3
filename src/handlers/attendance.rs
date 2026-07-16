use axum::{extract::{Path, State}, http::{HeaderMap, StatusCode}, response::IntoResponse, Json};
use serde::Deserialize;
use serde_json::json;

use crate::auth;
use crate::error::{AppError, AppResultJson};
use crate::models::*;
use crate::services::attendance_service;
use crate::AppState;

pub async fn update_checkin(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<UpdateCheckin>,
) -> AppResultJson {
    auth::get_current_user_id(&headers)?;
    let lesson_id = req.lesson_id;
    let student_id = req.student_id;
    let new_status = req.status.clone().unwrap_or_default();
    attendance_service::upsert_checkin(&state.db, req).await?;

    // When status is cleared (empty) or set to present/leave/absent, cancel pending makeups
    if new_status.is_empty() || new_status == "present" || new_status == "leave" || new_status == "absent" {
        // Find pending makeup_lessons for this student+lesson and soft-delete them
        let pending_makeups: Vec<(i64, Option<String>)> = sqlx::query_as(
            r#"SELECT mk.id, mk.makeup_type
               FROM makeup_lessons mk
               JOIN lessons l ON mk.original_class_id = l.class_id
                  AND mk.lesson_num = CAST(l.num AS TEXT)
               WHERE l.id = ? AND mk.student_id = ?
                 AND mk.status IN ('waiting', 'scheduled')
                 AND mk.is_deleted = 0"#
        )
        .bind(lesson_id)
        .bind(student_id)
        .fetch_all(&state.db)
        .await?;

        for (mk_id, mk_type) in &pending_makeups {
            // Soft-delete the makeup record
            sqlx::query(
                "UPDATE makeup_lessons SET is_deleted = 1, updated_at = datetime('now') WHERE id = ?"
            )
            .bind(mk_id)
            .execute(&state.db)
            .await?;

            // If it was a recording makeup, also clean up class 8 enrollment
            if let Some(ref t) = mk_type {
                if t == "線上錄播" || t == "課室錄播" {
                    sqlx::query(
                        "UPDATE enrollments SET is_deleted = 1, updated_at = datetime('now') WHERE makeup_id = ? AND is_deleted = 0"
                    )
                    .bind(mk_id)
                    .execute(&state.db)
                    .await
                    .ok();
                }
            }

            // Log the cancellation
            sqlx::query(
                "INSERT INTO attendance_log (enrollment_id, lesson_num, old_status, new_status, created_at)
                 VALUES ((SELECT id FROM enrollments WHERE student_id = ? AND class_id = (SELECT class_id FROM lessons WHERE id = ?) AND is_deleted = 0 LIMIT 1),
                         (SELECT num FROM lessons WHERE id = ?), 'makeup_cancelled', ?, datetime('now'))"
            )
            .bind(student_id)
            .bind(lesson_id)
            .bind(lesson_id)
            .bind(&new_status)
            .execute(&state.db)
            .await
            .ok();
        }
    }

    // If checking in at 補課錄播班 (class_id=8), mark makeup as done AND sync back to original lesson_checkin
    let class_id: Option<i64> = sqlx::query_scalar(
        "SELECT class_id FROM lessons WHERE id = ?"
    )
    .bind(lesson_id)
    .fetch_optional(&state.db)
    .await?
    .flatten();

    if class_id == Some(8) && (new_status == "recording_room_present" || new_status == "video_makeup") {
        // Try to find the specific makeup via enrollment.makeup_id first (more precise)
        let linked_makeup: Option<(i64,)> = sqlx::query_as(
            "SELECT m.id FROM makeup_lessons m
             JOIN enrollments e ON e.makeup_id = m.id
             WHERE e.student_id = ? AND e.class_id = 8 AND e.is_deleted = 0
               AND m.student_id = ?
               AND m.makeup_type IN ('線上錄播', '課室錄播')
               AND m.status = 'scheduled'
               AND m.is_deleted = 0
             LIMIT 1"
        )
        .bind(student_id)
        .bind(student_id)
        .fetch_optional(&state.db)
        .await?;

        let makeup_ids: Vec<i64> = if let Some((mid,)) = linked_makeup {
            vec![mid]
        } else {
            // Fallback: find any pending recording makeups for this student
            sqlx::query_scalar(
                "SELECT id FROM makeup_lessons
                 WHERE student_id = ?
                   AND makeup_type IN ('線上錄播', '課室錄播')
                   AND status = 'scheduled'
                   AND is_deleted = 0"
            )
            .bind(student_id)
            .fetch_all(&state.db)
            .await?
        };

        for mid in &makeup_ids {
            // Mark makeup as done
            sqlx::query(
                "UPDATE makeup_lessons SET status = 'done', updated_at = datetime('now') WHERE id = ? AND status = 'scheduled'"
            )
            .bind(mid)
            .execute(&state.db)
            .await?;

            // Get original class info + makeup_type to sync back the original lesson_checkin
            let mk_orig: Option<(i64, String, String)> = sqlx::query_as(
                "SELECT COALESCE(original_class_id, 0), COALESCE(lesson_num, ''), COALESCE(makeup_type, '') FROM makeup_lessons WHERE id = ?"
            )
            .bind(mid)
            .fetch_optional(&state.db)
            .await?;

            if let Some((orig_cid, lnum_str, mk_type)) = mk_orig {
                if orig_cid > 0 && !lnum_str.is_empty() {
                    if let Ok(lesson_num) = lnum_str.parse::<i32>() {
                        // Find the original lesson
                        let orig_lesson_id: Option<i64> = sqlx::query_scalar(
                            "SELECT id FROM lessons WHERE class_id = ? AND num = ? AND is_deleted = 0"
                        )
                        .bind(orig_cid)
                        .bind(lesson_num)
                        .fetch_optional(&state.db)
                        .await?;

                        if let Some(olid) = orig_lesson_id {
                            // Determine correct sync-back status from makeup_type
                            let sync_status = match mk_type.as_str() {
                                "課室錄播" => "recording_room_present".to_string(),
                                "線上錄播" => "video_makeup".to_string(),
                                _ => new_status.clone(),
                            };

                            // Find enrollment in the original class
                            let orig_enrollment: Option<i64> = sqlx::query_scalar(
                                "SELECT id FROM enrollments WHERE student_id = ? AND class_id = ? AND is_deleted = 0"
                            )
                            .bind(student_id)
                            .bind(orig_cid)
                            .fetch_optional(&state.db)
                            .await?;

                            // Get old status before updating (for attendance_log)
                            let old_orig_status: String = sqlx::query_scalar(
                                "SELECT COALESCE(status,'') FROM lesson_checkins WHERE lesson_id = ? AND student_id = ?"
                            )
                            .bind(olid)
                            .bind(student_id)
                            .fetch_optional(&state.db)
                            .await?
                            .flatten()
                            .unwrap_or_default();

                            // Upsert checkin in the original lesson
                            sqlx::query(
                                r#"INSERT INTO lesson_checkins (lesson_id, student_id, enrollment_id, status, checkin_time, source)
                                   VALUES (?, ?, ?, ?, datetime('now'), 'makeup')
                                   ON CONFLICT(lesson_id, student_id) DO UPDATE SET status = excluded.status, checkin_time = datetime('now')"#
                            )
                            .bind(olid)
                            .bind(student_id)
                            .bind(orig_enrollment)
                            .bind(&sync_status)
                            .execute(&state.db)
                            .await?;

                            // Log the change in attendance_log
                            if old_orig_status != sync_status {
                                sqlx::query(
                                    "INSERT INTO attendance_log (enrollment_id, lesson_num, old_status, new_status, created_at) VALUES (?, ?, ?, ?, datetime('now'))"
                                )
                                .bind(orig_enrollment)
                                .bind(lesson_num)
                                .bind(&old_orig_status)
                                .bind(&sync_status)
                                .execute(&state.db)
                                .await?;
                            }
                        }
                    }
                }
            }
        }
    }

    Ok(Json(json!({"ok": true})))
}

pub async fn list_makeups(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> AppResultJson {
    auth::get_current_user_id(&headers)?;

    // 1. Existing makeup_lessons
    let makeups = sqlx::query_as::<_, MakeupLesson>(
        "SELECT * FROM makeup_lessons WHERE is_deleted = 0 ORDER BY id DESC LIMIT 500"
    )
    .fetch_all(&state.db)
    .await?;

    // 2. Build set of (student_id, lesson_num) that already have a makeup
    use std::collections::{HashMap, HashSet};
    let mut makeup_keys: HashSet<String> = HashSet::new();
    for mk in &makeups {
        if let Some(lnum) = &mk.lesson_num {
            makeup_keys.insert(format!("{}_{}", mk.student_id, lnum));
        }
    }

    // 3. Absent/leave checkins without a makeup record
    #[derive(Debug, sqlx::FromRow, serde::Serialize)]
    struct AbsenteeItem {
        student_id: i64,
        class_id: i64,
        topic_name: String,
        lesson_num: String,
        absent_date: String,
        class_name: String,
        checkin_status: String,
    }
    let absentees: Vec<AbsenteeItem> = sqlx::query_as::<_, AbsenteeItem>(
        r#"SELECT DISTINCT e.student_id, c.id as class_id, COALESCE(t.name,'') as topic_name,
                  CAST(l.num AS TEXT) as lesson_num, COALESCE(l.date,'') as absent_date, c.name as class_name,
                  lc.status as checkin_status
           FROM lesson_checkins lc
           JOIN enrollments e ON lc.enrollment_id = e.id AND e.is_deleted = 0 AND e.status = 'active'
           JOIN lessons l ON lc.lesson_id = l.id AND l.is_deleted = 0
           JOIN classes c ON l.class_id = c.id AND c.is_deleted = 0
           JOIN topics t ON c.topic_id = t.id
           WHERE lc.status IN ('absent','leave')
           ORDER BY l.date DESC, c.name"#
    )
    .fetch_all(&state.db)
    .await.unwrap_or_default();

    // 4. Merge: existing makeups + virtual entries for absentees
    let mut merged: Vec<serde_json::Value> = Vec::new();
    for mk in &makeups {
        let student_info = sqlx::query_as::<_, (String,String,String,String,String)>(
            "SELECT surname, given_name, COALESCE(school,''), COALESCE(phone,''), COALESCE(parent_phone,'') FROM students WHERE id = ?"
        )
        .bind(mk.student_id)
        .fetch_optional(&state.db)
        .await?;

        let student = student_info.as_ref()
            .map(|(s,g,_,_,_)| format!("{} {}", s, g))
            .unwrap_or_else(|| format!("ID:{}", mk.student_id));
        let student_school = student_info.as_ref()
            .map(|(_,_,sc,_,_)| sc.clone())
            .unwrap_or_default();
        let student_phone = student_info.as_ref()
            .map(|(_,_,_,ph,_)| ph.clone())
            .unwrap_or_default();
        let student_parent_phone = student_info.as_ref()
            .map(|(_,_,_,_,pph)| pph.clone())
            .unwrap_or_default();

        // For waiting entries: check same lesson across similar classes
        let mut available_days: Vec<serde_json::Value> = Vec::new();
        let mut next_lesson_label: Option<String> = None;
        let mut deadline_date: Option<String> = None;
        if mk.status.as_deref() == Some("waiting") {
            // Find deadline: next regular lesson date in the original class
            if let (Some(ocid), Some(ref lnum_str)) = (mk.original_class_id, &mk.lesson_num) {
                let missed_num: i32 = lnum_str.parse().unwrap_or(0);
                let next_num = missed_num + 1;
                let deadline_info = sqlx::query_as::<_, (String, i32, Option<String>)>(
                    r#"SELECT l.date, l.num, c.week
                       FROM lessons l JOIN classes c ON l.class_id = c.id
                       WHERE l.class_id = ? AND l.num = ? AND l.is_deleted = 0 AND c.is_deleted = 0
                       LIMIT 1"#
                )
                .bind(ocid).bind(next_num)
                .fetch_optional(&state.db)
                .await?;

                if let Some((dl_date, dl_num, dl_week)) = deadline_info {
                    deadline_date = Some(dl_date.clone());
                    let time_part = dl_week.as_deref()
                        .and_then(|w| w.split(' ').nth(1))
                        .unwrap_or("");
                    let date_part = chrono::NaiveDate::parse_from_str(&dl_date, "%Y-%m-%d")
                        .ok().map(|d| d.format("%m-%d").to_string()).unwrap_or_default();
                    let dow = chrono::NaiveDate::parse_from_str(&dl_date, "%Y-%m-%d")
                        .ok().map(|d| d.format("%a").to_string()).unwrap_or_default();
                    next_lesson_label = Some(format!("第{}課 · {} ({}) {} 截止", dl_num, date_part, dow, time_part));
                }

                // Find topic_id of the original class, then all classes with same topic
                let topic_id: Option<i64> = sqlx::query_scalar(
                    "SELECT topic_id FROM classes WHERE id = ? AND is_deleted = 0"
                )
                .bind(ocid)
                .fetch_optional(&state.db)
                .await?
                .flatten();

                if let Some(tid) = topic_id {
                    let today_str = chrono::Local::now().format("%Y-%m-%d").to_string();
                    // Get all classes with same topic that have the missed lesson, ordered by date
                    let same_topic_lessons = sqlx::query_as::<_, (i64, i64, String, String, String, String)>(
                        r#"SELECT l.id, c.id, c.name, CAST(COALESCE(c.seat,0) AS TEXT), c.week, l.date
                           FROM lessons l
                           JOIN classes c ON l.class_id = c.id
                           WHERE c.topic_id = ? AND l.num = ? AND l.date >= ? AND l.is_deleted = 0 AND c.is_deleted = 0
                           AND c.name NOT LIKE '%補課%'
                           ORDER BY l.date ASC"#
                    )
                    .bind(tid).bind(missed_num).bind(&today_str)
                    .fetch_all(&state.db)
                    .await?;

                    let mut day_idx = 0usize;
                    let mut after_deadline_idx = 0usize;
                    for (lid, cid, cname, seat, week_info, date_str) in &same_topic_lessons {
                        let is_before_deadline = deadline_date.as_ref().map_or(false, |dl| date_str.as_str() < dl.as_str());
                        let label = if is_before_deadline {
                            day_idx += 1;
                            let date_part = chrono::NaiveDate::parse_from_str(date_str, "%Y-%m-%d")
                                .ok().map(|d| d.format("%m-%d").to_string()).unwrap_or_default();
                            format!("{} ({})", cname, date_part)
                        } else {
                            after_deadline_idx += 1;
                            if after_deadline_idx == 1 && day_idx > 0 {
                                format!("⬇ 第{}課後", deadline_date.as_ref().and_then(|d| {
                                    chrono::NaiveDate::parse_from_str(d, "%Y-%m-%d").ok()
                                        .map(|dd| dd.format("%m-%d").to_string())
                                }).unwrap_or_default())
                            } else {
                                let date_part = chrono::NaiveDate::parse_from_str(date_str, "%Y-%m-%d")
                                    .ok().map(|d| d.format("%m-%d").to_string()).unwrap_or_default();
                                let dow = chrono::NaiveDate::parse_from_str(date_str, "%Y-%m-%d")
                                    .ok().map(|d| d.format("%a").to_string()).unwrap_or_default();
                                format!("{} {} ({})", cname, date_part, dow)
                            }
                        };

                        // Check available seats
                        let enrolled: i64 = sqlx::query_scalar(
                            "SELECT COUNT(*) FROM enrollments WHERE class_id = ? AND is_deleted = 0 AND status = 'active'"
                        ).bind(cid).fetch_one(&state.db).await.unwrap_or(0);

                        let leave: i64 = sqlx::query_scalar(
                            "SELECT COUNT(*) FROM lesson_checkins lc JOIN enrollments e ON lc.enrollment_id = e.id WHERE lc.lesson_id = ? AND lc.status = 'leave' AND e.class_id = ? AND e.is_deleted = 0"
                        ).bind(lid).bind(cid).fetch_one(&state.db).await.unwrap_or(0);

                        let blocked: i64 = sqlx::query_scalar(
                            r#"SELECT COUNT(*) FROM enrollments e
                               WHERE e.class_id = ? AND e.is_deleted = 0 AND e.status = 'active'
                               AND EXISTS (SELECT 1 FROM lessons lp WHERE lp.class_id = ? AND lp.num = ? - 1 AND lp.is_deleted = 0
                                   AND NOT EXISTS (SELECT 1 FROM lesson_checkins lc WHERE lc.lesson_id = lp.id AND lc.student_id = e.student_id
                                       AND lc.status IN ('present','makeup','recording_room_present','video_makeup'))"#
                        ).bind(cid).bind(cid).bind(missed_num).fetch_one(&state.db).await.unwrap_or(0);

                        let pending_mk: i64 = sqlx::query_scalar(
                            "SELECT COUNT(DISTINCT student_id) FROM makeup_lessons WHERE target_lesson_id = ? AND status = 'scheduled' AND is_deleted = 0 AND makeup_type = '課室補課'"
                        ).bind(lid).fetch_one(&state.db).await.unwrap_or(0);

                        let standby: i64 = sqlx::query_scalar(
                            "SELECT COUNT(*) FROM lesson_standby WHERE class_id = ? AND status = 'waiting' AND is_deleted = 0"
                        ).bind(cid).fetch_one(&state.db).await.unwrap_or(0);

                        let available = seat.parse::<i64>().unwrap_or(0) - enrolled + leave + blocked - pending_mk - standby;
                        let time_part: String = week_info.split(' ').nth(1).unwrap_or("").to_string();

                    let is_waiting_class = mk.makeup_class.as_deref() == Some(cname.as_str());

                    available_days.push(json!({
                        "date": date_str,
                        "label": label,
                        "hasLesson": true,
                        "beforeDeadline": is_before_deadline,
                        "isWaitingClass": is_waiting_class,
                        "className": cname,
                            "time": time_part,
                            "available": available.max(0),
                            "spotAvailable": available > 0,
                            "spotText": if available > 0 { format!("有位！{} 個空位", available) } else { "未見空位".to_string() },
                        }));
                    }
                }
            }
        }

        let any_spot_available = available_days.iter().any(|d| d["spotAvailable"].as_bool().unwrap_or(false));
        let any_before_deadline = available_days.iter().any(|d| d["beforeDeadline"].as_bool().unwrap_or(false) && d["spotAvailable"].as_bool().unwrap_or(false));
        // Backward compat: pick first available day, or first day
        let first_avail = available_days.iter().find(|d| d["spotAvailable"].as_bool().unwrap_or(false))
            .or_else(|| available_days.first());
        let (spot_available, available_text, today_class, today_time) = if let Some(d) = first_avail {
            (d["spotAvailable"].as_bool().unwrap_or(false),
             d["spotText"].as_str().unwrap_or("").to_string(),
             Some(d["className"].as_str().unwrap_or("").to_string()),
             d["time"].as_str().map(|s| s.to_string()))
        } else {
            (false, String::new(), None, None)
            };

        // Look up original class name
        let original_class_name: Option<String> = if let Some(ocid) = mk.original_class_id {
            sqlx::query_scalar::<_, String>("SELECT name FROM classes WHERE id = ?")
                .bind(ocid)
                .fetch_optional(&state.db)
                .await.ok().flatten()
        } else {
            None
        };

        merged.push(json!({
            "id": mk.id,
            "studentId": mk.student_id,
            "studentName": student,
            "studentSchool": student_school,
            "studentPhone": student_phone,
            "studentParentPhone": student_parent_phone,
            "originalClassId": mk.original_class_id,
            "originalClassName": original_class_name,
            "originalTopic": mk.original_topic,
            "lessonNum": mk.lesson_num,
            "absentDate": mk.absent_date,
            "makeupType": mk.makeup_type,
            "makeupClass": mk.makeup_class,
            "targetLessonId": mk.target_lesson_id,
            "status": mk.status,
            "isVirtual": false,
            "nextLessonLabel": next_lesson_label,
            "deadlineDate": deadline_date,
            "availableDays": available_days,
            "anySpotAvailable": any_spot_available,
            "anyBeforeDeadline": any_before_deadline,
            "spotAvailable": spot_available,
            "spotText": available_text,
            "todayClass": today_class,
            "todayTime": today_time,
        }));
    }

    for ab in &absentees {
        let key = format!("{}_{}", ab.student_id, ab.lesson_num);
        if !makeup_keys.contains(&key) {
            let student_info = sqlx::query_as::<_, (String,String,String)>(
                "SELECT surname, given_name, COALESCE(school,'') FROM students WHERE id = ?"
            )
            .bind(ab.student_id)
            .fetch_optional(&state.db)
            .await?;

            let student = student_info.as_ref()
                .map(|(s,g,_)| format!("{} {}", s, g))
                .unwrap_or_else(|| format!("ID:{}", ab.student_id));
            let student_school = student_info.as_ref()
                .map(|(_,_,sc)| sc.clone())
                .unwrap_or_default();

            merged.push(json!({
                "id": -(ab.student_id),
                "studentId": ab.student_id,
                "studentName": student,
                "studentSchool": student_school,
                "originalClassId": ab.class_id,
                "originalClassName": ab.class_name,
                "originalTopic": ab.topic_name,
                "lessonNum": ab.lesson_num,
                "absentDate": ab.absent_date,
                "makeupType": serde_json::Value::Null,
                "makeupClass": ab.class_name,
                "targetLessonId": serde_json::Value::Null,
                "status": "absent",
                "checkinStatus": ab.checkin_status,
                "isVirtual": true,
            }));
        }
    }

    // 5. Next 3 days class overview
    let today = chrono::Local::now().naive_local().date();
    let mut upcoming_days: Vec<serde_json::Value> = Vec::new();
    for day_offset in 0..3 {
        let day = today + chrono::Duration::days(day_offset);
        let day_str = day.format("%Y-%m-%d").to_string();
        let day_label = if day_offset == 0 { "今日".to_string() } else if day_offset == 1 { "明日".to_string() } else { format!("{} ({})", day.format("%m-%d"), day.format("%a")) };

        let lessons_on_day = sqlx::query_as::<_, (i64, i64, String, String, i64)>(
            r#"SELECT l.id, c.id, c.name, c.week, COALESCE(c.seat,0)
               FROM lessons l JOIN classes c ON l.class_id = c.id
               WHERE l.date = ? AND l.is_deleted = 0 AND c.is_deleted = 0 AND c.name NOT LIKE '%補課%'
               ORDER BY c.week"#
        )
        .bind(&day_str)
        .fetch_all(&state.db)
        .await?;

        let mut class_list: Vec<serde_json::Value> = Vec::new();
        for (lid, cid, cname, week_info, seat) in &lessons_on_day {
            let time = week_info.split(' ').nth(1).unwrap_or("").to_string();
            let enrolled: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM enrollments WHERE class_id = ? AND is_deleted = 0 AND status = 'active'"
            ).bind(cid).fetch_one(&state.db).await.unwrap_or(0);
            let leave: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM lesson_checkins lc JOIN enrollments e ON lc.enrollment_id = e.id WHERE lc.lesson_id = ? AND lc.status = 'leave' AND e.class_id = ? AND e.is_deleted = 0"
            ).bind(lid).bind(cid).fetch_one(&state.db).await.unwrap_or(0);
            let pending_mk: i64 = sqlx::query_scalar(
                "SELECT COUNT(DISTINCT student_id) FROM makeup_lessons WHERE target_lesson_id = ? AND status = 'scheduled' AND is_deleted = 0 AND makeup_type = '課室補課'"
            ).bind(lid).fetch_one(&state.db).await.unwrap_or(0);
            let standby: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM lesson_standby WHERE class_id = ? AND status = 'waiting' AND is_deleted = 0"
            ).bind(cid).fetch_one(&state.db).await.unwrap_or(0);
            let available = seat - enrolled + leave - pending_mk;

            class_list.push(json!({
                "classId": cid,
                "lessonId": lid,
                "className": cname,
                "time": time,
                "seat": seat,
                "enrolled": enrolled,
                "leave": leave,
                "pendingMakeups": pending_mk,
                "standby": standby,
                "available": available.max(0),
                "hasSpots": available > 0,
            }));
        }

        upcoming_days.push(json!({
            "date": day_str,
            "label": day_label,
            "classes": class_list,
        }));
    }

    Ok(Json(json!({"ok": true, "data": merged, "upcomingClasses": upcoming_days})))
}

pub async fn create_makeup(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<CreateMakeup>,
) -> AppResultJson {
    let uid = auth::get_current_user_id(&headers)?;

    // Check if a makeup already exists for this student + lesson_num
    let existing: Option<(i64,)> = sqlx::query_as(
        "SELECT id FROM makeup_lessons WHERE student_id = ? AND lesson_num = ? AND is_deleted = 0"
    )
    .bind(req.student_id)
    .bind(&req.lesson_num)
    .fetch_optional(&state.db)
    .await?;

    let id = if let Some((eid,)) = existing {
        // Update existing record instead of creating duplicate
        sqlx::query(
            "UPDATE makeup_lessons SET original_class_id=?, original_topic=?, absent_date=?, makeup_type=?, makeup_class=?, target_lesson_id=?, status=?, updated_by=?, updated_at=datetime('now') WHERE id=?"
        )
        .bind(&req.original_class_id)
        .bind(&req.original_topic)
        .bind(&req.absent_date)
        .bind(&req.makeup_type)
        .bind(&req.makeup_class)
        .bind(req.target_lesson_id)
        .bind(&req.status)
        .bind(uid)
        .bind(eid)
        .execute(&state.db)
        .await?;
        eid
    } else {
        let result = sqlx::query(
            "INSERT INTO makeup_lessons (student_id, original_class_id, original_topic, lesson_num, absent_date, makeup_type, makeup_class, target_lesson_id, status, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        )
        .bind(req.student_id)
        .bind(&req.original_class_id)
        .bind(&req.original_topic)
        .bind(&req.lesson_num)
        .bind(&req.absent_date)
        .bind(&req.makeup_type)
        .bind(&req.makeup_class)
        .bind(req.target_lesson_id)
        .bind(&req.status)
        .bind(uid)
        .execute(&state.db)
        .await?;
        result.last_insert_rowid()
    };

    // Sync lesson_checkin status to reflect the new makeup arrangement
    if let (Some(status), Some(orig_cid), Some(lnum_str)) = (&req.status, req.original_class_id, &req.lesson_num) {
        let checkin_new_status = match (status.as_str(), req.makeup_type.as_deref()) {
            ("scheduled", Some("課室錄播")) => Some("scheduled_room"),
            ("scheduled", Some("線上錄播")) => Some("scheduled_video"),
            ("scheduled", _) => Some("scheduled_classroom"),
            ("waiting", _) => Some("waiting"),
            _ => None,
        };
        if let Some(new_st) = checkin_new_status {
            if let Ok(lnum) = lnum_str.parse::<i32>() {
                let old_status: Option<String> = sqlx::query_scalar(
                    r#"SELECT lc.status FROM lesson_checkins lc
                       JOIN lessons l ON lc.lesson_id = l.id
                       WHERE lc.student_id = ? AND l.class_id = ? AND l.num = ?"#
                )
                .bind(req.student_id)
                .bind(orig_cid)
                .bind(lnum)
                .fetch_optional(&state.db)
                .await?
                .flatten();

                if let Some(ref old) = old_status {
                    if old != new_st {
                        sqlx::query(
                            r#"UPDATE lesson_checkins SET status = ?
                               WHERE student_id = ? AND lesson_id IN (
                                   SELECT id FROM lessons WHERE class_id = ? AND num = ? AND is_deleted = 0
                               )"#
                        )
                        .bind(new_st)
                        .bind(req.student_id)
                        .bind(orig_cid)
                        .bind(lnum)
                        .execute(&state.db)
                        .await?;

                        // Log the change
                        sqlx::query(
                            "INSERT INTO attendance_log (enrollment_id, lesson_num, old_status, new_status, created_at) VALUES ((SELECT id FROM enrollments WHERE student_id = ? AND class_id = ? AND is_deleted = 0 LIMIT 1), ?, ?, ?, datetime('now'))"
                        )
                        .bind(req.student_id)
                        .bind(orig_cid)
                        .bind(lnum)
                        .bind(old)
                        .bind(new_st)
                        .execute(&state.db)
                        .await
                        .ok();
                    }
                } else {
                    // No existing lesson_checkin → insert one
                    let lid: Option<i64> = sqlx::query_scalar(
                        "SELECT id FROM lessons WHERE class_id = ? AND num = ? AND is_deleted = 0"
                    )
                    .bind(orig_cid)
                    .bind(lnum)
                    .fetch_optional(&state.db)
                    .await?;

                    if let Some(lid) = lid {
                        let eid: Option<i64> = sqlx::query_scalar(
                            "SELECT id FROM enrollments WHERE student_id = ? AND class_id = ? AND is_deleted = 0 LIMIT 1"
                        )
                        .bind(req.student_id)
                        .bind(orig_cid)
                        .fetch_optional(&state.db)
                        .await?;

                        sqlx::query(
                            "INSERT INTO lesson_checkins (lesson_id, student_id, enrollment_id, status, checkin_time, source) VALUES (?, ?, ?, ?, datetime('now'), 'makeup')"
                        )
                        .bind(lid)
                        .bind(req.student_id)
                        .bind(eid)
                        .bind(new_st)
                        .execute(&state.db)
                        .await?;

                        sqlx::query(
                            "INSERT INTO attendance_log (enrollment_id, lesson_num, old_status, new_status, created_at) VALUES (?, ?, '', ?, datetime('now'))"
                        )
                        .bind(eid)
                        .bind(lnum)
                        .bind(new_st)
                        .execute(&state.db)
                        .await
                        .ok();
                    }
                }
            }
        }
    }

    // Auto-enroll in recording class for 線上錄播 / 課室錄播
    const RECORDING_CLASS_ID: i64 = 8;
    if let Some(ref mk_type) = req.makeup_type {
        if (mk_type == "線上錄播" || mk_type == "課室錄播") && req.status.as_deref() == Some("scheduled") {
            // Check if student already has ANY active enrollment in class 8 (any makeup_id)
            let existing_enrollment: Option<(i64,)> = sqlx::query_as(
                "SELECT id FROM enrollments WHERE student_id = ? AND class_id = ? AND is_deleted = 0 LIMIT 1"
            )
            .bind(req.student_id)
            .bind(RECORDING_CLASS_ID)
            .fetch_optional(&state.db)
            .await?;

            if existing_enrollment.is_none() {
                sqlx::query(
                    "INSERT INTO enrollments (student_id, class_id, makeup_id, status, is_deleted, create_time, updated_at, updated_by) VALUES (?, ?, ?, 'active', 0, datetime('now'), datetime('now'), ?)"
                )
                .bind(req.student_id)
                .bind(RECORDING_CLASS_ID)
                .bind(id)
                .bind(uid)
                .execute(&state.db)
                .await?;
            }
        }
    }

    Ok(Json(json!({"ok": true, "id": id})))
}

pub async fn update_makeup(
    State(state): State<AppState>,
    headers: HeaderMap,
    axum::extract::Path(id): axum::extract::Path<i64>,
    Json(req): Json<UpdateMakeup>,
) -> AppResultJson {
    let uid = auth::get_current_user_id(&headers)?;
    if let Some(status) = &req.status {
        sqlx::query("UPDATE makeup_lessons SET status = ?, updated_at = datetime('now') WHERE id = ? AND is_deleted = 0")
            .bind(status).bind(id).execute(&state.db).await?;

        // Sync lesson_checkin when makeup status changes
        if status == "scheduled" || status == "waiting" {
            let checkin_new_st = match (status.as_str(), req.makeup_type.as_deref().unwrap_or("")) {
                ("scheduled", "課室錄播") => "scheduled_room",
                ("scheduled", "線上錄播") => "scheduled_video",
                ("scheduled", _) => "scheduled_classroom",
                ("waiting", _) => "waiting",
                _ => "",
            };
            if !checkin_new_st.is_empty() {
                let mk_base: Option<(i64, i64, String)> = sqlx::query_as(
                    "SELECT student_id, COALESCE(original_class_id,0), COALESCE(lesson_num,'') FROM makeup_lessons WHERE id = ?"
                )
                .bind(id)
                .fetch_optional(&state.db)
                .await?
                .map(|(sid, ocid, lns): (i64, i64, String)| (sid, ocid, lns));

                if let Some((sid, ocid, lns)) = mk_base {
                    if ocid > 0 && !lns.is_empty() {
                        if let Ok(lnum) = lns.parse::<i32>() {
                            sqlx::query(
                                r#"UPDATE lesson_checkins SET status = ?
                                   WHERE student_id = ? AND lesson_id IN (
                                       SELECT id FROM lessons WHERE class_id = ? AND num = ? AND is_deleted = 0
                                   ) AND status IN ('waiting','scheduled_room','scheduled_video','scheduled_classroom','leave','absent')"#
                            )
                            .bind(checkin_new_st)
                            .bind(sid)
                            .bind(ocid)
                            .bind(lnum)
                            .execute(&state.db)
                            .await?;
                        }
                    }
                }
            }
        }
    }
    if let Some(makeup_type) = &req.makeup_type {
        sqlx::query("UPDATE makeup_lessons SET makeup_type = ?, updated_at = datetime('now') WHERE id = ?")
            .bind(makeup_type).bind(id).execute(&state.db).await?;

        // Auto-enroll in class 8 when changing to recording type
        if makeup_type == "線上錄播" || makeup_type == "課室錄播" {
            // Also clear makeup_class and target_lesson_id
            sqlx::query("UPDATE makeup_lessons SET makeup_class = NULL, target_lesson_id = NULL, updated_at = datetime('now') WHERE id = ?")
                .bind(id).execute(&state.db).await?;

            let existing_enrollment: Option<(i64,)> = sqlx::query_as(
                "SELECT id FROM enrollments WHERE student_id = (SELECT student_id FROM makeup_lessons WHERE id = ?) AND class_id = 8 AND is_deleted = 0 LIMIT 1"
            )
            .bind(id)
            .fetch_optional(&state.db)
            .await?;

            if existing_enrollment.is_none() {
                sqlx::query(
                    "INSERT INTO enrollments (student_id, class_id, status, is_deleted, create_time, updated_at, updated_by) SELECT student_id, 8, 'active', 0, datetime('now'), datetime('now'), ? FROM makeup_lessons WHERE id = ?"
                )
                .bind(uid)
                .bind(id)
                .execute(&state.db)
                .await?;
            }
        }
    }
    if let Some(makeup_class) = &req.makeup_class {
        sqlx::query("UPDATE makeup_lessons SET makeup_class = ?, updated_at = datetime('now') WHERE id = ?")
            .bind(makeup_class).bind(id).execute(&state.db).await?;
    }
    if let Some(tlid) = req.target_lesson_id {
        sqlx::query("UPDATE makeup_lessons SET target_lesson_id = ?, updated_at = datetime('now') WHERE id = ?")
            .bind(tlid).bind(id).execute(&state.db).await?;
    }
    Ok(Json(json!({"ok": true})))
}

pub async fn delete_makeup(
    State(state): State<AppState>,
    headers: HeaderMap,
    axum::extract::Path(id): axum::extract::Path<i64>,
) -> AppResultJson {
    let _uid = auth::get_current_user_id(&headers)?;

    // Get student_id + makeup_type + original class info before deleting
    let mk_info: Option<(i64, Option<String>, Option<i64>, Option<String>)> = sqlx::query_as(
        "SELECT student_id, makeup_type, original_class_id, lesson_num FROM makeup_lessons WHERE id = ? AND is_deleted = 0"
    )
    .bind(id)
    .fetch_optional(&state.db)
    .await?;

    sqlx::query("UPDATE makeup_lessons SET is_deleted = 1, updated_at = datetime('now') WHERE id = ?")
        .bind(id).execute(&state.db).await?;

    // Revert lesson_checkin status back to leave/absent when deleting a pending makeup
    if let Some((sid, _, Some(orig_cid), Some(lnum_str))) = &mk_info {
        if !lnum_str.is_empty() {
            if let Ok(lnum) = lnum_str.parse::<i32>() {
                let revert_to: String = sqlx::query_scalar(
                    "SELECT old_status FROM attendance_log WHERE enrollment_id = (SELECT id FROM enrollments WHERE student_id = ? AND class_id = ? AND is_deleted = 0 LIMIT 1) AND lesson_num = ? AND new_status IN ('waiting','scheduled_room','scheduled_video','scheduled_classroom') ORDER BY id DESC LIMIT 1"
                )
                .bind(sid)
                .bind(orig_cid)
                .bind(lnum)
                .fetch_optional(&state.db)
                .await?
                .flatten()
                .unwrap_or_else(|| "leave".to_string());

                sqlx::query(
                    r#"UPDATE lesson_checkins SET status = ?
                       WHERE student_id = ? AND lesson_id IN (
                           SELECT id FROM lessons WHERE class_id = ? AND num = ? AND is_deleted = 0
                       ) AND status IN ('waiting','scheduled_room','scheduled_video','scheduled_classroom')"#
                )
                .bind(&revert_to)
                .bind(sid)
                .bind(orig_cid)
                .bind(lnum)
                .execute(&state.db)
                .await?;
            }
        }
    }

    // If recording makeup, also soft-delete the class 8 enrollment (by makeup_id)
    if let Some((_, Some(ref mk_type), _, _)) = mk_info {
        if mk_type == "線上錄播" || mk_type == "課室錄播" {
            sqlx::query(
                "UPDATE enrollments SET is_deleted = 1, updated_at = datetime('now') WHERE makeup_id = ? AND is_deleted = 0"
            )
            .bind(id)
            .execute(&state.db)
            .await?;
        }
    }

    Ok(Json(json!({"ok": true})))
}

/// Check-in a makeup: create lesson_checkin + mark as done
pub async fn checkin_makeup(
    State(state): State<AppState>,
    headers: HeaderMap,
    axum::extract::Path(id): axum::extract::Path<i64>,
) -> AppResultJson {
    let _uid = auth::get_current_user_id(&headers)?;

    // Get the makeup lesson
    let mk: Option<(i64, Option<i64>, Option<String>, Option<String>, Option<i64>)> = sqlx::query_as(
        "SELECT student_id, target_lesson_id, makeup_type, COALESCE(lesson_num,'0'), original_class_id
         FROM makeup_lessons WHERE id = ? AND is_deleted = 0"
    )
    .bind(id)
    .fetch_optional(&state.db)
    .await?;

    let (student_id, target_lesson_id, makeup_type, lesson_num, original_class_id) = match mk {
        Some(m) => m,
        None => return Ok(Json(json!({"ok": false, "error": "找不到補課記錄"}))),
    };

    // Reject direct checkin for recording makeups — use class 8 attendance grid instead
    if let Some(ref mk_type) = makeup_type {
        if mk_type == "線上錄播" || mk_type == "課室錄播" {
            return Ok(Json(json!({"ok": false, "error": "錄播補課請到補課錄播班簽到"})));
        }
    }

    // Map makeup_type → checkin status
    let checkin_status = match makeup_type.as_deref() {
        Some("線上錄播") => "video_makeup",
        Some("課室錄播") => "recording_room_present",
        _ => "makeup",
    };

    // Find enrollment for this student in the original class
    let enrollment_id: Option<i64> = if let Some(ocid) = original_class_id {
        sqlx::query_scalar(
            "SELECT id FROM enrollments WHERE student_id = ? AND class_id = ? AND is_deleted = 0 AND status = 'active'"
        )
        .bind(student_id)
        .bind(ocid)
        .fetch_optional(&state.db)
        .await?
    } else {
        // Try to find any active enrollment for this student
        sqlx::query_scalar(
            "SELECT id FROM enrollments WHERE student_id = ? AND is_deleted = 0 AND status = 'active' LIMIT 1"
        )
        .bind(student_id)
        .fetch_optional(&state.db)
        .await?
    };

    // If there's a target_lesson_id, create checkin there
    if let Some(tlid) = target_lesson_id {
        sqlx::query(
            r#"INSERT INTO lesson_checkins (lesson_id, student_id, enrollment_id, status, checkin_time, source)
               VALUES (?, ?, ?, ?, datetime('now'), 'makeup')
               ON CONFLICT(lesson_id, student_id) DO UPDATE SET status = excluded.status, checkin_time = datetime('now')"#
        )
        .bind(tlid)
        .bind(student_id)
        .bind(enrollment_id)
        .bind(checkin_status)
        .execute(&state.db)
        .await?;
    }

    // Mark makeup as done
    sqlx::query("UPDATE makeup_lessons SET status = 'done', updated_at = datetime('now') WHERE id = ?")
        .bind(id)
        .execute(&state.db)
        .await?;

    // For 課室補課: sync-back to original lesson so prerequisite check passes
    if makeup_type.as_deref() == Some("課室補課") {
        if let (Some(ocid), Some(lnum_str)) = (original_class_id, lesson_num) {
            if ocid > 0 && !lnum_str.is_empty() {
                if let Ok(lnum) = lnum_str.parse::<i32>() {
                    // Find the original lesson
                    let orig_lesson_id: Option<i64> = sqlx::query_scalar(
                        "SELECT id FROM lessons WHERE class_id = ? AND num = ? AND is_deleted = 0"
                    )
                    .bind(ocid)
                    .bind(lnum)
                    .fetch_optional(&state.db)
                    .await?;

                    if let Some(olid) = orig_lesson_id {
                        let orig_enrollment: Option<i64> = sqlx::query_scalar(
                            "SELECT id FROM enrollments WHERE student_id = ? AND class_id = ? AND is_deleted = 0"
                        )
                        .bind(student_id)
                        .bind(ocid)
                        .fetch_optional(&state.db)
                        .await?;

                        let old_orig_status: String = sqlx::query_scalar(
                            "SELECT COALESCE(status,'') FROM lesson_checkins WHERE lesson_id = ? AND student_id = ?"
                        )
                        .bind(olid)
                        .bind(student_id)
                        .fetch_optional(&state.db)
                        .await?
                        .flatten()
                        .unwrap_or_default();

                        sqlx::query(
                            r#"INSERT INTO lesson_checkins (lesson_id, student_id, enrollment_id, status, checkin_time, source)
                               VALUES (?, ?, ?, ?, datetime('now'), 'makeup')
                               ON CONFLICT(lesson_id, student_id) DO UPDATE SET status = excluded.status, checkin_time = datetime('now')"#
                        )
                        .bind(olid)
                        .bind(student_id)
                        .bind(orig_enrollment)
                        .bind(checkin_status)
                        .execute(&state.db)
                        .await?;

                        if old_orig_status != checkin_status {
                            sqlx::query(
                                "INSERT INTO attendance_log (enrollment_id, lesson_num, old_status, new_status, created_at) VALUES (?, ?, ?, ?, datetime('now'))"
                            )
                            .bind(orig_enrollment)
                            .bind(lnum)
                            .bind(&old_orig_status)
                            .bind(checkin_status)
                            .execute(&state.db)
                            .await?;
                        }
                    }
                }
            }
        }
    }

    Ok(Json(json!({"ok": true, "checkin_status": checkin_status})))
}

/// Combined list: makeup_lessons + absentees without a makeup record
pub async fn list_makeups_manage(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> AppResultJson {
    auth::get_current_user_id(&headers)?;

    // 1. Existing makeup_lessons
    let makeups = sqlx::query_as::<_, MakeupLesson>(
        "SELECT * FROM makeup_lessons WHERE is_deleted = 0 ORDER BY id DESC LIMIT 200"
    )
    .fetch_all(&state.db)
    .await?;

    // 2. Build set of (student_id, lesson_num) that already have a makeup
    use std::collections::{HashMap, HashSet};
    let mut makeup_keys: HashSet<String> = HashSet::new();
    for mk in &makeups {
        if let Some(lnum) = &mk.lesson_num {
            makeup_keys.insert(format!("{}_{}", mk.student_id, lnum));
        }
    }

    // 3. Absent/leave checkins without a makeup record
    #[derive(Debug, sqlx::FromRow, serde::Serialize)]
    struct AbsenteeItem {
        student_id: i64,
        class_id: i64,
        topic_name: String,
        lesson_num: String,
        absent_date: String,
        class_name: String,
        checkin_status: String,
    }
    let absentees: Vec<AbsenteeItem> = sqlx::query_as::<_, AbsenteeItem>(
        r#"SELECT DISTINCT e.student_id, c.id as class_id, COALESCE(t.name,'') as topic_name,
                  CAST(l.num AS TEXT) as lesson_num, l.date as absent_date, c.name as class_name,
                  lc.status as checkin_status
           FROM lesson_checkins lc
           JOIN enrollments e ON lc.enrollment_id = e.id AND e.is_deleted = 0 AND e.status = 'active'
           JOIN lessons l ON lc.lesson_id = l.id AND l.is_deleted = 0
           JOIN classes c ON l.class_id = c.id AND c.is_deleted = 0
           JOIN topics t ON c.topic_id = t.id
           WHERE lc.status IN ('absent','leave')
           ORDER BY l.date DESC, c.name"#
    )
    .fetch_all(&state.db)
    .await?;

    // 4. Merge: virtual entries for absentees not in makeup list
    let mut merged: Vec<serde_json::Value> = Vec::new();
    for mk in &makeups {
        let student_info = sqlx::query_as::<_, (String,String,String,String,String)>(
            "SELECT surname, given_name, COALESCE(school,''), COALESCE(phone,''), COALESCE(parent_phone,'') FROM students WHERE id = ?"
        )
        .bind(mk.student_id)
        .fetch_optional(&state.db)
        .await?;

        let student = student_info.as_ref()
            .map(|(s,g,_,_,_)| format!("{} {}", s, g))
            .unwrap_or_else(|| format!("ID:{}", mk.student_id));
        let student_school = student_info.as_ref()
            .map(|(_,_,sc,_,_)| sc.clone())
            .unwrap_or_default();
        let student_phone = student_info.as_ref()
            .map(|(_,_,_,ph,_)| ph.clone())
            .unwrap_or_default();
        let student_parent_phone = student_info.as_ref()
            .map(|(_,_,_,_,pph)| pph.clone())
            .unwrap_or_default();

        let original_class_name: String = if let Some(ocid) = mk.original_class_id {
            sqlx::query_scalar::<_, String>(
                "SELECT COALESCE(name, '') FROM classes WHERE id = ?"
            )
            .bind(ocid)
            .fetch_optional(&state.db)
            .await?
            .unwrap_or_default()
        } else {
            String::new()
        };

        merged.push(json!({
            "id": mk.id,
            "studentId": mk.student_id,
            "studentName": student,
            "studentSchool": student_school,
            "studentPhone": student_phone,
            "studentParentPhone": student_parent_phone,
            "originalClassId": mk.original_class_id,
            "originalClassName": original_class_name,
            "originalTopic": mk.original_topic,
            "lessonNum": mk.lesson_num,
            "absentDate": mk.absent_date,
            "makeupType": mk.makeup_type,
            "makeupClass": mk.makeup_class,
            "targetLessonId": mk.target_lesson_id,
            "status": mk.status,
            "isVirtual": false,
        }));
    }

    for ab in &absentees {
        let key = format!("{}_{}", ab.student_id, ab.lesson_num);
        if !makeup_keys.contains(&key) {
            let student_info = sqlx::query_as::<_, (String,String,String)>(
                "SELECT surname, given_name, COALESCE(school,'') FROM students WHERE id = ?"
            )
            .bind(ab.student_id)
            .fetch_optional(&state.db)
            .await?;

            let student = student_info.as_ref()
                .map(|(s,g,_)| format!("{} {}", s, g))
                .unwrap_or_else(|| format!("ID:{}", ab.student_id));
            let student_school = student_info.as_ref()
                .map(|(_,_,sc)| sc.clone())
                .unwrap_or_default();

            merged.push(json!({
                "id": -(ab.student_id),
                "studentId": ab.student_id,
                "studentName": student,
                "studentSchool": student_school,
                "originalClassId": ab.class_id,
                "originalClassName": ab.class_name,
                "originalTopic": ab.topic_name,
                "lessonNum": ab.lesson_num,
                "absentDate": ab.absent_date,
                "makeupType": serde_json::Value::Null,
                "makeupClass": ab.class_name,
                "targetLessonId": serde_json::Value::Null,
                "status": "absent",
                "checkinStatus": ab.checkin_status,
                "isVirtual": true,
            }));
        }
    }

    // 5. Available classes per class_id for inline arrangement
    let mut class_ids: Vec<i64> = merged.iter()
        .filter_map(|mk| mk.get("originalClassId").and_then(|v| v.as_i64()))
        .collect();
    class_ids.sort();
    class_ids.dedup();

    // avMap keyed by "originalClassId_lessonNum" → list of target lessons
    let mut av_map: HashMap<String, Vec<serde_json::Value>> = HashMap::new();

    #[derive(Debug, sqlx::FromRow)]
    struct AvLessonRow {
        lesson_id: i64,
        class_id: i64,
        class_name: String,
        week: String,
        lesson_num: i32,
        lesson_date: Option<String>,
        start: String,
        end: String,
        seat: i32,
        enrolled: i64,
        pending_makeups: i64,
        leave_count: i64,
        blocked_count: i64,
        waiting_count: i64,
    }

    // Build list of (originalClassId, lessonNum) pairs from merged
    let mut needed: Vec<(i64, String)> = merged.iter()
        .map(|mk| (
            mk.get("originalClassId").and_then(|v| v.as_i64()).unwrap_or(0),
            mk.get("lessonNum").and_then(|v| v.as_str()).unwrap_or("0").to_string(),
        ))
        .collect();
    needed.sort();
    needed.dedup();

    // Collect unique original class ids and their lesson nums
    let mut orig_to_lnums: HashMap<i64, Vec<String>> = HashMap::new();
    for (ocid, lnum) in &needed {
        orig_to_lnums.entry(*ocid).or_default().push(lnum.clone());
    }

    for (ocid, lnum_str) in &needed {
        let key = format!("{}_{}", ocid, lnum_str);
        let lnum_i32 = lnum_str.parse::<i32>().unwrap_or(0);
        if lnum_i32 == 0 { continue; }

        let topic_id: Option<i64> = sqlx::query_scalar("SELECT topic_id FROM classes WHERE id = ?")
            .bind(ocid)
            .fetch_optional(&state.db)
            .await?;
        if topic_id.is_none() { continue; }
        let tid = topic_id.unwrap();

        let rows = sqlx::query_as::<_, AvLessonRow>(
            r#"SELECT
                l.id as lesson_id,
                c.id as class_id,
                COALESCE(c.name,'') as class_name,
                COALESCE(c.week,'') as week,
                l.num as lesson_num,
                l.date as lesson_date,
                COALESCE(c.start,'') as start,
                COALESCE(c.end,'') as end,
                COALESCE(c.seat,0) as seat,
                COALESCE((SELECT COUNT(*) FROM enrollments WHERE class_id = c.id AND is_deleted = 0 AND status = 'active'), 0) as enrolled,
                COALESCE((SELECT COUNT(DISTINCT student_id) FROM makeup_lessons WHERE target_lesson_id = l.id AND status = 'scheduled' AND is_deleted = 0 AND makeup_type = '課室補課'), 0) as pending_makeups,
                COALESCE((SELECT COUNT(*) FROM lesson_checkins lc JOIN enrollments e ON lc.enrollment_id = e.id WHERE lc.lesson_id = l.id AND lc.status = 'leave' AND e.class_id = c.id AND e.is_deleted = 0), 0) as leave_count,
                COALESCE((SELECT COUNT(*) FROM enrollments e2 WHERE e2.class_id = c.id AND e2.is_deleted = 0 AND e2.status = 'active' AND EXISTS (SELECT 1 FROM lessons l_prev WHERE l_prev.class_id = c.id AND l_prev.num = l.num - 1 AND l_prev.is_deleted = 0 AND NOT EXISTS (SELECT 1 FROM lesson_checkins lc2 WHERE lc2.lesson_id = l_prev.id AND lc2.student_id = e2.student_id AND lc2.status IN ('present','makeup','recording_room_present','video_makeup')))), 0) as blocked_count,
                COALESCE((SELECT COUNT(*) FROM lesson_standby WHERE class_id = c.id AND status = 'waiting' AND is_deleted = 0), 0) as waiting_count
            FROM lessons l
            JOIN classes c ON l.class_id = c.id
            WHERE c.topic_id = ?
              AND c.id != ?
              AND c.is_deleted = 0
              AND c.is_completed = 0
              AND l.is_deleted = 0
              AND l.num = ?
            ORDER BY c.name, l.num"#
        )
        .bind(tid)
        .bind(ocid)
        .bind(lnum_i32)
        .fetch_all(&state.db)
        .await?;

        let av_list: Vec<serde_json::Value> = rows.into_iter().map(|r| {
            let available = r.seat as i64 - r.enrolled + r.leave_count + r.blocked_count - r.pending_makeups - r.waiting_count;
            let t = r.week.split(' ').nth(1).unwrap_or("").to_string();
            json!({
                "lessonId": r.lesson_id,
                "classId": r.class_id,
                "className": r.class_name,
                "week": r.week,
                "lessonNum": r.lesson_num,
                "lessonDate": r.lesson_date,
                "time": t,
                "seat": r.seat,
                "enrolled": r.enrolled,
                "pending": r.pending_makeups,
                "leave": r.leave_count,
                "blocked": r.blocked_count,
                "waiting": r.waiting_count,
                "available": if available > 0 { available } else { 0 },
                "full": available <= 0,
                "seatText": if available > 0 { format!("剩{}位", available) } else { "滿".to_string() },
            })
        }).collect();
        av_map.insert(key, av_list);
    }

    Ok(Json(json!({"ok": true, "data": {
        "makeups": merged,
        "avMap": av_map,
    }})))
}
#[derive(Deserialize)]
pub struct ConfirmStandbyReq {
    pub student_id: i64,
    pub standby_id: i64,
    pub class_id: i64,
}

pub async fn confirm_standby(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<ConfirmStandbyReq>,
) -> AppResultJson {
    let _uid = auth::get_current_user_id(&headers)?;

    // Check seat capacity
    let class_seat: Option<(i32,)> = sqlx::query_as(
        "SELECT seat FROM classes WHERE id = ? AND is_deleted = 0"
    )
    .bind(req.class_id)
    .fetch_optional(&state.db)
    .await?;

    if let Some((seat,)) = class_seat {
        if seat > 0 {
            let active_count: (i64,) = sqlx::query_as(
                "SELECT COUNT(*) FROM enrollments WHERE class_id = ? AND status = 'active' AND is_deleted = 0"
            )
            .bind(req.class_id)
            .fetch_one(&state.db)
            .await?;
            if active_count.0 >= seat as i64 {
                return Err(AppError::BadRequest("班級已滿額，無法確認候補".into()));
            }
        }
    }

    sqlx::query(
        "UPDATE lesson_standby SET status = 'confirmed', confirmed_at = datetime('now'), confirmed_by = 1, updated_at = datetime('now') WHERE id = ? AND is_deleted = 0"
    )
    .bind(req.standby_id)
    .execute(&state.db)
    .await?;

    let existing: Option<(i64,)> = sqlx::query_as(
        "SELECT id FROM enrollments WHERE student_id = ? AND class_id = ? AND is_deleted = 0"
    )
    .bind(req.student_id)
    .bind(req.class_id)
    .fetch_optional(&state.db)
    .await?;

    let enrollment_id = if let Some((eid,)) = existing {
        sqlx::query("UPDATE enrollments SET status = 'active', is_deleted = 0 WHERE id = ?")
            .bind(eid)
            .execute(&state.db)
            .await?;
        eid
    } else {
        let result = sqlx::query(
            "INSERT INTO enrollments (student_id, class_id, pay_status, purchase, remaining, status) VALUES (?, ?, 'paid', 12, 12, 'active')"
        )
        .bind(req.student_id)
        .bind(req.class_id)
        .execute(&state.db)
        .await?;
        result.last_insert_rowid()
    };

    sqlx::query(
        r#"INSERT OR IGNORE INTO lesson_checkins (lesson_id, student_id, enrollment_id, status, checkin_time, source)
           SELECT l.id, ?, ?, 'present', datetime('now'), 'enrolled'
           FROM lessons l
           WHERE l.class_id = ? AND l.is_deleted = 0 AND l.date <= date('now')"#
    )
    .bind(req.student_id)
    .bind(enrollment_id)
    .bind(req.class_id)
    .execute(&state.db)
    .await?;

    Ok(Json(json!({"ok": true, "enrollment_id": enrollment_id})))
}

#[derive(serde::Serialize)]
pub struct StandbyListItem {
    standby_id: i64,
    student_id: i64,
    student_name: String,
    student_school: String,
    class_id: i64,
    class_name: String,
    status: String,
    trigger_time: String,
}

pub async fn list_standby(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> AppResultJson {
    auth::get_current_user_id(&headers)?;

    let items = sqlx::query_as::<_, (i64, i64, i64, String, String, String)>(
        r#"SELECT ls.id, ls.student_id, ls.class_id, ls.status, ls.trigger_time, c.name
           FROM lesson_standby ls
           JOIN classes c ON ls.class_id = c.id
           WHERE ls.is_deleted = 0 AND ls.status = 'waiting'
           ORDER BY ls.trigger_time DESC"#
    )
    .fetch_all(&state.db)
    .await?;

    let mut result: Vec<serde_json::Value> = Vec::new();
    for (sid, student_id, class_id, status, trigger_time, class_name) in items {
        let student_info = sqlx::query_as::<_, (String, String, String)>(
            "SELECT surname, given_name, COALESCE(school,'') FROM students WHERE id = ?"
        )
        .bind(student_id)
        .fetch_optional(&state.db)
        .await?
        .unwrap_or(("?".into(), "".into(), "".into()));

        result.push(json!({
            "standbyId": sid,
            "studentId": student_id,
            "studentName": format!("{} {}", student_info.0, student_info.1),
            "studentSchool": student_info.2,
            "classId": class_id,
            "className": class_name,
            "status": status,
            "triggerTime": trigger_time,
        }));
    }

    Ok(Json(json!({"ok": true, "data": result})))
}

// ─── Class standby students (for dashboard class card click) ─────────

pub async fn class_standby_students(
    State(state): State<AppState>,
    Path(class_id): Path<i64>,
    headers: HeaderMap,
) -> AppResultJson {
    auth::get_current_user_id(&headers)?;

    let items = sqlx::query_as::<_, (i64, i64, String, String)>(
        r#"SELECT ls.id, ls.student_id, ls.status, ls.trigger_time
           FROM lesson_standby ls
           WHERE ls.class_id = ? AND ls.is_deleted = 0 AND ls.status = 'waiting'
           ORDER BY ls.trigger_time DESC"#
    )
    .bind(class_id)
    .fetch_all(&state.db)
    .await?;

    let mut result: Vec<serde_json::Value> = Vec::new();
    for (sid, student_id, status, trigger_time) in items {
        let student_info = sqlx::query_as::<_, (String, String, String)>(
            "SELECT surname, given_name, COALESCE(school,'') FROM students WHERE id = ?"
        )
        .bind(student_id)
        .fetch_optional(&state.db)
        .await?
        .unwrap_or(("?".into(), "".into(), "".into()));

        result.push(json!({
            "standbyId": sid,
            "studentId": student_id,
            "studentName": format!("{} {}", student_info.0, student_info.1),
            "studentSchool": student_info.2,
            "status": status,
            "triggerTime": trigger_time,
        }));
    }

    Ok(Json(json!({"ok": true, "data": result})))
}

// ─── QR Scanner: email-based checkin (no auth) ───────────────────────────

#[derive(Deserialize)]
pub struct QrEmailReq {
    pub email: String,
    pub lesson_id: Option<i64>,
}

pub async fn qr_checkin(
    State(state): State<AppState>,
    Json(req): Json<QrEmailReq>,
) -> AppResultJson {
    // 1. Determine lesson_id: from request (PDA) or from active scan session (desktop scanner)
    let lesson_id = match req.lesson_id {
        Some(lid) => lid,
        None => {
            let session: Option<(i64, i64)> = sqlx::query_as(
                "SELECT id, lesson_id FROM scan_sessions WHERE active = 1 ORDER BY started_at DESC LIMIT 1"
            )
            .fetch_optional(&state.db)
            .await?;
            match session {
                Some((_, lid)) => lid,
                None => return Ok(Json(json!({"ok": false, "error": "沒有進行中的掃碼時段"}))),
            }
        }
    };

    // 2. Find student by email
    let student: Option<(i64, String, String)> = sqlx::query_as(
        "SELECT id, surname, given_name FROM students WHERE email = ? AND is_deleted = 0"
    )
    .bind(&req.email)
    .fetch_optional(&state.db)
    .await?;

    let (stu_id, _, _) = match student {
        Some(s) => s,
        None => return Ok(Json(json!({"ok": false, "error": "找不到此電郵的學生"}))),
    };

    // 3. Find enrollment for this student in the lesson's class
    let enrollment: Option<(i64,)> = sqlx::query_as(
        r#"SELECT e.id FROM enrollments e
           JOIN lessons l ON l.id = ? AND l.is_deleted = 0
           WHERE e.student_id = ? AND e.class_id = l.class_id AND e.is_deleted = 0"#
    )
    .bind(lesson_id)
    .bind(stu_id)
    .fetch_optional(&state.db)
    .await?;

    // Check if already checked in
    let existing_status: Option<String> = sqlx::query_scalar(
        "SELECT status FROM lesson_checkins WHERE lesson_id = ? AND student_id = ?"
    )
    .bind(lesson_id)
    .bind(stu_id)
    .fetch_optional(&state.db)
    .await?;

    let already = matches!(existing_status.as_deref(), Some("present") | Some("makeup") | Some("recording_room_present") | Some("video_makeup"));

    // Find student name
    let student_info = sqlx::query_as::<_, (String, String)>(
        "SELECT surname, given_name FROM students WHERE id = ?"
    )
    .bind(stu_id)
    .fetch_optional(&state.db)
    .await?;
    let student_name = student_info.map(|(s, g)| format!("{} {}", s, g)).unwrap_or_default();

    if existing_status.is_some() {
        return Ok(Json(json!({"ok": true, "data": {
            "studentId": stu_id,
            "name": student_name,
            "status": existing_status,
            "already": true,
        }})));
    }

    if let Some((eid,)) = enrollment {
        // 4a. Enrolled student: upsert checkin as present
        sqlx::query(
            r#"INSERT INTO lesson_checkins (lesson_id, student_id, enrollment_id, status, checkin_time, source)
               VALUES (?, ?, ?, 'present', datetime('now'), 'enrolled')
               ON CONFLICT(lesson_id, student_id) DO UPDATE SET status = 'present', checkin_time = datetime('now')"#
        )
        .bind(lesson_id)
        .bind(stu_id)
        .bind(eid)
        .execute(&state.db)
        .await?;

        // Cancel any pending makeup for this student+lesson (same logic as update_checkin)
        let pending_mk: Vec<(i64, Option<String>)> = sqlx::query_as(
            r#"SELECT mk.id, mk.makeup_type
               FROM makeup_lessons mk
               WHERE mk.student_id = ? AND mk.status IN ('waiting', 'scheduled')
                 AND mk.is_deleted = 0
                 AND (mk.target_lesson_id = ? OR (
                   mk.original_class_id = (SELECT class_id FROM lessons WHERE id = ?)
                   AND mk.lesson_num = CAST((SELECT num FROM lessons WHERE id = ?) AS TEXT)
                 ))"#
        )
        .bind(stu_id)
        .bind(lesson_id)
        .bind(lesson_id)
        .bind(lesson_id)
        .fetch_all(&state.db)
        .await?;

        for (mk_id, mk_type) in &pending_mk {
            sqlx::query("UPDATE makeup_lessons SET is_deleted = 1, updated_at = datetime('now') WHERE id = ?")
                .bind(mk_id).execute(&state.db).await?;
            if let Some(ref t) = mk_type {
                if t == "線上錄播" || t == "課室錄播" {
                    sqlx::query("UPDATE enrollments SET is_deleted = 1, updated_at = datetime('now') WHERE makeup_id = ? AND is_deleted = 0")
                        .bind(mk_id).execute(&state.db).await.ok();
                }
            }
        }
    } else {
        // 4b. Check if student has a scheduled makeup for this lesson
        let makeup: Option<(i64,)> = sqlx::query_as(
            "SELECT id FROM makeup_lessons
             WHERE student_id = ? AND target_lesson_id = ? AND status = 'scheduled' AND is_deleted = 0
             LIMIT 1"
        )
        .bind(stu_id)
        .bind(lesson_id)
        .fetch_optional(&state.db)
        .await?;

        match makeup {
            Some((mk_id,)) => {
                // Makeup student: create checkin with source='makeup' and mark makeup as done
                sqlx::query(
                    r#"INSERT INTO lesson_checkins (lesson_id, student_id, status, checkin_time, source)
                       VALUES (?, ?, 'makeup', datetime('now'), 'makeup')
                       ON CONFLICT(lesson_id, student_id) DO UPDATE SET status = 'makeup', checkin_time = datetime('now')"#
                )
                .bind(lesson_id)
                .bind(stu_id)
                .execute(&state.db)
                .await?;

                sqlx::query("UPDATE makeup_lessons SET status = 'done', updated_at = datetime('now') WHERE id = ?")
                    .bind(mk_id)
                    .execute(&state.db)
                    .await?;
            }
            None => return Ok(Json(json!({"ok": false, "error": "該學生未報讀此課程"}))),
        }
    }

    Ok(Json(json!({"ok": true, "data": {"studentId": stu_id, "name": student_name, "status": "present", "already": false}})))
}

// ─── Hardware Scanner: form-encoded body, plain text response ──────────

/// Scanner sends:
///   Content-Type: text/html; charset=UTF-8
///   Body: vgdecoderesult=student@email.com&&devicenumber=SCANNER01&&otherparams=
/// Response: code=0000 (success) or code=0001~0008 (error + voice prompt)
pub async fn scanner_checkin(
    State(state): State<AppState>,
    body: String,
) -> impl IntoResponse {
    let mut email = String::new();
    let mut _device = String::new();

    for part in body.split("&&") {
        if let Some((k, v)) = part.split_once('=') {
            match k.trim() {
                "vgdecoderesult" => email = v.trim().to_string(),
                "devicenumber" => _device = v.trim().to_string(),
                _ => {}
            }
        }
    }

    if email.is_empty() {
        return (StatusCode::OK, "code=0005");
    }

    // lesson_id from active scan session
    let lesson_id: i64 = match sqlx::query_scalar(
        "SELECT lesson_id FROM scan_sessions WHERE active = 1 ORDER BY started_at DESC LIMIT 1"
    )
    .fetch_optional(&state.db)
    .await
    {
        Ok(Some(lid)) => lid,
        _ => return (StatusCode::OK, "code=0002"),
    };

    // Find student
    let (stu_id, _, _) = match sqlx::query_as::<_, (i64, String, String)>(
        "SELECT id, surname, given_name FROM students WHERE email = ? AND is_deleted = 0"
    )
    .bind(&email)
    .fetch_optional(&state.db)
    .await
    {
        Ok(Some(s)) => s,
        _ => return (StatusCode::OK, "code=0001"),
    };

    // Already checked in?
    let existing: Option<String> = sqlx::query_scalar(
        "SELECT status FROM lesson_checkins WHERE lesson_id = ? AND student_id = ?"
    )
    .bind(lesson_id)
    .bind(stu_id)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten();

    if let Some(ref status) = existing {
        let already = matches!(
            status.as_str(),
            "present" | "makeup" | "recording_room_present" | "video_makeup"
        );
        if already || !status.is_empty() {
            return (StatusCode::OK, "code=0004");
        }
    }

    // Enrolled?
    let enrollment: Option<(i64,)> = sqlx::query_as(
        r#"SELECT e.id FROM enrollments e
           JOIN lessons l ON l.id = ? AND l.is_deleted = 0
           WHERE e.student_id = ? AND e.class_id = l.class_id AND e.is_deleted = 0"#
    )
    .bind(lesson_id)
    .bind(stu_id)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten();

    if let Some((eid,)) = enrollment {
        let result = sqlx::query(
            r#"INSERT INTO lesson_checkins (lesson_id, student_id, enrollment_id, status, checkin_time, source)
               VALUES (?, ?, ?, 'present', datetime('now'), 'scanner')
               ON CONFLICT(lesson_id, student_id) DO UPDATE SET status = 'present', checkin_time = datetime('now')"#
        )
        .bind(lesson_id)
        .bind(stu_id)
        .bind(eid)
        .execute(&state.db)
        .await;

        return match result {
            Ok(_) => (StatusCode::OK, "code=0000"),
            Err(_) => (StatusCode::OK, "code=0005"),
        };
    }

    // Makeup?
    let makeup: Option<(i64,)> = sqlx::query_as(
        "SELECT id FROM makeup_lessons
         WHERE student_id = ? AND target_lesson_id = ? AND status = 'scheduled' AND is_deleted = 0
         LIMIT 1"
    )
    .bind(stu_id)
    .bind(lesson_id)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten();

    if let Some((mk_id,)) = makeup {
        if sqlx::query(
            r#"INSERT INTO lesson_checkins (lesson_id, student_id, status, checkin_time, source)
               VALUES (?, ?, 'makeup', datetime('now'), 'scanner')
               ON CONFLICT(lesson_id, student_id) DO UPDATE SET status = 'makeup', checkin_time = datetime('now')"#
        )
        .bind(lesson_id)
        .bind(stu_id)
        .execute(&state.db)
        .await
        .is_err()
        {
            return (StatusCode::OK, "code=0005");
        }

        let _ = sqlx::query(
            "UPDATE makeup_lessons SET status = 'done', updated_at = datetime('now') WHERE id = ?"
        )
        .bind(mk_id)
        .execute(&state.db)
        .await;

        return (StatusCode::OK, "code=0000");
    }

    (StatusCode::OK, "code=0003")
}

// ─── Scan Session Management (auth required) ────────────────────────────

#[derive(Deserialize)]
pub struct ScanStartReq {
    pub lesson_id: i64,
}

pub async fn scan_start(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<ScanStartReq>,
) -> AppResultJson {
    auth::get_current_user_id(&headers)?;

    // Stop any existing active sessions first
    sqlx::query(
        "UPDATE scan_sessions SET active = 0, stopped_at = datetime('now') WHERE active = 1"
    )
    .execute(&state.db)
    .await?;

    let result = sqlx::query(
        "INSERT INTO scan_sessions (lesson_id) VALUES (?)"
    )
    .bind(req.lesson_id)
    .execute(&state.db)
    .await?;

    Ok(Json(json!({"ok": true, "session_id": result.last_insert_rowid()})))
}

pub async fn scan_stop(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> AppResultJson {
    auth::get_current_user_id(&headers)?;

    sqlx::query(
        "UPDATE scan_sessions SET active = 0, stopped_at = datetime('now') WHERE active = 1"
    )
    .execute(&state.db)
    .await?;

    Ok(Json(json!({"ok": true})))
}

pub async fn scan_active(
    State(state): State<AppState>,
) -> AppResultJson {
    let session: Option<(i64, i64)> = sqlx::query_as(
        "SELECT id, lesson_id FROM scan_sessions WHERE active = 1 ORDER BY started_at DESC LIMIT 1"
    )
    .fetch_optional(&state.db)
    .await?;

    match session {
        Some((sid, lid)) => Ok(Json(json!({"ok": true, "active": true, "session_id": sid, "lesson_id": lid}))),
        None => Ok(Json(json!({"ok": true, "active": false}))),
    }
}

// ─── Daily attendance: lessons & students for a given date ──────────

#[derive(Deserialize)]
pub struct DailyQuery {
    pub date: String,
}

// ─── Toggle homework_done for a student in a lesson ─────────────

#[derive(Deserialize)]
pub struct ToggleHomework {
    pub lesson_id: i64,
    pub student_id: i64,
    pub done: bool,
}

pub async fn toggle_homework(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<ToggleHomework>,
) -> AppResultJson {
    auth::get_current_user_id(&headers)?;
    
    let hw_value: i32 = if req.done { 1 } else { 0 };
    
    // Upsert: insert checkin with homework_done or update existing
    sqlx::query(
        r#"INSERT INTO lesson_checkins (lesson_id, student_id, homework_done, status, source, checkin_time, created_at)
           VALUES (?, ?, ?, '', '', datetime('now'), datetime('now'))
           ON CONFLICT(lesson_id, student_id) DO UPDATE SET homework_done = excluded.homework_done"#
    )
    .bind(req.lesson_id)
    .bind(req.student_id)
    .bind(hw_value)
    .execute(&state.db)
    .await?;

    Ok(Json(json!({"ok": true})))
}


// ─── Available lessons for makeup arrangement (per-lesson seat info) ──

#[derive(Deserialize)]
pub struct AvailableQuery {
    pub class_id: i64,
    pub lesson_num: i32,
}

pub async fn available_lessons(
    State(state): State<AppState>,
    headers: HeaderMap,
    axum::extract::Query(q): axum::extract::Query<AvailableQuery>,
) -> AppResultJson {
    auth::get_current_user_id(&headers)?;

    #[derive(Debug, sqlx::FromRow)]
    struct AvLessonRow {
        lesson_id: i64,
        class_id: i64,
        class_name: String,
        week: String,
        lesson_num: i32,
        lesson_date: Option<String>,
        start: String,
        end: String,
        seat: i32,
        enrolled: i64,
        pending_makeups: i64,
        leave_count: i64,
        blocked_count: i64,
        waiting_count: i64,
    }

    let topic_id: Option<i64> = sqlx::query_scalar("SELECT topic_id FROM classes WHERE id = ?")
        .bind(q.class_id)
        .fetch_optional(&state.db)
        .await?;

    let results: Vec<serde_json::Value> = if let Some(tid) = topic_id {
        let rows = sqlx::query_as::<_, AvLessonRow>(
            r#"SELECT
                l.id as lesson_id,
                c.id as class_id,
                COALESCE(c.name,'') as class_name,
                COALESCE(c.week,'') as week,
                l.num as lesson_num,
                l.date as lesson_date,
                COALESCE(c.start,'') as start,
                COALESCE(c.end,'') as end,
                COALESCE(c.seat,0) as seat,
                COALESCE((SELECT COUNT(*) FROM enrollments WHERE class_id = c.id AND is_deleted = 0 AND status = 'active'), 0) as enrolled,
                COALESCE((SELECT COUNT(DISTINCT student_id) FROM makeup_lessons WHERE target_lesson_id = l.id AND status = 'scheduled' AND is_deleted = 0 AND makeup_type = '課室補課'), 0) as pending_makeups,
                COALESCE((SELECT COUNT(*) FROM lesson_checkins lc JOIN enrollments e ON lc.enrollment_id = e.id WHERE lc.lesson_id = l.id AND lc.status = 'leave' AND e.class_id = c.id AND e.is_deleted = 0), 0) as leave_count,
                COALESCE((SELECT COUNT(*) FROM enrollments e2 WHERE e2.class_id = c.id AND e2.is_deleted = 0 AND e2.status = 'active' AND EXISTS (SELECT 1 FROM lessons l_prev WHERE l_prev.class_id = c.id AND l_prev.num = l.num - 1 AND l_prev.is_deleted = 0 AND NOT EXISTS (SELECT 1 FROM lesson_checkins lc2 WHERE lc2.lesson_id = l_prev.id AND lc2.student_id = e2.student_id AND lc2.status IN ('present','makeup','recording_room_present','video_makeup')))), 0) as blocked_count,
                COALESCE((SELECT COUNT(*) FROM lesson_standby WHERE class_id = c.id AND status = 'waiting' AND is_deleted = 0), 0) as waiting_count
            FROM lessons l
            JOIN classes c ON l.class_id = c.id
            WHERE c.topic_id = ?
              AND c.is_deleted = 0
              AND c.is_completed = 0
              AND l.is_deleted = 0
              AND l.num = ?
            ORDER BY c.name, l.num"#
        )
        .bind(tid)
        .bind(q.lesson_num)
        .fetch_all(&state.db)
        .await
        .unwrap_or_default();

        rows.into_iter().map(|r| {
            let available = r.seat as i64 - r.enrolled + r.leave_count + r.blocked_count - r.pending_makeups - r.waiting_count;
            let time_from_week = r.week.split(' ').nth(1).unwrap_or("").to_string();
            json!({
                "lessonId": r.lesson_id,
                "classId": r.class_id,
                "className": r.class_name,
                "week": r.week,
                "lessonNum": r.lesson_num,
                "lessonDate": r.lesson_date,
                "time": time_from_week.clone(),
                "seat": r.seat,
                "enrolled": r.enrolled,
                "pending": r.pending_makeups,
                "leave": r.leave_count,
                "blocked": r.blocked_count,
                "waiting": r.waiting_count,
                "available": if available > 0 { available } else { 0 },
                "full": available <= 0,
                "seatText": if available > 0 { format!("剩{}位", available) } else { "滿".to_string() },
            })
        }).collect()
    } else {
        Vec::new()
    };

    Ok(Json(json!({"ok": true, "data": results})))
}

pub async fn daily_checkin(
    State(state): State<AppState>,
    headers: HeaderMap,
    axum::extract::Query(q): axum::extract::Query<DailyQuery>,
) -> AppResultJson {
    auth::get_current_user_id(&headers)?;

    // Get all lessons on this date with class info (matching old Tera template)
    #[derive(sqlx::FromRow, serde::Serialize)]
    #[serde(rename_all = "camelCase")]
    struct LessonWithClass {
        lesson_id: i64,
        class_id: i64,
        num: i32,
        date: String,
        class_name: String,
        week: String,
        time: String,
        class_seat: Option<i32>,
        class_type: String,
    }

    let lessons = sqlx::query_as::<_, LessonWithClass>(
        r#"SELECT l.id as lesson_id, l.class_id, l.num, l.date, c.name as class_name,
                  COALESCE(c.week,'') as week, COALESCE(c.start,'') || '-' || COALESCE(c.end,'') as time,
                  c.seat as class_seat, COALESCE(t.type,'') as class_type
           FROM lessons l
           JOIN classes c ON l.class_id = c.id
           LEFT JOIN topics t ON c.topic_id = t.id
           WHERE l.date = ? AND l.is_deleted = 0 AND c.is_deleted = 0
           ORDER BY c.name, l.num"#
    )
    .bind(&q.date)
    .fetch_all(&state.db)
    .await?;

    // Auto-create a lesson for 補課錄播班 if none exists for this date
    let has_recording_lesson = lessons.iter().any(|l| l.class_id == 8);
    if !has_recording_lesson {
        let max_num: Option<i32> = sqlx::query_scalar(
            "SELECT COALESCE(MAX(num), 0) FROM lessons WHERE class_id = 8 AND is_deleted = 0"
        )
        .fetch_one(&state.db)
        .await?;
        let next_num = max_num.unwrap_or(0) + 1;
        sqlx::query(
            "INSERT INTO lessons (class_id, num, date, start, end, status, is_deleted, updated_at, updated_by) VALUES (8, ?, ?, '09:00', '18:00', '正常', 0, datetime('now'), 1)"
        )
        .bind(next_num)
        .bind(&q.date)
        .execute(&state.db)
        .await?;
    }

    // Re-fetch lessons to include auto-created recording lesson
    let lessons = sqlx::query_as::<_, LessonWithClass>(
        r#"SELECT l.id as lesson_id, l.class_id, l.num, l.date, c.name as class_name,
                  COALESCE(c.week,'') as week, COALESCE(c.start,'') || '-' || COALESCE(c.end,'') as time,
                  c.seat as class_seat, COALESCE(t.type,'') as class_type
           FROM lessons l
           JOIN classes c ON l.class_id = c.id
           LEFT JOIN topics t ON c.topic_id = t.id
           WHERE l.date = ? AND l.is_deleted = 0 AND c.is_deleted = 0
           ORDER BY c.name, l.num"#
    )
    .bind(&q.date)
    .fetch_all(&state.db)
    .await?;

    // Student name + school lookup
    let all_students = sqlx::query_as::<_, crate::models::Student>(
        "SELECT * FROM students WHERE is_deleted = 0"
    )
    .fetch_all(&state.db)
    .await.unwrap_or_default();

    use std::collections::{HashMap, HashSet};
    let mut student_names: HashMap<i64, String> = HashMap::new();
    let mut student_school: HashMap<i64, String> = HashMap::new();
    let mut student_phone: HashMap<i64, String> = HashMap::new();
    let mut student_email: HashMap<i64, String> = HashMap::new();
    let mut student_note: HashMap<i64, String> = HashMap::new();
    for st in &all_students {
        student_names.insert(st.id, format!("{} {}", st.surname, st.given_name));
        student_school.insert(st.id, st.school.clone().unwrap_or_default());
        student_phone.insert(st.id, st.phone.clone().unwrap_or_default());
        student_email.insert(st.id, st.email.clone().unwrap_or_default());
        student_note.insert(st.id, st.note.clone().unwrap_or_default());
    }

    // Pay status per student per class
    let mut pay_status_map: HashMap<String, String> = HashMap::new();
    let enrollment_raw = sqlx::query_as::<_, (i64, i64, String)>(
        "SELECT e.student_id, e.class_id, e.pay_status FROM enrollments e WHERE e.is_deleted = 0 AND e.status = 'active'"
    )
    .fetch_all(&state.db)
    .await.unwrap_or_default();
    for (sid, cid, ps) in &enrollment_raw {
        pay_status_map.insert(format!("{}_{}", sid, cid), ps.clone());
    }

    // Get existing checkins for these lessons
    let mut checkin_map: HashMap<String, (String, String, String, i32)> = HashMap::new(); // "lessonId_studentId" -> (status, source, checkin_time, homework_done)
    if !lessons.is_empty() {
        let lesson_ids: Vec<i64> = lessons.iter().map(|l| l.lesson_id).collect();
        let ph: Vec<String> = lesson_ids.iter().map(|_| "?".to_string()).collect();
        let sql = format!(
            "SELECT lc.lesson_id, lc.student_id, lc.status, lc.source, COALESCE(lc.checkin_time,''), COALESCE(lc.homework_done,1)
             FROM lesson_checkins lc WHERE lc.lesson_id IN ({})",
            ph.join(",")
        );
        let mut qq = sqlx::query_as::<_, (i64, i64, String, String, String, i32)>(&sql);
        for lid in &lesson_ids { qq = qq.bind(lid); }
        let raw = qq.fetch_all(&state.db).await.unwrap_or_default();
        for (lid, sid, st, src, ctime, hw) in &raw {
            checkin_map.insert(format!("{}_{}", lid, sid), (st.clone(), src.clone(), ctime.clone(), *hw));
        }
    }

    // Build lesson_by_class: class_id -> [lessons]
    let mut lesson_by_class: HashMap<i64, Vec<&LessonWithClass>> = HashMap::new();
    let mut lesson_num_map: HashMap<i64, HashMap<i32, i64>> = HashMap::new();
    for l in &lessons {
        lesson_by_class.entry(l.class_id).or_default().push(l);
        lesson_num_map.entry(l.class_id).or_default().insert(l.num, l.lesson_id);
    }

    // Build result: for each unique class, get enrolled students + their checkins per lesson
    let mut seen_cids: HashSet<i64> = HashSet::new();
    let mut result = Vec::new();

    for l in &lessons {
        if seen_cids.contains(&l.class_id) { continue; }
        seen_cids.insert(l.class_id);

        let mut enrolled: Vec<(i64,)>;
        let mut makeup_source: HashMap<i64, serde_json::Value> = HashMap::new();

        if l.class_id == 8 {
            // 補課錄播班: query pending recording makeups instead of enrollments
            let raw = sqlx::query_as::<_, (i64, i64, Option<i64>, Option<String>, Option<String>, Option<String>, Option<String>, Option<String>)>(
                "SELECT ml.student_id, ml.id, ml.original_class_id, ml.original_topic, ml.lesson_num, ml.absent_date, ml.makeup_type, ml.status
                 FROM makeup_lessons ml
                 WHERE ml.makeup_type IN ('線上錄播', '課室錄播')
                   AND ml.status = 'scheduled'
                   AND ml.is_deleted = 0"
            )
            .fetch_all(&state.db)
            .await.unwrap_or_default();

            enrolled = raw.iter().map(|(sid, _, _, _, _, _, _, _)| (*sid,)).collect();
            for (sid, mid, ocid, otopic, lnum, adate, mktype, mkstatus) in &raw {
                let orig_class_name = if let Some(oid) = ocid {
                    sqlx::query_scalar::<_, Option<String>>("SELECT name FROM classes WHERE id = ?")
                        .bind(oid).fetch_optional(&state.db).await.unwrap_or_default().flatten().unwrap_or_default()
                } else { String::new() };
                makeup_source.insert(*sid, json!({
                    "makeup_id": mid,
                    "original_class": orig_class_name,
                    "original_class_id": ocid,
                    "original_topic": otopic,
                    "lesson_num": lnum,
                    "absent_date": adate,
                    "makeup_type": mktype,
                    "status": mkstatus,
                }));
            }
        } else {
            enrolled = sqlx::query_as::<_, (i64,)>(
                "SELECT student_id FROM enrollments WHERE class_id = ? AND is_deleted = 0 AND status = 'active'"
            )
            .bind(l.class_id)
            .fetch_all(&state.db)
            .await.unwrap_or_default();
        }

        let class_lessons = lesson_by_class.get(&l.class_id).unwrap();
        let mut lessons_json = Vec::new();

        // Also include students doing makeup at this class (target_lesson_id matches any lesson in this class)
        if l.class_id != 8 {
            let mk_students = sqlx::query_as::<_, (i64, i64, Option<i64>, Option<String>, Option<String>, Option<String>, Option<String>, Option<String>)>(
                "SELECT ml.student_id, ml.id, ml.original_class_id, ml.original_topic, ml.lesson_num, ml.absent_date, ml.makeup_type, ml.status
                 FROM makeup_lessons ml
                 WHERE (ml.target_lesson_id IN (SELECT id FROM lessons WHERE class_id = ? AND is_deleted = 0)
                        OR ml.makeup_class = (SELECT COALESCE(name, '') FROM classes WHERE id = ?))
                   AND ml.is_deleted = 0 AND ml.status IN ('scheduled', 'waiting')"
            )
            .bind(l.class_id)
            .bind(l.class_id)
            .fetch_all(&state.db)
            .await.unwrap_or_default();

            for (sid, mid, ocid, otopic, lnum, adate, mktype, mkstatus) in &mk_students {
                    if !enrolled.iter().any(|(eid,)| eid == sid) {
                        enrolled.push((*sid,));
                    }
                    if !makeup_source.contains_key(sid) {
                        let orig_class_name = if let Some(oid) = ocid {
                            sqlx::query_scalar::<_, Option<String>>("SELECT name FROM classes WHERE id = ?")
                                .bind(oid).fetch_optional(&state.db).await.unwrap_or_default().flatten().unwrap_or_default()
                        } else { String::new() };
                        makeup_source.insert(*sid, json!({
                            "makeup_id": mid,
                            "original_class": orig_class_name,
                            "original_class_id": ocid,
                            "original_topic": otopic,
                            "lesson_num": lnum,
                            "absent_date": adate,
                            "makeup_type": mktype,
                            "status": mkstatus,
                        }));
                    }
                }
        }

        for cl in class_lessons {
            let mut students_json = Vec::new();
            for (sid,) in &enrolled {
                let sname = student_names.get(sid).cloned().unwrap_or_else(|| format!("ID:{}", sid));
                let school = student_school.get(sid).cloned().unwrap_or_default();
                let phone = student_phone.get(sid).cloned().unwrap_or_default();
                let email = student_email.get(sid).cloned().unwrap_or_default();
                let note = student_note.get(sid).cloned().unwrap_or_default();
                let pay_key = format!("{}_{}", sid, l.class_id);
                let pay_status = pay_status_map.get(&pay_key).cloned().unwrap_or_default();
                let ck_key = format!("{}_{}", cl.lesson_id, sid);
                let (status, mut source, checkin_time, homework_done) = checkin_map.get(&ck_key)
                    .cloned()
                    .unwrap_or_else(|| (String::new(), String::new(), String::new(), 1));

                // For makeup students without a checkin, mark source as 'makeup'
                if source.is_empty() && makeup_source.contains_key(sid) {
                    source = "makeup".to_string();
                }

                // Blocked detection: previous lesson not present/late
                // 補課錄播班 (class 8) 是特別班，不需順序檢查
                let blocked = if l.class_id == 8 {
                    false
                } else if cl.num > 1 {
                    if let Some(num_map) = lesson_num_map.get(&cl.class_id) {
                        if let Some(prev_lid) = num_map.get(&(cl.num - 1)) {
                            let prev_key = format!("{}_{}", prev_lid, sid);
                            let (prev_st, _, _, _) = checkin_map.get(&prev_key)
                                .cloned()
                                .unwrap_or_else(|| (String::new(), String::new(), String::new(), 1));
                            let is_prev_completed = matches!(
                                prev_st.as_str(),
                                "present" | "makeup" | "recording_room_present" | "video_makeup"
                            );
                            prev_st != "" && !is_prev_completed
                        } else { false }
                    } else { false }
                } else { false };

                // Locked: this lesson can't be edited because a later lesson already has data
                let locked = if l.class_id == 8 {
                    false
                } else {
                    let max_num = class_lessons.iter()
                        .filter(|other| other.num > cl.num)
                        .filter_map(|other| {
                            let key = format!("{}_{}", other.lesson_id, sid);
                            checkin_map.get(&key)
                        })
                        .any(|(st, _, _, _)| !st.is_empty());
                    max_num
                };

                let mut stu = json!({
                    "studentId": sid,
                    "name": sname,
                    "school": school,
                    "phone": phone,
                    "email": email,
                    "note": note,
                    "payStatus": pay_status,
                    "status": status,
                    "source": source,
                    "checkinTime": checkin_time,
                    "blocked": blocked,
                    "locked": locked,
                    "homeworkDone": homework_done == 1,
                });
                if let Some(mk_src) = makeup_source.get(sid) {
                    stu["makeup_source"] = mk_src.clone();
                }
                students_json.push(stu);
            }

            lessons_json.push(json!({
                "lessonId": cl.lesson_id,
                "lessonNum": cl.num,
                "time": cl.time,
                "students": students_json,
            }));
        }

        result.push(json!({
            "classId": l.class_id,
            "className": l.class_name,
            "week": l.week,
            "seat": l.class_seat,
            "classType": l.class_type,
            "lessons": lessons_json,
            "students": enrolled.iter().map(|(sid,)| {
                let sname = student_names.get(sid).cloned().unwrap_or_else(|| format!("ID:{}", sid));
                let school = student_school.get(sid).cloned().unwrap_or_default();
                json!({ "studentId": sid, "name": sname, "school": school })
            }).collect::<Vec<_>>(),
            "lessonMap": lesson_num_map.get(&l.class_id).map(|m| {
                m.iter().map(|(k, v)| json!({ "num": k, "id": v })).collect::<Vec<_>>()
            }).unwrap_or_default(),
        }));
    }

    Ok(Json(json!({"ok": true, "data": result})))
}

// ─── Calendar view: attendance summary by day ───────────────────────

#[derive(Deserialize)]
pub struct CalendarQuery {
    pub year: i32,
    pub month: i32,
}

pub async fn calendar(
    State(state): State<AppState>,
    axum::extract::Query(q): axum::extract::Query<CalendarQuery>,
) -> AppResultJson {
    let first = chrono::NaiveDate::from_ymd_opt(q.year, q.month as u32, 1).unwrap();
    let last = {
        let next = if q.month == 12 {
            chrono::NaiveDate::from_ymd_opt(q.year + 1, 1, 1).unwrap()
        } else {
            chrono::NaiveDate::from_ymd_opt(q.year, (q.month + 1) as u32, 1).unwrap()
        };
        next.pred_opt().unwrap()
    };

    let lessons_on_date = sqlx::query_as::<_, (String, i64)>(
        r#"SELECT l.date, l.id FROM lessons l
           WHERE l.date BETWEEN ? AND ? AND l.is_deleted = 0
           ORDER BY l.date"#
    )
    .bind(first.to_string())
    .bind(last.to_string())
    .fetch_all(&state.db)
    .await?;

    // Group lesson ids by date
    use std::collections::HashMap;
    let mut day_lids: HashMap<String, Vec<i64>> = HashMap::new();
    for (date_str, lid) in &lessons_on_date {
        day_lids.entry(date_str.clone()).or_default().push(*lid);
    }

    let mut day_data: HashMap<String, serde_json::Value> = HashMap::new();
    for (date_str, lids) in &day_lids {
        // Checkin stats for these lessons
        let ph: Vec<String> = lids.iter().map(|_| "?".to_string()).collect();
        let sql = format!(
            r#"SELECT status, COUNT(*) as cnt FROM lesson_checkins
               WHERE lesson_id IN ({}) GROUP BY status"#,
            ph.join(",")
        );
        let mut q = sqlx::query_as::<_, (String, i32)>(&sql);
        for lid in lids { q = q.bind(lid); }
        let stats = q.fetch_all(&state.db).await.unwrap_or_default();

        let mut present = 0i32;
        let mut leave = 0i32;
        let mut absent = 0i32;
        let mut checked = 0i32;
        for (st, cnt) in &stats {
            checked += cnt;
            match st.as_str() {
                "present" | "makeup" | "recording_room_present" | "video_makeup" => present += cnt,
                "leave" => leave += cnt,
                "absent" => absent += cnt,
                "waiting" | "scheduled_room" | "scheduled_video" | "scheduled_classroom" => leave += cnt,
                _ => {}
            }
        }

        // Total enrolled students for these lessons' classes
        let class_ids: Vec<i64> = {
            let ph2: Vec<String> = lids.iter().map(|_| "?".to_string()).collect();
            let sql2 = format!("SELECT DISTINCT class_id FROM lessons WHERE id IN ({})", ph2.join(","));
            let mut q2 = sqlx::query_scalar::<_, i64>(&sql2);
            for lid in lids { q2 = q2.bind(lid); }
            q2.fetch_all(&state.db).await.unwrap_or_default()
        };

        let total_enrolled: i32 = if class_ids.is_empty() { 0 } else {
            let ph3: Vec<String> = class_ids.iter().map(|_| "?".to_string()).collect();
            let sql3 = format!("SELECT COALESCE(SUM(cnt),0) FROM (SELECT COUNT(*) as cnt FROM enrollments WHERE class_id IN ({}) AND is_deleted = 0 AND status = 'active' GROUP BY class_id)", ph3.join(","));
            let mut q3 = sqlx::query_scalar::<_, i64>(&sql3);
            for cid in &class_ids { q3 = q3.bind(cid); }
            q3.fetch_one(&state.db).await.unwrap_or(0) as i32
        };

        day_data.insert(date_str.clone(), json!({
            "date": date_str,
            "lessons": lids.len(),
            "present": present,
            "leave": leave,
            "absent": absent,
            "unchecked": (total_enrolled * lids.len() as i32) - checked,
        }));
    }

    Ok(Json(json!({"ok": true, "data": day_data})))
}

// ─── Update student note ────────────────────────────────────────────

#[derive(serde::Deserialize)]
pub struct UpdateNoteReq {
    student_id: i64,
    note: String,
}

pub async fn update_student_note(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<UpdateNoteReq>,
) -> AppResultJson {
    auth::get_current_user_id(&headers)?;

    sqlx::query("UPDATE students SET note = ?, updated_at = datetime('now') WHERE id = ?")
        .bind(&req.note)
        .bind(req.student_id)
        .execute(&state.db)
        .await?;

    Ok(Json(json!({"ok": true})))
}
