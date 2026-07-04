#!/usr/bin/env python3
"""完整測試數據產生器 — course_manage_v2 版本（含 invoices）"""

import sqlite3
import random
import datetime
import math

DB = "instance/data.db"
random.seed(2026)

conn = sqlite3.connect(DB)
cur = conn.cursor()

today = datetime.date(2026, 6, 12)

# ─── 1. 清空動態數據 ─────────────────────────────────────
for t in ["lesson_checkins","attendance_log","makeup_lessons","lesson_standby",
          "scan_sessions","attendances","invoices","enrollments","students",
          "lessons","classes","topics","year_courses"]:
    cur.execute(f"DELETE FROM {t}")
cur.execute("DELETE FROM users WHERE username != 'admin'")
print("✅ 已清空動態數據")

# ─── 2. 年級/科目結構 ────────────────────────────────────
cur.execute("INSERT INTO year_courses (id, name, year, grade) VALUES (1, '2026-2027 DSE Chem 常規課程', 2026, 'F6')")
cur.execute("INSERT INTO year_courses (id, name, year, grade) VALUES (2, '2026-2027 DSE 常規 F3', 2026, 'F3')")
cur.execute("INSERT INTO year_courses (id, name, year, grade) VALUES (3, '2027-2028 DSE Chem 預備', 2027, 'F5')")

topics_data = [
    (1, 1, '微觀世界I', 'Live', 12, 4800, 400, 380, 1),
    (2, 1, '酸和鹽基', 'Live', 12, 4800, 400, 380, 2),
    (3, 1, '有機化學', 'Live', 12, 4800, 400, 380, 3),
    (4, 1, '氧化還原', 'Live', 12, 4800, 400, 380, 4),
    (5, 1, '金屬非金屬', 'Live', 12, 4800, 400, 380, 5),
    (6, 1, '反應速率', 'Live', 10, 4200, 420, 400, 6),
    (7, 1, '補課錄播班', 'Video', 0, 0, 0, 0, 7),
    (8, 1, 'SAT 操卷班', 'Live', 8, 3600, 450, 430, 8),
    (9, 2, 'F3 化學基礎', 'Live', 12, 3600, 300, 280, 1),
    (10, 2, '微觀世界 (F3)', 'Live', 12, 3600, 300, 280, 2),
    (11, 3, 'F5 Chem 預備班', 'Live', 12, 4200, 350, 330, 1),
]
for t in topics_data:
    cur.execute("INSERT INTO topics (id, year_course_id, name, type, lessons, fee, unit_price_new, unit_price_insert, sort) VALUES (?,?,?,?,?,?,?,?,?)", t)

print("✅ 已重建 year_courses + topics")

# ─── 3. 班級 ──────────────────────────────────────────────
classes_data = [
    (1, 1, 'DSE Chem P6A (微觀世界I)', 'Saturday', '09:00', '11:00', '2026-03-07', 12),
    (2, 2, 'DSE Chem P6B (酸和鹽基)', 'Saturday', '11:30', '13:30', '2026-03-07', 12),
    (3, 3, 'DSE Chem P5A (有機化學)', 'Friday', '17:00', '19:00', '2026-03-06', 12),
    (4, 4, 'DSE Chem P6C (氧化還原)', 'Sunday', '10:00', '12:00', '2026-03-08', 10),
    (5, 5, 'DSE Chem P6D (金屬非金屬)', 'Sunday', '14:00', '16:00', '2026-03-08', 12),
    (6, 6, 'DSE Chem SAT-A (反應速率)', 'Saturday', '14:00', '16:00', '2026-04-11', 16),
    (7, 8, 'SAT 操卷班 A', 'Sunday', '09:00', '12:00', '2026-03-15', 10),
    (8, 7, '補課錄播班', 'Flexible', '', '', None, 30),
    (9, 9, 'F3A 基礎化學', 'Wednesday', '17:00', '18:30', '2026-03-04', 15),
    (10, 10, '微觀F3A', 'Thursday', '17:00', '18:30', '2026-03-05', 15),
    (11, 9, 'F3C 基礎化學', 'Saturday', '10:00', '11:30', '2026-03-07', 15),
    (12, 11, 'F5 Chem 預備班 A', 'Tuesday', '18:00', '20:00', '2026-04-07', 12),
    (13, 7, '補課錄播班 F3', 'Flexible', '', '', None, 20),
]
for c in classes_data:
    cur.execute("INSERT INTO classes (id, topic_id, name, week, start, end, first_lesson, seat) VALUES (?,?,?,?,?,?,?,?)", c)

