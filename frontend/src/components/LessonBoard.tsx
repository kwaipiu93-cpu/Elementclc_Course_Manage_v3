import { useMemo, useState, useRef, useCallback, useEffect } from 'react';
import { Maximize2, Minimize2 } from 'lucide-react';

// ─── Types ─────────────────────────────────────────────────────────

interface Stu {
  studentId: number;
  name: string;
  school: string;
  status: string;
  checkinTime: string;
  source: string;
  payStatus: string;
  homeworkDone: boolean;
  note: string;
  blocked: boolean;
  locked: boolean;
  phone: string;
  email: string;
}

interface Props {
  lessonId: number;
  students: Stu[];
  onToggleHomework?: (lessonId: number, studentId: number, done: boolean) => void;
}

// ─── Helpers ───────────────────────────────────────────────────────

const CHECKED = new Set([
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

const STATUS_TEXT: Record<string, string> = {
  'present':              '課堂出席',
  'makeup':               '補堂出席',
  'recording_room_present': '課室錄播',
  'video_makeup':         '線上錄播',
};

// ─── Student Card ──────────────────────────────────────────────────

function StudentCard({ s, idx, lessonId, onToggleHomework }: {
  s: Stu; idx: number; lessonId: number;
  onToggleHomework?: (lessonId: number, studentId: number, done: boolean) => void;
}) {
  const avatarBg = useMemo(() => {
    const colors = ['#3b82f6','#ef4444','#10b981','#f59e0b','#8b5cf6','#ec4899','#06b6d4','#84cc16'];
    const ci = s.studentId % colors.length;
    return colors[ci];
  }, [s.studentId]);

  // Get student photo URL from the API
  const photoUrl = `/api/students/${s.studentId}/avatar`;

  return (
    <div
      className="bg-white rounded-xl shadow-md flex gap-4 items-stretch overflow-hidden hover:shadow-lg transition-shadow"
      style={{
        borderLeft: '8px solid #28a745',
        animation: `slideIn 0.35s ease-out`,
        ...(idx === 0 ? { boxShadow: '0 0 0 2px #22c55e, 0 4px 12px rgba(0,0,0,0.15)' } : {}),
      }}
    >
      {/* Avatar — Gary style: 90×115 */}
      <div className="shrink-0" style={{ width: 90, minHeight: 115 }}>
        <img
          src={photoUrl}
          alt={s.name}
          className="w-full h-full object-cover"
          style={{ width: 90, height: 115 }}
          onError={(e) => {
            // Fallback: colored block with initial
            const t = e.currentTarget;
            t.style.display = 'none';
            const fallback = document.createElement('div');
            fallback.className = 'w-full h-full flex items-center justify-center text-white font-bold text-3xl';
            fallback.style.width = '90px';
            fallback.style.height = '115px';
            fallback.style.background = avatarBg;
            fallback.textContent = s.name.charAt(0);
            t.parentElement?.appendChild(fallback);
          }}
        />
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0 py-2.5 pr-3 flex flex-col gap-1.5">
        {/* Header row: name + time */}
        <div className="flex items-start justify-between gap-2 border-b border-gray-100 pb-1.5">
          <span className="text-[17px] font-bold text-blue-600 truncate">{s.name}</span>
          {s.checkinTime && (
            <span className="text-[13px] text-green-600 font-bold whitespace-nowrap shrink-0">
              🕐{s.checkinTime}
            </span>
          )}
        </div>

        {/* School */}
        <div className="text-[13px] text-gray-500">
          <span className="font-semibold text-gray-400 mr-1">學校:</span>
          {s.school || '—'}
        </div>

        {/* Phone */}
        {s.phone && (
          <div className="text-[13px] text-gray-500">
            <span className="font-semibold text-gray-400 mr-1">電話:</span>
            {s.phone}
          </div>
        )}

        {/* Email */}
        {s.email && (
          <div className="text-[12px] text-gray-400 truncate">
            <span className="font-semibold text-gray-400 mr-1">Email:</span>
            {s.email}
          </div>
        )}

        {/* Pay status + Note + Homework row */}
        <div className="flex items-center gap-2 flex-wrap mt-1">
          {/* Pay status */}
          <span className={`shrink-0 text-[11px] font-bold px-2 py-0.5 rounded-full ${
            s.payStatus === '已繳'
              ? 'bg-green-100 text-green-700'
              : 'bg-red-100 text-red-600'
          }`}>
            {s.payStatus === '已繳' ? '💰 已繳' : '💰 未繳'}
          </span>

          {/* Status badge */}
          {STATUS_TEXT[s.status] && (
            <span className="shrink-0 text-[11px] px-2 py-0.5 rounded-full bg-green-50 text-green-700 font-medium">
              ✅ {STATUS_TEXT[s.status]}
            </span>
          )}

          {/* Homework toggle — Gary style pill */}
          {!s.blocked && !s.locked && onToggleHomework && (
            <button
              onClick={() => onToggleHomework(lessonId, s.studentId, !s.homeworkDone)}
              className={`shrink-0 inline-flex items-center gap-1 px-3 py-1 rounded-full text-[12px] font-bold border-2 transition-all ${
                s.homeworkDone
                  ? 'bg-green-50 text-green-700 border-green-300 hover:bg-green-100'
                  : 'bg-red-50 text-red-600 border-red-300 hover:bg-red-100'
              }`}
            >
              {s.homeworkDone ? '✓ 已交功課' : '✗ 未交功課'}
            </button>
          )}
        </div>

        {/* Note */}
        {s.note?.trim() && (
          <div className="mt-0.5 px-2 py-1.5 bg-amber-50 border border-amber-200 rounded text-[12px] text-amber-800 leading-relaxed">
            📝 <span className="font-medium">備註：</span>{s.note}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Component ─────────────────────────────────────────────────────

export default function LessonBoard({ lessonId, students, onToggleHomework }: Props) {
  const [cols3, setCols3] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const boardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

  const toggleFullscreen = useCallback(async () => {
    if (!boardRef.current) return;
    try {
      if (!document.fullscreenElement) {
        await boardRef.current.requestFullscreen();
        setFullscreen(true);
      } else {
        await document.exitFullscreen();
        setFullscreen(false);
      }
    } catch { /* blocked */ }
  }, []);

  // Group checked-in students by name initial
  const groups = useMemo(() => {
    const r1 = 'A-I';
    const r2 = cols3 ? 'J-Q' : 'J-Z';

    const g1: Stu[] = [];
    const g2: Stu[] = [];
    const g3: Stu[] = [];

    for (const s of students) {
      if (!CHECKED.has(s.status)) continue;

      const initial = getInitial(s.name);
      if (!initial || isInRange(initial, r1)) {
        g1.push(s);
      } else if (isInRange(initial, r2)) {
        g2.push(s);
      } else {
        g3.push(s);
      }
    }

    const sortByTime = (a: Stu, b: Stu) => {
      if (a.checkinTime && b.checkinTime) return b.checkinTime.localeCompare(a.checkinTime);
      if (a.checkinTime) return -1;
      if (b.checkinTime) return 1;
      return a.name.localeCompare(b.name);
    };
    g1.sort(sortByTime);
    g2.sort(sortByTime);
    g3.sort(sortByTime);

    return { g1, g2, g3, cols: cols3 ? 3 : 2 };
  }, [students, cols3]);

  if (students.length === 0) {
    return <div className="p-4 text-center text-sm text-gray-400">未有學生報讀此課節</div>;
  }

  const totalChecked = groups.g1.length + groups.g2.length + groups.g3.length;

  if (totalChecked === 0) {
    return (
      <div className="p-6 text-center text-gray-400">
        <p className="text-sm">未有學生簽到 — 請掃碼簽到</p>
      </div>
    );
  }

  const renderColumn = (group: Stu[], title: string, accentColor: string) => (
    <div className="flex flex-col" style={{ borderTop: `4px solid ${accentColor}` }}>
      <div className="flex items-center justify-between px-3 py-2 bg-gray-800 border-b border-gray-700">
        <span className="font-bold text-sm text-gray-200">{title}</span>
        <span className="text-[11px] text-gray-400">{group.length}人</span>
      </div>
      <div className="flex-1 space-y-3 p-3 min-h-[80px] max-h-[55vh] overflow-y-auto">
        {group.length === 0 ? (
          <div className="text-center text-gray-500 text-xs py-8">—</div>
        ) : (
          group.slice(0, 80).map((s, idx) => (
            <StudentCard
              key={s.studentId}
              s={s}
              idx={idx}
              lessonId={lessonId}
              onToggleHomework={onToggleHomework}
            />
          ))
        )}
      </div>
    </div>
  );

  const boardContent = (
    <div
      ref={boardRef}
      className={`bg-gray-900 ${fullscreen ? 'fixed inset-0 z-[9999] overflow-hidden' : 'rounded-b-lg'}`}
    >
      {/* Top stats bar — Gary style */}
      <div
        className="flex items-center justify-between px-4 py-3 border-b border-gray-700"
        style={{
          background: 'linear-gradient(to right, #1e293b, #0f172a)',
          borderLeft: '6px solid #3b82f6',
        }}
      >
        <div className="flex items-center gap-8">
          <div className="text-white">
            <span className="text-sm text-gray-400">總人數</span>
            <span className="ml-2 text-2xl font-bold text-blue-400">{students.length}</span>
          </div>
          <div className="text-white">
            <span className="text-sm text-gray-400">已簽到</span>
            <span className="ml-2 text-2xl font-bold text-green-400">{totalChecked}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex bg-gray-700 rounded-md p-0.5">
            <button
              onClick={() => setCols3(false)}
              className={`px-2 py-1 rounded transition-colors text-[11px] ${!cols3 ? 'bg-white text-gray-800 shadow-sm font-medium' : 'text-gray-400 hover:text-gray-200'}`}
            >
              2欄
            </button>
            <button
              onClick={() => setCols3(true)}
              className={`px-2 py-1 rounded transition-colors text-[11px] ${cols3 ? 'bg-white text-gray-800 shadow-sm font-medium' : 'text-gray-400 hover:text-gray-200'}`}
            >
              3欄
            </button>
          </div>
          <button
            onClick={toggleFullscreen}
            className="px-2 py-1 rounded text-xs bg-gray-700 text-gray-300 hover:bg-gray-600 transition-colors"
            title={fullscreen ? '退出全屏' : '全屏顯示'}
          >
            {fullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
        </div>
      </div>

      {/* Grid columns */}
      <div
        className="grid"
        style={{
          height: fullscreen ? 'calc(100vh - 56px)' : 'auto',
          gridTemplateColumns: groups.cols === 3 ? 'repeat(3, 1fr)' : 'repeat(2, 1fr)',
          ...(fullscreen ? { fontSize: '1.05rem' } : {}),
        }}
      >
        {renderColumn(groups.g1, `1️⃣ A - I`, '#3b82f6')}
        {renderColumn(groups.g2, `2️⃣ ${cols3 ? 'J - Q' : 'J - Z'}`, '#f59e0b')}
        {groups.cols === 3 && renderColumn(groups.g3, `3️⃣ R - Z`, '#06b6d4')}
      </div>

      {/* Slide-in keyframes (injected once) */}
      <style>{`
        @keyframes slideIn {
          from { opacity: 0; transform: translateX(-16px); }
          to   { opacity: 1; transform: translateX(0); }
        }
      `}</style>
    </div>
  );

  return boardContent;
}
