#!/usr/bin/env python3
"""Reseed all test data via API — explicit student-to-class assignment."""
import requests, json, random, subprocess
from datetime import date, timedelta

BASE = "http://localhost:8000/api"
TOKEN = "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJzdWIiOjEsImV4cCI6MTc4MDczNDc2Mn0.alHwUZ6vSRubBR311eMkG9iG4pWPPkgIoLm_PFzESwg"
HEADERS = {"Content-Type": "application/json", "Authorization": f"Bearer {TOKEN}"}
random.seed(42)

def api(method, path, data=None):
    url = f"{BASE}{path}"
    r = requests.request(method, url, headers=HEADERS, json=data)
    if not r.ok:
        print(f"  ⚠️  {method} {path} → {r.status_code}: {r.text[:200]}")
        return None
    return r.json()

def extract_id(resp):
    if resp is None: return None
    if isinstance(resp, dict):
        if "data" in resp and isinstance(resp["data"], dict):
            return resp["data"].get("id")
        return resp.get("id")
    return None

def extract_list(resp, key="data"):
    if resp is None: return []
    if isinstance(resp, dict) and key in resp and isinstance(resp[key], list):
        return resp[key]
    return resp if isinstance(resp, list) else []

# ── Step 1: Clear ──
print("🔄 CLEAR DB")
subprocess.run(["sqlite3", "instance/data.db", """
PRAGMA foreign_keys = OFF;
DELETE FROM lesson_checkins;
DELETE FROM attendance_log;
DELETE FROM scan_sessions;
DELETE FROM lesson_standby;
DELETE FROM makeup_lessons;
DELETE FROM invoices;
DELETE FROM attendances;
DELETE FROM enrollments;
DELETE FROM lessons;
DELETE FROM classes;
DELETE FROM topics;
DELETE FROM year_courses;
DELETE FROM students;
PRAGMA foreign_keys = ON;
"""], check=True)
print("✅ Cleared\n")

# ── Step 2: Year Courses ──
print("=" * 50)
print("1️⃣  YEAR COURSES + TOPICS + CLASSES")
print("=" * 50)

yc_resp = api("POST", "/year_courses", {"name": "2026-2027 DSE Chem 常規課程", "year": 2026, "grade": "F.6"})
S6_YC_ID = extract_id(yc_resp)
yc_resp = api("POST", "/year_courses", {"name": "2026-2027 DSE 常規 F3", "year": 2026, "grade": "F.3"})
F3_YC_ID = extract_id(yc_resp)
yc_resp = api("POST", "/year_courses", {"name": "2027-2028 DSE Chem 常規課程", "year": 2027, "grade": "F.5"})
S5_YC_ID = extract_id(yc_resp)
print(f"  Year courses: S6={S6_YC_ID}, F3={F3_YC_ID}, S5={S5_YC_ID}")

# Topics — track by name
tid_of = {}
for yc_id, name, ttype, lessons, fee, new_p, ins_p, mk_fee, sort in [
    (S6_YC_ID, "Chem 常規", "課堂教學", 12, 4800, 500, 450, 50, 1),
    (S6_YC_ID, "Chem 技巧班", "課堂教學", 8, 3200, 450, 400, 40, 2),
    (S6_YC_ID, "Chem 的終極操卷", "課堂教學", 6, 2800, 500, 450, 50, 3),
    (F3_YC_ID, "F3 英文", "課堂教學", 12, 3600, 350, 300, 30, 1),
    (F3_YC_ID, "F3 數學", "課堂教學", 12, 3600, 350, 300, 30, 2),
    (F3_YC_ID, "F3 科學", "課堂教學", 10, 3000, 350, 300, 30, 3),
    (F3_YC_ID, "F3 Chem (免費體驗班)", "課堂教學", 4, 0, 0, 0, 0, 4),
    (S5_YC_ID, "F5 Chem 常規", "課堂教學", 12, 4200, 450, 400, 45, 1),
    (S5_YC_ID, "F5 Chem 補底班", "課堂教學", 10, 3500, 400, 350, 40, 2),
]:
    r = api("POST", "/topics", {"year_course_id": yc_id, "name": name, "type": ttype,
                                "lessons": lessons, "fee": fee, "unit_price_new": new_p,
                                "unit_price_insert": ins_p, "makeup_fee": mk_fee, "sort": sort})
    tid_of[name] = extract_id(r)
