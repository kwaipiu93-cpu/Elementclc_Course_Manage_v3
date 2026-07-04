# React 前端重寫計劃

> **目標：** 用 Vite + React SPA 全面取代現有 Alpine.js + htmx + Tera 前端
> **背景：** 現有系統用 Rust (Axum) + Tera + Alpine.js + htmx，無 build step。宜家要改成標準 React SPA，Rust 做純 JSON API 後端。

## 技術選型

| 層 | 技術 | 原因 |
|---|---|---|
| 建構工具 | Vite 6 | 最快 React 開發體驗 |
| UI 框架 | React 19 | 你指定 |
| 路由 | React Router v7 | 標準 SPA routing |
| 數據請求 | React Query (TanStack Query v5) | server state 管理，cache, loading, error 全包 |
| 樣式 | Tailwind CSS v4 | 快速開發，無需額外 CSS 檔案 |
| 狀態管理 | React Context + React Query | 夠用，唔使 Zustand/Redux |
| 圖標 | Lucide React | 輕量，tree-shakable |

## 專案結構

```
course_manage_v2/
├── frontend/                      # ← 新加：React 專案
│   ├── src/
│   │   ├── main.tsx               # React entry
│   │   ├── App.tsx                # Router setup
│   │   ├── api/
│   │   │   └── client.ts          # Axios/fetch wrapper
│   │   ├── pages/
│   │   │   ├── Login.tsx
│   │   │   ├── Dashboard.tsx
│   │   │   ├── Students.tsx
│   │   │   ├── Classes.tsx
│   │   │   ├── ClassDetail.tsx    # 最複雜
│   │   │   ├── Attendance.tsx
│   │   │   └── Makeups.tsx
│   │   ├── components/
│   │   │   ├── Layout.tsx         # Sidebar + topbar
│   │   │   ├── Sidebar.tsx
│   │   │   ├── CourseTree.tsx
│   │   │   ├── AttendanceGrid.tsx
│   │   │   ├── AttendanceCalendar.tsx
│   │   │   ├── StudentTable.tsx
│   │   │   ├── CheckinGrid.tsx
│   │   │   ├── MakeupModal.tsx
│   │   │   ├── DetailModal.tsx
│   │   │   ├── AiRegisterModal.tsx
│   │   │   └── Badge.tsx
│   │   ├── hooks/
│   │   │   ├── useAuth.ts
│   │   │   ├── useClassTree.ts
│   │   │   └── useAttendance.ts
│   │   └── types/
│   │       └── index.ts           # TypeScript types
│   ├── index.html
│   ├── package.json
│   ├── tsconfig.json
│   ├── vite.config.ts
│   └── tailwind.config.ts
├── src/                           # Rust 後端（修改）
│   ├── main.rs                    # 加 static file serving + JSON API only
│   ├── handlers/
│   │   ├── api.rs                 # JSON API endpoints（已存在）
│   │   └── pages.rs               # 改為只 serve index.html
│   └── ...
├── templates/                     # 可以刪除（完成後）
└── static/                        # 可以刪除（完成後）
```

## 實施階段

---

### Phase 0: Rust 後端改做 JSON API + Static File Serving

**Task 0.1: 移除 Tera 依賴**
- `Cargo.toml` 移除 `tera`
- 刪除所有 `.html` template 檔案

**Task 0.2: 加入 static files serving**
- 用 `tower-http` 的 `ServeDir` 提供 Vite build output
- 所有非 `/api/*` 路由都回傳 `index.html`（SPA fallback）
- 所有 `/api/*` 路由照常行 Axum JSON handler

**Task 0.3: 確認所有 API endpoint 齊全**
現有 API 應該已覆蓋：
- `GET /api/class-tree`
- `GET /api/classes/{id}`
- `GET /api/students`
- `POST /api/students`
- `DELETE /api/students/{id}`
- `GET /api/attendance/calendar?year=&month=`
- `PUT /api/attendance`
- `POST /api/checkin`
- `POST /api/makeups`
- `GET /api/makeups`
- `POST /api/standby/confirm`
- `POST /api/scan/start`, `/api/scan/stop`
- `POST /api/classes/{id}/ai-parse`, `/api/classes/{id}/ai-enroll`
- `POST /api/auth/login`
- etc.

---

### Phase 1: Frontend Setup（~15 min）

**Task 1.1: Create Vite project**
```bash
cd /home/bill/course_manage_v2
npm create vite@latest frontend -- --template react-ts
cd frontend
npm install
```

**Task 1.2: Install dependencies**
```bash
npm install react-router-dom @tanstack/react-query tailwindcss @tailwindcss/vite lucide-react
```

