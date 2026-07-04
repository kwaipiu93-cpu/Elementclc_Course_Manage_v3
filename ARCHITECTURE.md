# Course_Manage_v2 — 系統架構文檔

> 最後更新：2026-05-30
> 技術棧：Rust (Axum) + React (Vite/TypeScript/Tailwind) + SQLite

---

## 目錄

1. [系統總覽](#1-系統總覽)
2. [資料庫設計](#2-資料庫設計)
3. [API 路由一覽](#3-api-路由一覽)
4. [核心業務流程](#4-核心業務流程)
5. [前端架構](#5-前端架構)
6. [後端架構](#6-後端架構)
7. [狀態對照表](#7-狀態對照表)
8. [部署方式](#8-部署方式)
9. [目錄結構](#9-目錄結構)

---

## 1. 系統總覽

### 1.1 背景

補習社後台管理系統，用於管理學生報名、課堂簽到、補課安排、QR 掃碼簽到、AI 智能報名。

### 1.2 技術選型

```
Backend:  Rust + Axum + sqlx + SQLite + JWT (Argon2)
Frontend: Vite + React 19 + TypeScript + Tailwind CSS v4
          + React Router v7 + TanStack React Query v5 + Lucide React
Auth:     Bearer JWT (7日有效期)
Deploy:   Single binary (前端 build 後由 Rust static serve)
```

### 1.3 系統邊界

- **內部使用**：補習社員工後台（單一 admin 角色）
- **公開端點**：QR 掃碼簽到（無需登入）
- **外部 API**：DeepSeek API（AI 報名解析）

---

## 2. 資料庫設計

### 2.1 ER 圖

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│ year_courses │────▶│   topics     │────▶│   classes    │────▶│   lessons    │
│              │     │              │     │              │     │              │
│ id           │     │ id           │     │ id           │     │ id           │
│ name         │     │ year_course_*│     │ topic_id     │     │ class_id     │
│ year         │     │ name         │     │ name         │     │ num          │
│ grade        │     │ type(Live)   │     │ week(逢六...)│     │ date         │
│ is_deleted   │     │ lessons(12)  │     │ start,end    │     │ start,end    │
└──────────────┘     │ fee          │     │ seat         │     │ video_url    │
                     │ unit_price_* │     │ is_completed │     │ is_deleted   │
                     │ sort         │     │ is_deleted   │     └──────────────┘
                     │ is_deleted   │     └──────┬───────┘            │
                     └──────────────┘            │                     │
                                                 │ enrollments         │
                                                 ▼                     ▼
                                          ┌──────────────┐     ┌──────────────────┐
                                          │  enrollments │     │ lesson_checkins  │
                                          │              │     │                  │
                                    ┌────▶│ id           │     │ id               │
                                    │     │ student_id   │◀────│ lesson_id        │
                                    │     │ class_id     │     │ student_id       │
                                    │     │ makeup_id    │     │ enrollment_id    │
                                    │     │ pay_status   │     │ makeup_lesson_*  │
                                    │     │ purchase(12) │     │ status           │
                                    │     │ used,remain  │     │ checkin_time     │
                                    │     │ status(active)│    │ source           │
                                    │     │ is_deleted   │     │ (enrolled/makeup)│
                                    │     └──────────────┘     └──────────────────┘
                                    │              │
┌──────────────┐                    │              │
│   students   │────────────────────┘              │
│              │                                   │
│ id           │             ┌──────────────────┐  │
│ surname      │             │  makeup_lessons  │  │
│ given_name   │             │                  │  │
│ school       │◀────────────│ student_id       │──┘
│ email        │             │ original_class_* │
│ phone        │             │ original_topic   │
│ parent_phone │             │ lesson_num       │
│ note         │             │ absent_date      │
│ dse_year     │             │ makeup_type      │
│ is_deleted   │             │ makeup_class     │
└──────────────┘             │ target_lesson_*  │
                             │ status           │
┌──────────────────┐         │ (scheduled/done/ │
│ lesson_standby   │         │  waiting/absent) │
│                  │         │ is_deleted       │
│ class_id         │         └──────────────────┘
│ student_id       │
│ status(waiting)  │    ┌──────────────────┐
│ confirmed_at     │    │  attendance_log  │
│ is_deleted       │    │                  │
└──────────────────┘    │ enrollment_id    │
                        │ lesson_num       │ ← 注意：實際儲存 lesson_id（歷史遺留）
┌──────────────────┐    │ old_status       │
│  scan_sessions   │    │ new_status       │
│                  │    │ created_at       │
│ lesson_id        │    └──────────────────┘
│ active(1/0)      │
│ started_at       │    ┌──────────────────┐
│ stopped_at       │    │     users        │
└──────────────────┘    │                  │
                        │ username         │
                        │ password_hash    │
                        │ role(superadmin) │
                        └──────────────────┘
```

### 2.2 表格詳解

| 表 | 用途 | 關鍵欄位 |
|----|------|---------|
| `users` | 管理員帳號（預設 admin/admin123） | `email` (登入唯一依據), `password_hash` (Argon2) |
| `year_courses` | 學年度（如 2025-26） | `name`, `year`, `grade` |
| `topics` | 科目（如 數學 English） | `name`, `type`, `lessons`(堂數), `fee`, `unit_price_*` |
| `classes` | 班級（如 逢六 10-12） | `week`(逢六 10:00-12:00), `seat`(人數上限) |
| `lessons` | 課節（班級建立時自動生成） | `num`(第N課), `date`, `start/end` |
| `students` | 學生資料 | `surname+given_name`, `school`, `phone`, `dse_year` |
| `enrollments` | 報名記錄 | `pay_status`, `purchase/used/remaining`, `makeup_id` |
| `lesson_checkins` | 簽到記錄（核心表） | `status`, `checkin_time`, `source` |
| `makeup_lessons` | 補課安排 | `makeup_type`, `status`, `target_lesson_id` |
| `lesson_standby` | 候補名單 | `status`(waiting/confirmed) |
| `scan_sessions` | QR 掃碼時段 | `lesson_id`, `active` |
| `attendance_log` | 簽到變更記錄 | `old_status`, `new_status` |

### 2.3 重要約束

```sql
-- Lesson 簽到：每學生每課節只能簽一次
UNIQUE(lesson_id, student_id)

-- Erollment：每學生每班只能報一次
UNIQUE(student_id, class_id)

-- 候補：每學生每班只能候補一次
UNIQUE(class_id, student_id)

-- 所有業務表使用 soft delete (is_deleted = 0/1)
```

---

## 3. API 路由一覽

所有 API 路徑以 `/api/` 為前綴，回應格式統一：
```json
{ "ok": true/false, "data": ..., "message": "error msg" }
```

### 3.1 認證

| Method | Path | Auth | 功能 |
|--------|------|------|------|
| POST | `/auth/login` | ❌ | 登入（回傳 JWT token） |
| GET | `/auth/me` | ✅ | 取得當前用戶資訊 |

### 3.2 課程管理

| Method | Path | 功能 |
|--------|------|------|
| GET | `/class-tree` | 取得完整課程樹（year_courses + topics + classes） |
| GET | `/year_courses` | 列出學年度 |
| POST | `/year_courses` | 新增學年度 |
| GET | `/topics` | 列出科目 |
| POST | `/topics` | 新增科目 |
| GET | `/classes` | 列出班級 |
| POST | `/classes` | 新增班級（自動生成 lessons） |

### 3.3 課節 API

| Method | Path | 功能 |
|--------|------|------|
| GET | `/classes/{id}/lessons` | 列出班級課節 |
| PUT | `/lessons/{id}` | 編輯課節日期/時間 |

### 3.4 報名 API

| Method | Path | 功能 |
|--------|------|------|
| GET | `/classes/{id}/enrollments` | 列出班級報名 |
| POST | `/enrollments` | 新增報名 |
| DELETE | `/enrollments/{id}` | 刪除報名（soft） |
| PUT | `/enrollments/{id}/payment` | 更新繳費狀態 |
| POST | `/classes/{id}/ai-parse` | AI 解析報名文字 |
| POST | `/classes/{id}/ai-enroll` | AI 報名（批量建立） |

### 3.5 學生 API

| Method | Path | 功能 |
|--------|------|------|
| GET | `/students` | 列出學生 |
| POST | `/students` | 新增學生 |
| GET | `/students/{id}` | 學生詳情 |
| PUT | `/students/{id}` | 編輯學生 |
| DELETE | `/students/{id}` | 刪除學生（soft） |
| GET | `/students/{id}/detail` | 學生完整資料（含各班的出席狀況） |

### 3.6 簽到 API

| Method | Path | Auth | 功能 |
|--------|------|------|------|
| PUT | `/attendance` | ✅ | 更新簽到狀態 |
| GET | `/attendance/daily?date=YYYY-MM-DD` | ✅ | 每日簽到表 |
| GET | `/attendance/calendar?year=&month=` | ✅ | 月曆簽到統計 |

### 3.7 補課 API

| Method | Path | 功能 |
|--------|------|------|
| GET | `/makeups` | 列出補課記錄（Dashboard 用 — 同時回傳 `data`(waiting+absent) + `upcomingClasses`(3日班級視圖)）|
| POST | `/makeups` | 新增補課（自動入 class 8 如錄播） |
| GET | `/makeups/manage` | 補課管理（含自動偵測未安排缺席） |
| PUT | `/makeups/{id}` | 更新補課安排 |
| DELETE | `/makeups/{id}` | 刪除補課 |
| POST | `/makeups/{id}/checkin` | 補課簽到 |

### 3.8 候補 API

| Method | Path | 功能 |
|--------|------|------|
| GET | `/standby` | 列出所有候補學生 |
| POST | `/standby/confirm` | 確認候補入班（自動建立 enrollment + 補簽過往課節）|
| GET | `/classes/{id}/standby-list` | 某班候補學生列表（Dashboard class card click 用）|

### 3.9 QR 掃碼

| Method | Path | Auth | 功能 |
|--------|------|------|------|
| POST | `/qr-checkin` | ❌ | 掃碼簽到（需 email + active session） |
| POST | `/scan/start` | ✅ | 開啟掃碼時段 |
| POST | `/scan/stop` | ✅ | 關閉掃碼時段 |
| GET | `/scan/active` | ❌ | 查詢是否有進行中時段 |

### 3.10 開發工具

| Method | Path | 功能 |
|--------|------|------|
| GET | `/init_data` | 初始化測試數據 |

---

## 4. 核心業務流程

### 4.1 課程建立流程

```
1. 建立 year_course（如：2025-26 中四）
2. 在 year_course 下建立 topic（如：數學, lessons=12, fee=4800）
3. 在 topic 下建立 class（如：逢六 10:00-12:00, seat=20）
   └─ 自動按 first_lesson 日期 + week 推算 12 堂 lesson
```

**Lesson 自動生成邏輯**：
```
first_lesson = 2026-01-03
week = "逢六 10:00-12:00"
→ Lesson 1: 2026-01-03 (六)
→ Lesson 2: 2026-01-10 (六)
→ ...
→ Lesson 12: 2026-03-21 (六)
```

### 4.2 報名流程

```
手動報名：
  選擇學生 → 選擇班級 → 建立 enrollment
  (purchase=12, remaining=12, pay_status=Unpaid)

AI 報名：
  貼上文字 → DeepSeek API 解析 (fallback: regex)
  → 顯示結果（可手動編輯所有欄位）
  → 確認後批量建立 students + enrollments
```

### 4.3 簽到流程（核心）

```
每日簽到表 (/attendance/daily?date=...):

1. 查詢指定日期的所有 lessons
2. 如 class 8 (補課錄播班) 當日無 lesson → 自動建立一堂
3. 對每班：
   a. 取得 enrolled students（class 8 則查 pending makeups）
   b. 查 makeup 學生（其他班的補課生在該班上課）
   c. 對每學生 x 每課節查 lesson_checkins
   d. 封鎖檢查：第 N 課需先完成第 N-1 課
      (completed = present / recording_room_present / video_makeup)
4. 回傳完整簽到表資料

更新簽到 (/attendance PUT):
1. prerequisite 檢查（class 8 跳過，清空 status 時也跳過）
2. 如 status 為空字串 `""`：刪除 checkin record + soft-delete 相關 makeups（釋放座位）
3. 寫入/更新 lesson_checkins
4. 記錄 attendance_log
5. 如 class 8 + (recording_room_present/video_makeup)：
   a. 找出對應 makeup_lessons → 標記為 done
   b. 同步寫回原班 original lesson_checkins（source=makeup）
   c. 記錄 attendance_log
```

### 4.4 補課流程

```
缺課事件 (status=absent/leave)
         │
         ▼
補課管理頁顯示 (list_makeups_manage)
  ├─ 已有 makeup_lessons 記錄
  └─ 自動偵測未安排缺席（absent/leave 但無對應 makeup record）
         │
         ▼
老師選擇補課類型（三選一）：

┌─────────────────────────────────────────────────────┐
│ ① 🏫 課室補課                                      │
│   → 選擇同 Topic 的其他班                           │
│   → 有位 → status=scheduled, target_lesson_id=該班ID│
│   → 滿額 → status=waiting（候補）                    │
│   → 簽到時寫入 target lesson 的 lesson_checkins     │
├─────────────────────────────────────────────────────┤
│ ② 🎥 線上錄播                                      │
│   → 自動入 class 8 (補課錄播班) enrollment          │
│   → status=scheduled                                │
│   → 在 class 8 簽到後 → 自動 mark done              │
│   → 同步寫回原班 lesson_checkins                    │
├─────────────────────────────────────────────────────┤
│ ③ 📹 課室錄播 (在課室睇錄播)                        │
│   → 同上（class 8）                                  │
└─────────────────────────────────────────────────────┘
```

### 4.5 Class 8 補課錄播班

這是系統中最特別的班級（class_id=8）：

```
特性：
- 每日自動開課（無 lesson 時自動 INSERT）
- 不設座位上限
- 跳過 prerequisite 封鎖檢查
- header 顯示 🎥 錄播簽到（非班級名）

上課學生：
- 查 pending recording makeups（scheduled / done）
- 顯示原班級、Topic、原課節、缺席日、類型等資訊

簽到效果：
- 該學生所有錄播補課標記為 done
- 原班 lesson_checkins 同步更新（source=makeup）
- 下一課封鎖檢查視 recording_room_present/video_makeup 為"已完成"
```

### 4.6 QR 掃碼簽到流程

```
老師端：
  1. 選擇課節 → POST /scan/start { lesson_id }
  2. 顯示 QR code（學生用 email 掃碼）
  3. 結束 → POST /scan/stop

學生端：
  1. 掃 QR code（POST /qr-checkin { email }）
  2. 系統檢查：有 active session？
  3. 系統檢查：email 對應的學生存在？
  4. 系統檢查：該學生有報讀此班？
  5. ✅ → 自動簽到為 present
```

### 4.7 候補流程

```
滿額班級 → 學生無法報名 → 可加入 lesson_standby
         ↓
老師確認 → POST /standby/confirm
  ├─ 檢查是否已有 enrollment → 啟用/建立
  ├─ 自動補簽已過去的課節為 present
  └─ 學生正式入班
```

---

## 5. 前端架構

### 5.1 頁面結構

```
React SPA (/) ─────────── Login (/login)
       │
  Layout (sidebar nav)
       │
  ├── Dashboard (/)         ─ 需要處理事項概覽（缺課補課 / 候補 / 錄播簽到 / 今日課堂）
  │                           ├─ 頂部：未來3日班級視圖（座位公式 chips + click 展開 panel）
  │                           │   座位公式：座位−已報+請假−補堂=可用（候補獨立顯示唔扣入計算）
  │                           │   Click 班級卡 → 等安排補課學生（電話顯示 + 一鍵安排到本班）
  │                           │                    + 課堂候補學生列表
  │                           └─ 底部：候補中（deadline-based 可補時段 + 安排 modal）
  ├── Classes (/classes)    ─ 課程樹 + CRUD modal
  ├── ClassDetail           ─ 3 Tab 頁
  │   ├── /classes/:id/lessons    ─ 課節編輯
  │   ├── /classes/:id/students   ─ 學員 + 繳費
  │   └── /classes/:id/attendance ─ 出席表 Grid
  ├── Students (/students)  ─ 學生列表 + CRUD modal
  ├── StudentDetail         ─ 學生所有班級的出席狀況
  ├── Makeups (/makeups)    ─ 補課管理 + filter + arrange modal
  └── Attendance            ─ 每日簽到 + 日曆（點擊狀態 badge 快速操作：更改出席狀態 / 安排錄播補課）
      ├── List View         ─ 按班級顯示
      └── Calendar View     ─ 月曆摘要
```

### 5.2 關鍵組件

```
src/
├── api/client.ts           ─ API 封裝（request helper + 所有 endpoint）
├── hooks/useAuth.tsx       ─ JWT token 管理 + 登入狀態
├── components/Layout.tsx   ─ 側邊欄導航佈局
├── pages/
│   ├── Dashboard.tsx       ─ 需要處理事項：缺課補課清單、候補/待補統計、錄播補課簽到、今日課堂
│   ├── Classes.tsx         ─ 課程樹 + 3 種 create modal
│   ├── ClassDetail.tsx     ─ 班級詳情（最大頁面，~960 行）
│   ├── Attendance.tsx      ─ 每日簽到 + 日曆 + 點擊 badge 快速操作（~530 行）
│   ├── Makeups.tsx         ─ 補課管理
│   ├── Students.tsx        ─ 學生 CRUD
│   ├── StudentDetail.tsx   ─ 學生出席明細
│   └── Login.tsx           ─ 登入頁
└── types/index.ts          ─ TypeScript types
```

### 5.3 狀態管理方式

- **Server state**：TanStack React Query（cache + auto-refetch）
- **Auth state**：localStorage + React Context (`useAuth` hook)
- **Modal state**：useState（每個頁面自己管理）
- **無 global store**：React Query 已處理大部份跨頁面共享狀態

---

## 6. 後端架構

### 6.1 Module 結構

```
src/
├── main.rs                 ─ 入口：Router 定義 + SPA fallback + class tree API
├── config.rs               ─ 環境變數讀取
├── db.rs                   ─ SQLite pool init + migrations
├── auth.rs                 ─ JWT 生成/驗證 + 密碼 hash + middleware helper
├── models.rs               ─ Struct 定義（對應 DB table）
├── error.rs                ─ 統一錯誤處理
├── handlers/
│   ├── mod.rs              ─ export
│   ├── auth.rs             ─ login + me
│   ├── classes.rs          ─ year_courses / topics / classes / lessons / enrollments + AI
│   ├── students.rs         ─ students CRUD + detail
│   └── attendance.rs       ─ checkin / makeup / standby / QR scan / daily / calendar
└── services/
    ├── mod.rs              ─ export
    ├── attendance_service  ─ upsert_checkin (含 prerequisite check + attendance_log)
    ├── enrollment_service  ─ create / soft_delete / update_payment
    └── student_service     ─ list_all / get_by_id / create / update / soft_delete
```

### 6.2 Router 結構

```rust
Router::new()
    .nest("/api", api_routes())
    .nest_service("/assets", ServeDir::new("frontend/dist/assets"))
    .fallback(get(spa_fallback))   // 所有非 API 路徑 → React SPA
```

### 6.3 AppState

```rust
pub struct AppState {
    pub db: sqlx::SqlitePool,        // 5 connections max
    pub cfg: Config,                  // port, database_url, jwt_secret
    pub http_client: reqwest::Client, // for DeepSeek API calls
}
```

### 6.4 認證方式

```rust
// JWT (HS256)
Header: Authorization: Bearer <token>
Payload: { sub: user_id, exp: timestamp }
Secret: JWT_SECRET env var (default: "change-me-in-production")
Expiry: 7 days

// 密碼
Algorithm: Argon2id
Default admin: admin / admin123 (migration 時建立)
```

---

## 7. 狀態對照表

### 7.1 簽到狀態（lesson_checkins.status，10 個值 + 空字串）

| 資料庫值 | 前端顯示 | 顏色 | 說明 |
|----------|---------|------|------|
| `present` | ✅課堂教學出席 | green | 正常出席 |
| `leave` | 📋請假待安排 | blue | 請假，需要補課 |
| `absent` | ❌缺勤待安排 | red | 缺席，需要補課 |
| `recording_room_present` | ✅課室錄播出席 | emerald | 在課室睇錄播補堂 |
| `video_makeup` | ✅線上錄播出席 | purple | 線上睇片補堂 |
| `makeup` | ✅課堂補堂出席 | green | 在其他班上堂補課 |
| `waiting` | ‼️課堂教學候補 | orange | 目標班滿座，等待確認 |
| `scheduled_room` | ⌛️課室錄播待補 | amber | 已安排課室錄播未完成 |
| `scheduled_video` | ⌛️線上錄播待補 | purple | 已安排線上錄播未完成 |
| `scheduled_classroom` | ⌛️課堂教學待補 | amber | 已安排課堂補課未完成 |
| `""` (空字串) | 🟡未處理 | yellow | 未簽到（checkin record 被 delete）|

⚠️ `waiting` 同時用於 makeup_lessons（補課候補）和 lesson_checkins（課堂簽到候補），兩者含義不同

### 7.2 補課狀態

| status | 顯示 | 說明 |
|--------|------|------|
| `scheduled` | ⌛️課堂教學待補 / ⌛️課室錄播待補 / ⌛️線上錄播待補 | 已安排未完成 |
| `waiting` | ‼️課堂教學候補 | 目標班滿座，等待確認 |
| `done` | ✅課室錄播出席 / ✅線上錄播出席 / ✅課堂補堂出席 | 已完成 |
| `absent` (virtual) | ❌缺勤待安排 / 📋請假待安排 | 自動偵測缺課，未安排補課 |

### 7.3 繳費狀態

| pay_status | 顯示顏色 |
|------------|---------|
| `paid` / `已繳` | 🟢 green |
| 其他（包括 `Unpaid`、空值） | 🔴 red |

---

## 8. 部署方式

### 8.1 本地開發

```bash
# 1. 後端
cd course_manage_v2
cp .env.example .env      # 編輯環境變數
cargo run                 # 自動跑 migration + seed admin

# 2. 前端開發模式（hot reload）
cd frontend
npm install
npm run dev               # 需配合後端 CORS 設定

# 3. Production build
cd frontend && npm run build
cd .. && cargo build --release
./target/release/course_manage_v2
```

### 8.2 環境變數

```bash
PORT=8000                        # 服務埠口
DATABASE_URL=sqlite:data.db      # SQLite 路徑
JWT_SECRET=your-secret-key       # JWT 簽名密鑰
DEEPSEEK_API_KEY=sk-xxx          # AI 報名 API key（可選）
```

### 8.3 Single Binary 部署

```bash
# Build once, deploy anywhere
cargo build --release
scp target/release/course_manage_v2 user@server:~/
scp -r frontend/dist user@server:~/frontend/dist   # 前端靜態檔
./course_manage_v2                                   # Run
```

---

## 9. 目錄結構

```
course_manage_v2/
├── Cargo.toml                    # Rust 依賴
├── Cargo.lock
├── schema.sql                    # 完整 DB schema（CREATE TABLE 語句）
├── seed_data.py                  # 測試數據腳本
├── .env.example                  # 環境變數範本
│
├── src/                          # Rust 後端
│   ├── main.rs                   # 入口 + router + spa_fallback + class_tree API
│   ├── config.rs                 # Config struct + from_env()
│   ├── db.rs                     # SQLite pool + migrations
│   ├── auth.rs                   # JWT + Argon2
│   ├── models.rs                 # Struct 定義
│   ├── error.rs                  # AppError Enum + IntoResponse
│   ├── handlers/
│   │   ├── mod.rs
│   │   ├── auth.rs               # login + me
│   │   ├── classes.rs            # CRUD (795 lines, 最大檔案)
│   │   ├── students.rs           # CRUD + detail
│   │   └── attendance.rs         # checkin/makeup/scan/daily/calendar (1110 lines)
│   └── services/
│       ├── mod.rs
│       ├── attendance_service.rs # upsert_checkin 核心
│       ├── enrollment_service.rs # create/delete/payment
│       └── student_service.rs    # CRUD
│
├── frontend/                     # React 前端
│   ├── package.json
│   ├── vite.config.ts
│   ├── tsconfig.json
│   ├── index.html
│   ├── public/
│   │   ├── favicon.svg
│   │   └── icons.svg
│   └── src/
│       ├── main.tsx              # React entry + RouterProvider
│       ├── App.tsx               # Router 定義
│       ├── index.css             # Tailwind v4 (@import "tailwindcss")
│       ├── api/client.ts         # API 封裝
│       ├── hooks/useAuth.tsx     # Auth Context
│       ├── components/Layout.tsx # Sidebar nav
│       ├── types/index.ts
│       └── pages/
│           ├── Dashboard.tsx     # 228 lines（需要處理事項概覽）
│           ├── Classes.tsx       # 303 lines
│           ├── ClassDetail.tsx   # 963 lines（最大）
│           ├── Attendance.tsx    # 528 lines（點擊 badge 快速操作）
│           ├── Makeups.tsx       # 459 lines
│           ├── Students.tsx      # 364 lines
│           ├── StudentDetail.tsx
│           ├── Login.tsx
│           └── Placeholder.tsx
│
└── .gitignore
```

---

## 附錄 A：開發注意事項

### A.1 常見 Pitfall

1. **Class 8 特別處理**：所有 class_id=8 的查詢都要特別處理（封鎖跳過、學生來源不同、header 顯示不同）
2. **attendance_log.lesson_num**：欄位名誤導，實際儲存 lesson_id（V3 需修正）
3. **Makeup 去重**：同一 student + lesson_num 只允許一個 makeup record（CREATE 時會 UPDATE 現有）
4. **N+1 Query**：多處迴圈 query 學生名，數據量過千時需優化
5. **座位公式**：`seat - enrolled + leave - pending_mk = available` — standby(lesson_standby) 唔扣入計算，獨立顯示為「⏳候補N (未安排)」，因為老師未處理候補學生前佢哋未佔位
6. **清空 status（""）** = 刪除 checkin + soft-delete 相關 makeups（釋放座位），同時跳過 prerequisite 檢查
7. **Dashboard 用 raw fetch** — `api.get<T>` 會 strip 頂層 field（loss `upcomingClasses`），Dashboard 必須用 raw `fetch('/api/makeups')`
8. **Quick arrange 要 close panel** — `setSelectedClass(null)` on success，否則安排咗嘅學生仲顯示喺 panel 入面

### A.2 建議 V3 改動

1. 修正 `attendance_log.lesson_num` 欄位命名
2. 補課 waiting → scheduled 自動偵測
3. 加 DB index (`lessons.date`, `lesson_checkins.lesson_id`, 等)
4. N+1 query 優化（batch query + JOIN）
5. 前端 TypeScript 完整 type（消除 `any`）
6. 分頁處理（large tables）
7. 孤兒數據清理機制

---

*文檔完*