print(f"  Topics: {len(tid_of)} created")

# Classes
cid_of = {}
for tname, cname, week, first_lesson, seat in [
    ("Chem 常規", "S6 Chem A", "逢六 10:00-12:00", "2026-09-05", 8),
    ("Chem 常規", "S6 Chem B", "逢六 14:00-16:00", "2026-09-05", 6),
    ("Chem 常規", "S6 Chem C", "逢日 10:00-12:00", "2026-09-06", 4),
    ("Chem 技巧班", "S6 技巧 A", "逢六 16:30-18:30", "2026-09-05", 4),
    ("Chem 技巧班", "S6 技巧 B", "逢日 14:00-16:00", "2026-09-06", 3),
    ("Chem 的終極操卷", "S6 操卷班", "逢六 09:00-11:00", "2026-10-03", 30),
    ("F3 英文", "F3 Eng A", "逢六 09:00-11:00", "2026-09-05", 6),
    ("F3 英文", "F3 Eng B", "逢日 09:00-11:00", "2026-09-06", 3),
    ("F3 數學", "F3 Math A", "逢六 11:30-13:30", "2026-09-05", 4),
    ("F3 數學", "F3 Math B", "逢日 11:30-13:30", "2026-09-06", 6),
    ("F3 科學", "F3 Sci A", "逢六 14:00-16:00", "2026-09-05", 4),
    ("F3 Chem (免費體驗班)", "F3 Chem Free A", "逢日 16:30-18:30", "2026-09-06", 30),
    ("F5 Chem 常規", "S5 Chem A", "逢六 10:00-12:00", "2026-09-05", 4),
    ("F5 Chem 常規", "S5 Chem B", "逢日 10:00-12:00", "2026-09-06", 3),
    ("F5 Chem 補底班", "S5 補底 A", "逢六 14:00-16:00", "2026-09-05", 10),
]:
    r = api("POST", "/classes", {"topic_id": tid_of[tname], "name": cname,
                                  "week": week, "first_lesson": first_lesson, "seat": seat})
    cid_of[cname] = extract_id(r)
print(f"  Classes: {len(cid_of)} created")

# ── Step 3: Students ──
print("\n" + "=" * 50)
print("2️⃣  STUDENTS + ENROLLMENTS")
print("=" * 50)

