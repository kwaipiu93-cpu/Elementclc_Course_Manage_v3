#!/usr/bin/env python3
"""2026年7月測試數據產生器"""
import sqlite3
import random
import datetime

DB = "instance/data.db"
random.seed(202607)

conn = sqlite3.connect(DB)
cur = conn.cursor()

# ─── July 2026 calendar ───
# Wed 1, Thu 2, Fri 3, Sat 4, Sun 5, Mon 6, Tue 7, Wed 8, Thu 9, Fri 10,
# Sat 11, Sun 12, Mon 13, Tue 14, Wed 15, Thu 16, Fri 17, Sat 18, Sun 19,
# Mon 20, Tue 21, Wed 22, Thu 23, Fri 24, Sat 25, Sun 26, Mon 27, Tue 28,
# Wed 29, Thu 30, Fri 31

today = datetime.date(2026, 7, 9)

# ─── 1. Lessons ────────────────────────────────────────────
# Class 6: DSE Chem SAT-A (Sat 14:00-16:00) — last lesson #12 on 2026-06-27
# → lessons 13-16 on July 4, 11, 18, 25
july_sats = [4, 11, 18, 25]
for i, day in enumerate(july_sats, start=13):
    date_str = f"2026-07-{day:02d}"
    # Check if already exists
    exists = cur.execute(
        "SELECT id FROM lessons WHERE class_id=6 AND num=? AND is_deleted=0", (i,)
    ).fetchone()
    if not exists:
        cur.execute(
            "INSERT INTO lessons (class_id, num, date, start, end, updated_by) VALUES (6,?,?,'14:00','16:00',1)",
            (i, date_str)
        )
        lid = cur.lastrowid
        print(f"  Class 6 lesson #{i}: {date_str} (id={lid})")
    else:
        print(f"  Class 6 lesson #{i}: {date_str} (already exists, id={exists[0]})")

# Class 12: F5 Chem 預備班 A (Tue 18:00-20:00) — last lesson #12 on 2026-06-23
# → lessons 13-16 on July 7, 14, 21, 28
july_tues = [7, 14, 21, 28]
for i, day in enumerate(july_tues, start=13):
    date_str = f"2026-07-{day:02d}"
    exists = cur.execute(
        "SELECT id FROM lessons WHERE class_id=12 AND num=? AND is_deleted=0", (i,)
    ).fetchone()
    if not exists:
        cur.execute(
            "INSERT INTO lessons (class_id, num, date, start, end, updated_by) VALUES (12,?,?,'18:00','20:00',1)",
            (i, date_str)
        )
        lid = cur.lastrowid
        print(f"  Class 12 lesson #{i}: {date_str} (id={lid})")
    else:
        print(f"  Class 12 lesson #{i}: {date_str} (already exists, id={exists[0]})")

# Class 8 (補課錄播班) — already has July 4-12, add more for rest of July
# Flexible time 09:00-18:00
july_extra = [14, 15, 16, 17, 21, 22, 23, 24, 28, 29, 30, 31]
# Get current max lesson num for class 8
max_num_8 = cur.execute(
    "SELECT COALESCE(MAX(num),0) FROM lessons WHERE class_id=8 AND is_deleted=0"
).fetchone()[0]
for i, day in enumerate(july_extra, start=max_num_8 + 1):
    date_str = f"2026-07-{day:02d}"
    exists = cur.execute(
        "SELECT id FROM lessons WHERE class_id=8 AND date=? AND is_deleted=0", (date_str,)
    ).fetchone()
    if not exists:
        cur.execute(
            "INSERT INTO lessons (class_id, num, date, start, end, updated_by) VALUES (8,?,?,'09:00','18:00',1)",
            (i, date_str)
        )
        lid = cur.lastrowid
        print(f"  Class 8 lesson #{i}: {date_str} (id={lid})")

print(f"✅ July lessons created")

