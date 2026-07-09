#!/usr/bin/env python3
"""July 2026 測試數據 — 每日至少3班"""
import sqlite3
import random
import datetime

DB = "instance/data.db"
random.seed(202607)

conn = sqlite3.connect(DB)
cur = conn.cursor()
today = datetime.date(2026, 7, 9)

# ─── July dates by weekday ───
july_wed = [1, 8, 15, 22, 29]
july_thu = [2, 9, 16, 23, 30]
july_fri = [3, 10, 17, 24, 31]
july_sat = [4, 11, 18, 25]
july_sun = [5, 12, 19, 26]
july_mon = [6, 13, 20, 27]
july_tue = [7, 14, 21, 28]

lesson_schedule = []

# Class 1: DSE Chem P6A (Sat 09:00-11:00) — lessons 13-16
for i, day in enumerate(july_sat, start=13):
    lesson_schedule.append((1, i, f"2026-07-{day:02d}", "09:00", "11:00"))

# Class 2: DSE Chem P6B (Sat 11:30-13:30) — lessons 13-16
for i, day in enumerate(july_sat, start=13):
    lesson_schedule.append((2, i, f"2026-07-{day:02d}", "11:30", "13:30"))

# Class 3: DSE Chem P5A (Fri 17:00-19:00) — lessons 13-17 (5 Fridays)
for i, day in enumerate(july_fri, start=13):
    lesson_schedule.append((3, i, f"2026-07-{day:02d}", "17:00", "19:00"))

# Class 4: DSE Chem P6C (Sun 10:00-12:00) — lessons 13-16
for i, day in enumerate(july_sun, start=13):
    lesson_schedule.append((4, i, f"2026-07-{day:02d}", "10:00", "12:00"))

# Class 5: DSE Chem P6D (Sun 14:00-16:00) — lessons 13-16
for i, day in enumerate(july_sun, start=13):
    lesson_schedule.append((5, i, f"2026-07-{day:02d}", "14:00", "16:00"))

# Class 6: SAT-A (Sat 14:00-16:00) — already has lessons 13-16, skip

# Class 7: SAT操卷班 A — extend to Sun 09:00-12:00 AND Mon 09:00-12:00 (暑假特訓)
max7 = 12
for day in july_sun:
    max7 += 1
    lesson_schedule.append((7, max7, f"2026-07-{day:02d}", "09:00", "12:00"))
for day in july_mon:
    max7 += 1
    lesson_schedule.append((7, max7, f"2026-07-{day:02d}", "09:00", "12:00"))

# Class 9: F3A 基礎化學 (Wed 17:00-18:30) — lessons 13-17
for i, day in enumerate(july_wed, start=13):
    lesson_schedule.append((9, i, f"2026-07-{day:02d}", "17:00", "18:30"))

# Class 10: 微觀F3A (Thu 17:00-18:30) — lessons 13-17
for i, day in enumerate(july_thu, start=13):
    lesson_schedule.append((10, i, f"2026-07-{day:02d}", "17:00", "18:30"))

# Class 11: F3C 基礎化學 (Sat 10:00-11:30) — lessons 13-16
for i, day in enumerate(july_sat, start=13):
    lesson_schedule.append((11, i, f"2026-07-{day:02d}", "10:00", "11:30"))

# Class 8: 補課錄播班 — extend to ALL July weekdays
all_july_weekdays = sorted(set(july_mon + july_tue + july_wed + july_thu + july_fri + july_sat + july_sun))
max8 = cur.execute("SELECT COALESCE(MAX(num),0) FROM lessons WHERE class_id=8 AND is_deleted=0").fetchone()[0]
for day in all_july_weekdays:
    ds = f"2026-07-{day:02d}"
    exists = cur.execute("SELECT id FROM lessons WHERE class_id=8 AND date=? AND is_deleted=0", (ds,)).fetchone()
    if not exists:
        max8 += 1
        lesson_schedule.append((8, max8, ds, "09:00", "18:00"))

# Class 13: 補課錄播班 F3 — add Mon-Fri all July
max13 = 0
for day in all_july_weekdays:
    ds = f"2026-07-{day:02d}"
    max13 += 1
    lesson_schedule.append((13, max13, ds, "09:00", "18:00"))

# ─── Insert lessons ───
inserted = 0
for cid, num, date_str, start, end in lesson_schedule:
    exists = cur.execute(
        "SELECT id FROM lessons WHERE class_id=? AND num=? AND is_deleted=0", (cid, num)
    ).fetchone()
    if not exists:
        cur.execute(
            "INSERT INTO lessons (class_id, num, date, start, end, updated_by) VALUES (?,?,?,?,?,1)",
            (cid, num, date_str, start, end)
        )
        inserted += 1

print(f"✅ Created {inserted} new July lessons across all classes")

# ─── Verify daily coverage ───
cov = cur.execute("""
    SELECT l.date, COUNT(DISTINCT l.class_id) as cnt
    FROM lessons l WHERE l.date LIKE '2026-07-%' AND l.is_deleted=0
    GROUP BY l.date ORDER BY l.date
""").fetchall()

print(f"\n📋 July daily coverage ({len(cov)} days):")
for date_str, cnt in cov:
    flag = "✅" if cnt >= 3 else "❌"
    print(f"  {flag} {date_str}: {cnt} classes")

below3 = [(d,c) for d,c in cov if c < 3]
if below3:
    print(f"\n⚠️ {len(below3)} days still below 3 classes!")