# Students with explicit DSE year for proper class assignment
all_students = [
    # S6 students (DSE 2026)
    ("張", "子晴", "拔萃女書院", "91234567", "99887766", 2026, "s6_zhang"),
    ("李", "俊傑", "喇沙書院", "93456789", "91234567", 2026, "s6_li"),
    ("王", "芷晴", "瑪利諾修院學校", "94567890", "92345678", 2026, "s6_wang"),
    ("劉", "浩賢", "英皇書院", "95678901", "93456789", 2026, "s6_liu"),
    ("黃", "穎欣", "協恩中學", "96789012", "94567890", 2026, "s6_huang"),
    ("梁", "志豪", "聖保羅男女中學", "97890123", "95678901", 2026, "s6_liang"),
    ("楊", "樂怡", "真光中學", "98901234", "96789012", 2026, "s6_yang"),
    ("鄭", "梓軒", "華仁書院", "99012345", "97890123", 2026, "s6_zheng"),
    ("吳", "凱琳", "聖士提反女子中學", "90123456", "98901234", 2026, "s6_wu_kailin"),
    ("郭", "雪瑩", "聖保祿學校", "90567890", "90345678", 2026, "s6_guo"),
    ("鄧", "海晴", "迦密中學", "90789012", "90567890", 2026, "s6_deng"),
    ("朱", "柏豪", "浸信會呂明才中學", "90890123", "90678901", 2026, "s6_zhu"),
    ("胡", "美琪", "崇真書院", "90901234", "90789012", 2026, "s6_hu"),
    ("余", "佩君", "香港華仁書院", "91123456", "90901234", 2026, "s6_yu"),
    # F3 students (DSE 2029 = current F3)
    ("陳", "小明", "皇仁書院", "92345678", "98765432", 2029, "f3_chen"),
    ("何", "天佑", "張祝珊英文中學", "90234567", "99012345", 2029, "f3_he"),
    ("周", "詠琪", "德望學校", "90345678", "90123456", 2029, "f3_zhou"),
    ("林", "浩朗", "英華書院", "90456789", "90234567", 2029, "f3_lin"),
    ("馬", "浩然", "民生書院", "90678901", "90456789", 2029, "f3_ma"),
    ("曹", "振宇", "培正中學", "91012345", "90890123", 2029, "f3_cao"),
    # F5 students (DSE 2027)
    ("陳", "俊賢", "香港華仁書院", "90111111", "90222222", 2027, "s5_chen_jx"),
    ("羅", "穎怡", "德望學校", "90333333", "90444444", 2027, "s5_luo"),
    ("黃", "志恆", "英華書院", "90555555", "90666666", 2027, "s5_huang_zh"),
    ("楊", "奕朗", "喇沙書院", "90777777", "90888888", 2027, "s5_yang"),
    ("林", "嘉雯", "拔萃女書院", "90999999", "90101010", 2027, "s5_lin"),
    ("何", "志健", "皇仁書院", "90202020", "90303030", 2027, "s5_he"),
]

sid_of = {}  # name_key → id
for surname, given_name, school, phone, parent_phone, dse, key in all_students:
    d = {"surname": surname, "given_name": given_name, "school": school,
         "phone": phone, "parent_phone": parent_phone, "dse_year": dse,
         "email": f"{key}@example.com"}
    r = api("POST", "/students", d)
    sid = extract_id(r)
    if sid:
        sid_of[key] = sid

print(f"  Students: {len(sid_of)} created")

