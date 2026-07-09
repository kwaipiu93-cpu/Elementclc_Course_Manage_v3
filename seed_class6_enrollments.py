#!/usr/bin/env python3
"""Add Class 6 enrollments for July data"""
import sqlite3
import random

DB = "instance/data.db"
random.seed(20260702)

conn = sqlite3.connect(DB)
cur = conn.cursor()

max_eid = cur.execute("SELECT COALESCE(MAX(id),95) FROM enrollments").fetchone()[0]

# Students already in Chem classes 1-5
chem_students = cur.execute("""
    SELECT DISTINCT e.student_id FROM enrollments e 
    WHERE e.class_id IN (1,2,3,4,5) AND e.is_deleted=0 AND e.status='active'
    ORDER BY e.student_id
""").fetchall()
chem_ids = [r[0] for r in chem_students]

selected = random.sample(chem_ids, min(10, len(chem_ids)))
count = 0

for sid in selected:
    pay = random.choice(['paid', 'paid', 'paid', 'Unpaid'])
    pay_amt = 3800 if pay == 'paid' else 0
    pay_mtd = 'Cash' if pay == 'paid' else ''
    remaining = random.randint(4, 12)
    used = 12 - remaining

    max_eid += 1
    cur.execute("""
        INSERT OR IGNORE INTO enrollments (id, student_id, class_id, pay_status, pay_amount, pay_method, purchase, used, remaining, status)
        VALUES (?,?,6,?,?,?,12,?,?,'active')
    """, (max_eid, sid, pay, pay_amt, pay_mtd, used, remaining))
    if cur.rowcount > 0:
        count += 1
        if pay == 'paid':
            cur.execute("""
                INSERT INTO invoices (enrollment_id, student_id, type, amount, status, pay_method, created_at, paid_at)
                VALUES (?,?,'tuition',?,'paid',?,?,?)
            """, (max_eid, sid, pay_amt, pay_mtd, '2026-06-15', '2026-06-15'))

conn.commit()
print(f"Added {count} enrollments to Class 6")
conn.close()
