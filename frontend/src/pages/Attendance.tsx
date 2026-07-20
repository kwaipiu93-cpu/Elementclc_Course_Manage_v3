import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { Calendar as CalendarIcon, Loader2, X, ChevronLeft, ChevronRight, Clock } from 'lucide-react';
import ScanPanel from '../components/ScanPanel';
import WeekTimeline from '../components/WeekTimeline';
import DayTimeline from '../components/DayTimeline';
import LessonBoard from '../components/LessonBoard';

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

const RECORDING_CLASS_ID = 8;

// ⚡ Quick actions: status updates + recording makeup creation
const STATUS_OPTIONS = [
  { key: 'present', label: '✅ 課堂出席', color: 'bg-green-100 text-green-700 hover:bg-green-200' },
  { key: 'leave', label: '📋 請假', color: 'bg-blue-100 text-blue-700 hover:bg-blue-200' },
  { key: 'absent', label: '❌ 缺勤', color: 'bg-red-100 text-red-700 hover:bg-red-200' },
  { key: '', label: '🔄 未處理', color: 'bg-gray-100 text-gray-600 hover:bg-gray-200' },
];

// Status options for 補課錄播班 (Class 8) — recording checkin only
const RECORDING_STATUS_OPTIONS = [
  { key: 'recording_room_present', label: '📹 課室錄播出席', color: 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200' },
  { key: 'video_makeup', label: '🎥 線上錄播出席', color: 'bg-purple-100 text-purple-700 hover:bg-purple-200' },
  { key: 'leave', label: '📋 請假', color: 'bg-blue-100 text-blue-700 hover:bg-blue-200' },
  { key: '', label: '🔄 未處理', color: 'bg-gray-100 text-gray-600 hover:bg-gray-200' },
];

const RECORDING_ACTIONS = [
  { type: '線上錄播', label: '🎥 安排線上錄播', color: 'bg-purple-100 text-purple-700 hover:bg-purple-200' },
  { type: '課室錄播', label: '📹 安排課室錄播', color: 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200' },
];

export default function Attendance() {
  const today = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD（local timezone）
  const [selectedDate, setSelectedDate] = useState(today);
  const [calMode, setCalMode] = useState<'day' | 'week' | 'month'>('day');
  const [calWeekStart, setCalWeekStart] = useState(() => {
    // Monday of current week
    const now = new Date();
    const dow = now.getDay();
    const diff = dow === 0 ? -6 : 1 - dow;
    const mon = new Date(now);
    mon.setDate(mon.getDate() + diff);
    mon.setHours(0, 0, 0, 0);
    return mon;
  });
  const [lessonBoardIds, setLessonBoardIds] = useState<Set<number>>(new Set());

  const toggleLessonBoard = (lessonId: number) => {
    setLessonBoardIds(prev => {
      const next = new Set(prev);
      if (next.has(lessonId)) next.delete(lessonId);
      else next.add(lessonId);
      return next;
    });
  };
  const [actionTarget, setActionTarget] = useState<{
    lessonId: number;
    studentId: number;
    studentName: string;
    studentSchool: string;
    className: string;
    lessonNum: number;
    existingStatus: string;
  } | null>(null);

  const [includeFee, setIncludeFee] = useState(true);

  const [scanningLessonId, setScanningLessonId] = useState<number | null>(null);

  const queryClient = useQueryClient();

  // Daily data — auto-refresh during scan
  const { data: classGroups, isLoading, isError } = useQuery({
    queryKey: ['attendance-daily', selectedDate],
    queryFn: () => api.getAttendanceDaily(selectedDate),
    enabled: calMode === 'day',
    refetchInterval: scanningLessonId ? 3000 : false,
  });

  // Separate 補課錄播班 (Class 8) from date-bound classes
  const recordingGroup = (classGroups || []).find(g => g.classId === RECORDING_CLASS_ID);
  const normalGroups = (classGroups || []).filter(g => g.classId !== RECORDING_CLASS_ID);

  // Calendar — fetch current month for month view
  const calYear = calWeekStart.getFullYear();
  const calMonth = calWeekStart.getMonth() + 1;
  const calMonthName = ['一月','二月','三月','四月','五月','六月','七月','八月','九月','十月','十一月','十二月'][calMonth - 1];

  const { data: calApiData } = useQuery({
    queryKey: ['calendar', calYear, calMonth],
    queryFn: () => api.getAttendanceCalendar(calYear, calMonth),
    enabled: calMode === 'month',
  });

  // Mutations
  const updateStatus = useMutation({
    mutationFn: (data: { lessonId: number; studentId: number; status: string }) =>
      api.updateCheckin(data.lessonId, data.studentId, data.status),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['attendance-daily', selectedDate] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['calendar'] });
      setActionTarget(null);
    },
  });

  const createRecordingMakeup = useMutation({
    mutationFn: (data: { lessonId: number; studentId: number; makeupType: string }) => {
      // Find the lesson info to get class_id and lesson_num (search normal groups only)
      const allGroups = normalGroups || [];
      for (const group of allGroups) {
        for (const ls of group.lessons || []) {
          if (ls.lessonId === data.lessonId) {
            return api.createMakeup({
              student_id: data.studentId,
              original_class_id: group.classId,
              original_topic: group.className,
              lesson_num: String(ls.lessonNum),
              absent_date: selectedDate,
              makeup_type: data.makeupType,
              makeup_class: null,
              target_lesson_id: null,
              status: 'scheduled',
            });
          }
        }
      }
      throw new Error('找不到對應課堂資料');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['attendance-daily', selectedDate] });
      queryClient.invalidateQueries({ queryKey: ['makeups'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      setActionTarget(null);
    },
  });

  const toggleHw = useMutation({
    mutationFn: (data: { lessonId: number; studentId: number; done: boolean }) =>
      api.toggleHomework(data.lessonId, data.studentId, data.done),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['attendance-daily', selectedDate] });
    },
  });

  const updateNote = useMutation({
    mutationFn: (data: { studentId: number; note: string }) =>
      api.updateStudentNote(data.studentId, data.note),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['attendance-daily', selectedDate] });
    },
  });
  void updateNote; // keep for future use

  const startScan = useMutation({
    mutationFn: (lessonId: number) => api.scanStart(lessonId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['attendance-daily', selectedDate] });
    },
    onError: () => {
      setScanningLessonId(null);
    },
  });

  const stopScan = useMutation({
    mutationFn: () => api.scanStop(),
    onSuccess: () => {
      setScanningLessonId(null);
      queryClient.invalidateQueries({ queryKey: ['attendance-daily', selectedDate] });
    },
  });

  // Check for active scan session on mount
  const { data: activeScan } = useQuery({
    queryKey: ['scan-active'],
    queryFn: () => api.scanActive(),
    enabled: scanningLessonId === null,
  });

  useEffect(() => {
    if (activeScan?.active && scanningLessonId === null) {
      setScanningLessonId(activeScan.lesson_id);
    }
  }, [activeScan, scanningLessonId]);

  // Track seen checkins for scan card popups
  const seenCheckins = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!scanningLessonId || !classGroups) return;
    // Find the scanning lesson's students
    for (const g of classGroups) {
      for (const ls of g.lessons) {
        if (ls.lessonId !== scanningLessonId) continue;
        // Check each student for new checkins
        for (const stu of ls.students) {
          const isCheckedIn = stu.status === 'present' || stu.status === 'makeup' || stu.status === 'recording_room_present' || stu.status === 'video_makeup';
          if (!isCheckedIn || !stu.checkinTime) continue;
          const key = `${stu.studentId}-${stu.checkinTime}`;
          if (seenCheckins.current.has(key)) continue;
          seenCheckins.current.add(key);
          // Show card via window bridge
          const addCard = (window as any).__scanAddCard;
          if (addCard) {
            addCard({
              id: key,
              studentId: stu.studentId,
              name: stu.name,
              school: stu.school,
              phone: stu.phone || '',
              email: stu.email || '',
              note: stu.note || '',
              payStatus: stu.payStatus || '',
              checkinTime: stu.checkinTime,
              homeworkDone: stu.homeworkDone,
              status: 'success' as const,
            });
          }
        }
        break;
      }
    }
  }, [classGroups, scanningLessonId]);

  const handleQuickStatus = (status: string) => {
    if (!actionTarget) return;
    updateStatus.mutate({
      lessonId: actionTarget.lessonId,
      studentId: actionTarget.studentId,
      status,
    });
  };

  const handleQuickRecording = async (makeupType: string) => {
    if (!actionTarget) return;
    try {
      await createRecordingMakeup.mutateAsync({
        lessonId: actionTarget.lessonId,
        studentId: actionTarget.studentId,
        makeupType,
      });
      // Auto-create purchase for recording handling fee
      if (includeFee) {
        await api.createPurchase({
          student_id: actionTarget.studentId,
          product_id: 3, // Video補課手續費
          quantity: 1,
          total_price: 0, // backend uses product price if 0
          note: `${makeupType} — ${actionTarget.className} 第${actionTarget.lessonNum}節`,
        });
      }
    } catch (err) {
      // Error handled by mutation onError
    }
  };

  // Calendar
  const goToDate = (dateStr: string) => {
    setSelectedDate(dateStr);
    setCalMode('day');
  };

  const goToday = () => {
    setSelectedDate(today);
    setCalMode('day');
  };

  const calDays = () => {
    if (!calApiData) return [];
    const daysInMonth = new Date(calYear, calMonth, 0).getDate();
    const firstDow = new Date(calYear, calMonth - 1, 1).getDay();
    const weeks: (any[] | null)[] = [];
    let week: (any | null)[] = [];
    for (let i = 0; i < firstDow; i++) week.push(null);
    for (let d = 1; d <= daysInMonth; d++) {
      const pad = String(d).padStart(2, '0');
      const dateStr = `${calYear}-${String(calMonth).padStart(2, '0')}-${pad}`;
      const data = (calApiData as any)[dateStr] || null;
      const today2 = dateStr === new Date().toLocaleDateString('en-CA');
      week.push({ date: d, dateStr, data, today: today2 });
      if (week.length === 7) { weeks.push(week); week = []; }
    }
    if (week.length > 0) { while (week.length < 7) week.push(null); weeks.push(week); }
    return weeks;
  };

  const statsForLesson = (lesson: Lesson) => {
    let present = 0, leave = 0, absent = 0, pending = 0, waiting = 0, catchup = 0;
    for (const stu of lesson.students) {
      const st = stu.status;
      if (st === 'present' || st === 'makeup' || st === 'recording_room_present' || st === 'video_makeup') present++;
      else if (st === 'leave') leave++;
      else if (st === 'absent') absent++;
      else if (st === 'scheduled_room' || st === 'scheduled_video' || st === 'scheduled_classroom') pending++;
      else if (st === 'catchup_required') catchup++;
      else if (st === 'waiting') waiting++;
    }
    return { present, leave, absent, pending, waiting, catchup, total: lesson.students.length };
  };

  const isProcessing = updateStatus.isPending || createRecordingMakeup.isPending;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">📅 每日簽到</h1>
      </div>

      {/* Control bar */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <input
          type="date"
          value={selectedDate}
          onChange={(e) => setSelectedDate(e.target.value)}
          className="form-input w-auto"
        />
        <button onClick={goToday} className="px-3 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg border border-gray-200">
          今日
        </button>
        <span className="text-sm text-gray-400 ml-1">
          {normalGroups && !isLoading ? `${normalGroups.length} 班` : ''}
        </span>
        <div className="flex gap-1 ml-auto">
          <button
            onClick={() => setCalMode('day')}
            className={`px-3 py-1.5 text-sm rounded-lg ${calMode === 'day' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
          >
            <Clock size={16} className="inline mr-1" />日
          </button>
          <button
            onClick={() => setCalMode('week')}
            className={`px-3 py-1.5 text-sm rounded-lg ${calMode === 'week' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
          >
            <CalendarIcon size={16} className="inline mr-1" />週
          </button>
          <button
            onClick={() => setCalMode('month')}
            className={`px-3 py-1.5 text-sm rounded-lg ${calMode === 'month' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
          >
            <CalendarIcon size={16} className="inline mr-1" />月
          </button>
        </div>
      </div>

      {/* ═══ Calendar: Week View ═══ */}
      {calMode === 'week' && (
        <div>
          {/* Week nav */}
          <div className="flex items-center justify-between mb-3">
            <button
              onClick={() => {
                const prev = new Date(calWeekStart);
                prev.setDate(prev.getDate() - 7);
                setCalWeekStart(prev);
              }}
              className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500"
            >
              <ChevronLeft size={20} />
            </button>
            <strong className="text-base text-gray-700">
              {(() => {
                const end = new Date(calWeekStart);
                end.setDate(end.getDate() + 6);
                const fmt = (d: Date) => `${d.getMonth() + 1}/${d.getDate()}`;
                return `${fmt(calWeekStart)} — ${fmt(end)}`;
              })()}
            </strong>
            <button
              onClick={() => {
                const next = new Date(calWeekStart);
                next.setDate(next.getDate() + 7);
                setCalWeekStart(next);
              }}
              className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500"
            >
              <ChevronRight size={20} />
            </button>
          </div>

          <WeekTimeline weekStart={calWeekStart} onDayClick={goToDate} />
        </div>
      )}

      {/* ═══ Calendar: Month View ═══ */}
      {calMode === 'month' && (
        <div className="bg-white rounded-xl shadow-sm p-4 mb-4">
          <div className="flex items-center justify-between mb-3">
            <strong className="text-lg">{calYear}年 {calMonthName}</strong>
          </div>
          <table className="w-full">
            <thead>
              <tr>
                {['日','一','二','三','四','五','六'].map(d => (
                  <th key={d} className="text-center p-2 text-xs text-gray-500">{d}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {calDays().map((week, wi) => (
                <tr key={wi}>
                  {(week || []).map((day: any, di: number) => (
                    <td
                      key={di}
                      className={`align-top text-center p-1 border border-gray-100 cursor-pointer ${day?.today ? 'bg-blue-50' : day?.data ? 'bg-green-50' : ''}`}
                      style={{ minWidth: 80, height: 70 }}
                      onClick={() => day && goToDate(day.dateStr)}
                    >
                      {day && (
                        <div>
                          <div className="text-sm font-medium">{day.date}</div>
                          {day.data && (
                            <div className="text-[10px] leading-tight mt-1">
                              <div className="text-gray-600">📚 {day.data.lessons}節</div>
                              {day.data.present > 0 && <div className="text-green-700">✅ {day.data.present}</div>}
                              {day.data.leave > 0 && <div className="text-blue-700">📋 {day.data.leave}</div>}
                              {day.data.absent > 0 && <div className="text-red-700">❌ {day.data.absent}</div>}
                              {day.data.unchecked > 0 && <div className="text-yellow-700">🟡 {day.data.unchecked}</div>}
                            </div>
                          )}
                          {!day.data && <div className="text-[10px] text-gray-300 mt-1">—</div>}
                        </div>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ═══ List view — 全班分組展示 ═══ */}

      {calMode === 'day' && (
        <div className="space-y-6">
          {isLoading && (
            <div className="flex items-center justify-center py-12">
              <Loader2 size={32} className="animate-spin text-gray-400" />
            </div>
          )}

          {isError && (
            <div className="bg-red-50 text-red-700 p-4 rounded-xl text-center">載入失敗，請重試</div>
          )}

          {/* ─── 🎥 錄播補課簽到（恆常 panel，不分日期） ─── */}
          {!isLoading && !isError && recordingGroup && recordingGroup.lessons.map((lesson: Lesson) => {
            const stats = statsForLesson(lesson);
            return (
              <div key={`recording-${lesson.lessonId}`} className="bg-white rounded-xl shadow-sm overflow-hidden mb-4 border-l-4 border-l-amber-400">
                {/* Recording panel header */}
                <div className="px-4 py-2.5 bg-gradient-to-r from-amber-50 to-white border-b border-gray-200 flex items-center justify-between">
                  <div>
                    <span className="font-bold text-gray-800">🎥 錄播補課簽到</span>
                    <span className="text-xs text-amber-600 ml-3">不限日期 · 全部待補學生</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="text-xs text-gray-400">
                      {stats.total} 人待簽到
                    </div>
                    {scanningLessonId === lesson.lessonId ? (
                      <span className="flex items-center gap-1 text-xs">
                        <span className="inline-block w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                        <span className="text-green-700 font-medium">掃碼中</span>
                        <button onClick={() => stopScan.mutate()} disabled={stopScan.isPending}
                          className="ml-1 px-2 py-0.5 rounded text-xs bg-red-100 text-red-700 hover:bg-red-200 disabled:opacity-50">
                          🛑 停止
                        </button>
                      </span>
                    ) : (
                      <button
                        onClick={() => { setScanningLessonId(lesson.lessonId); startScan.mutate(lesson.lessonId); }}
                        disabled={startScan.isPending || !!scanningLessonId}
                        className="px-2 py-0.5 rounded text-xs bg-blue-100 text-blue-700 hover:bg-blue-200 disabled:opacity-50"
                      >
                        📷 掃碼
                      </button>
                    )}
                  </div>
                </div>

                {/* Scan info bar */}
                {scanningLessonId === lesson.lessonId && (
                  <div className="px-4 py-1.5 bg-green-50 border-b border-green-100 text-xs text-green-700 space-y-1">
                    <div className="flex items-center gap-2">
                      <span>📡 Web掃碼 →</span>
                      <code className="bg-green-100 px-2 py-0.5 rounded text-green-800 font-mono select-all">
                        {window.location.origin}/api/qr-checkin
                      </code>
                      <span className="text-green-500">{"{email}"} (JSON)</span>
                    </div>
                  </div>
                )}

                {/* Recording students table */}
                <div className="overflow-x-auto">
                  {lesson.students.length === 0 ? (
                    <div className="p-6 text-center text-sm text-gray-400">
                      🎉 暫無需錄播補課的學生
                    </div>
                  ) : (
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-100 bg-gray-50/50 text-xs text-gray-500">
                          <th className="text-left px-3 py-2 font-medium">學生</th>
                          <th className="text-left px-3 py-2 font-medium">原班級</th>
                          <th className="text-left px-3 py-2 font-medium">Topic</th>
                          <th className="text-left px-3 py-2 font-medium">課節</th>
                          <th className="text-left px-3 py-2 font-medium">缺席日</th>
                          <th className="text-left px-3 py-2 font-medium">類型</th>
                          <th className="text-left px-3 py-2 font-medium">簽到狀態</th>
                          <th className="text-left px-3 py-2 font-medium">功課</th>
                        </tr>
                      </thead>
                      <tbody>
                        {lesson.students.map((stu: Stu) => {
                          const mk = (stu as any).makeup_source;
                          return (
                            <tr key={stu.studentId} className="border-t border-gray-50 hover:bg-gray-50">
                            <td className="px-3 py-2">
                              <span className="font-medium text-sm text-gray-800">
                                {(() => {
                                  const idx = stu.name.indexOf(' ');
                                  if (idx > 0) {
                                    const sur = stu.name.slice(0, idx);
                                    const given = stu.name.slice(idx + 1);
                                    return <><span className="inline-block bg-gray-100 text-gray-500 text-[10px] font-bold px-1.5 py-0.5 rounded mr-1 align-middle">{sur}</span><span className="align-middle">{given}</span></>;
                                  }
                                  return stu.name;
                                })()}
                              </span>
                              {stu.school && <div className="text-[10px] text-gray-400">{stu.school}</div>}
                            </td>
                            <td className="px-3 py-2 text-xs text-gray-600">{mk?.original_class || '—'}</td>
                            <td className="px-3 py-2 text-xs text-gray-600">{mk?.original_topic || '—'}</td>
                            <td className="px-3 py-2 text-xs text-gray-600">第{mk?.lesson_num || '?'}課</td>
                            <td className="px-3 py-2 text-xs text-gray-600">{mk?.absent_date || '—'}</td>
                            <td className="px-3 py-2 text-xs">
                              <span className={`px-1.5 py-0.5 rounded-full text-xs font-medium ${
                                mk?.makeup_type === '線上錄播' ? 'bg-purple-100 text-purple-700' : 'bg-emerald-100 text-emerald-700'
                              }`}>
                                {mk?.makeup_type === '線上錄播' ? '🎥線上' : '📹課室'}
                              </span>
                            </td>
                            <td className="px-3 py-2">
                              <button
                                onClick={() => {
                                  setActionTarget({
                                    lessonId: lesson.lessonId,
                                    studentId: stu.studentId,
                                    studentName: stu.name,
                                    studentSchool: stu.school ?? '',
                                    className: '錄播補課',
                                    lessonNum: lesson.lessonNum,
                                    existingStatus: stu.status,
                                  });
                                }}
                                disabled={isProcessing}
                                className="text-left w-full disabled:opacity-50 disabled:cursor-not-allowed"
                              >
                                {(() => {
                                  const s = stu.status;
                                  if (s === 'recording_room_present' || s === 'video_makeup') {
                                    const badge: Record<string, { text: string; bg: string; fg: string }> = {
                                      'recording_room_present': { text: '✅課室錄播出席', bg: 'bg-emerald-50', fg: 'text-emerald-700' },
                                      'video_makeup': { text: '✅線上錄播出席', bg: 'bg-purple-50', fg: 'text-purple-700' },
                                    };
                                    const b = badge[s];
                                    return <span className={`inline-block px-2 py-1 rounded text-xs font-medium ${b.bg} ${b.fg}`}>{b.text}</span>;
                                  }
                                  return <span className="inline-block px-2 py-1 rounded text-xs font-medium bg-amber-50 text-amber-700">⌛️待簽到</span>;
                                })()}
                              </button>
                            </td>
                            <td className="px-3 py-2 text-xs">
                              <button
                                onClick={() => toggleHw.mutate({
                                  lessonId: lesson.lessonId,
                                  studentId: stu.studentId,
                                  done: !stu.homeworkDone,
                                })}
                                disabled={toggleHw.isPending}
                                className={`inline-block px-2 py-1 rounded text-xs font-medium transition-colors ${
                                  stu.homeworkDone
                                    ? 'bg-green-50 text-green-700 hover:bg-green-100'
                                    : 'bg-red-50 text-red-700 hover:bg-red-100 border border-red-200'
                                }`}
                                title={stu.homeworkDone ? '已交功課 (click變未交)' : '未交功課 (click變已交)'}
                              >
                                {stu.homeworkDone ? '✅ 已交' : '❌ 未交'}
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          );
        })}

          {!isLoading && !isError && normalGroups.length === 0 && (
            <div className="bg-white rounded-xl shadow-sm p-8 text-center text-gray-400">
              <CalendarIcon size={48} className="mx-auto mb-3 opacity-30" />
              <p className="text-lg font-medium">{selectedDate}</p>
              <p className="mt-1">當日沒有課堂</p>
            </div>
          )}

          {/* ═══ Day Timeline ═══ */}
          {!isLoading && !isError && normalGroups.length > 0 && (
            <DayTimeline
              lessons={normalGroups.flatMap(g => g.lessons.map((l: any) => ({ ...l, className: g.className, classId: g.classId })))}
              statsForLesson={statsForLesson}
              scanningLessonId={scanningLessonId}
              startScan={startScan}
              stopScan={stopScan}
              toggleHw={toggleHw}
              onStudentClick={(data) => setActionTarget(data)}
              isProcessing={isProcessing || updateStatus.isPending || toggleHw.isPending}
              onToggleExpand={(id) => toggleLessonBoard(id)}
              expandedIds={lessonBoardIds}
              renderExpanded={(l: any) => (
                <LessonBoard
                  lessonId={l.lessonId}
                  students={l.students}
                  onToggleHomework={(_lid: number, sid: number, done: boolean) => toggleHw.mutate({ lessonId: _lid, studentId: sid, done })}
                />
              )}
            />
          )}
        </div>
      )}

      {/* ═══ Scan floating panel ═══ */}
      {scanningLessonId && (() => {
        let scanGroup: ClassGroup | undefined;
        let scanLesson: Lesson | undefined;
        for (const g of classGroups || []) {
          for (const ls of g.lessons) {
            if (ls.lessonId === scanningLessonId) {
              scanGroup = g;
              scanLesson = ls;
            }
          }
        }
        if (!scanGroup) return null;
        return (
          <ScanPanel
            lessonId={scanningLessonId}
            className={scanGroup.className}
            lessonNum={scanLesson?.lessonNum ?? 0}
            onStop={() => stopScan.mutate()}
            stopping={stopScan.isPending}
            onToggleHomework={(studentId, _lessonId, done) => {
              toggleHw.mutate({ lessonId: _lessonId, studentId, done });
            }}
          />
        );
      })()}

      {/* ═══ Quick action popover ═══ */}
      {actionTarget && (
        <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center p-4" onClick={() => setActionTarget(null)}>
          <div className="bg-white rounded-xl shadow-xl p-5 max-w-sm w-full mx-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="font-bold text-base">{actionTarget.studentName}</h3>
                {actionTarget.studentSchool && (
                  <p className="text-xs text-gray-400">{actionTarget.studentSchool}</p>
                )}
                <p className="text-xs text-gray-400">
                  {actionTarget.className} · 第{actionTarget.lessonNum}節
                </p>
              </div>
              <button onClick={() => setActionTarget(null)} className="p-1 hover:bg-gray-100 rounded">
                <X size={18} className="text-gray-400" />
              </button>
            </div>

            {/* Status update — different options for 錄播補課 vs normal classes */}
            <div className={actionTarget.className === '錄播補課' ? '' : 'mb-3'}>
              <p className="text-xs font-medium text-gray-600 mb-2">
                {actionTarget.className === '錄播補課' ? '🎥 錄播簽到' : '⚡ 更改狀態'}
              </p>
              <div className="grid grid-cols-2 gap-2">
                {(actionTarget.className === '錄播補課' ? RECORDING_STATUS_OPTIONS : STATUS_OPTIONS).map(opt => (
                  <button
                    key={opt.key}
                    onClick={() => handleQuickStatus(opt.key)}
                    disabled={isProcessing}
                    className={`px-2 py-1.5 rounded-lg text-xs font-medium ${opt.color} disabled:opacity-50`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Recording makeup actions — only for normal classes, not 錄播補課 itself */}
            {actionTarget.className !== '錄播補課' && (
            <div>
              <p className="text-xs font-medium text-gray-600 mb-2">🎥 安排錄播補課</p>
              <div className="grid grid-cols-2 gap-2">
                {RECORDING_ACTIONS.map(act => (
                  <button
                    key={act.type}
                    onClick={() => handleQuickRecording(act.type)}
                    disabled={isProcessing}
                    className={`px-2 py-1.5 rounded-lg text-xs font-medium ${act.color} disabled:opacity-50`}
                  >
                    {act.label}
                  </button>
                ))}
              </div>
              {/* Handling fee checkbox */}
              <label className="flex items-center gap-2 mt-3 p-2.5 bg-amber-50 border border-amber-200 rounded-lg cursor-pointer hover:bg-amber-100 transition-colors">
                <input
                  type="checkbox"
                  checked={includeFee}
                  onChange={e => setIncludeFee(e.target.checked)}
                  className="w-4 h-4 text-amber-600 rounded"
                />
                <span className="text-xs font-medium text-amber-800">💰 Video補課手續費 ($50)</span>
                <span className="text-[10px] text-amber-500 ml-auto">購買記錄</span>
              </label>
            </div>
            )}

            {isProcessing && (
              <div className="mt-3 text-center text-xs text-gray-400">
                <Loader2 size={14} className="inline animate-spin mr-1" />處理中...
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
