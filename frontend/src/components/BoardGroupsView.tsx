import { useState, useMemo } from 'react';
import { CalendarIcon, Loader2 } from 'lucide-react';

// ─── Types ─────────────────────────────────────────────────────────

interface Stu {
  studentId: number;
  name: string;
  school: string;
  phone: string;
  email: string;
  note: string;
  payStatus: string;
  status: string;
  source: string;
  checkinTime: string;
  blocked: boolean;
  locked: boolean;
  homeworkDone: boolean;
}

interface Lesson {
  lessonId: number;
  lessonNum: number;
  time: string;
  students: Stu[];
}

interface ClassGroup {
  classId: number;
  className: string;
  week: string;
  seat: number | null;
  classType?: string;
  lessons: Lesson[];
  students: { studentId: number; name: string; school: string }[];
  lessonMap: { num: number; id: number }[];
}

interface Props {
  classGroups: ClassGroup[];
  isLoading: boolean;
  isError: boolean;
  selectedDate: string;
}

// ─── Board student — flattened student across all classes/lessons ──

interface BoardStu {
  studentId: number;
  name: string;
  school: string;
  phone: string;
  email: string;
  note: string;
  payStatus: string;
  homeworkDone: boolean;
  status: string;
  source: string;
  checkinTime: string;
  className: string;
  lessonNum: number;
}

// ─── Helpers ───────────────────────────────────────────────────────

const CHECKED_STATUSES = new Set([
  'present', 'makeup', 'recording_room_present', 'video_makeup',
]);

const getInitial = (name: string): string => {
  const ch = name.trim().charAt(0).toUpperCase();
  if (ch >= 'A' && ch <= 'Z') return ch;
  return '';
};

const isInRange = (letter: string, range: string): boolean => {
  const m = range.match(/^([A-Z])\s*-\s*([A-Z])$/);
  if (!m) return false;
  return letter >= m[1] && letter <= m[2];
};

const STATUS_BADGE: Record<string, { text: string; bg: string; fg: string }> = {
  'present':              { text: '✅出席', bg: 'bg-green-50',   fg: 'text-green-700' },
  'makeup':               { text: '✅補堂', bg: 'bg-green-50',   fg: 'text-green-700' },
  'recording_room_present': { text: '✅課室錄播', bg: 'bg-emerald-50', fg: 'text-emerald-700' },
  'video_makeup':         { text: '✅線上錄播', bg: 'bg-purple-50',  fg: 'text-purple-700' },
  'leave':                { text: '📋請假', bg: 'bg-blue-50',    fg: 'text-blue-700' },
  'absent':               { text: '❌缺勤', bg: 'bg-red-50',     fg: 'text-red-700' },
  'waiting':              { text: '‼️候補', bg: 'bg-red-50',     fg: 'text-red-700' },
  'scheduled_room':       { text: '⌛️課室錄播', bg: 'bg-amber-50',  fg: 'text-amber-700' },
  'scheduled_video':      { text: '⌛️線上錄播', bg: 'bg-purple-50',  fg: 'text-purple-700' },
  'scheduled_classroom':  { text: '⌛️待補', bg: 'bg-amber-50',  fg: 'text-amber-700' },
};

// ─── Component ─────────────────────────────────────────────────────