print("✅ 已重建 classes")

# ─── 4. Lessons ──────────────────────────────────────────
lesson_id = 1
for cid, tpid, cname, week, start_time, end_time, first_lesson, seat in classes_data:
    if not first_lesson:
        continue
    base = datetime.date.fromisoformat(first_lesson)
    num_lessons = 12 if seat != 30 else 5
    for n in range(1, num_lessons + 1):
        ldate = base + datetime.timedelta(weeks=n - 1)
        cur.execute(
            "INSERT INTO lessons (id, class_id, num, date, start, end) VALUES (?,?,?,?,?,?)",
            (lesson_id, cid, n, ldate.isoformat(), start_time, end_time)
        )
        lesson_id += 1
print(f"✅ 已重建 lessons (共 {lesson_id - 1} 堂)")

# ─── 5. Students ─────────────────────────────────────────
surnames = ['陳','李','張','王','黃','劉','梁','吳','林','何','周','楊','鄭','謝','馬','葉','徐','孫','鄧','高',
            '朱','黎','羅','曾','蕭','郭','許','蘇','廖','歐陽','胡','潘','余','戴','譚','蔡','方','石','鍾','麥',
            '陸','盧','邱','程','溫','曹','袁','馮','彭','董','唐','范','文','夏','古','甘','凌','江','洪','莊']
given_names_m = ['浩天','俊傑','子軒','宇軒','家偉','志豪','曉明','天佑','文杰','嘉誠',
                 '俊賢','偉文','卓賢','朗賢','澤霖','景軒','啟豪','銘杰','德華','冠中']
given_names_f = ['雅琳','樂怡','凱琳','芷晴','梓淇','樂兒','凱晴','思穎','曉彤','詠欣',
                 '梓珊','穎欣','凱婷','潔瑩','美琪','小慧','婉君','佩珊','慧敏','韻怡']
schools = ['皇仁書院','男拔萃書院','女拔萃書院','聖保羅男女中學','喇沙書院','協恩中學',
           '聖士提反女子中學','英華書院','瑪利曼中學','香港華仁書院','九龍華仁書院',
           '聖若瑟書院','瑪利諾修院學校','伊利沙伯中學','觀塘瑪利諾書院','順德聯誼總會李兆基中學',
           '培正中學','真光女書院','聖公會曾肇添中學','浸信會呂明才中學',
           '香港四邑商工總會黃棣珊紀念中學','長沙灣天主教英文中學','寶血會上智英文書院',
           '嘉諾撒聖家書院','德望學校','聖羅撒學校','華英中學','迦密中學','民生書院',
           '香港中國婦女會中學']

student_id = 1
student_names = []
for i in range(80):
    surname = random.choice(surnames)
    given = random.choice(given_names_m if i < 40 else given_names_f)
    school = random.choice(schools)
    dse = random.choice([2026, 2027, 2027, 2028, 2028, 2028])
    phone = f"9{random.randint(1000000, 9999999)}"
    parent_phone = f"6{random.randint(1000000, 9999999)}"
    email = f"{surname.lower()}{given.lower()}{random.randint(1,99)}@gmail.com"
    note = random.choice(['', '', '', '特別需要：考試前請假', '家長要求坐前排'])
    student_names.append((student_id, surname, given))
    cur.execute(
        "INSERT INTO students (id, surname, given_name, school, email, password, phone, parent_phone, note, dse_year, enroll_date) "
        "VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        (student_id, surname, given, school, email, 'student123', phone, parent_phone, note,
         dse, (today - datetime.timedelta(days=random.randint(30, 365))).isoformat())
    )
    student_id += 1

