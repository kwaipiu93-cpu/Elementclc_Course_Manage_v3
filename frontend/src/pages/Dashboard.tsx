import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Bell, ArrowRight, Clock, CalendarX, CalendarPlus, CalendarDays, X, CheckCircle, UserPlus } from 'lucide-react';

type AvailableDay = {
  date: string;
  label: string;
  hasLesson: boolean;
  beforeDeadline: boolean;
  isWaitingClass: boolean;
  className: string;
  time: string | null;
  available: number;
  spotAvailable: boolean;
  spotText: string;
};

type MakeupItem = {
  id: number;
  studentId: number;
  studentName: string;
  studentSchool: string;
  studentPhone: string;
  studentParentPhone: string;
  originalClassId: number | null;
  originalClassName: string | null;
  originalTopic: string | null;
  lessonNum: string | null;
  makeupClass: string | null;
  status: string | null;
  isVirtual: boolean;
  nextLessonLabel: string | null;
  deadlineDate: string | null;
  availableDays: AvailableDay[];
  anySpotAvailable: boolean;
  anyBeforeDeadline: boolean;
};

type UpcomingClass = {
  classId: number;
  lessonId: number;
  className: string;
  time: string;
  seat: number;
  enrolled: number;
  leave: number;
  pendingMakeups: number;
  standby: number;
  available: number;
  hasSpots: boolean;
};

type UpcomingDay = {
  date: string;
  label: string;
  classes: UpcomingClass[];
};

type AvLesson = {
  lessonId: number;
  classId: number;
  className: string;
  week: string;
  lessonNum: number;
  lessonDate: string | null;
  time: string;
  seat: number;
  enrolled: number;
  pending: number;
  leave: number;
  blocked: number;
  waiting: number;
  available: number;
  full: boolean;
  seatText: string;
};

type StandbyStudent = {
  standbyId: number;
  studentId: number;
  studentName: string;
  studentSchool: string;
  status: string;
  triggerTime: string;
};

