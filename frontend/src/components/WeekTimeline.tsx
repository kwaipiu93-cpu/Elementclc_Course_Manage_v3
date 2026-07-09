import { useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import { api } from '../api/client';
import { Loader2 } from 'lucide-react';

// ─── Types ─────────────────────────────────────────────────────────

interface LessonInfo {
  lessonId: number;
  lessonNum: number;
  time: string;        // "09:00-10:30"
  className: string;
  classId: number;
  stats: { present: number; leave: number; absent: number; pending: number; waiting: number; total: number };
}

interface Props {
  weekStart: Date;      // Monday 00:00
  onDayClick: (dateStr: string) => void;
}

// ─── Helpers ───────────────────────────────────────────────────────

function toDateStr(d: Date): string {
  return d.toLocaleDateString('en-CA'); // YYYY-MM-DD
}

function parseTime(timeStr: string): { startH: number; endH: number } | null {
  // "09:00-10:30" or "9:00-10:30" or ""
  if (!timeStr) return null;
  const parts = timeStr.split('-');
  if (parts.length < 2) return null;
  const toH = (s: string) => {
    const [h, m] = s.trim().split(':').map(Number);
    if (isNaN(h)) return NaN;
    return h + (m || 0) / 60;
  };
  const start = toH(parts[0]);
  const end = toH(parts[1]);
  if (isNaN(start) || isNaN(end)) return null;
  if (end <= start) return null;
  return { startH: start, endH: end };
}

const DAY_LABELS = ['日','一','二','三','四','五','六'];

// ─── Component ─────────────────────────────────────────────────────

export default function WeekTimeline({ weekStart, onDayClick }: Props) {
  // Build 7 day date strings
  const dayDates = useMemo(() => {
    const days: Date[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(weekStart);
      d.setDate(d.getDate() + i);
      days.push(d);
    }
    return days;
  }, [weekStart]);

  const dayStrs = dayDates.map(toDateStr);

  // Fetch all 7 days in parallel
  const queries = useQueries({
    queries: dayStrs.map(dateStr => ({
      queryKey: ['attendance-daily', dateStr],
      queryFn: () => api.getAttendanceDaily(dateStr),
      staleTime: 30_000,
    })),
  });

  const isLoading = queries.some(q => q.isLoading);
  const allLoaded = queries.every(q => q.isSuccess);

  // Extract all lessons with time info
  const lessonsByDay = useMemo(() => {
    const map: Map<string, LessonInfo[]> = new Map();
    dayStrs.forEach(ds => map.set(ds, []));

    if (!allLoaded) return map;

    queries.forEach((q, idx) => {
      const dateStr = dayStrs[idx];
      const groups = q.data || [];
      for (const group of groups) {
        for (const lesson of group.lessons || []) {
          parseTime(lesson.time || ''); // validate
          // Count stats
          let present = 0, leave = 0, absent = 0, pending = 0, waiting = 0;
          for (const stu of lesson.students || []) {
            const st = stu.status;
            if (st === 'present' || st === 'makeup' || st === 'recording_room_present' || st === 'video_makeup') present++;
            else if (st === 'leave') leave++;
            else if (st === 'absent') absent++;
            else if (st === 'scheduled_room' || st === 'scheduled_video' || st === 'scheduled_classroom') pending++;
            else if (st === 'waiting') waiting++;
          }
          map.get(dateStr)!.push({
            lessonId: lesson.lessonId,
            lessonNum: lesson.lessonNum,
            time: lesson.time || '',
            className: group.className,
            classId: group.classId,
            stats: { present, leave, absent, pending, waiting, total: (lesson.students || []).length },
          });
        }
      }
    });
    return map;
  }, [allLoaded, queries, dayStrs]);

  // Determine time range across all lessons
  const timeRange = useMemo(() => {
    let minH = 8, maxH = 21; // default 08:00-21:00
    for (const [, lessons] of lessonsByDay) {
      for (const l of lessons) {
        const t = parseTime(l.time);
        if (!t) continue;
        if (t.startH < minH) minH = Math.floor(t.startH);
        if (t.endH > maxH) maxH = Math.ceil(t.endH);
      }
    }
    // Ensure at least 8 hours range
    if (maxH - minH < 8) maxH = minH + 8;
    return { minH, maxH };
  }, [lessonsByDay]);

  const PX_PER_HOUR = 64;
  const totalHours = timeRange.maxH - timeRange.minH;
  const gridHeight = totalHours * PX_PER_HOUR;

  // Generate hour labels
  const hourSlots = useMemo(() => {
    const slots: number[] = [];
    for (let h = timeRange.minH; h <= timeRange.maxH; h++) {
      slots.push(h);
    }
    return slots;
  }, [timeRange]);

  const todayStr = new Date().toLocaleDateString('en-CA');

  // Current time indicator
  const nowLine = useMemo(() => {
    const now = new Date();
    const nowH = now.getHours() + now.getMinutes() / 60;
    if (nowH < timeRange.minH || nowH > timeRange.maxH) return null;
    return (nowH - timeRange.minH) * PX_PER_HOUR;
  }, [timeRange, PX_PER_HOUR]);

  return (
    <div className="bg-white rounded-xl shadow-sm mb-4 overflow-hidden">
      {/* Top header: day names */}
      <div className="flex border-b border-gray-200 bg-gray-50 sticky top-0 z-10">
        {/* Time gutter */}
        <div className="w-14 shrink-0 border-r border-gray-200" />
        {dayDates.map((d, _i) => {
          const ds = toDateStr(d);
          const isToday = ds === todayStr;
          return (
            <div
              key={ds}
              className={`flex-1 text-center py-2 border-r border-gray-100 last:border-r-0 cursor-pointer hover:bg-gray-100 transition-colors ${
                isToday ? 'bg-blue-50' : ''
              }`}
              onClick={() => onDayClick(ds)}
            >
              <div className="text-[11px] text-gray-400">{DAY_LABELS[d.getDay()]}</div>
              <div className={`text-sm font-bold ${isToday ? 'text-blue-600' : 'text-gray-700'}`}>
                {d.getDate()}
              </div>
            </div>
          );
        })}
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center justify-center py-16">
          <Loader2 size={28} className="animate-spin text-gray-400" />
          <span className="ml-2 text-sm text-gray-400">載入課堂...</span>
        </div>
      )}

      {/* Timeline grid */}
      {allLoaded && (
        <div className="relative flex" style={{ height: gridHeight }}>
          {/* Time axis */}
          <div className="w-14 shrink-0 border-r border-gray-200 relative">
            {hourSlots.map(h => {
              const top = (h - timeRange.minH) * PX_PER_HOUR;
              return (
                <div
                  key={h}
                  className="absolute right-2 text-[10px] text-gray-400 -translate-y-1/2"
                  style={{ top }}
                >
                  {String(h).padStart(2, '0')}:00
                </div>
              );
            })}
          </div>

          {/* Day columns */}
          {dayStrs.map((ds, _di) => {
            const lessons = lessonsByDay.get(ds) || [];
            const isToday = ds === todayStr;
            return (
              <div
                key={ds}
                className={`flex-1 relative border-r border-gray-100 last:border-r-0 ${
                  isToday ? 'bg-blue-50/30' : ''
                }`}
              >
                {/* Hour grid lines */}
                {hourSlots.map(h => (
                  <div
                    key={h}
                    className="absolute left-0 right-0 border-t border-gray-100"
                    style={{ top: (h - timeRange.minH) * PX_PER_HOUR }}
                  />
                ))}

                {/* Half-hour lines */}
                {(() => {
                  const lines: number[] = [];
                  for (let h = timeRange.minH; h < timeRange.maxH; h += 0.5) {
                    if (h === Math.floor(h)) continue; // skip full hours (already have lines)
                    lines.push(h);
                  }
                  return lines.map(h => (
                    <div
                      key={h}
                      className="absolute left-0 right-0 border-t border-gray-50 border-dashed"
                      style={{ top: (h - timeRange.minH) * PX_PER_HOUR }}
                    />
                  ));
                })()}

                {/* Current time line */}
                {nowLine !== null && isToday && (
                  <div
                    className="absolute left-0 right-0 z-20 pointer-events-none"
                    style={{ top: nowLine }}
                  >
                    <div className="h-0.5 bg-red-500" />
                    <div className="w-2 h-2 bg-red-500 rounded-full -mt-1 -ml-1" />
                  </div>
                )}

                {/* Lesson blocks */}
                {lessons.map(l => {
                  const t = parseTime(l.time);
                  if (!t) return null;
                  const top = (t.startH - timeRange.minH) * PX_PER_HOUR;
                  const height = Math.max((t.endH - t.startH) * PX_PER_HOUR, 24);
                  const total = l.stats.total;
                  const present = l.stats.present;
                  const bg = total > 0 && present === total
                    ? 'bg-green-100 border-green-300 text-green-800'
                    : present > 0
                    ? 'bg-amber-100 border-amber-300 text-amber-800'
                    : 'bg-red-100 border-red-200 text-red-700';

                  return (
                    <div
                      key={l.lessonId}
                      onClick={() => onDayClick(ds)}
                      className={`absolute left-0.5 right-0.5 rounded px-1.5 py-0.5 border cursor-pointer hover:brightness-95 transition-all overflow-hidden ${bg}`}
                      style={{ top, height }}
                      title={`${l.className} · 第${l.lessonNum}節 · ${l.time}\n✅${present} 📋${l.stats.leave} ❌${l.stats.absent} / ${total}人`}
                    >
                      <div className="text-[9px] font-semibold leading-tight truncate">
                        {l.className}
                      </div>
                      {height >= 32 && (
                        <div className="text-[8px] leading-tight mt-0.5">
                          第{l.lessonNum}節
                        </div>
                      )}
                      {height >= 40 && total > 0 && (
                        <div className="text-[8px] leading-tight mt-0.5 text-gray-600">
                          ✅{present}/{total}
                        </div>
                      )}
                      {height >= 48 && (
                        <div className="text-[7px] leading-tight mt-0.5 opacity-70">
                          {l.time}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}

      {/* No data */}
      {allLoaded && !isLoading && (
        (() => {
          let totalLessons = 0;
          for (const [, lessons] of lessonsByDay) totalLessons += lessons.length;
          if (totalLessons === 0) {
            return (
              <div className="py-12 text-center text-gray-400 text-sm">
                本週沒有課堂
              </div>
            );
          }
          return null;
        })()
      )}

      {/* Legend */}
      <div className="flex items-center gap-3 px-4 py-2 bg-gray-50 border-t border-gray-200 text-[10px] text-gray-500">
        <span>🟩 全員出席</span>
        <span>🟨 部份出席</span>
        <span>🟥 未有出席</span>
      </div>
    </div>
  );
}