**Task 1.3: Configure Tailwind**
- 用 `@tailwindcss/vite` plugin（Tailwind v4）
- 設定 `vite.config.ts`

**Task 1.4: Setup project structure**
- 建立 `src/api/`, `src/pages/`, `src/components/`, `src/hooks/`, `src/types/`
- 建立 `api/client.ts` 用 fetch + token auth

---

### Phase 2: Auth + Layout（~20 min）

**Task 2.1: Type definitions** (`types/index.ts`)
- `Student`, `Enrollment`, `Lesson`, `Class`, `Topic`, `YearCourse`
- `CheckinMap`, `BlockedMap`, `MakeupMap`
- `ReportEvent`, `CellDetail`
- 等於目前 Rust 回傳嘅 JSON shape

**Task 2.2: Auth hook** (`hooks/useAuth.ts`)
- `login(username, password) → token`
- `getToken()` from `localStorage`
- `isAuthenticated`, `logout()`

**Task 2.3: Login page** (`pages/Login.tsx`)
- 簡單表單，POST `/api/login`
- 成功後 store token + redirect to /

**Task 2.4: Layout component** (`components/Layout.tsx`)
- Sidebar (Links: 概覽, 學生, 每日簽到, 補課, 課程)
- CourseTree sidebar section（fetch `/api/class-tree`）
- Mobile hamburger menu

**Task 2.5: React Router + App** (`App.tsx`)
- Routes: `/login`, `/`, `/students`, `/attendance`, `/makeups`, `/classes`, `/class/:id`
- Protected routes（redirect to /login if no token）
- React Query provider
- Layout wrapper

---

### Phase 3: Pages（~60 min each，最複雜 ClassDetail ~120 min）

**Task 3.1: Dashboard** (`pages/Dashboard.tsx`)
- Fetch stats from API
- Display cards: 學生總數, 課堂數, 今日簽到 etc.

**Task 3.2: Students page** (`pages/Students.tsx`)
- 學生列表（table）
- 新增/編輯 modal
- 刪除

**Task 3.3: Classes page** (`pages/Classes.tsx`)
- Course tree（YearCourse → Topic → Class）
- 新增 YearCourse / Topic / Class modal
- 類似目前 `classes.html`

**Task 3.4: Class Detail** (`pages/ClassDetail.tsx`) — 最複雜
- 三個 tabs：課節, 學員, 出席表
- 課節 tab：lesson list
- 學員 tab：enrollment table + AI 報名 button + modal
- 出席表 tab：attendance grid（click cell → detail modal, status change, makeup）
- 所有目前 Alpine.js 功能遷移

**Task 3.5: Attendance** (`pages/Attendance.tsx`)
- Date picker + per-lesson checkin table
- Inline status buttons
- Calendar view toggle
- Scan mode controls

**Task 3.6: Makeups** (`pages/Makeups.tsx`)
- Makeup list + status filter
- Create/edit makeup modal
- Confirm/delete

---

### Phase 4: 梳理 + 部署（~15 min）

**Task 4.1: 刪除舊 templates 同 static**
- `rm -rf templates/ static/`
- 確認所有功能由前端+API handle

**Task 4.2: Build + Embed frontend**
- `cd frontend && npm run build`
- Vite output 去 `frontend/dist/`
- Rust binary embed `frontend/dist/` 做 static serving

**Task 4.3: 最終測試**
- 測試所有頁面同功能
- 確認無 Alpine/Tera 依賴

---

## 時間估算

| Phase | 內容 | 預估時間 |
|-------|------|----------|
| 0 | Rust static file serving | 15 min |
| 1 | Frontend setup | 15 min |
| 2 | Auth + Layout | 20 min |
| 3.1 | Dashboard | 30 min |
| 3.2 | Students | 45 min |
| 3.3 | Classes | 60 min |
| 3.4 | ClassDetail（最難） | 120 min |
| 3.5 | Attendance | 60 min |
| 3.6 | Makeups | 45 min |
| 4 | Cleanup + Deploy | 15 min |
| **Total** | | **~7 小時** |

---

## 注意事項

1. **先 Phase 0 後 frontend** — 先確保 Rust 後端順利 serve static files + JSON API，先好開始郁 frontend
2. **Incremental** — Phase 2-3 係逐個 page 做，唔使一次過搞晒
3. **API 先行** — 每個 page 開工前 confirm 齊 API
4. **Token auth** — 全部 API 經 `Authorization: Bearer <token>` header，login 拎 token
5. **TypeScript** — 全程 TypeScript，減少 runtime error
6. **No old templates** — 完成後 templates/ static/ 可刪