# 特別案例
special = [
    (81, '趙', '雅琳', '聖士提反女子中學', 'chiu.nyl@gmail.com', 'student123', '91234567', '61234567', '聽講有障礙，需安排前排', 2027),
    (82, '蔡', '俊賢', '男拔萃書院', 'choy.chun@yahoo.com', 'student123', '92345678', '62345678', '', 2027),
    (83, '程', '樂怡', '協恩中學', 'ching.loky@gmail.com', 'student123', '93456789', '63456789', '家長要求錄播補課', 2028),
    (84, '丁', '偉文', '皇仁書院', 'ting.waiman@outlook.com', 'student123', '94567890', '64567890', '轉校生，需重點跟進', 2027),
    (85, '姚', '凱琳', '香港華仁書院', 'yiu.hoilam@gmail.com', 'student123', '95678901', '65678901', '', 2028),
    (86, '宋', '雅言', '德望學校', 'sung.ngayin@gmail.com', 'student123', '96789012', '66789012', '豁免第一期學費', 2028),
    (87, '麥', '浩然', '伊利沙伯中學', 'mak.hoyin@hotmail.com', 'student123', '97890123', '67890123', '', 2026),
    (88, '蕭', '子晴', '瑪利曼中學', 'siu.tsching@gmail.com', 'student123', '98901234', '68901234', '', 2027),
]
for s in special:
    student_names.append((s[0], s[1], s[2]))
    cur.execute(
        "INSERT INTO students (id, surname, given_name, school, email, password, phone, parent_phone, note, dse_year, enroll_date) "
        "VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        s + ((today - datetime.timedelta(days=90)).isoformat(),)
    )

print(f"✅ 已重建 students (88人)")

# ─── 6. Enrollments ──────────────────────────────────────
eid_counter = 1
dse_students = list(range(1, 45))
f3_students = list(range(45, 70))
f5_students = list(range(70, 85))

assigned = set()

# DSE 班 (1-7)
for cid in [1, 2, 3, 4, 5, 6, 7]:
    avail = [s for s in dse_students if s not in assigned]
    n = min({1:9, 2:10, 3:9, 4:8, 5:9, 6:12, 7:7}[cid], len(avail))
    for s in avail[:n]:
        assigned.add(s)
        pay_st = random.choice(['paid', 'paid', 'paid', 'Unpaid'])
        pur = random.choice([12, 12, 10, 8])
        rem = random.randint(2, pur)
        pay_amt = random.choice([0, pur * 400, 4200, 4800])
        pay_mtd = 'Cash' if pay_amt > 0 else ''
        cur.execute(
            "INSERT INTO enrollments (id, student_id, class_id, pay_status, pay_amount, pay_method, purchase, used, remaining, status) "
            "VALUES (?,?,?,?,?,?,?,?,?,'active')",
            (eid_counter, s, cid, pay_st, pay_amt, pay_mtd, pur, pur - rem, rem)
        )
        eid_counter += 1

# 補課班 (8)
for s in random.sample(dse_students, 8):
    cur.execute(
        "INSERT INTO enrollments (id, student_id, class_id, pay_status, pay_amount, pay_method, purchase, used, remaining, status) "
        "VALUES (?,?,?,'paid',0,'',0,0,0,'active')",
        (eid_counter, s, 8)
    )
    eid_counter += 1

# F3 班 (9, 10, 11)
for cid in [9, 10, 11]:
    avail = [s for s in f3_students if s not in assigned]
    n = min(10, len(avail))
    for s in random.sample(avail, n):
        assigned.add(s)
        pay_st = random.choice(['paid', 'paid', 'paid', 'Unpaid'])
        pur = random.choice([12, 12, 6, 12])
        rem = random.randint(2, pur)
        pay_amt = random.choice([0, 3600, 3000])
        pay_mtd = 'Cash' if pay_amt > 0 else ''
        cur.execute(
            "INSERT INTO enrollments (id, student_id, class_id, pay_status, pay_amount, pay_method, purchase, used, remaining, status) "
            "VALUES (?,?,?,?,?,?,?,?,?,'active')",
            (eid_counter, s, cid, pay_st, pay_amt, pay_mtd, pur, 0, rem)
        )
        eid_counter += 1

# F5 班 (12)
for s in random.sample(f5_students, min(8, len(f5_students))):
    pay_st = random.choice(['Unpaid', 'paid'])
    pur = 12
    pay_amt = random.choice([0, 4200, 3600])
    pay_mtd = 'Cash' if pay_amt > 0 else ''
    used_now = random.randint(0, 8)
    cur.execute(
        "INSERT INTO enrollments (id, student_id, class_id, pay_status, pay_amount, pay_method, purchase, used, remaining, status) "
        "VALUES (?,?,?,?,?,?,?,?,?,'active')",
        (eid_counter, s, 12, pay_st, pay_amt, pay_mtd, pur, used_now, pur - used_now)
    )
    eid_counter += 1

