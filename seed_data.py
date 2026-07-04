#!/usr/bin/env python3
"""增強版測試資料填充 — 真正大量 lesson_checkins"""

import sqlite3
import random
import datetime

DB = "instance/data.db"
random.seed(42)

conn = sqlite3.connect(DB)
cur = conn.cursor()

today = datetime.date(2026, 12, 15)  # 模擬今日係 2026-12-15，咁大部分課都 past

# ─── 1. 清空舊嘅 test data（保留學生/班級結構）─────────────────────────
cur.execute("DELETE FROM lesson_checkins")
cur.execute("DELETE FROM attendance_log")
cur.execute("DELETE FROM makeup_lessons")
print("Cleared existing checkins/log/makeups")

# ─── 2. 將部分 lesson 日期改為已過去 ─────────────────────────────────
lessons = cur.execute(
    "SELECT l.id, l.class_id, l.num, l.date FROM lessons l WHERE l.is_deleted=0 ORDER BY l.class_id, l.num"
).fetchall()

# 每個 class，將第 1-5 課改為真正「已過去」嘅日期
for l in lessons:
    lid, cid, num, old_date = l
    if 1 <= num <= 5:
        # 根據班上課日計算過去日期
        class_info = cur.execute("SELECT name, first_lesson FROM classes WHERE id=?", (cid,)).fetchone()
        if class_info and class_info[1]:
            base = datetime.date.fromisoformat(class_info[1])
            new_date = base + datetime.timedelta(weeks=(num - 1))
            if new_date < today:
                cur.execute("UPDATE lessons SET date=? WHERE id=?", (new_date.isoformat(), lid))
        else:
            # 用預設日期
            base = datetime.date(2026, 9, 5)  # 開學第一個星期六
            new_date = base + datetime.timedelta(weeks=(num - 1))
            if new_date < today:
                cur.execute("UPDATE lessons SET date=? WHERE id=?", (new_date.isoformat(), lid))
    elif num == 6:
        # 第6課設為下星期（即將來臨）
        next_week = today + datetime.timedelta(days=7)
        cur.execute("UPDATE lessons SET date=? WHERE id=?", (next_week.isoformat(), lid))
    elif num == 7:
        # 第7課兩星期後
        two_weeks = today + datetime.timedelta(days=14)
        cur.execute("UPDATE lessons SET date=? WHERE id=?", (two_weeks.isoformat(), lid))
    elif num >= 8:
        # 第8課以後 — 往後推
        future_date = today + datetime.timedelta(weeks=(num - 6))
        cur.execute("UPDATE lessons SET date=? WHERE id=?", (future_date.isoformat(), lid))

print("Updated lesson dates")

# ─── 3. 重新讀取更新後嘅 lessons ─────────────────────────────────────
lessons = cur.execute(
    "SELECT l.id, l.class_id, l.num, l.date FROM lessons l WHERE l.is_deleted=0 ORDER BY l.class_id, l.num"
).fetchall()
past_lessons = [l for l in lessons if l[3] and datetime.date.fromisoformat(l[3]) <= today]
near_future_lessons = [l for l in lessons if l[3] and datetime.date.fromisoformat(l[3]) > today]
print(f"Past lessons: {len(past_lessons)}, Future: {len(near_future_lessons)}")

# ─── 4. 產生大量 lesson_checkins ──────────────────────────────────────
enrollments = cur.execute(
    "SELECT e.id, e.student_id, e.class_id FROM enrollments e WHERE e.is_deleted=0"
).fetchall()

checkin_inserted = 0
makeup_inserted = 0
existing_keys = set()