# ── Step 4: Enrollments (explicit) ──
# (student_key, class_name, pay_status, pay_amount, purchase)
enroll_plan = [
    # S6 Chem A (seat=8) — 8 enrolled exactly at capacity
    ("s6_zhang", "S6 Chem A", "已繳", 4800, 12),
    ("s6_li", "S6 Chem A", "已繳", 4800, 12),
    ("s6_wang", "S6 Chem A", "已繳", 4800, 12),
    ("s6_liu", "S6 Chem A", "已繳", 4800, 12),
    ("s6_huang", "S6 Chem A", "已繳", 4800, 12),
    ("s6_liang", "S6 Chem A", "未繳", 0, 12),
    ("s6_yang", "S6 Chem A", "已繳", 4800, 12),
    ("s6_zheng", "S6 Chem A", "已繳", 4800, 12),
    # S6 Chem B (seat=6) — 6 enrolled at capacity
    ("s6_wu_kailin", "S6 Chem B", "已繳", 4800, 12),
    ("s6_guo", "S6 Chem B", "已繳", 4800, 12),
    ("s6_deng", "S6 Chem B", "未繳", 0, 12),
    ("s6_zhu", "S6 Chem B", "已繳", 4800, 12),
    ("s6_hu", "S6 Chem B", "已繳", 2400, 6),
    ("s6_yu", "S6 Chem B", "已繳", 4800, 12),
    # S6 Chem C (seat=4) — 2 enrolled, room for 2
    ("s6_zhang", "S6 Chem C", "已繳", 4800, 12),
    ("s6_li", "S6 Chem C", "已繳", 4800, 12),
    # S6 技巧 A (seat=4) — take 4 S6 students
    ("s6_wang", "S6 技巧 A", "已繳", 3200, 8),
    ("s6_liu", "S6 技巧 A", "已繳", 3200, 8),
    ("s6_huang", "S6 技巧 A", "未繳", 0, 8),
    ("s6_liang", "S6 技巧 A", "已繳", 3200, 8),
    # S6 技巧 B (seat=3) — 2 enrolled, room for 1
    ("s6_yang", "S6 技巧 B", "已繳", 3200, 8),
    ("s6_zheng", "S6 技巧 B", "已繳", 3200, 8),
    # S6 操卷班 (seat=30) — 4 enrolled, lots of room
    ("s6_wu_kailin", "S6 操卷班", "已繳", 2800, 6),
    ("s6_guo", "S6 操卷班", "已繳", 2800, 6),
    ("s6_deng", "S6 操卷班", "未繳", 0, 6),
    ("s6_zhu", "S6 操卷班", "已繳", 2800, 6),
    # F3 Eng A (seat=6) — 6 enrolled at capacity
    ("f3_chen", "F3 Eng A", "已繳", 3600, 12),
    ("f3_he", "F3 Eng A", "已繳", 3600, 12),
    ("f3_zhou", "F3 Eng A", "未繳", 0, 12),
    ("f3_lin", "F3 Eng A", "已繳", 3600, 12),
    ("f3_ma", "F3 Eng A", "已繳", 3600, 12),
    ("f3_cao", "F3 Eng A", "已繳", 3600, 12),
    # F3 Eng B (seat=3) — 2 enrolled, room
    ("f3_chen", "F3 Eng B", "已繳", 3600, 12),
    ("f3_he", "F3 Eng B", "已繳", 3600, 12),
    # F3 Math A (seat=4) — 5 enrolled, 1 over! 
    ("f3_zhou", "F3 Math A", "已繳", 3600, 12),
    ("f3_lin", "F3 Math A", "已繳", 3600, 12),
    ("f3_ma", "F3 Math A", "未繳", 0, 12),
    ("f3_cao", "F3 Math A", "已繳", 3600, 12),
    ("f3_chen", "F3 Math A", "已繳", 3600, 12),  # 5th student, seat=4 → OVER
    # F3 Math B (seat=6) — 3 enrolled, room
    ("f3_he", "F3 Math B", "已繳", 3600, 12),
    ("f3_zhou", "F3 Math B", "已繳", 3600, 12),
    ("f3_lin", "F3 Math B", "未繳", 0, 12),
    # F3 Sci A (seat=4) — 2 enrolled, room
    ("f3_ma", "F3 Sci A", "已繳", 3000, 10),
    ("f3_cao", "F3 Sci A", "已繳", 3000, 10),
    # F3 Chem Free A (seat=30) — 2 enrolled
    ("f3_chen", "F3 Chem Free A", "已繳", 0, 4),
    ("f3_he", "F3 Chem Free A", "已繳", 0, 4),
    # S5 Chem A (seat=4) — 4 enrolled at capacity
    ("s5_chen_jx", "S5 Chem A", "已繳", 4200, 12),
    ("s5_luo", "S5 Chem A", "已繳", 4200, 12),
    ("s5_huang_zh", "S5 Chem A", "未繳", 0, 12),
    ("s5_yang", "S5 Chem A", "已繳", 4200, 12),
    # S5 Chem B (seat=3) — 2 enrolled, room
    ("s5_lin", "S5 Chem B", "已繳", 4200, 12),
    ("s5_he", "S5 Chem B", "未繳", 0, 12),
    # S5 補底 A (seat=10) — 3 enrolled, room
    ("s5_chen_jx", "S5 補底 A", "已繳", 3500, 10),
    ("s5_luo", "S5 補底 A", "已繳", 3500, 10),
    ("s5_huang_zh", "S5 補底 A", "未繳", 0, 10),
]