# F3 補課班 (13)
for s in random.sample(list(range(45, 70)), 5):
    cur.execute(
        "INSERT INTO enrollments (id, student_id, class_id, pay_status, pay_amount, pay_method, purchase, used, remaining, status) "
        "VALUES (?,?,?,'paid',0,'',0,0,0,'active')",
        (eid_counter, s, 13)
    )
    eid_counter += 1

# 已退學
for s in random.sample(list(range(1, 89)), 5):
    cid = random.choice([1, 2, 3, 9, 10])
    cur.execute(
        "INSERT INTO enrollments (id, student_id, class_id, pay_status, pay_amount, pay_method, purchase, used, remaining, status) "
        "VALUES (?,?,?,'Unpaid',0,'',0,0,0,'dropped')",
        (eid_counter, s, cid)
    )
    eid_counter += 1

print(f"✅ 已重建 enrollments (共 {eid_counter - 1} 筆)")

# ─── 7. Invoices ──────────────────────────────────────────
enrollments = cur.execute(
    "SELECT id, student_id, class_id, pay_amount, pay_method, pay_status FROM enrollments WHERE is_deleted=0"
).fetchall()
inv_count = 0
for eid, sid, cid, pay_amt, pay_mtd, pay_st in enrollments:
    if pay_amt > 0:
        # 已付款 invoice
        paid_date = (today - datetime.timedelta(days=random.randint(5, 90))).isoformat()
        cur.execute(
            "INSERT INTO invoices (enrollment_id, student_id, type, amount, status, pay_method, created_at, paid_at) "
            "VALUES (?,?,'tuition',?,'paid',?,?,?)",
            (eid, sid, pay_amt, pay_mtd, paid_date, paid_date)
        )
        inv_count += 1
    elif pay_st == 'Unpaid':
        # 未找 invoice
        cur.execute(
            "INSERT INTO invoices (enrollment_id, student_id, type, amount, status, created_at) "
            "VALUES (?,?,'tuition',?,'unpaid',?)",
            (eid, sid, random.choice([4200, 4800, 3600, 3000]),
             (today - datetime.timedelta(days=random.randint(1, 14))).isoformat())
        )
        inv_count += 1
# 一些額外雜費 invoice（material 都要關聯 enrollment）
for i in range(5):
    sid = random.randint(1, 88)
    eid_row = cur.execute(
        "SELECT id FROM enrollments WHERE student_id=? AND is_deleted=0 LIMIT 1", (sid,)
    ).fetchone()
    if eid_row:
        cur.execute(
            "INSERT INTO invoices (enrollment_id, student_id, type, amount, status, created_at) "
            "VALUES (?,?,'material',?,'unpaid',?)",
            (eid_row[0], sid, random.choice([150, 200, 300, 500]),
             (today - datetime.timedelta(days=random.randint(1, 30))).isoformat())
        )
        inv_count += 1
print(f"✅ 已重建 invoices (共 {inv_count} 筆)")

# ─── 8. Lesson checkins ──────────────────────────────────
all_lessons = cur.execute(
    "SELECT id, class_id, num, date FROM lessons WHERE is_deleted=0 AND date IS NOT NULL ORDER BY class_id, num"
).fetchall()
enrolls = cur.execute(
    "SELECT id, student_id, class_id FROM enrollments WHERE is_deleted=0 AND status='active'"
).fetchall()
enroll_by_class = {}
for eid, sid, cid in enrolls:
    enroll_by_class.setdefault(cid, []).append((eid, sid))

ck_count = 0
ck_keys = set()