function DayRow({ day }: { day: AvailableDay }) {
  const isDeadlineSep = day.label.startsWith('⬇');
  if (isDeadlineSep) {
    return (
      <div className="flex items-center gap-2 text-[11px] text-gray-400 pt-2 mt-2">
        <span className="flex-1 border-t border-gray-200" />
        <span>{day.label}</span>
        <span className="flex-1 border-t border-gray-200" />
      </div>
    );
  }
  return (
    <div className={`rounded-lg px-3 py-2 ${
      day.spotAvailable
        ? 'bg-green-50 border-l-4 border-green-500'
        : day.isWaitingClass
          ? 'bg-blue-50 border-l-4 border-blue-400'
          : 'bg-gray-50 border-l-4 border-gray-200'
    }`}>
      <div className="flex items-center gap-2 text-xs">
        <span className={`font-medium shrink-0 ${day.spotAvailable ? 'text-green-800' : day.isWaitingClass ? 'text-blue-700' : 'text-gray-500'}`}>
          {day.label} {day.isWaitingClass && <span className="text-[10px] text-blue-400 font-normal">(候補班)</span>}
        </span>
        {day.time && (
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md font-semibold text-[11px] ${
            day.spotAvailable
              ? 'bg-white text-blue-700 border border-blue-200 shadow-sm'
              : day.isWaitingClass
                ? 'bg-white text-blue-600 border border-blue-200'
                : 'bg-white text-gray-500 border border-gray-200'
          }`}>
            <Clock size={10} />
            {day.time}
          </span>
        )}
        {day.spotAvailable ? (
          <span className="text-green-700 font-semibold text-xs ml-auto shrink-0">🟢 {day.spotText}</span>
        ) : (
          <span className="text-gray-400 text-[11px] ml-auto shrink-0">{day.spotText}</span>
        )}
      </div>
    </div>
  );
}

export default function Dashboard() {
  const queryClient = useQueryClient();
  const [arrangeItem, setArrangeItem] = useState<MakeupItem | null>(null);
  const [arrangeTargetId, setArrangeTargetId] = useState<number | null>(null);
  const [selectedClass, setSelectedClass] = useState<{classId: number; lessonId: number; className: string; hasSpots: boolean} | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['dashboard'],
    queryFn: async () => {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/makeups', {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const json = await res.json();
      return {
        items: (json.data ?? []).filter(
          (m: MakeupItem) => !m.isVirtual && m.status === 'waiting'
        ) as MakeupItem[],
        upcomingClasses: (json.upcomingClasses ?? []) as UpcomingDay[],
      };
    },
  });

  const openArrange = (mk: MakeupItem) => {
    setArrangeItem(mk);
    setArrangeTargetId(null);
  };

  // Fetch available lessons for the selected student
  const { data: avLessons = [] } = useQuery<AvLesson[]>({
    queryKey: ['avail-lessons', arrangeItem?.originalClassId, arrangeItem?.lessonNum],
    queryFn: async () => {
      if (!arrangeItem || !arrangeItem.originalClassId) return [];
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/makeups/available?class_id=${arrangeItem.originalClassId}&lesson_num=${arrangeItem.lessonNum ?? 0}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const json = await res.json();
      return json.data ?? [];
    },
    enabled: !!arrangeItem && !!arrangeItem.originalClassId,
  });

  // Fetch standby students for selected class
  const { data: standbyList = [] } = useQuery<StandbyStudent[]>({
    queryKey: ['class-standby', selectedClass?.classId],
    queryFn: async () => {
      if (!selectedClass) return [];
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/classes/${selectedClass.classId}/standby-list`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const json = await res.json();
      return json.data ?? [];
    },
    enabled: !!selectedClass,
  });

  const arrangeMutation = useMutation({
    mutationFn: async (lessonId: number) => {
      if (!arrangeItem) throw new Error('no item');
      const token = localStorage.getItem('token');
      const selected = avLessons.find(l => l.lessonId === lessonId);
      const isFull = selected ? selected.available <= 0 : false;
      const res = await fetch(`/api/makeups/${arrangeItem.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          target_lesson_id: lessonId,
          makeup_class: selected?.className ?? null,
          status: isFull ? 'waiting' : 'scheduled',
          makeup_type: '課室補課',
        }),
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      setArrangeItem(null);
      setArrangeTargetId(null);
    },
    onError: (err: Error) => alert('安排失敗：' + err.message),
  });

  const doArrange = () => {
    if (!arrangeTargetId) return;
    arrangeMutation.mutate(arrangeTargetId);
  };

  // Quick arrange from class card panel — direct schedule, no modal
  const quickArrangeMutation = useMutation({
    mutationFn: async ({mkId, lessonId, className}: {mkId: number; lessonId: number; className: string}) => {
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/makeups/${mkId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          target_lesson_id: lessonId,
          makeup_class: className,
          status: 'scheduled',
          makeup_type: '課室補課',
        }),
      });
      return res.json();
    },
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: ['dashboard'] });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      setSelectedClass(null);
    },
    onError: (err: Error) => alert('安排失敗：' + err.message),
  });

  if (isLoading) {
    return <div className="text-gray-500">載入中...</div>;
  }

  const makeupWaiting = data?.items ?? [];
  const upcomingDays = data?.upcomingClasses ?? [];
  const hasBeforeDeadline = makeupWaiting.some(m => m.anyBeforeDeadline);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">概覽</h1>

      {/* === TOP: Next 3 Days Class Overview === */}
      <section>
        <h2 className="text-lg font-semibold text-blue-600 mb-3 flex items-center gap-2">
          <CalendarDays size={20} /> 未來3日班級視圖
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {upcomingDays.map((day, di) => (
            <div key={di} className="bg-white rounded-xl shadow-sm p-4">
              <div className="flex items-center gap-2 mb-2 pb-2 border-b border-gray-100">
                <span className={`w-2.5 h-2.5 rounded-full ${day.classes.some(c => c.hasSpots) ? 'bg-green-500 animate-pulse' : 'bg-gray-300'}`} />
                <span className="font-semibold text-sm">{day.label}</span>
              </div>
              {day.classes.length === 0 ? (
                <div className="text-gray-400 text-xs text-center py-3">— 冇課 —</div>
              ) : (
                <div className="space-y-1.5">
                  {day.classes.map((cls, ci) => (
                    <div
                      key={ci}
                      onClick={() => {
                        if (selectedClass?.classId === cls.classId) {
                          setSelectedClass(null);
                        } else {
                          setSelectedClass({ classId: cls.classId, lessonId: cls.lessonId, className: cls.className, hasSpots: cls.hasSpots });
                        }
                      }}
                      className={`rounded-lg px-2.5 py-1.5 border-l-4 text-xs cursor-pointer transition-all ${
                        cls.hasSpots ? 'bg-green-50 border-l-green-500 hover:bg-green-100' : 'bg-gray-50 border-l-gray-300 hover:bg-gray-100'
                      } ${selectedClass?.classId === cls.classId ? 'ring-2 ring-blue-400 shadow-md' : ''}`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                          <span className={`font-medium ${cls.hasSpots ? 'text-green-800' : 'text-gray-600'}`}>{cls.className}</span>
                          {cls.standby > 0 && <UserPlus size={11} className="text-amber-500" />}
                        </div>
                        <span className={`font-semibold text-[11px] ${cls.hasSpots ? 'text-green-700' : 'text-gray-400'}`}>
                          {cls.hasSpots ? `🟢 ${cls.available}位` : '⚪ 滿'}
                        </span>
                      </div>
                      <div className="text-[11px] text-gray-400 mt-0.5">
                        🕐 {cls.time} <span className="ml-2">👥 {cls.enrolled - cls.leave}/{cls.seat}</span>
                        {cls.standby > 0 && <span className="ml-2 text-amber-600 font-semibold">⏳候補{cls.standby}</span>}
                        {cls.pendingMakeups > 0 && <span className="ml-2 text-orange-500">📋補堂{cls.pendingMakeups}</span>}
                      </div>
                      <div className="flex flex-wrap items-center gap-x-0.5 gap-y-1 mt-1.5 text-[11px] font-mono">
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-gray-100 rounded text-gray-600">
                          座位<span className="font-bold">{cls.seat}</span>
                        </span>
                        <span className="text-gray-300 mx-0.5">−</span>
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-gray-100 rounded text-gray-600">
                          已報<span className="font-bold">{cls.enrolled}</span>
                        </span>
                        <span className="text-gray-300 mx-0.5">+</span>
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-blue-50 rounded text-blue-700">
                          請假<span className="font-bold">{cls.leave}</span>
                        </span>
                        <span className="text-gray-300 mx-0.5">−</span>
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-orange-50 rounded text-orange-600">
                          補堂<span className="font-bold">{cls.pendingMakeups}</span>
                        </span>
                        <span className="mx-0.5 text-gray-400">=</span>
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded font-bold text-sm ${
                          cls.hasSpots
                            ? 'bg-green-100 text-green-700 ring-1 ring-green-400'
                            : 'bg-gray-200 text-gray-500'
                        }`}>
                          {cls.hasSpots ? `🟢 ${cls.available}位` : `⚪ ${cls.available}位`}
                        </span>
                        {cls.standby > 0 && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 ring-1 ring-amber-300 ml-1">
                            ⏳候補{cls.standby} (未安排)
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Selected class panel: makeup-waiting + standby students */}
        {selectedClass && (
          <div className="mt-4 bg-white rounded-xl shadow-sm overflow-hidden border border-blue-100">
            <div className="flex items-center justify-between px-5 py-3 bg-blue-50 border-b border-blue-100">
              <div className="flex items-center gap-2">
                <span className={`w-2.5 h-2.5 rounded-full ${selectedClass.hasSpots ? 'bg-green-500 animate-pulse' : 'bg-gray-300'}`} />
                <span className="font-semibold text-sm text-blue-800">{selectedClass.className}</span>
              </div>
              <button
                onClick={() => setSelectedClass(null)}
                className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-white/50 transition-colors"
              >
                <X size={16} />
              </button>
            </div>

            {/* SECTION 1: Makeup-waiting students for this class */}
            {(() => {
              const classWaiting = makeupWaiting.filter(mk => mk.originalClassId === selectedClass.classId);
              if (classWaiting.length === 0) return null;
              return (
                <div className="px-5 py-3 border-b border-gray-100">
                  <div className="text-xs text-gray-500 font-medium mb-2 flex items-center gap-1.5">
                    <Bell size={13} className="text-red-400" />
                    等安排補課學生
                  </div>
                  <div className="space-y-2">
                    {classWaiting.map(mk => (
                      <div key={mk.id} className="flex items-center justify-between bg-amber-50/50 rounded-lg px-3 py-2 border border-amber-100">
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-gray-800">{mk.studentName}</div>
                          <div className="text-xs text-gray-400">
                            {mk.studentSchool && <span>{mk.studentSchool} · </span>}
                            缺第{mk.lessonNum}課
                          </div>
                          <div className="flex items-center gap-2 mt-1">
                            {mk.studentPhone && (
                              <a href={`tel:${mk.studentPhone}`} className="inline-flex items-center gap-1 text-xs text-blue-600 bg-blue-50 px-2 py-0.5 rounded hover:bg-blue-100 transition-colors">
                                📞 {mk.studentPhone}
                              </a>
                            )}
                            {mk.studentParentPhone && (
                              <a href={`tel:${mk.studentParentPhone}`} className="inline-flex items-center gap-1 text-xs text-purple-600 bg-purple-50 px-2 py-0.5 rounded hover:bg-purple-100 transition-colors">
                                👨‍👩‍👧 {mk.studentParentPhone}
                              </a>
                            )}
                            {!mk.studentPhone && !mk.studentParentPhone && (
                              <span className="text-xs text-gray-400">— 冇電話 —</span>
                            )}
                          </div>
                        </div>
                        <button
                          onClick={() => quickArrangeMutation.mutate({
                            mkId: mk.id,
                            lessonId: selectedClass.lessonId,
                            className: selectedClass.className,
                          })}
                          disabled={quickArrangeMutation.isPending}
                          className="shrink-0 inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                          {quickArrangeMutation.isPending ? '安排中...' : '安排到本班'}
                        </button>
                      </div>
                    ))}
                  </div>
                  {quickArrangeMutation.isSuccess && (
                    <div className="mt-2 text-xs text-green-600 font-medium">✅ 安排成功</div>
                  )}
                </div>
              );
            })()}

            {/* SECTION 2: lesson_standby students */}
            {standbyList.length > 0 && (
              <div className="px-5 py-3">
                <div className="text-xs text-gray-500 font-medium mb-2 flex items-center gap-1.5">
                  <UserPlus size={13} className="text-amber-500" />
                  課堂候補學生
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 text-xs text-gray-500 uppercase">
                      <th className="text-left px-3 py-2 font-medium">學生</th>
                      <th className="text-left px-3 py-2 font-medium">學校</th>
                      <th className="text-right px-3 py-2 font-medium">輪候時間</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {standbyList.map((s) => (
                      <tr key={s.standbyId} className="hover:bg-gray-50 transition-colors">
                        <td className="px-3 py-2 font-medium text-gray-800">{s.studentName}</td>
                        <td className="px-3 py-2 text-gray-500 text-xs">{s.studentSchool || '—'}</td>
                        <td className="px-3 py-2 text-right text-gray-400 text-[11px]">{s.triggerTime || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {standbyList.length === 0 && (() => {
              const classWaiting = makeupWaiting.filter(mk => mk.originalClassId === selectedClass.classId);
              if (classWaiting.length === 0) return (
                <div className="px-5 py-6 text-center text-gray-400 text-sm">✅ 暫無相關學生</div>
              );
              return null;
            })()}
          </div>
        )}
      </section>

      {/* === BOTTOM: Waiting Students === */}
      <section>
        <h2 className="text-lg font-semibold text-red-600 mb-3 flex items-center gap-2">
          <Bell size={20} /> 候補中
        </h2>

        {makeupWaiting.length === 0 ? (
          <div className="bg-white rounded-xl shadow-sm p-4 text-gray-500 text-sm">✅ 無候補學生</div>
        ) : (
          <div className="space-y-3">
            {hasBeforeDeadline && (
              <div className="bg-green-50 border border-green-300 rounded-lg px-4 py-3 flex items-start gap-3">
                <span className="text-lg mt-0.5">🎯</span>
                <div className="text-sm text-green-800">
                  <strong>截止前有位釋放！</strong>
                  <p className="text-green-700 text-xs mt-0.5">有學生可以在下一次常規課前安排補課</p>
                </div>
              </div>
            )}

            <div className="bg-white rounded-xl shadow-sm divide-y">
              {makeupWaiting.map((mk: MakeupItem, i: number) => {
                const beforeDays = mk.availableDays?.filter(d => d.beforeDeadline) ?? [];
                const afterDays = mk.availableDays?.filter(d => !d.beforeDeadline) ?? [];

                return (
                  <div key={i} className="px-5 py-4">
                    <div className="flex items-center gap-3 mb-3">
                      <span className={`w-3 h-3 rounded-full shrink-0 ${mk.anyBeforeDeadline ? 'bg-green-500 animate-pulse' : 'bg-gray-300'}`} />
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-sm">{mk.studentName}</span>
                          {mk.studentSchool && <span className="text-gray-400 text-xs">({mk.studentSchool})</span>}
                        </div>
                      </div>
                    </div>

                    <div className="ml-7 mb-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                      <div className="flex items-center gap-1.5">
                        <CalendarX size={13} className="text-red-400 shrink-0" />
                        <span className="text-gray-500">缺課：</span>
                        <span className="font-medium text-gray-700">{mk.originalClassName ?? '—'} · 第{mk.lessonNum}課</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <CalendarPlus size={13} className="text-blue-400 shrink-0" />
                        <span className="text-gray-500">補去：</span>
                        <span className="font-medium text-gray-700">{mk.makeupClass ?? '—'}</span>
                        <span className="text-gray-400">(候補中)</span>
                      </div>
                    </div>

                    {beforeDays.length > 0 && (
                      <div className="ml-7 mb-1">
                        <div className="text-[11px] text-gray-400 font-medium mb-1.5">⬆ 截止前可補時段</div>
                        <div className="space-y-1.5">
                          {beforeDays.map((day, di) => <DayRow key={di} day={day} />)}
                        </div>
                      </div>
                    )}

                    {afterDays.length > 0 && (
                      <div className="ml-7">
                        <div className="text-[11px] text-gray-400 font-medium mb-1.5 mt-2">⬇ 截止後時段</div>
                        <div className="space-y-1.5">
                          {afterDays.map((day, di) => <DayRow key={di} day={day} />)}
                        </div>
                      </div>
                    )}

                    {mk.anyBeforeDeadline && (
                      <div className="mt-3 ml-7">
                        <button
                          onClick={() => openArrange(mk)}
                          className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 bg-blue-50 px-3 py-1.5 rounded-lg font-medium"
                        >
                          安排補課 <ArrowRight size={12} />
                        </button>
                      </div>
                    )}

                    {mk.nextLessonLabel && (
                      <div className="ml-7 mt-3 flex items-center gap-1.5 text-xs text-amber-700 bg-amber-50 px-3 py-1.5 rounded-lg">
                        <Clock size={13} />
                        <span>下次常規課：<strong>{mk.nextLessonLabel}</strong></span>
                        <span className="text-amber-500 ml-auto text-[10px] whitespace-nowrap">⏰ 截止</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </section>

      {/* === Arrange Modal === */}
      {arrangeItem && (
        <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center" onClick={() => setArrangeItem(null)}>
          <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-lg mx-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold">🔄 安排補課</h3>
              <button onClick={() => setArrangeItem(null)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
            </div>

            <div className="grid grid-cols-2 gap-3 bg-gray-50 rounded-lg p-3 mb-4 text-sm">
              <div>
                <span className="text-xs text-gray-400 block">學生</span>
                <span className="font-medium">{arrangeItem.studentName}</span>
                {arrangeItem.studentSchool && <span className="text-xs text-gray-400 ml-1">({arrangeItem.studentSchool})</span>}
              </div>
              <div>
                <span className="text-xs text-gray-400 block">缺課</span>
                <span>{arrangeItem.originalClassName || '—'} · 第{arrangeItem.lessonNum}課</span>
              </div>
            </div>

            <div>
              <label className="font-medium text-gray-600 text-xs block mb-2">選擇可安排課節</label>
              {avLessons.length === 0 ? (
                <div className="text-gray-400 text-center py-6 bg-gray-50 rounded-lg text-sm">
                  暫無其他同 Topic 班級有第 {arrangeItem.lessonNum} 課
                </div>
              ) : (
                <div className="space-y-2 max-h-60 overflow-y-auto">
                  {avLessons.map(l => (
                    <div
                      key={l.lessonId}
                      onClick={() => setArrangeTargetId(l.lessonId)}
                      className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer text-sm transition-colors ${
                        arrangeTargetId === l.lessonId
                          ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-200'
                          : 'border-gray-200 hover:bg-gray-50'
                      }`}
                    >
                      <span className={`w-5 h-5 rounded-full border-2 flex items-center justify-center text-xs ${
                        arrangeTargetId === l.lessonId
                          ? 'border-blue-600 bg-blue-600 text-white'
                          : 'border-gray-300'
                      }`}>
                        {arrangeTargetId === l.lessonId ? '✓' : ''}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">{l.className}</div>
                        <div className="text-xs text-gray-400 mt-0.5">
                          第{l.lessonNum}課 · {l.week} · {l.lessonDate ?? '—'} · {l.time}
                        </div>
                        <div className="text-xs text-gray-500 mt-1 flex flex-wrap gap-x-2">
                          <span>座位{l.seat}</span><span className="text-gray-300">|</span>
                          <span>已報{l.enrolled}</span><span className="text-gray-300">|</span>
                          <span className="text-blue-500">請假{l.leave}</span><span className="text-gray-300">|</span>
                          <span className="text-amber-500">封鎖{l.blocked}</span><span className="text-gray-300">|</span>
                          <span className="text-purple-500">補課{l.pending}</span><span className="text-gray-300">|</span>
                          <span className="text-orange-500">候補{l.waiting}</span>
                        </div>
                      </div>
                      {l.full
                        ? <span className="shrink-0 text-amber-600 text-xs">⏳ {l.seatText}</span>
                        : <span className="shrink-0 text-green-600 text-xs">{l.seatText}</span>
                      }
                    </div>
                  ))}
                </div>
              )}
              {arrangeTargetId && (() => {
                const l = avLessons.find(x => x.lessonId === arrangeTargetId);
                if (!l) return null;
                return l.full
                  ? <p className="mt-2 text-amber-600 text-xs">⏳ 該課已滿，將排入候補</p>
                  : <p className="mt-2 text-green-600 text-xs">✅ 有空位，可直接安排</p>;
              })()}
            </div>

            <div className="flex justify-end gap-3 pt-3 mt-4 border-t border-gray-100">
              <button onClick={() => setArrangeItem(null)} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg text-sm transition-colors">取消</button>
              <button
                onClick={doArrange}
                disabled={!arrangeTargetId || arrangeMutation.isPending}
                className={`inline-flex items-center gap-1.5 px-5 py-2 rounded-lg text-sm font-medium transition-colors ${
                  arrangeTargetId
                    ? 'bg-blue-600 text-white hover:bg-blue-700'
                    : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                }`}
              >
                <CheckCircle size={16} />
                {arrangeMutation.isPending ? '安排中...' : '確認安排'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
