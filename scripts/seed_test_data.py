#!/usr/bin/env python3
"""Re-seed enrollments, checkins, standby, makeups (students already exist)."""
import sqlite3, random
from datetime import datetime

DB = "/home/bill/course_manage_v2/instance/data.db"
db = sqlite3.connect(DB)
db.execute("PRAGMA foreign_keys = OFF")
c = db.cursor()

random.seed(42)

# ── Class seat config ────────────────────────────────────────────────
CLASS_SEAT_MAP = {
    1: 3, 2: 4, 3: 5,
    4: 4, 5: 3,
    6: 30,
    7: 5, 8: 3, 9: 2, 10: 6, 11: 4, 12: 30,
    13: 4, 14: 3, 15: 10,
}

print("Updating class seats...")
for cid, seats in CLASS_SEAT_MAP.items():
    db.execute("UPDATE classes SET seat = ? WHERE id = ?", (seats, cid))

# ── Get all students by DSE year ─────────────────────────────────────
new_students = c.execute(
    "SELECT id, dse_year FROM students WHERE id >= 27 ORDER BY id"
).fetchall()

s6_pool = [s[0] for s in new_students if s[1] == 2026]
f3_pool = [s[0] for s in new_students if s[1] == 2029]
s5_pool = [s[0] for s in new_students if s[1] == 2027]
other_pool = [s[0] for s in new_students if s[1] not in (2026, 2027, 2029)]

random.shuffle(s6_pool)
random.shuffle(f3_pool)
random.shuffle(s5_pool)
random.shuffle(other_pool)

print(f"Student pools: S6={len(s6_pool)}, F3={len(f3_pool)}, S5={len(s5_pool)}, Other={len(other_pool)}")

# ── Enroll across classes ─────────────────────────────────────────────
CLASS_CONFIG = [
    (1,  "s6", 15),   # S6 Chem A (seat=3) → oversub
    (2,  "s6", 12),   # S6 Chem B (seat=4)
    (3,  "s6", 12),   # S6 Chem C (seat=5)
    (4,  "s6", 15),   # S6 技巧 A (seat=4)
    (5,  "s6", 5),    # S6 技巧 B (seat=3) — small
    (6,  "s6", 8),    # S6 操卷班 (seat=30) — lots of room
    (7,  "f3", 25),   # F3 Eng A (seat=5)
    (8,  "f3", 20),   # F3 Eng B (seat=3)
    (9,  "f3", 20),   # F3 Math A (seat=2)
    (10, "f3", 15),   # F3 Math B (seat=6)
    (11, "f3", 12),   # F3 Sci A (seat=4)
    (12, "f3", 6),    # F3 Chem Free (seat=30)
    (13, "s5", 15),   # S5 Chem A (seat=4)
    (14, "s5", 12),   # S5 Chem B (seat=3)
    (15, "s5", 10),   # S5 補底 A (seat=10)
]

pools = {"s6": s6_pool, "f3": f3_pool, "s5": s5_pool, "other": other_pool}
pool_idx = {"s6": 0, "f3": 0, "s5": 0, "other": 0}

print("\nCreating enrollments...")
for cid, pool_key, count in CLASS_CONFIG:
    pool = pools[pool_key]
    idx = pool_idx[pool_key]
    available = len(pool) - idx
    count = min(count, available)
    if count <= 0:
        print(f"  class {cid}: ⚠️ no more {pool_key} students")
        continue

    student_ids = pool[idx:idx + count]
    pool_idx[pool_key] = idx + count

    for sid in student_ids:
        purchase = random.choices([12, 10, 8, 6, 4, 2], weights=[30, 20, 20, 15, 10, 5])[0]
        pay_status = random.choices(["paid", "unpaid", "partial"], weights=[60, 30, 10])[0]
        pay_amount = round(random.uniform(1000, 5000), 0)
        pay_method = random.choices(["cash", "fps", "bank", None], weights=[30, 40, 20, 10])[0]

        c.execute(
            "INSERT INTO enrollments (student_id, class_id, pay_status, pay_amount, pay_method, purchase, used, remaining) VALUES (?, ?, ?, ?, ?, ?, 0, ?)",
            (sid, cid, pay_status, pay_amount, pay_method, purchase, purchase)
        )
    print(f"  class {cid}: enrolled {count} {pool_key} students")

