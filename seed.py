import sqlite3
import sys
from datetime import date, timedelta

DB = '/home/bill/course_manage_v2/instance/data.db'

# ─── Connect ───────────────────────────────────────────────────────────────
db = sqlite3.connect(DB)
db.execute("PRAGMA foreign_keys = OFF")
db.execute("PRAGMA journal_mode = WAL")
cur = db.cursor()

# ─── Clear all data ───────────────────────────────────────────────────────
tables = [
    'invoices', 'attendance_log', 'scan_sessions', 'lesson_standby',
    'lesson_checkins', 'makeup_lessons', 'attendances', 'enrollments',
    'lessons', 'classes', 'topics', 'year_courses', 'students'
]
for t in tables:
    cur.execute(f"DELETE FROM {t}")

print("✅ Cleared all tables (preserved users)")

# ─── Year Courses ─────────────────────────────────────────────────────────
year_courses = [
    (1, '2026-2027 DSE Chem 常規課程', 2026, 'F.6'),
    (2, '2026-2027 DSE 常規 F3', 2026, 'F.3'),
    (3, '2027-2028 DSE Chem 常規課程', 2027, 'F.5'),
]

for yc_id, name, year, grade in year_courses:
    cur.execute(
        "INSERT INTO year_courses (id, name, year, grade) VALUES (?, ?, ?, ?)",
        (yc_id, name, year, grade)
    )

print(f"✅ Seeded {len(year_courses)} year courses")

# ─── Topics ────────────────────────────────────────────────────────────────
topics = [
    # F.6 Chem (year_course_id=1)
    (1, 1, 'Chem 常規', '課堂教學', 12, 4800, 500, 450, 50, 1),
    (2, 1, 'Chem 技巧班', '課堂教學', 8, 3200, 450, 400, 40, 2),
    (3, 1, 'Chem 的終極操卷', '課堂教學', 6, 2800, 500, 450, 50, 3),
    # F.3 (year_course_id=2)
    (4, 2, 'F3 英文', '課堂教學', 12, 3600, 350, 300, 30, 1),
    (5, 2, 'F3 數學', '課堂教學', 12, 3600, 350, 300, 30, 2),
    (6, 2, 'F3 科學', '課堂教學', 10, 3000, 350, 300, 30, 3),
    (7, 2, 'F3 Chem (免費體驗班)', '課堂教學', 4, 0, 0, 0, 0, 4),
    # F.5 Chem (year_course_id=3)
    (8, 3, 'F5 Chem 常規', '課堂教學', 12, 4200, 450, 400, 45, 1),
    (9, 3, 'F5 Chem 補底班', '課堂教學', 10, 3500, 400, 350, 40, 2),
]

for t_id, yc_id, name, ttype, lessons, fee, new_p, ins_p, mk_fee, sort in topics:
    cur.execute(
        "INSERT INTO topics (id, year_course_id, name, type, lessons, fee, unit_price_new, unit_price_insert, makeup_fee, sort) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (t_id, yc_id, name, ttype, lessons, fee, new_p, ins_p, mk_fee, sort)
    )

print(f"✅ Seeded {len(topics)} topics")

# ─── Classes ───────────────────────────────────────────────────────────────
classes = [
    # F.6 Chem classes
    (1, 1, 'S6 Chem A', '逢六 10:00-12:00', '2026-09-05', 20),
    (2, 1, 'S6 Chem B', '逢六 14:00-16:00', '2026-09-05', 18),
    (3, 1, 'S6 Chem C', '逢日 10:00-12:00', '2026-09-06', 15),
    # F.6 技巧班
    (4, 2, 'S6 技巧 A', '逢六 16:30-18:30', '2026-09-05', 15),
    (5, 2, 'S6 技巧 B', '逢日 14:00-16:00', '2026-09-06', 12),
    # F.6 操卷
    (6, 3, 'S6 操卷班', '逢六 09:00-11:00', '2026-10-03', 20),
    # F.3 English
    (7, 4, 'F3 Eng A', '逢六 09:00-11:00', '2026-09-05', 25),
    (8, 4, 'F3 Eng B', '逢日 09:00-11:00', '2026-09-06', 25),
    # F.3 Math
    (9, 5, 'F3 Math A', '逢六 11:30-13:30', '2026-09-05', 25),
    (10, 5, 'F3 Math B', '逢日 11:30-13:30', '2026-09-06', 20),
    # F.3 Science
    (11, 6, 'F3 Sci A', '逢六 14:00-16:00', '2026-09-05', 20),
    # F.3 Chem (免費)
    (12, 7, 'F3 Chem Free A', '逢日 16:30-18:30', '2026-09-06', 30),
    # F.5 Chem
    (13, 8, 'S5 Chem A', '逢六 10:00-12:00', '2026-09-05', 20),
    (14, 8, 'S5 Chem B', '逢日 10:00-12:00', '2026-09-06', 18),
    (15, 9, 'S5 補底 A', '逢六 14:00-16:00', '2026-09-05', 15),
]