else:
    print(f"\n✅ All days have at least 3 classes!")

# ─── Checkins for July ──────────────────────────────────────
all_lessons = cur.execute(
    "SELECT id, class_id, num, date FROM lessons WHERE is_deleted=0 AND date LIKE '2026-07-%' AND date IS NOT NULL ORDER BY class_id, num"
).fetchall()

enrolls = cur.execute(
    "SELECT id, student_id, class_id FROM enrollments WHERE is_deleted=0 AND status='active'"
).fetchall()

enroll_by_class = {}
for eid, sid, cid in enrolls:
    enroll_by_class.setdefault(cid, []).append((eid, sid))

print(f"\n📋 Generating checkins for {len(all_lessons)} July lessons ({len(enrolls)} active enrollments)...")

ck_count = 0
ck_keys = set()

# Pre-load existing checkin keys
existing = cur.execute(
    "SELECT lesson_id, student_id FROM lesson_checkins WHERE lesson_id IN (SELECT id FROM lessons WHERE date LIKE '2026-07-%' AND is_deleted=0)"
).fetchall()
for lid, sid in existing:
    ck_keys.add((lid, sid))

for lid, lcid, lnum, ldate_str in all_lessons:
    ldate = datetime.date.fromisoformat(ldate_str)
    is_past = ldate <= today
    class_enrolls = enroll_by_class.get(lcid, [])

    if lcid in (8, 13):  # 補課班 — skip regular checkins
        continue

    for eid, sid in class_enrolls:
        key = (lid, sid)
        if key in ck_keys:
            continue

        if is_past:
            r = random.random()
            if r < 0.65:
                status = 'present'
                hour = random.choice([8, 9, 9, 10, 10])
                ctime = f"{ldate_str} {hour:02d}:{random.randint(0,59):02d}:00"
            elif r < 0.78:
                status = 'present'
                hour = random.randint(10, 12)
                ctime = f"{ldate_str} {hour:02d}:{random.randint(0,59):02d}:00"
            elif r < 0.87:
                status = 'late'
                ctime = f"{ldate_str} {random.randint(12,16):02d}:{random.randint(0,59):02d}:00"
            elif r < 0.94:
                status = 'leave'
                ctime = None
            else:
                status = 'absent'
                ctime = None

            hw = 1 if random.random() < 0.82 else 0
            cur.execute(
                "INSERT OR IGNORE INTO lesson_checkins (lesson_id, student_id, enrollment_id, status, checkin_time, source, homework_done) "
                "VALUES (?,?,?,?,?,'enrolled',?)",
                (lid, sid, eid, status, ctime, hw)
            )
            if cur.rowcount > 0:
                ck_keys.add(key)
                ck_count += 1
                cur.execute(
                    "INSERT OR IGNORE INTO attendances (enrollment_id, lesson_num, status, checkin_time) VALUES (?,?,?,?)",
                    (eid, lnum, status, ctime)
                )

print(f"✅ Created {ck_count} new July checkins (total July: {len(ck_keys)})")

# ─── Makeups for July absences ──────────────────────────────
absent_ck = cur.execute(
    """SELECT DISTINCT lc.student_id, lc.lesson_id, l.date, l.class_id, l.num 
       FROM lesson_checkins lc JOIN lessons l ON l.id=lc.lesson_id 
       WHERE lc.status IN ('leave','absent') AND l.date LIKE '2026-07-%' 
         AND l.date IS NOT NULL
         AND lc.id NOT IN (SELECT COALESCE(MIN(id),0) FROM lesson_checkins GROUP BY student_id, lesson_id)"""
).fetchall()

# Simpler: just get distinct absences
absent_ck = cur.execute(
    """SELECT lc.student_id, lc.lesson_id, l.date, l.class_id, l.num
       FROM lesson_checkins lc
       JOIN lessons l ON l.id = lc.lesson_id
       WHERE lc.status IN ('leave','absent') AND l.date LIKE '2026-07-%' AND l.date IS NOT NULL
    """
).fetchall()

mk_count = 0
seen_mk = set()
for sid, lid, ldate, cid, lnum in absent_ck:
    key = (sid, ldate)
    if key in seen_mk:
        continue
    seen_mk.add(key)
    if random.random() < 0.35:
        cur.execute(
            "INSERT INTO makeup_lessons (student_id, original_class_id, lesson_num, absent_date, status, updated_by) "
            "VALUES (?,?,?,?,'pending',1)",
            (sid, cid, str(lnum), ldate)
        )
        mk_count += 1

print(f"✅ Created {mk_count} July makeup requests")

# ─── July invoices ──────────────────────────────────────────
unpaid = cur.execute(
    "SELECT id, student_id FROM enrollments WHERE is_deleted=0 AND pay_status='Unpaid'"
).fetchall()

inv_count = 0
for eid, sid in unpaid:
    if random.random() < 0.25:
        cur.execute(
            "INSERT INTO invoices (enrollment_id, student_id, type, amount, status, created_at) "
            "VALUES (?,?,'tuition',?,'unpaid',?)",
            (eid, sid, random.choice([4200, 4800, 3600, 3000]),
             f"2026-07-{random.randint(1,9):02d}")
        )
        inv_count += 1

print(f"✅ Created {inv_count} July invoices")

conn.commit()
conn.close()
print(f"\n🎉 July data complete!")