# ─── 2. Checkins for July lessons ──────────────────────────
all_lessons = cur.execute(
    "SELECT id, class_id, num, date FROM lessons WHERE is_deleted=0 AND date LIKE '2026-07-%' AND date IS NOT NULL ORDER BY class_id, num"
).fetchall()
print(f"\n📋 Processing checkins for {len(all_lessons)} July lessons...")

enrolls = cur.execute(
    "SELECT id, student_id, class_id FROM enrollments WHERE is_deleted=0 AND status='active'"
).fetchall()
print(f"  Active enrollments: {len(enrolls)}")

enroll_by_class = {}
for eid, sid, cid in enrolls:
    enroll_by_class.setdefault(cid, []).append((eid, sid))

ck_count = 0
ck_keys = set()

for lid, lcid, lnum, ldate_str in all_lessons:
    ldate = datetime.date.fromisoformat(ldate_str)
    is_past = ldate <= today
    is_future = ldate > today
    class_enrolls = enroll_by_class.get(lcid, [])

    if lcid in (8, 13):  # 補課班 skip checkins
        continue

    for eid, sid in class_enrolls:
        key = (lid, sid)
        if key in ck_keys:
            continue

        if is_past:
            r = random.random()
            if r < 0.68:
                status = 'present'
                ctime = f"{ldate_str} {random.choice(['13:','14:','14:','15:'])}{random.randint(0,59):02d}:00"
            elif r < 0.80:
                status = 'present'
                ctime = f"{ldate_str} {random.choice(['14:','15:'])}{random.randint(0,59):02d}:00"
            elif r < 0.87:
                status = 'late'
                ctime = f"{ldate_str} {random.randint(15,17):02d}:{random.randint(0,59):02d}:00"
            elif r < 0.94:
                status = 'leave'
                ctime = None
            else:
                status = 'absent'
                ctime = None

            cur.execute(
                "INSERT OR IGNORE INTO lesson_checkins (lesson_id, student_id, enrollment_id, status, checkin_time, source, homework_done) "
                "VALUES (?,?,?,?,?,'enrolled',?)",
                (lid, sid, eid, status, ctime, 1 if random.random() < 0.85 else 0)
            )
            if cur.rowcount > 0:
                ck_keys.add(key)
                ck_count += 1
                cur.execute(
                    "INSERT OR IGNORE INTO attendances (enrollment_id, lesson_num, status, checkin_time) VALUES (?,?,?,?)",
                    (eid, lnum, status, ctime)
                )
        elif is_future and random.random() < 0.05:
            status = random.choice(['leave', 'absent'])
            cur.execute(
                "INSERT OR IGNORE INTO lesson_checkins (lesson_id, student_id, enrollment_id, status, checkin_time, source) "
                "VALUES (?,?,?,?,NULL,'enrolled')",
                (lid, sid, eid, status)
            )
            if cur.rowcount > 0:
                ck_keys.add(key)
                ck_count += 1
                cur.execute(
                    "INSERT OR IGNORE INTO attendances (enrollment_id, lesson_num, status, checkin_time) VALUES (?,?,?,?)",
                    (eid, lnum, status, None)
                )

print(f"✅ Created {ck_count} July checkins")

# ─── 3. Makeups for July absent/leave ──────────────────────
absent_ck = cur.execute(
    "SELECT lc.student_id, lc.lesson_id, l.date, l.class_id, l.num "
    "FROM lesson_checkins lc JOIN lessons l ON l.id=lc.lesson_id "
    "WHERE lc.status IN ('leave','absent') AND l.date LIKE '2026-07-%' AND l.date IS NOT NULL"
).fetchall()
print(f"\n📋 Processing makeups for {len(absent_ck)} July absences...")