for lid, lcid, lnum, ldate_str in all_lessons:
    ldate = datetime.date.fromisoformat(ldate_str)
    is_past = ldate <= today
    is_near = (ldate - today).days <= 7 and ldate > today
    class_enrolls = enroll_by_class.get(lcid, [])

    if lcid in (8, 13):  # 補課班跳過
        continue

    for eid, sid in class_enrolls:
        key = (lid, sid)
        if key in ck_keys:
            continue
        if is_past:
            r = random.random()
            if r < 0.68:
                status = 'present'
                ctime = f"{ldate_str} {random.choice(['08:','09:','10:'])}{random.randint(0,59):02d}:00"
            elif r < 0.80:
                status = 'present'
                ctime = f"{ldate_str} {random.choice(['09:','10:'])}{random.randint(0,59):02d}:00"
            elif r < 0.87:
                status = 'late'
                ctime = f"{ldate_str} {random.randint(10,12):02d}:{random.randint(0,59):02d}:00"
            elif r < 0.94:
                status = 'leave'
                ctime = None
            else:
                status = 'absent'
                ctime = None

            cur.execute(
                "INSERT OR IGNORE INTO lesson_checkins (lesson_id, student_id, enrollment_id, status, checkin_time, source) "
                "VALUES (?,?,?,?,?,'enrolled')",
                (lid, sid, eid, status, ctime)
            )
            if cur.rowcount > 0:
                ck_keys.add(key)
                ck_count += 1
                cur.execute(
                    "INSERT OR IGNORE INTO attendances (enrollment_id, lesson_num, status, checkin_time) VALUES (?,?,?,?)",
                    (eid, lnum, status, ctime)
                )
        elif is_near and random.random() < 0.10:
            status = random.choice(['leave', 'absent'])
            cur.execute(
                "INSERT OR IGNORE INTO lesson_checkins (lesson_id, student_id, enrollment_id, status, checkin_time, source) "
                "VALUES (?,?,?,?,NULL,'enrolled')",
                (lid, sid, eid, status, None)
            )
            if cur.rowcount > 0:
                ck_keys.add(key)
                ck_count += 1
                cur.execute(
                    "INSERT OR IGNORE INTO attendances (enrollment_id, lesson_num, status, checkin_time) VALUES (?,?,?,?)",
                    (eid, lnum, status, None)
                )

print(f"✅ 已重建 checkins (共 {ck_count} 筆)")

# ─── 9. Makeups ──────────────────────────────────────────
absent_ck = cur.execute(
    "SELECT lc.student_id, lc.lesson_id, l.date, l.class_id, l.num "
    "FROM lesson_checkins lc JOIN lessons l ON l.id=lc.lesson_id "
    "WHERE lc.status IN ('leave','absent') AND l.date IS NOT NULL"
).fetchall()

mk_count = 0
mk_seen = set()
for sid, lid, adate, cid, lnum in absent_ck[:80]:
    if sid in mk_seen or random.random() > 0.35:
        continue
    mk_seen.add(sid)
    topic_name = cur.execute(
        "SELECT t.name FROM topics t JOIN classes c ON c.topic_id=t.id WHERE c.id=?", (cid,)
    ).fetchone()
    topic_name = topic_name[0] if topic_name else 'General'
    mk_status = random.choice(['scheduled', 'scheduled', 'waiting', 'done', 'done'])
    mk_type = random.choice(['課室補課', '課室補課', '線上錄播'])
    target_lesson_id = None
    if mk_status == 'done':
        fl = cur.execute(
            "SELECT id FROM lessons WHERE class_id=? AND date>? AND is_deleted=0 LIMIT 1",
            (cid, today.isoformat())
        ).fetchone()
        if fl:
            target_lesson_id = fl[0]
    cur.execute(
        "INSERT INTO makeup_lessons (student_id, original_class_id, original_topic, lesson_num, absent_date, makeup_type, status, target_lesson_id) "
        "VALUES (?,?,?,?,?,?,?,?)",
        (sid, cid, topic_name, str(lnum), adate, mk_type, mk_status, target_lesson_id)
    )
    muid = cur.lastrowid
    if target_lesson_id and mk_status == 'done':
        cur.execute(
            "INSERT OR IGNORE INTO lesson_checkins (lesson_id, student_id, makeup_lesson_id, status, checkin_time, source) "
            "VALUES (?,?,?,'present',?,'makeup')",
            (target_lesson_id, sid, muid, f"{today.isoformat()} 10:00:00")
        )
    mk_count += 1