for c_id, t_id, name, week, first_lesson, seat in classes:
    cur.execute(
        "INSERT INTO classes (id, topic_id, name, week, first_lesson, seat) VALUES (?, ?, ?, ?, ?, ?)",
        (c_id, t_id, name, week, first_lesson, seat)
    )

print(f"✅ Seeded {len(classes)} classes")

# ─── Lessons (auto-generate for each class) ────────────────────────────────
WEEKDAY_MAP = {'日': 0, '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6}
lesson_count = 0

for c_id, t_id, name, week, first_lesson_s, seat in classes:
    # Get topic lesson count
    t_lessons = [t[4] for t in topics if t[0] == t_id][0]

    # Parse week to find day of week and time
    import re
    m = re.search(r'逢([日一二三四五六]) (\d{2}:\d{2})-(\d{2}:\d{2})', week)
    if not m:
        continue
    dow_char = m.group(1)
    start_time = m.group(2)
    end_time = m.group(3)
    target_dow = WEEKDAY_MAP.get(dow_char, 6)

    # Parse first_lesson date
    first_date = date.fromisoformat(first_lesson_s)

    # Find first occurrence of target weekday
    current = first_date
    while current.weekday() != (target_dow % 7):  # Python: Mon=0, Sun=6
        current += timedelta(days=1)

    for n in range(1, t_lessons + 1):
        lesson_count += 1
        cur.execute(
            "INSERT INTO lessons (class_id, num, date, start, end) VALUES (?, ?, ?, ?, ?)",
            (c_id, n, current.isoformat(), start_time, end_time)
        )
        current += timedelta(days=7)

print(f"✅ Seeded {lesson_count} lessons")

# ─── Students (realistic HK names & schools) ───────────────────────────────
students = [
    ('陳', '小明', '皇仁書院', '92345678', '98765432', 2027),
    ('張', '子晴', '拔萃女書院', '91234567', '99887766', 2026),
    ('李', '俊傑', '喇沙書院', '93456789', '91234567', 2026),
    ('王', '芷晴', '瑪利諾修院學校', '94567890', '92345678', 2026),
    ('劉', '浩賢', '英皇書院', '95678901', '93456789', 2026),
    ('黃', '穎欣', '協恩中學', '96789012', '94567890', 2026),
    ('梁', '志豪', '聖保羅男女中學', '97890123', '95678901', 2026),
    ('楊', '樂怡', '真光中學', '98901234', '96789012', 2026),
    ('鄭', '梓軒', '華仁書院', '99012345', '97890123', 2026),
    ('吳', '凱琳', '聖士提反女子中學', '90123456', '98901234', 2026),
    ('何', '天佑', '張祝珊英文中學', '90234567', '99012345', 2027),
    ('周', '詠琪', '德望學校', '90345678', '90123456', 2027),
    ('林', '浩朗', '英華書院', '90456789', '90234567', 2027),
    ('郭', '雪瑩', '聖保祿學校', '90567890', '90345678', 2026),
    ('馬', '浩然', '民生書院', '90678901', '90456789', 2027),
    ('鄧', '海晴', '迦密中學', '90789012', '90567890', 2026),
    ('朱', '柏豪', '浸信會呂明才中學', '90890123', '90678901', 2026),
    ('胡', '美琪', '崇真書院', '90901234', '90789012', 2026),
    ('曹', '振宇', '培正中學', '91012345', '90890123', 2027),
    ('余', '佩君', '香港華仁書院', '91123456', '90901234', 2026),
]

for s_id, (surname, given, school, phone, parent_phone, dse_year) in enumerate(students, 1):
    cur.execute(
        "INSERT INTO students (id, surname, given_name, school, phone, parent_phone, dse_year) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (s_id, surname, given, school, phone, parent_phone, dse_year)
    )

print(f"✅ Seeded {len(students)} students")

# ─── Enrollments ──────────────────────────────────────────────────────────
# (student_id, class_id, pay_status, pay_amount, purchase)
enrollments = [
    # S6 Chem A (class 1) - 8 students
    (1, 1, '已繳', 4800, 12), (2, 1, '已繳', 4800, 12), (3, 1, '已繳', 4800, 12),
    (5, 1, '已繳', 4800, 12), (7, 1, '已繳', 4800, 12), (9, 1, '未繳', 0, 12),
    (14, 1, '已繳', 4800, 12), (16, 1, '未繳', 0, 12),
    # S6 Chem B (class 2) - 6 students
    (4, 2, '已繳', 4800, 12), (6, 2, '已繳', 4800, 12), (8, 2, '已繳', 4800, 12),
    (10, 2, '未繳', 0, 12), (15, 2, '已繳', 4800, 12), (18, 2, '已繳', 2400, 6),
    # S6 Chem C (class 3) - 4 students
    (11, 3, '已繳', 4800, 12), (12, 3, '未繳', 0, 12), (17, 3, '已繳', 4800, 12), (20, 3, '已繳', 4800, 12),
    # F3 Eng A (class 7) - 6 students
    (1, 7, '已繳', 3600, 12), (6, 7, '已繳', 3600, 12), (13, 7, '已繳', 3600, 12),
    (15, 7, '未繳', 0, 12), (19, 7, '已繳', 3600, 12), (20, 7, '已繳', 3600, 12),
    # F5 Chem A (class 13) - 5 students
    (7, 13, '已繳', 4200, 12), (9, 13, '已繳', 4200, 12), (13, 13, '未繳', 0, 12),
    (15, 13, '已繳', 4200, 12), (19, 13, '已繳', 2100, 6),
    # F3 Math A (class 9) - 4 students
    (1, 9, '已繳', 3600, 12), (3, 9, '已繳', 3600, 12), (11, 9, '已繳', 3600, 12), (14, 9, '已繳', 3600, 12),
]

enrollment_ids = {}
for idx, (sid, cid, pay_status, pay_amount, purchase) in enumerate(enrollments, 1):
    used = min(3, purchase)
    remaining = purchase - used
    cur.execute(
        "INSERT INTO enrollments (id, student_id, class_id, pay_status, pay_amount, purchase, used, remaining) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (idx, sid, cid, pay_status, pay_amount, purchase, used, remaining)
    )
    enrollment_ids[(sid, cid)] = idx

print(f"✅ Seeded {len(enrollments)} enrollments")

# ─── Lesson Checkins ──────────────────────────────────────────────────────
# For classes 1, 2, 3, 7, 9, 13 - mark first few lessons
statuses = ['present', 'leave', 'absent', 'present', 'present', 'present', 'makeup', 'present', 'present', 'present', 'present', 'present']

checkin_count = 0
for enroll_idx, (sid, cid, pay_status, pay_amount, purchase) in enumerate(enrollments, 1):
    # Get lesson IDs for this class
    cur.execute("SELECT id, num FROM lessons WHERE class_id = ? AND is_deleted = 0 ORDER BY num", (cid,))
    lessons_data = cur.fetchall()

    for lid, lnum in lessons_data:
        if lnum > len(statuses):
            break
        if lnum > 4:  # Only mark first 4 lessons for most
            # Mark randoms
            if enroll_idx % 3 == 0 and lnum <= 6:
                pass  # skip some
            else:
                continue

        st = 'present'
        # Assign some variety
        if enroll_idx == 1 and lnum == 2:
            st = 'leave'
        elif enroll_idx == 2 and lnum == 3:
            st = 'absent'
        elif enroll_idx == 3 and lnum == 3:
            st = 'leave'
        elif enroll_idx == 5 and lnum == 2:
            st = 'leave'
        elif enroll_idx == 5 and lnum == 4:
            st = 'leave'
        elif enroll_idx == 7 and lnum == 4:
            st = 'absent'
        elif enroll_idx == 10 and lnum == 3:
            st = 'leave'
        elif enroll_idx == 12 and lnum == 2:
            st = 'absent'

        cur.execute(
            "INSERT OR IGNORE INTO lesson_checkins (lesson_id, student_id, enrollment_id, status, checkin_time, source) VALUES (?, ?, ?, ?, datetime('now', ?), 'enrolled')",
            (lid, sid, enroll_idx, st, f'-{5-lnum} hours')
        )
        checkin_count += 1

print(f"✅ Seeded {checkin_count} lesson checkins")

# ─── Makeup Lessons (some scheduled, some done) ──────────────────────────
makeups = [
    # (student_id, original_class_id, original_topic, lesson_num, absent_date, makeup_type, status)
    (1, 1, 'Chem 常規', 2, '2026-09-12', '課室錄播', 'scheduled'),
    (5, 1, 'Chem 常規', 2, '2026-09-12', '課室錄播', 'done'),
    (7, 1, 'Chem 常規', 4, '2026-09-26', '課室補課', 'waiting'),
    (2, 1, 'Chem 常規', 3, '2026-09-19', '線上錄播', 'scheduled'),
]

for idx, (sid, ocid, topic, lnum, absent, mktype, status) in enumerate(makeups, 1):
    cur.execute(
        "INSERT INTO makeup_lessons (id, student_id, original_class_id, original_topic, lesson_num, absent_date, makeup_type, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (idx, sid, ocid, topic, str(lnum), absent, mktype, status)
    )

print(f"✅ Seeded {len(makeups)} makeup lessons")

# ─── Lesson Standby ───────────────────────────────────────────────────────
standbys = [
    # (class_id, student_id, status)
    (1, 4, 'waiting'),  # Class 1 full, student 4 wants to join
    (2, 5, 'waiting'),  # Class 2 full
    (13, 11, 'waiting'),
]

for cid, sid, status in standbys:
    cur.execute(
        "INSERT INTO lesson_standby (class_id, student_id, status) VALUES (?, ?, ?)",
        (cid, sid, status)
    )

print(f"✅ Seeded {len(standbys)} standby entries")

# ─── Invoices ──────────────────────────────────────────────────────────────
invoices = [
    # (enrollment_id, student_id, topic_id, type, amount, makeup_fee, status, pay_method, note, paid_at)
    (1, 1, 1, 'tuition', 4800, 0, 'paid', '轉數快', 'Chem 常規全期學費', '2026-08-15 10:00:00'),
    (2, 2, 1, 'tuition', 4800, 0, 'paid', '現金', 'Chem 常規全期', '2026-08-20 14:30:00'),
    (3, 3, 1, 'tuition', 4800, 0, 'paid', '銀行轉賬', 'Chem 常規', '2026-09-01 09:00:00'),
    (5, 7, 1, 'tuition', 4800, 0, 'paid', '轉數快', 'Chem 常規', '2026-08-25 16:00:00'),
    (9, 1, 4, 'tuition', 3600, 0, 'paid', '轉數快', 'F3 Eng A 全期', '2026-08-15 10:30:00'),
    (10, 1, 5, 'tuition', 3600, 0, 'unpaid', '', 'F3 Math A 學費', None),
    (11, 9, 1, 'tuition', 4800, 0, 'unpaid', '', 'Chem 常規 (未繳)', None),
    (14, 4, 1, 'tuition', 4800, 0, 'unpaid', '', 'Chem B 學費', None),
    (1, 1, 1, 'makeup', 0, 50, 'paid', '轉數快', 'Chem 第2課補課手續費', '2026-09-13 15:00:00'),
]

for inv_id, (eid, sid, tid, itype, amount, mkfee, status, method, note, paid_at) in enumerate(invoices, 1):
    cur.execute(
        "INSERT INTO invoices (id, enrollment_id, student_id, topic_id, type, amount, makeup_fee, status, pay_method, note, paid_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (inv_id, eid, sid, tid, itype, amount, mkfee, status, method, note, paid_at)
    )

print(f"✅ Seeded {len(invoices)} invoices")

# ─── Attendance logs ──────────────────────────────────────────────────────
# Log some status changes
log_entries = [
    (1, 2, '', 'leave', '2026-09-12 10:05:00'),
    (5, 2, '', 'leave', '2026-09-12 10:06:00'),
    (3, 3, '', 'absent', '2026-09-12 10:10:00'),
]

for eid, lnum, old, new, ts in log_entries:
    cur.execute(
        "INSERT INTO attendance_log (enrollment_id, lesson_num, old_status, new_status, created_at) VALUES (?, ?, ?, ?, ?)",
        (eid, lnum, old, new, ts)
    )

print(f"✅ Seeded {len(log_entries)} attendance logs")

# ─── Commit ────────────────────────────────────────────────────────────────
db.commit()
db.close()

print("\n🎉 Seed complete!")
