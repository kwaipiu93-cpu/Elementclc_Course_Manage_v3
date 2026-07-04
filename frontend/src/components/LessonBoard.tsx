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

export default function LessonBoard({ lessonId, students, onToggleHomework }: Props) {
  const [cols3, setCols3] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const boardRef = useRef<HTMLDivElement>(null);

  // Listen for fullscreen exit (Escape key, etc.)
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
    } catch {
      // Browser may block fullscreen if not triggered by user gesture
    }
  }, []);

  // Only checked-in students, sorted by checkinTime DESC
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

  const renderColumn = (group: Stu[], title: string, accentColor: string, borderColor: string) => (
    <div className="flex flex-col" style={{ borderTop: `3px solid ${accentColor}` }}>
      <div className="flex items-center justify-between px-3 py-1.5 bg-gray-50 border-b border-gray-100">
        <span className="font-bold text-xs text-gray-700">{title}</span>
        <span className="text-[10px] text-gray-400">{group.length}人</span>
      </div>
      <div className="flex-1 space-y-1.5 p-2 min-h-[60px] max-h-[50vh] overflow-y-auto">
        {group.length === 0 ? (
          <div className="text-center text-gray-300 text-xs py-6">—</div>
        ) : (
          group.slice(0, 80).map((s, idx) => (
            <div
              key={s.studentId}
              className={`bg-white rounded-lg px-2.5 py-2 border border-gray-100 shadow-sm ${
                idx === 0 ? 'ring-2 ring-green-300' : ''
              }`}
              style={{ borderLeft: `5px solid ${borderColor}` }}
            >
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center text-white text-[10px] font-bold shrink-0">
                  {s.name.charAt(0)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-1">
                    <div className="flex items-center gap-1 min-w-0">
                      <span className="text-xs font-semibold text-gray-800 truncate">
                        {s.name}
                      </span>
                      {/* 💰 繳費 — 醒目顯示 */}
                      <span className={`shrink-0 text-[10px] font-bold ${
                        s.payStatus === '已繳' ? 'text-green-600' : 'text-red-500'
                      }`}>
                        {s.payStatus === '已繳' ? '💰已繳' : '💰未繳'}
                      </span>
                    </div>
                    <span className={`shrink-0 px-1.5 py-0.5 rounded text-[9px] font-medium ${STATUS_BADGE[s.status]?.bg || 'bg-green-50'} ${STATUS_BADGE[s.status]?.fg || 'text-green-700'}`}>
                      {STATUS_BADGE[s.status]?.text || '✅出席'}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 text-[10px] text-gray-400 mt-0.5">
                    {s.school && <span className="truncate">{s.school}</span>}
                    {s.checkinTime && <span>· 🕐{s.checkinTime}</span>}
                  </div>
                </div>
              </div>
              {/* 功課 — 灰色按鈕 */}
              <div className="mt-1.5 flex items-center gap-2">
                {!s.blocked && !s.locked && onToggleHomework ? (
                  <button
                    onClick={() => onToggleHomework(lessonId, s.studentId, !s.homeworkDone)}
                    className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-medium bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors"
                  >
                    {s.homeworkDone ? '✅已交' : '❌未交'}
                  </button>
                ) : (
                  <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-medium bg-gray-100 text-gray-500">
                    {s.homeworkDone ? '✅已交' : '❌未交'}
                  </span>
                )}
              </div>
              {/* 📝 備註 — 醒目底色塊 */}
              {s.note?.trim() && (
                <div className="mt-1.5 px-2 py-1.5 bg-amber-50 border border-amber-200 rounded text-[10px] text-amber-800 leading-relaxed">
                  📝 <span className="font-medium">備註：</span>{s.note}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );

  const boardContent = (
    <div ref={boardRef} className={`${fullscreen ? 'fixed inset-0 z-[9999] bg-white overflow-hidden' : ''}`}>
      {/* Top bar */}
      <div className={`flex items-center justify-between px-4 py-2 bg-gradient-to-r from-gray-50 to-white border-b border-gray-200 ${fullscreen ? 'px-6 py-3' : ''}`}>
        <span className={`font-medium ${fullscreen ? 'text-green-700 text-base' : 'text-xs text-green-700'}`}>
          ✅ {totalChecked} 人已簽到
        </span>
        <div className="flex items-center gap-2">
          <div className="flex bg-gray-200 rounded-md p-0.5">
            <button
              onClick={() => setCols3(false)}
              className={`px-2 py-0.5 rounded transition-colors ${!cols3 ? 'bg-white text-gray-700 shadow-sm font-medium' : 'text-gray-500 hover:text-gray-600'} ${fullscreen ? 'text-sm px-3 py-1' : 'text-[10px]'}`}
            >
              2欄
            </button>
            <button
              onClick={() => setCols3(true)}
              className={`px-2 py-0.5 rounded transition-colors ${cols3 ? 'bg-white text-gray-700 shadow-sm font-medium' : 'text-gray-500 hover:text-gray-600'} ${fullscreen ? 'text-sm px-3 py-1' : 'text-[10px]'}`}
            >
              3欄
            </button>
          </div>
          {/* Fullscreen button */}
          <button
            onClick={toggleFullscreen}
            className="px-2 py-1 rounded text-xs bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors"
            title={fullscreen ? '退出全屏' : '全屏顯示'}
          >
            {fullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
        </div>
      </div>
      {/* Grid — fullscreen uses larger font/spacing */}
      <div
        className="grid"
        style={{
          height: fullscreen ? 'calc(100vh - 48px)' : 'auto',
          gridTemplateColumns: groups.cols === 3 ? 'repeat(3, 1fr)' : 'repeat(2, 1fr)',
          ...(fullscreen ? { fontSize: '1.1rem' } : {}),
        }}
      >
        {renderColumn(groups.g1, `1️⃣ A-I`, '#3b82f6', '#3b82f6')}
        {renderColumn(groups.g2, `2️⃣ ${cols3 ? 'J-Q' : 'J-Z'}`, '#f59e0b', '#f59e0b')}
        {groups.cols === 3 && renderColumn(groups.g3, `3️⃣ R-Z`, '#06b6d4', '#06b6d4')}
      </div>
    </div>
  );

  // When fullscreen, render outside the normal flow at the document level
  if (fullscreen) {
    return boardContent;
  }

  // Normal inline rendering
  return boardContent;
}
