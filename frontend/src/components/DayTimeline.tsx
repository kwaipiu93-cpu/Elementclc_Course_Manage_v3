interface Stats {
  present: number;
  leave: number;
  absent: number;
  catchup: number;
  pending: number;
  waiting: number;
  total: number;
}

interface Props {
  lessons: any[];
  statsForLesson: (l: any) => Stats;
  scanningLessonId: number | null;
  startScan: { mutate: (id: number) => void; isPending: boolean };
  stopScan: { mutate: () => void; isPending: boolean };
  toggleHw: { mutate: (data: { lessonId: number; studentId: number; done: boolean }) => void; isPending: boolean };
  onStudentClick: (data: {
    lessonId: number; studentId: number; studentName: string; studentSchool: string;
    className: string; lessonNum: number; existingStatus: string;
  }) => void;
  isProcessing: boolean;
  onToggleExpand: (lessonId: number) => void;
  expandedIds: Set<number>;
}

const PX_PER_HOUR = 80;

function parseTime(t: string): { start: number; end: number } | null {
  const m = t.match(/(\d{1,2}):(\d{2})\s*[-–—]\s*(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return {
    start: parseInt(m[1]) + parseInt(m[2]) / 60,
    end: parseInt(m[3]) + parseInt(m[4]) / 60,
  };
}

export default function DayTimeline({
  lessons, statsForLesson, scanningLessonId, startScan, stopScan,
  toggleHw, onStudentClick, isProcessing, onToggleExpand, expandedIds,
}: Props) {
  const parsed: any[] = lessons
    .map(l => {
      const t = parseTime(l.time || '');
      return t ? { ...l, startH: t.start, endH: t.end } : null;
    })
    .filter((l): l is any => l !== null);

  if (parsed.length === 0) {
    return (
      <div className="bg-white rounded-xl shadow-sm p-8 text-center text-gray-400">
        當日課堂未有時間資料
      </div>
    );
  }

  const gridStart = Math.floor(Math.min(...parsed.map(l => l.startH))) - 0.5;
  const gridEnd = Math.ceil(Math.max(...parsed.map(l => l.endH))) + 0.5;
  const totalH = gridEnd - gridStart;
  const hours: number[] = [];
  for (let h = Math.floor(gridStart); h <= Math.ceil(gridEnd); h++) hours.push(h);

  // Group overlapping lessons (simple greedy, max 2 cols)
  const columns: any[][] = [];
  for (const l of parsed) {
    let placed = false;
    for (const col of columns) {
      const last = col[col.length - 1];
      if (last.endH <= l.startH) { col.push(l); placed = true; break; }
    }
    if (!placed) columns.push([l]);
  }
  const maxCols = Math.min(columns.length, 2);

  return (
    <div className="bg-white rounded-xl shadow-sm overflow-hidden">
      <div className="relative" style={{ paddingLeft: '3.5rem', minHeight: `${totalH * PX_PER_HOUR + 20}px` }}>
        {/* Time axis + gridlines */}
        <div className="absolute left-0 top-0 bottom-0 w-14 border-r border-gray-200 bg-gray-50/50" style={{ zIndex: 1 }}>
          {hours.map(h => {
            const top = (h - gridStart) * PX_PER_HOUR;
            return (
              <div key={h} className="absolute right-2 text-[10px] text-gray-400 font-mono" style={{ top: top - 6 }}>
                {String(h).padStart(2, '0')}:00
              </div>
            );
          })}
          {Array.from({ length: Math.floor(totalH * 2) }, (_, i) => {
            const top = i * (PX_PER_HOUR / 2);
            return <div key={`gl-${i}`} className="absolute left-0 right-0 border-t border-gray-100" style={{ top }} />;
          })}
        </div>

        {/* Hour gridlines on content area */}
        <div className="absolute left-14 right-0 top-0 bottom-0" style={{ zIndex: 0 }}>
          {hours.map(h => {
            const top = (h - gridStart) * PX_PER_HOUR;
            return <div key={`hgl-${h}`} className="absolute left-0 right-0 border-t border-gray-200" style={{ top }} />;
          })}
        </div>

        {/* Lesson blocks */}
        <div className="relative" style={{ zIndex: 2, paddingTop: 4 }}>
          {parsed.map(l => {
            const colIdx = columns.findIndex(c => c.some(cl => cl.lessonId === l.lessonId));
            const leftPct = (colIdx / maxCols) * 100;
            const stats = statsForLesson(l);
            const isExpanded = expandedIds.has(l.lessonId);

            return (
              <div key={l.lessonId} className="mb-3" style={{ paddingLeft: `${leftPct}%`, width: `${100 / maxCols}%` }}>
                {/* Lesson card */}
                <div
                  onClick={() => onToggleExpand(l.lessonId)}
                  className="cursor-pointer rounded-lg border-2 border-l-4 p-2.5 hover:shadow-md transition-shadow bg-white"
                  style={{
                    borderLeftColor: stats.present === stats.total ? '#22c55e' : stats.present > 0 ? '#f59e0b' : '#ef4444',
                    minHeight: 36,
                  }}
                >
                  <div className="flex items-start justify-between gap-1">
                    <div className="min-w-0">
                      <div className="font-semibold text-sm text-gray-800 truncate">{l.className}</div>
                      <div className="text-[11px] text-gray-500">第{l.lessonNum}節 · {l.time || '—'}</div>
                    </div>
                    <div className="text-[10px] text-gray-400 text-right whitespace-nowrap shrink-0">
                      <span className="text-green-600">✅{stats.present}</span>{' '}
                      <span className="text-blue-600">📋{stats.leave}</span>{' '}
                      <span className="text-red-600">❌{stats.absent}</span>
                      {stats.catchup > 0 && <span className="text-purple-600"> 🎥{stats.catchup}</span>}
                      {stats.waiting > 0 && <span className="text-red-600"> ‼️{stats.waiting}</span>}
                      <span className="text-gray-400"> /{stats.total}</span>
                    </div>
                  </div>

                  {/* Action buttons */}
                  <div className="flex items-center gap-1 mt-1.5" onClick={e => e.stopPropagation()}>
                    {scanningLessonId === l.lessonId ? (
                      <>
                        <span className="inline-block w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                        <span className="text-[10px] text-green-700 font-medium">掃碼中</span>
                        <button onClick={() => stopScan.mutate()} disabled={stopScan.isPending}
                          className="ml-1 px-1.5 py-0.5 rounded text-[10px] bg-red-100 text-red-700 hover:bg-red-200">
                          🛑停止
                        </button>
                      </>
                    ) : (
                      <button onClick={() => { startScan.mutate(l.lessonId); }}
                        disabled={startScan.isPending || !!scanningLessonId}
                        className="px-1.5 py-0.5 rounded text-[10px] bg-blue-100 text-blue-700 hover:bg-blue-200 disabled:opacity-50">
                        📷掃碼
                      </button>
                    )}
                    <span className={`text-[10px] ${isExpanded ? 'text-amber-600 font-medium' : 'text-gray-400'}`}>
                      {isExpanded ? '▲收合' : '▼展開'} {stats.total}人
                    </span>
                  </div>
                </div>

                {/* Expanded student table */}
                {isExpanded && (
                  <div className="mt-1 border border-gray-200 rounded-lg overflow-hidden bg-white">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-100 bg-gray-50/50 text-xs text-gray-500">
                          <th className="text-left px-2 py-1.5 font-medium">學生</th>
                          <th className="text-left px-2 py-1.5 font-medium">狀態</th>
                          <th className="text-left px-2 py-1.5 font-medium">功課</th>
                          <th className="text-left px-2 py-1.5 font-medium">時間</th>
                        </tr>
                      </thead>
                      <tbody>
                        {l.students.map((stu: any) => (
                          <tr key={stu.studentId} className={`border-t border-gray-50 ${stu.blocked ? 'bg-red-50' : ''}`}>
                            <td className="px-2 py-1.5">
                              <button
                                onClick={() => {
                                  if (stu.blocked || stu.locked) return;
                                  onStudentClick({
                                    lessonId: l.lessonId, studentId: stu.studentId,
                                    studentName: stu.name, studentSchool: stu.school || '',
                                    className: l.className, lessonNum: l.lessonNum,
                                    existingStatus: stu.status,
                                  });
                                }}
                                disabled={stu.blocked || stu.locked || isProcessing}
                                className="text-left disabled:opacity-50"
                              >
                                <span className="font-medium text-xs">{stu.name.split(' ')[1] || stu.name}</span>
                                <span className="text-[10px] text-gray-400 ml-1">{stu.school}</span>
                              </button>
                            </td>
                            <td className="px-2 py-1.5">
                              {(() => {
                                const s = stu.status;
                                const badge: Record<string, string> = {
                                  'present': '✅', 'leave': '📋', 'absent': '❌',
                                  'recording_room_present': '📹✅', 'video_makeup': '🎥✅',
                                  'makeup': '🔄✅', 'waiting': '‼️',
                                  'scheduled_room': '⌛📹', 'scheduled_video': '⌛🎥',
                                  'scheduled_classroom': '⌛🔄', 'catchup_required': '🎥',
                                };
                                return <span className="text-xs">{badge[s] || '🟡'}</span>;
                              })()}
                            </td>
                            <td className="px-2 py-1.5 text-xs">
                              <button
                                onClick={() => toggleHw.mutate({ lessonId: l.lessonId, studentId: stu.studentId, done: !stu.homeworkDone })}
                                disabled={toggleHw.isPending}
                                className={`px-1.5 py-0.5 rounded text-[10px] ${stu.homeworkDone ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}
                              >
                                {stu.homeworkDone ? '✅' : '❌'}
                              </button>
                            </td>
                            <td className="px-2 py-1.5 text-[10px] text-gray-400">{stu.checkinTime?.slice(11, 16) || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {l.students.length === 0 && (
                      <div className="p-3 text-center text-xs text-gray-400">未有學生</div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