db.commit()

# ── Create checkins (sequential!) ────────────────────────────────────
print("\nCreating checkins (sequential attendance)...")
enrollments = c.execute(
    "SELECT e.id, e.student_id, e.class_id FROM enrollments e WHERE e.is_deleted = 0"
).fetchall()

STATUS_WEIGHTS = {
    "present": 85,
    "makeup": 5,
    "recording_room_present": 3,
    "video_makeup": 2,
}

LAST_STATUS_WEIGHTS = {
    "present": 80,
    "makeup": 3,
    "recording_room_present": 2,
    "video_makeup": 2,
    "leave": 8,
    "absent": 5,
}

chk_count = 0
for enr_id, sid, cid in enrollments:
    lessons = c.execute(
        "SELECT id, num FROM lessons WHERE class_id = ? AND is_deleted = 0 ORDER BY num",
        (cid,)
    ).fetchall()

    if not lessons:
        continue

    # Each student attends a contiguous run from lesson 1
    # Some attend only first few lessons, some attend most
    max_run = max(1, int(len(lessons) * random.uniform(0.3, 0.85)))
    attended = 0

    for lesson_id, lnum in lessons:
        if attended >= max_run:
            break

        # Every lesson in the run gets a checkin (no gaps allowed)
        # Using LAST_STATUS_WEIGHTS for the final lesson (may have leave/absent at end only)
        weights = LAST_STATUS_WEIGHTS if attended == max_run - 1 else STATUS_WEIGHTS
        status = random.choices(
            list(weights.keys()),
            weights=list(weights.values())
        )[0]

        checkin_time = None
        if status == "present":
            checkin_time = f"2026-{random.randint(5,8):02d}-{random.randint(1,28):02d}T{random.randint(9,11):02d}:{random.randint(0,59):02d}:00"

        try:
            c.execute(
                "INSERT OR IGNORE INTO lesson_checkins (lesson_id, student_id, enrollment_id, status, checkin_time, source) VALUES (?, ?, ?, ?, ?, 'enrolled')",
                (lesson_id, sid, enr_id, status, checkin_time)
            )
            chk_count += 1
            attended += 1
        except Exception:
            pass

db.commit()
print(f"  {chk_count} checkins (sequential, contiguous from lesson 1)")

# ── Create standby entries ───────────────────────────────────────────
print("\nCreating standby/waiting list...")
now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
standby_count = 0

classes = c.execute(
    "SELECT id, seat FROM classes WHERE is_deleted = 0 AND seat IS NOT NULL"
).fetchall()

for cid, seat in classes:
    enrolled = c.execute(
        "SELECT COUNT(*) FROM enrollments WHERE class_id = ? AND is_deleted = 0",
        (cid,)
    ).fetchone()[0]

    if enrolled > seat:
        excess = enrolled - seat
        excess_enrollments = c.execute(
            "SELECT e.id, e.student_id FROM enrollments e WHERE e.class_id = ? AND e.is_deleted = 0 ORDER BY RANDOM() LIMIT ?",
            (cid, excess)
        ).fetchall()

        for enr_id, sid in excess_enrollments:
            try:
                c.execute(
                    "INSERT OR IGNORE INTO lesson_standby (class_id, student_id, status, trigger_time, note) VALUES (?, ?, 'waiting', ?, '系統自動候補（滿額）')",
                    (cid, sid, now)
                )
                standby_count += 1
            except Exception:
                pass
        print(f"  class {cid}: {len(excess_enrollments)} standby (seat={seat}, enrolled={enrolled})")