for lesson in past_lessons:
    lid, lcid, lnum, ldate = lesson
    dt = datetime.date.fromisoformat(ldate)
    for eid, sid, cid in enrollments:
        if cid != lcid:
            continue
        key = (lid, sid)
        if key in existing_keys:
            continue

        # 出勤狀態分佈：present 65%, late 10%, leave 12%, absent 8%, 無記錄 5%
        r = random.random()
        if r < 0.15:
            # 15% 係第1-2課就有pattern — 久唔久缺席
            # 用 student_id hash 決定呢個學生係咪「常缺席」
            absent_pattern = hash(f"student_{sid}_class_{lcid}") % 10 < 2
            if absent_pattern:
                # 常缺席學生 — leave/absent 比例更高
                r2 = random.random()
                if r2 < 0.30:
                    status = "present"
                    ctime = f"{ldate} {random.randint(8,10):02d}:{random.randint(0,59):02d}:00"
                elif r2 < 0.55:
                    status = "late"
                    ctime = f"{ldate} {random.randint(10,12):02d}:{random.randint(0,59):02d}:00"
                elif r2 < 0.80:
                    status = "leave"
                    ctime = None
                else:
                    status = "absent"
                    ctime = None
            else:
                status = "present"
                ctime = f"{ldate} {random.randint(8,11):02d}:{random.randint(0,59):02d}:00"
        else:
            # 正常分佈
            r2 = random.random()
            if r2 < 0.65:
                status = "present"
                ctime = f"{ldate} {random.randint(8,11):02d}:{random.randint(0,59):02d}:00"
            elif r2 < 0.78:
                status = "present"
                ctime = f"{ldate} {random.randint(8,10):02d}:{random.randint(0,59):02d}:00"
            elif r2 < 0.88:
                status = "late"
                ctime = f"{ldate} {random.randint(10,12):02d}:{random.randint(0,59):02d}:00"
            elif r2 < 0.95:
                status = "leave"
                ctime = None
            else:
                status = "absent"
                ctime = None

        cur.execute(
            "INSERT OR IGNORE INTO lesson_checkins (lesson_id, student_id, enrollment_id, status, checkin_time, source) "
            "VALUES (?, ?, ?, ?, ?, 'enrolled')",
            (lid, sid, eid, status, ctime)
        )
        if cur.rowcount > 0:
            existing_keys.add(key)
            checkin_inserted += 1

            # 如果係 leave/absent，等概率加 makeup
            if status in ("leave", "absent") and random.random() < 0.55:
                class_info = cur.execute("SELECT topic_id FROM classes WHERE id=?", (lcid,)).fetchone()
                if class_info:
                    tpid = class_info[0]
                    target_classes = cur.execute(
                        "SELECT id, name FROM classes WHERE topic_id=? AND id!=? AND is_deleted=0",
                        (tpid, lcid)
                    ).fetchall()
                    if target_classes:
                        tc = random.choice(target_classes)
                        mk_status = random.choice(["scheduled", "scheduled", "scheduled", "waiting", "waiting", "done"])
                        cur.execute(
                            "INSERT INTO makeup_lessons "
                            "(student_id, original_class_id, original_topic, "
                            "lesson_num, absent_date, makeup_type, makeup_class, status, is_deleted, updated_at) "
                            "VALUES (?, ?, (SELECT name FROM topics WHERE id=?), ?, ?, ?, ?, ?, 0, datetime('now'))",
                            (sid, lcid, tpid, str(lnum), ldate,
                             random.choice(["課室補課", "課室補課", "線上錄播"]),
                             str(tc[0]), mk_status)
                        )
                        makeup_inserted += 1
                    else:
                        # 無同 topic 其他班 — 同班 makeup (線上錄播 type)
                        mk_status = random.choice(["scheduled", "waiting", "done"])
                        cur.execute(
                            "INSERT INTO makeup_lessons "
                            "(student_id, original_class_id, original_topic, "
                            "lesson_num, absent_date, makeup_type, makeup_class, status, is_deleted, updated_at) "
                            "VALUES (?, ?, (SELECT name FROM topics WHERE id=?), ?, ?, '線上錄播', ?, ?, 0, datetime('now'))",
                            (sid, lcid, tpid, str(lnum), ldate,
                             str(lcid), mk_status)
                        )
                        makeup_inserted += 1

    # End of lesson loop

# near_future lessons — 少量預先請假
for lesson in near_future_lessons[:20]:
    lid, lcid, lnum, ldate = lesson
    for eid, sid, cid in enrollments:
        if cid != lcid:
            continue
        key = (lid, sid)
        if key in existing_keys:
            continue
        if random.random() < 0.06:
            status = random.choice(["leave", "leave", "absent"])
            cur.execute(
                "INSERT OR IGNORE INTO lesson_checkins (lesson_id, student_id, enrollment_id, status, checkin_time, source) "
                "VALUES (?, ?, ?, ?, NULL, 'enrolled')",
                (lid, sid, eid, status)
            )
            if cur.rowcount > 0:
                existing_keys.add(key)
                checkin_inserted += 1

print(f"Added {checkin_inserted} checkins, {makeup_inserted} makeups")

# ─── 5. 補 d 試堂 / 等候名單學生 ───────────────────────────────────
# 新增 5 個「試堂」或「候補」相關 student 到特定班
trial_students = [
    ("趙", "雅琳", "聖士提反女子中學", 2027),
    ("蔡", "俊賢", "男拔萃書院", 2027),
    ("程", "樂怡", "協恩中學", 2028),
    ("丁", "偉文", "皇仁書院", 2027),
    ("姚", "凱琳", "香港華仁書院", 2028),
]
for sname, gname, sch, dse in trial_students:
    cur.execute(
        "INSERT INTO students (surname, given_name, school, dse_year, enroll_date, create_time, updated_at) "
        "VALUES (?, ?, ?, ?, '2026-11-01', datetime('now'), datetime('now'))",
        (sname, gname, sch, dse)
    )
print("Added trial/waiting students")