mk_count = 0
for sid, lid, ldate, cid, lnum in absent_ck:
    if random.random() < 0.4:  # 40% 會申請補堂
        cur.execute(
            "INSERT INTO makeup_lessons (student_id, original_class_id, lesson_num, absent_date, status, updated_by) "
            "VALUES (?,?,?,?,'pending',1)",
            (sid, cid, str(lnum), ldate)
        )
        mk_count += 1

print(f"✅ Created {mk_count} July makeup requests")

# ─── 4. July invoices ──────────────────────────────────────
print(f"\n📋 Creating July invoices...")
inv_count = 0

# New invoices for July enrollments or tuition
july_enrolls = cur.execute(
    "SELECT e.id, e.student_id, e.class_id, e.pay_amount, e.pay_method, e.pay_status "
    "FROM enrollments e WHERE is_deleted=0 AND e.pay_status='Unpaid'"
).fetchall()

for eid, sid, cid, pay_amt, pay_mtd, pay_st in july_enrolls:
    if random.random() < 0.3:  # 30% 未找的會開 7 月 invoice
        cur.execute(
            "INSERT INTO invoices (enrollment_id, student_id, type, amount, status, created_at) "
            "VALUES (?,?,'tuition',?,'unpaid',?)",
            (eid, sid, random.choice([4200, 4800, 3600, 3000]),
             f"2026-07-{random.randint(1,9):02d}")
        )
        inv_count += 1

# Extra material invoices
for i in range(8):
    sid = random.randint(1, 88)
    eid_row = cur.execute(
        "SELECT id FROM enrollments WHERE student_id=? AND is_deleted=0 LIMIT 1", (sid,)
    ).fetchone()
    if eid_row:
        cur.execute(
            "INSERT INTO invoices (enrollment_id, student_id, type, amount, status, created_at) "
            "VALUES (?,?,'material',?,'unpaid',?)",
            (eid_row[0], sid, random.choice([150, 200, 300, 500]),
             f"2026-07-{random.randint(1,9):02d}")
        )
        inv_count += 1

print(f"✅ Created {inv_count} July invoices")

# ─── 5. Product purchases for July ─────────────────────────
print(f"\n📋 Creating July product purchases...")
prod_purch_count = 0
student_ids = [r[0] for r in cur.execute("SELECT id FROM students WHERE is_deleted=0").fetchall()]

for sid in random.sample(student_ids, min(10, len(student_ids))):
    pid = random.choice([2, 3])  # 耳機 or video 補課手續費
    qty = 1 if pid == 3 else random.randint(1, 2)
    price = 20.0 if pid == 2 else 50.0
    cur.execute(
        "INSERT INTO product_purchases (student_id, product_id, quantity, total_price, pay_status, note, updated_by) "
        "VALUES (?,?,?,?,?,?,1)",
        (sid, pid, qty, price * qty,
         random.choice(['Paid', 'Unpaid']),
         'July 購買' if random.random() < 0.5 else '')
    )
    prod_purch_count += 1

print(f"✅ Created {prod_purch_count} July product purchases")

# ─── 6. Scan sessions for July ─────────────────────────────
print(f"\n📋 Creating July scan sessions...")
july_lessons_with_date = cur.execute(
    "SELECT id FROM lessons WHERE date LIKE '2026-07-%' AND date <= ? LIMIT 3",
    (today.isoformat(),)
).fetchall()

scan_count = 0
for (lid,) in july_lessons_with_date:
    if random.random() < 0.6:
        cur.execute(
            "INSERT INTO scan_sessions (lesson_id, active, started_at, stopped_at) "
            "VALUES (?,0,?,?)",
            (lid,
             f"2026-07-{random.randint(1,9):02d} {random.randint(13,14):02d}:{random.randint(0,59):02d}:00",
             f"2026-07-{random.randint(4,9):02d} {random.randint(15,17):02d}:{random.randint(0,59):02d}:00")
        )
        scan_count += 1

print(f"✅ Created {scan_count} July scan sessions")

conn.commit()
conn.close()
print("\n🎉 July 2026 test data added successfully!")