enr_of = {}  # (student_key, class_name) → enrollment id
for sk, cn, pay_status, pay_amount, purchase in enroll_plan:
    sid = sid_of.get(sk)
    cid = cid_of.get(cn)
    if not sid or not cid:
        print(f"  ⚠️  Skipping {sk}→{cn}: sid={sid}, cid={cid}")
        continue
    d = {"student_id": sid, "class_id": cid, "pay_status": pay_status,
         "pay_amount": pay_amount, "purchase": purchase}
    r = api("POST", "/enrollments", d)
    eid = extract_id(r)
    if eid:
        enr_of[(sk, cn)] = eid

print(f"  Enrollments: {len(enr_of)} created")

# ── Step 5: Lesson Checkins via API ──
print("\n" + "=" * 50)
print("3️⃣  LESSON CHECKINS")
print("=" * 50)

CHECKIN_STATUSES = {"present": 85, "makeup": 5, "recording_room_present": 3, "video_makeup": 2}
LAST_CHECKIN = {"present": 80, "makeup": 3, "recording_room_present": 2, "video_makeup": 2,
                "leave": 8, "absent": 5}

chk_count = 0
# Group enrollments by class
enr_by_class = {}
for (sk, cn), eid in enr_of.items():
    enr_by_class.setdefault(cn, []).append((sk, eid))

for cn, entries in enr_by_class.items():
    cid = cid_of.get(cn)
    if not cid:
        continue
    lessons_resp = api("GET", f"/classes/{cid}/lessons")
    lessons = extract_list(lessons_resp)
    if not lessons:
        continue

    for sk, eid in entries:
        sid = sid_of.get(sk)
        if not sid:
            continue
        max_run = max(1, int(len(lessons) * random.uniform(0.3, 0.85)))
        attended = 0
        for lesson in lessons:
            if attended >= max_run:
                break
            lid = lesson.get("id")
            weights = LAST_CHECKIN if attended == max_run - 1 else CHECKIN_STATUSES
            st = random.choices(list(weights.keys()), weights=list(weights.values()))[0]
            d = {"lesson_id": lid, "student_id": sid, "status": st}
            r = api("PUT", "/attendance", d)
            if r:
                chk_count += 1
                attended += 1

print(f"  ✅ {chk_count} checkins created")

# ── Step 6: Standby (only via DB since server doesn't auto-create) ──
print("\n" + "=" * 50)
print("4️⃣  STANDBY (DB insert for over-capacity classes)")
print("=" * 50)

# Classes that are over capacity:
# F3 Math A: seat=4, 5 enrolled → 1 over
# Classes at capacity that could have standby:
# S6 Chem A: seat=8, 8 enrolled
# S6 Chem B: seat=6, 6 enrolled
# F3 Eng A: seat=6, 6 enrolled
# S5 Chem A: seat=4, 4 enrolled

# Add standby entries via DB for classes that are full/over
subprocess.run(["sqlite3", "instance/data.db", """
PRAGMA foreign_keys = OFF;
-- F3 Math A is full (5 enrolled, seat=4), standbys waiting
INSERT OR IGNORE INTO lesson_standby (class_id, student_id, status, trigger_time, note) 
VALUES (""" + str(cid_of["F3 Math A"]) + """, """ + str(sid_of["f3_ma"]) + """, 'waiting', datetime('now'), '已滿額，等待新一期');
INSERT OR IGNORE INTO lesson_standby (class_id, student_id, status, trigger_time, note)
VALUES (""" + str(cid_of["S6 Chem A"]) + """, """ + str(sid_of["s6_wu_kailin"]) + """, 'waiting', datetime('now'), '滿額候補');
INSERT OR IGNORE INTO lesson_standby (class_id, student_id, status, trigger_time, note)
VALUES (""" + str(cid_of["S5 Chem A"]) + """, """ + str(sid_of["s5_he"]) + """, 'waiting', datetime('now'), '候補');
INSERT OR IGNORE INTO lesson_standby (class_id, student_id, status, trigger_time, note)
VALUES (""" + str(cid_of["F3 Eng A"]) + """, """ + str(sid_of["f3_lin"]) + """, 'waiting', datetime('now'), '已滿額，等待');
PRAGMA foreign_keys = ON;
"""], check=True)