# 已取消 makeups
for sid in random.sample(list(range(1, 89)), 3):
    cid = random.choice([1, 2, 3, 4, 5, 6])
    topic_name = cur.execute(
        "SELECT t.name FROM topics t JOIN classes c ON c.topic_id=t.id WHERE c.id=?", (cid,)
    ).fetchone()
    topic_name = topic_name[0] if topic_name else 'General'
    cur.execute(
        "INSERT INTO makeup_lessons (student_id, original_class_id, original_topic, lesson_num, absent_date, makeup_type, status, is_deleted) "
        "VALUES (?,?,?,?,'2026-04-15','課室補課','done',1)",
        (sid, cid, topic_name, '3')
    )
    mk_count += 1
print(f"✅ 已重建 makeups (共 {mk_count} 筆)")

# ─── 10. Standby ─────────────────────────────────────────
all_sids = set(r[0] for r in cur.execute("SELECT id FROM students").fetchall())
enr_sids = set(r[0] for r in cur.execute("SELECT student_id FROM enrollments WHERE is_deleted=0").fetchall())
free_sids = sorted(all_sids - enr_sids)

sb_count = 0
for cid in [1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12]:
    if not free_sids:
        break
    n = min(len(free_sids), random.randint(1, 3))
    for s in random.sample(free_sids, n):
        free_sids.remove(s)
        trigger = (today - datetime.timedelta(days=random.randint(1, 45))).isoformat()
        st = random.choice(['waiting', 'waiting', 'confirmed', 'expired'])
        confirmed_at = (today - datetime.timedelta(days=random.randint(1, 14))).isoformat() if st == 'confirmed' else None
        cur.execute(
            "INSERT OR IGNORE INTO lesson_standby (class_id, student_id, status, trigger_time, confirmed_at, note) "
            "VALUES (?,?,?,?,?,?)",
            (cid, s, st, trigger, confirmed_at, random.choice(['', '家長要求上午班', '']))
        )
        if cur.rowcount > 0:
            sb_count += 1
print(f"✅ 已重建 standby (共 {sb_count} 筆)")

# ─── 11. Attendance log ──────────────────────────────────
logs = cur.execute(
    "SELECT lc.enrollment_id, l.num, lc.status, lc.checkin_time "
    "FROM lesson_checkins lc JOIN lessons l ON l.id=lc.lesson_id "
    "WHERE lc.enrollment_id IS NOT NULL LIMIT 200"
).fetchall()
for eid, lnum, status, ctime in logs:
    if eid:
        cur.execute(
            "INSERT INTO attendance_log (enrollment_id, lesson_num, old_status, new_status) VALUES (?,?,'',?)",
            (eid, lnum, status)
        )
print(f"✅ 已重建 attendance_log (共 {len(logs)} 筆)")

# ─── 12. Scan sessions ──────────────────────────────────
recent = cur.execute(
    "SELECT id, date FROM lessons WHERE date >= date('now', '-3 days') AND date <= date('now', '+1 day') AND is_deleted=0"
).fetchall()
for lid, ldate in recent:
    is_active = 1 if ldate == today.isoformat() else 0
    cur.execute(
        "INSERT INTO scan_sessions (lesson_id, active, started_at) VALUES (?,?,datetime('now'))", (lid, is_active)
    )
print(f"✅ 已重建 scan_sessions")

# ─── 13. Extra users ────────────────────────────────────
cur.execute("INSERT OR IGNORE INTO users (username, display_name, role) VALUES ('teacher1', '陳老師', 'teacher')")

conn.commit()

# ─── Final stats ─────────────────────────────────────────
print("\n" + "=" * 50)
print("📊 最終統計")
print("=" * 50)
for t in ["year_courses","topics","classes","lessons","students","enrollments",
          "invoices","lesson_checkins","attendance_log","makeup_lessons","lesson_standby","scan_sessions"]:
    cnt = cur.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
    print(f"  {t}: {cnt}")

for label, tbl, gcol in [
    ("Checkin 分佈", "lesson_checkins", "status"),
    ("Makeup 分佈", "makeup_lessons", "status"),
    ("Standby 分佈", "lesson_standby", "status"),
    ("Invoice 狀態", "invoices", "status"),
]:
    dist = cur.execute(f"SELECT {gcol}, COUNT(*) FROM {tbl} GROUP BY {gcol} ORDER BY COUNT(*) DESC").fetchall()
    print(f"\n📋 {label}:")
    for s, c in dist:
        print(f"  {s}: {c}")

conn.close()
print("\n✅ Seed 完成！重新啟動 server 即可使用新數據")