db.commit()
print(f"  Total standby: {standby_count}")

# ── Create makeup entries ────────────────────────────────────────────
print("\nCreating makeup lessons...")
absent_checkins = c.execute(
    """SELECT lc.student_id, lc.lesson_id, e.class_id, l.num
       FROM lesson_checkins lc
       JOIN enrollments e ON lc.enrollment_id = e.id
       JOIN lessons l ON lc.lesson_id = l.id
       WHERE lc.status IN ('absent', 'leave') AND e.is_deleted = 0
       LIMIT 40"""
).fetchall()

for sid, lesson_id, cid, lnum in absent_checkins:
    makeup_type = random.choices(["課室錄播", "線上錄播", "課室補課"], weights=[40, 30, 30])[0]
    status = random.choices(["scheduled", "completed"], weights=[60, 40])[0]
    absent_date = f"2026-{random.randint(5,8):02d}-{random.randint(1,28):02d}"
    c.execute(
        "INSERT INTO makeup_lessons (student_id, original_class_id, lesson_num, absent_date, makeup_type, status) VALUES (?, ?, ?, ?, ?, ?)",
        (sid, cid, str(lnum), absent_date, makeup_type, status)
    )

print(f"  {len(absent_checkins)} makeup entries created")

# ── Final summary ────────────────────────────────────────────────────
db.commit()

print("\n" + "=" * 50)
print("✅ RE-SEEDING COMPLETE")
print("=" * 50)
print(f"  Enrollments: {c.execute('SELECT COUNT(*) FROM enrollments WHERE is_deleted=0').fetchone()[0]}")
print(f"  Checkins: {c.execute('SELECT COUNT(*) FROM lesson_checkins').fetchone()[0]}")
print(f"  Standby: {c.execute('SELECT COUNT(*) FROM lesson_standby WHERE is_deleted=0').fetchone()[0]}")
print(f"  Makeups: {c.execute('SELECT COUNT(*) FROM makeup_lessons WHERE is_deleted=0').fetchone()[0]}")

# Validate sequential attendance
print("\n=== Sequential validation (sample) ===")
for r in c.execute("""
    SELECT e.id, s.surname || ' ' || s.given_name, c.name as class_name,
           MIN(l.num) as first_lesson, MAX(l.num) as last_lesson, COUNT(lc.id) as total_checkins
    FROM enrollments e
    JOIN students s ON e.student_id = s.id
    JOIN classes c ON e.class_id = c.id
    JOIN lesson_checkins lc ON lc.enrollment_id = e.id
    JOIN lessons l ON lc.lesson_id = l.id
    WHERE e.is_deleted = 0 AND s.id >= 27
    GROUP BY e.id
    ORDER BY RANDOM()
    LIMIT 10
"""):
    print(f"  enr #{r[0]:3d} | {r[1]:30s} | {r[2]:15s} | lessons {r[3]:2d}–{r[4]:2d} ({r[5]} checkins)")

# Show class fill
print("\n=== Class fill status ===")
for r in c.execute("""
    SELECT c.id, c.name, c.seat,
           (SELECT COUNT(*) FROM enrollments WHERE class_id = c.id AND is_deleted = 0) as enrolled,
           (SELECT COUNT(*) FROM lesson_standby WHERE class_id = c.id AND is_deleted = 0) as standby
    FROM classes c WHERE c.is_deleted = 0 ORDER BY c.id
"""):
    cid, name, seat, enrolled, standby = r
    if seat and enrolled >= seat:
        icon = '🔴 FULL'
    elif seat and enrolled >= seat * 0.8:
        icon = '🟡 80%+'
    else:
        icon = '🟢'
    ratio = f'{enrolled}/{seat}' if seat else f'{enrolled}/∞'
    print(f'  class {cid:2d} {icon} | {name:<20} {ratio:>10} | {standby} standby')

db.close()