export default function BoardGroupsView({ classGroups, isLoading, isError, selectedDate }: Props) {
  const [cols3, setCols3] = useState(true);

  // ── Flatten all students across all classes/lessons ──
  const checkedStudents = useMemo<BoardStu[]>(() => {
    const map = new Map<number, BoardStu>();

    for (const group of classGroups) {
      for (const lesson of group.lessons) {
        for (const stu of lesson.students) {
          if (!CHECKED_STATUSES.has(stu.status)) continue; // ◀── 只取已簽到

          const existing = map.get(stu.studentId);
          if (!existing) {
            map.set(stu.studentId, {
              studentId: stu.studentId,
              name: stu.name,
              school: stu.school || '',
              phone: stu.phone || '',
              email: stu.email || '',
              note: stu.note || '',
              payStatus: stu.payStatus || '',
              homeworkDone: stu.homeworkDone,
              status: stu.status,
              source: stu.source || '',
              checkinTime: stu.checkinTime || '',
              className: group.className,
              lessonNum: lesson.lessonNum,
            });
          } else {
            // Keep the latest checkin time
            if (stu.checkinTime && stu.checkinTime > existing.checkinTime) {
              existing.status = stu.status;
              existing.source = stu.source || '';
              existing.checkinTime = stu.checkinTime;
              existing.homeworkDone = stu.homeworkDone;
              existing.className = group.className;
              existing.lessonNum = lesson.lessonNum;
            }
            if (stu.note) existing.note = stu.note;
            if (stu.payStatus) existing.payStatus = stu.payStatus;
          }
        }
      }
    }
    return Array.from(map.values());
  }, [classGroups]);

  // ── Group by letter range, sort by checkinTime DESC ──
  const groups = useMemo(() => {
    const r1 = 'A-I';
    const r2 = cols3 ? 'J-Q' : 'J-Z';
    const r3 = 'R-Z';

    const g1: BoardStu[] = [];
    const g2: BoardStu[] = [];
    const g3: BoardStu[] = [];

    for (const s of checkedStudents) {
      const initial = getInitial(s.name);
      if (!initial || isInRange(initial, r1)) {
        g1.push(s);
      } else if (isInRange(initial, r2)) {
        g2.push(s);
      } else {
        g3.push(s);
      }
    }

    // ◀── Sort each group by checkinTime DESC (latest first)
    const sortByTime = (a: BoardStu, b: BoardStu) => {
      if (a.checkinTime && b.checkinTime) return b.checkinTime.localeCompare(a.checkinTime);
      if (a.checkinTime) return -1;
      if (b.checkinTime) return 1;
      return a.name.localeCompare(b.name);
    };
    g1.sort(sortByTime);
    g2.sort(sortByTime);
    g3.sort(sortByTime);

    return { g1, g2, g3, cols: cols3 ? 3 : 2, titles: { g1: r1, g2: r2, g3: r3 } };
  }, [checkedStudents, cols3]);

  const totalChecked = checkedStudents.length;

  // ── Render ──
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 size={32} className="animate-spin text-gray-400" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="bg-red-50 text-red-700 p-4 rounded-xl text-center">載入失敗，請重試</div>
    );
  }

  if (classGroups.length === 0) {
    return (
      <div className="bg-white rounded-xl shadow-sm p-8 text-center text-gray-400">
        <CalendarIcon size={48} className="mx-auto mb-3 opacity-30" />
        <p className="text-lg font-medium">{selectedDate}</p>
        <p className="mt-1">當日沒有課堂</p>
      </div>
    );
  }

  if (totalChecked === 0) {
    return (
      <div className="bg-white rounded-xl shadow-sm p-8 text-center text-gray-400">
        <CalendarIcon size={48} className="mx-auto mb-3 opacity-30" />
        <p className="text-lg font-medium">{selectedDate}</p>
        <p className="mt-1">未有學生簽到 — 請掃碼簽到</p>
      </div>
    );
  }

  const renderGroup = (students: BoardStu[], title: string, accentColor: string, borderColor: string) => (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden flex flex-col" style={{ borderTop: `4px solid ${accentColor}` }}>
      {/* Group header */}
      <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
        <span className="font-bold text-gray-700">{title}</span>
        <span className="text-xs text-gray-400">{students.length}人</span>
      </div>
      {/* Cards — sorted by checkinTime DESC, latest at top */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2 min-h-[80px] max-h-[70vh]">
        {students.length === 0 ? (
          <div className="text-center text-gray-300 text-sm py-8">尚無簽到</div>
        ) : (
          students.slice(0, 100).map((s, idx) => (
            <div
              key={s.studentId}
              className={`bg-white rounded-lg p-3 border border-gray-100 shadow-sm transition-shadow hover:shadow-md ${
                idx === 0 ? 'ring-2 ring-green-300 shadow-md' : ''
              }`}
              style={{ borderLeft: `6px solid ${borderColor}` }}
            >
              {/* Top row: avatar + name + status */}
              <div className="flex items-start gap-2.5">
                {/* Avatar */}
                <div className="w-9 h-9 rounded-full bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center text-white text-sm font-bold shrink-0 shadow-sm">
                  {s.name.charAt(0)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-1">
                    <div>
                      <span className="font-semibold text-sm text-gray-800">{s.name}</span>
                      {s.school && (
                        <span className="text-[11px] text-gray-400 ml-1">· {s.school}</span>
                      )}
                    </div>
                    {/* Status badge */}
                    <span className={`shrink-0 px-2 py-0.5 rounded text-[10px] font-medium ${STATUS_BADGE[s.status]?.bg || 'bg-green-50'} ${STATUS_BADGE[s.status]?.fg || 'text-green-700'}`}>
                      {STATUS_BADGE[s.status]?.text || '✅出席'}
                    </span>
                  </div>
                  {/* Lesson context — 醒目顯示第幾課 (邊份卷) */}
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-xs font-bold text-gray-700 bg-gray-100 px-2 py-0.5 rounded">
                      📄 {s.className} · 第{s.lessonNum}課
                    </span>
                    {s.checkinTime && (
                      <span className="text-[11px] text-gray-400">🕐 {s.checkinTime}</span>
                    )}
                  </div>
                </div>
              </div>

              {/* Info row */}
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
                <span className={`font-medium ${s.payStatus === '已繳' ? 'text-green-700' : 'text-red-600'}`}>
                  💰 {s.payStatus || '未繳'}
                </span>
                <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium ${
                  s.homeworkDone
                    ? 'bg-green-50 text-green-700'
                    : 'bg-red-50 text-red-700 border border-red-200'
                }`}>
                  {s.homeworkDone ? '✅ 已交' : '❌ 未交'}
                </span>
                {s.source && (
                  <span className="text-gray-400">{s.source}</span>
                )}
              </div>

              {/* Note */}
              {s.note.trim() && (
                <div className="mt-1.5 text-[11px] text-amber-700 bg-amber-50 px-2 py-1 rounded">
                  📝 {s.note}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );

  return (
    <div>
      {/* Top bar */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 mb-4 flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xl font-bold text-green-700">{totalChecked}</span>
          <span className="text-sm text-gray-400">已簽到</span>
        </div>
        <div className="flex items-center gap-2">
          {/* Columns toggle */}
          <div className="flex bg-gray-100 rounded-lg p-0.5">
            <button
              onClick={() => setCols3(false)}
              className={`px-2.5 py-1 text-xs rounded-md transition-colors ${!cols3 ? 'bg-white text-gray-800 shadow-sm font-medium' : 'text-gray-500 hover:text-gray-700'}`}
            >
              2欄
            </button>
            <button
              onClick={() => setCols3(true)}
              className={`px-2.5 py-1 text-xs rounded-md transition-colors ${cols3 ? 'bg-white text-gray-800 shadow-sm font-medium' : 'text-gray-500 hover:text-gray-700'}`}
            >
              3欄
            </button>
          </div>
        </div>
      </div>

      {/* Board grid */}
      <div
        className="grid gap-4"
        style={{ gridTemplateColumns: groups.cols === 3 ? 'repeat(3, minmax(0, 1fr))' : 'repeat(2, minmax(0, 1fr))' }}
      >
        {renderGroup(groups.g1, `1️⃣ A-I`, '#3b82f6', '#3b82f6')}
        {renderGroup(groups.g2, `2️⃣ ${groups.titles.g2}`, '#f59e0b', '#f59e0b')}
        {groups.cols === 3 && renderGroup(groups.g3, `3️⃣ R-Z`, '#06b6d4', '#06b6d4')}
      </div>
    </div>
  );
}