# Verify standby
result = subprocess.run(
    ["sqlite3", "instance/data.db",
     "SELECT c.name, s.surname || ' ' || s.given_name, ls.status "
     "FROM lesson_standby ls "
     "JOIN classes c ON ls.class_id = c.id "
     "JOIN students s ON ls.student_id = s.id "
     "WHERE ls.is_deleted=0"],
    capture_output=True, text=True)
print(f"  Standby:\n{result.stdout.strip()}")

# ── Step 7: Makeup Lessons ──
print("\n" + "=" * 50)
print("5️⃣  MAKEUP LESSONS")
print("=" * 50)

# Find absent/leave checkins for makeup
result = subprocess.run(
    ["sqlite3", "instance/data.db",
     "SELECT lc.student_id, lc.lesson_id, e.class_id, l.num "
     "FROM lesson_checkins lc "
     "JOIN enrollments e ON lc.enrollment_id = e.id "
     "JOIN lessons l ON lc.lesson_id = l.id "
     "WHERE lc.status IN ('absent', 'leave') AND e.is_deleted = 0 "
     "LIMIT 8"],
    capture_output=True, text=True)
mk_count = 0
lines = result.stdout.strip().split("\n")
if lines and lines[0]:
    for line in lines:
        parts = line.split("|")
        if len(parts) >= 4:
            sid, lid, cid, lnum = parts
            mk_type = random.choices(["課室錄播", "線上錄播", "課室補課"], weights=[40, 30, 30])[0]
            status = random.choices(["scheduled", "done"], weights=[60, 40])[0]
            d = {"student_id": int(sid), "original_class_id": int(cid),
                 "lesson_num": str(lnum), "makeup_type": mk_type, "status": status}
            r = api("POST", "/makeups", d)
            if r:
                mk_count += 1
print(f"  ✅ {mk_count} makeups created")

# ── Final Verification ──
print("\n" + "=" * 60)
print("📊  FINAL VERIFICATION")
print("=" * 60)

counts = subprocess.run(
    ["sqlite3", "instance/data.db",
     "SELECT 'year_courses', COUNT(*) FROM year_courses "
     "UNION ALL SELECT 'topics', COUNT(*) FROM topics "
     "UNION ALL SELECT 'classes', COUNT(*) FROM classes "
     "UNION ALL SELECT 'lessons', COUNT(*) FROM lessons "
     "UNION ALL SELECT 'students', COUNT(*) FROM students "
     "UNION ALL SELECT 'enrollments', COUNT(*) FROM enrollments "
     "UNION ALL SELECT 'lesson_checkins', COUNT(*) FROM lesson_checkins "
     "UNION ALL SELECT 'lesson_standby', COUNT(*) FROM lesson_standby "
     "UNION ALL SELECT 'makeup_lessons', COUNT(*) FROM makeup_lessons"],
    capture_output=True, text=True).stdout.strip()
print(f"\n📈 Counts:\n{counts}")

fill = subprocess.run(
    ["sqlite3", "instance/data.db",
     "SELECT c.id, c.name, c.seat, "
     "(SELECT COUNT(*) FROM enrollments WHERE class_id = c.id AND is_deleted=0) as enrolled, "
     "(SELECT COUNT(*) FROM lesson_standby WHERE class_id = c.id AND is_deleted=0) as standby "
     "FROM classes c WHERE c.is_deleted=0 ORDER BY c.id"],
    capture_output=True, text=True).stdout.strip()
print(f"\n📊 Class fill:\n{fill}")

print("\n🎉 DONE — all data created via API")