# 將試堂學生加為 waiting/pending 到 random class
all_classes = cur.execute(
    "SELECT id, name, topic_id, seat FROM classes WHERE is_deleted=0 ORDER BY id"
).fetchall()
trial_sids = cur.execute(
    "SELECT id FROM students WHERE is_deleted=0 AND surname IN ('趙','蔡','程','丁','姚') ORDER BY id DESC LIMIT 5"
).fetchall()
for (tsid,) in trial_sids:
    cls = random.choice(all_classes)
    pay_st = random.choice(["Unpaid", "paid", "Unpaid"])
    pur = random.choice([12, 12, 0])
    rem = pur
    cur.execute(
        "INSERT INTO enrollments (student_id, class_id, pay_status, purchase, remaining, status, create_time, updated_at) "
        "VALUES (?, ?, ?, ?, ?, 'active', datetime('now'), datetime('now'))",
        (tsid, cls[0], pay_st, pur, rem)
    )
    # 加一些試堂 checkin
    random.seed(tsid)
    trial_lessons = [l for l in past_lessons[3:7]]  # 第4-7課左右
    for tl in trial_lessons:
        if random.random() < 0.6:
            lid, lcid, lnum, ldate = tl
            status = random.choice(["present", "present", "present", "absent", "leave"])
            ctime = f"{ldate} {random.randint(8,11):02d}:{random.randint(0,59):02d}:00" if status in ("present","late") else None
            cur.execute(
                "INSERT OR IGNORE INTO lesson_checkins (lesson_id, student_id, enrollment_id, status, checkin_time, source) "
                "VALUES (?, ?, "
                "(SELECT e.id FROM enrollments e WHERE e.student_id=? AND e.class_id=? AND e.is_deleted=0 LIMIT 1), "
                "?, ?, 'trial')",
                (lid, tsid, tsid, lcid, status, ctime)
            )
            if cur.rowcount > 0:
                checkin_inserted += 1

print(f"Total checkins (incl trial): {checkin_inserted}")

conn.commit()

# ─── 6. 加 lesson_standby 候補數據 ───────────────────────────────────
full_classes = cur.execute("""
    SELECT c.id, c.name, c.seat, COUNT(e.id) as enrolled
    FROM classes c
    LEFT JOIN enrollments e ON e.class_id=c.id AND e.is_deleted=0
    WHERE c.is_deleted=0 AND c.name != 'test'
    GROUP BY c.id
    ORDER BY (c.seat - COUNT(e.id)) ASC
""").fetchall()

all_sids = set(r[0] for r in cur.execute("SELECT id FROM students WHERE is_deleted=0").fetchall())
enrolled_sids = set(r[0] for r in cur.execute("SELECT student_id FROM enrollments WHERE is_deleted=0").fetchall())
free_sids = sorted(all_sids - enrolled_sids)
print(f"Standby candidates: {len(free_sids)} 個未入班學生")

import datetime as dt
now = dt.datetime(2026, 12, 10)
standby_inserted = 0
for cls in full_classes:
    cid, cname, seat, enrolled = cls
    n = min(len(free_sids), random.randint(2, 4))
    chosen = random.sample(free_sids, n)
    for i, sid in enumerate(chosen):
        days_ago = random.randint(1, 60)
        trigger = (now - dt.timedelta(days=days_ago)).strftime("%Y-%m-%d %H:%M:%S")
        st = random.choice(["waiting", "waiting", "waiting", "confirmed", "expired"])
        confirmed = None
        if st == "confirmed":
            confirmed = (now - dt.timedelta(days=random.randint(1, 20))).strftime("%Y-%m-%d %H:%M:%S")
        cur.execute(
            "INSERT OR IGNORE INTO lesson_standby (class_id, student_id, status, trigger_time, confirmed_at, note) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (cid, sid, st, trigger, confirmed, random.choice(["", "家長要求上午班", "遲d再聯絡", ""]))
        )
        if cur.rowcount > 0:
            standby_inserted += 1
print(f"Added {standby_inserted} standby entries")

conn.commit()

# ─── 7. 最終統計 ─────────────────────────────────────────────────────
print("\n=== 最終統計 ===")
for t in ["year_courses","topics","classes","lessons","students","enrollments","lesson_checkins","attendance_log","makeup_lessons","lesson_standby"]:
    cnt = cur.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
    print(f"  {t}: {cnt}")

dist = cur.execute(
    "SELECT status, COUNT(*) FROM lesson_checkins GROUP BY status ORDER BY CASE status "
    "WHEN 'present' THEN 1 WHEN 'late' THEN 2 WHEN 'leave' THEN 3 WHEN 'absent' THEN 4 END"
).fetchall()
print("\n=== Checkin 分佈 ===")
for s, c in dist:
    print(f"  {s}: {c}")

md = cur.execute(
    "SELECT status, COUNT(*) FROM makeup_lessons GROUP BY status ORDER BY COUNT(*) DESC"
).fetchall()
print("\n=== Makeup 分佈 ===")
for s, c in md:
    print(f"  {s}: {c}")

sd = cur.execute(
    "SELECT status, COUNT(*) FROM lesson_standby GROUP BY status ORDER BY COUNT(*) DESC"
).fetchall()
print("\n=== Standby 分佈 ===")
for s, c in sd:
    print(f"  {s}: {c}")

conn.close()
print("\n✅ Seed 完成！")
