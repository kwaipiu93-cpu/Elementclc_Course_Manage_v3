import { useState, useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { useLocation } from 'react-router-dom';

type MakeupItem = {
  id: number;
  studentId: number;
  studentName: string;
  studentSchool: string;
  originalClassId: number | null;
  originalClassName: string;
  originalTopic: string | null;
  lessonNum: string | null;
  absentDate: string | null;
  makeupType: string | null;
  makeupClass: string | null;
  targetLessonId: number | null;
  status: string | null;
  checkinStatus?: string | null;
  isVirtual: boolean;
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

type ManageData = {
  makeups: MakeupItem[];
  avMap: Record<string, AvLesson[]>;
};

// ─── Tabs ──────────────────────────────────────────────────────────

type TabKey = 'pending' | 'scheduled' | 'waiting' | 'done';

const TABS: { key: TabKey; label: string; color: string; activeColor: string }[] = [
  { key: 'pending',   label: '待安排',     color: 'text-red-600',     activeColor: 'bg-red-600 text-white' },
  { key: 'scheduled', label: '已安排待補', color: 'text-amber-600',   activeColor: 'bg-amber-600 text-white' },
  { key: 'waiting',   label: '已安排候補', color: 'text-orange-600',  activeColor: 'bg-orange-600 text-white' },
  { key: 'done',      label: '已完成',     color: 'text-emerald-600', activeColor: 'bg-emerald-600 text-white' },
];

function classifyItem(mk: MakeupItem): TabKey {
  if (mk.status === 'done') return 'done';
  if (mk.status === 'waiting') return 'waiting';
  if (mk.status === 'scheduled') return 'scheduled';
  return 'pending';
}

// ─── Display helpers ───────────────────────────────────────────────

function getStatusBadge(mk: MakeupItem): { text: string; color: string } {
  if (mk.status === 'done') {
    const t = mk.makeupType;
    if (t === '課室錄播') return { text: '✅課室錄播出席', color: 'bg-emerald-100 text-emerald-800' };
    if (t === '線上錄播') return { text: '✅線上錄播出席', color: 'bg-purple-100 text-purple-800' };
    return { text: '✅課堂補堂出席', color: 'bg-green-100 text-green-800' };
  }
  if (mk.status === 'scheduled') {
    const t = mk.makeupType;
    if (t === '課室錄播') return { text: '⌛️課室錄播待補', color: 'bg-amber-100 text-amber-800' };
    if (t === '線上錄播') return { text: '⌛️線上錄播待補', color: 'bg-purple-100 text-purple-800' };
    return { text: '⌛️課堂教學待補', color: 'bg-amber-100 text-amber-800' };
  }
  if (mk.status === 'waiting') return { text: '‼️課堂教學候補', color: 'bg-red-100 text-red-800 ring-1 ring-red-400' };
  if (mk.isVirtual) {
    if (mk.checkinStatus === 'leave') return { text: '📋請假待安排', color: 'bg-blue-100 text-blue-800' };
    return { text: '❌缺勤待安排', color: 'bg-red-100 text-red-800' };
  }
  return { text: mk.status ?? '?', color: 'bg-gray-100 text-gray-600' };
}

// ─── Component ─────────────────────────────────────────────────────

export default function Makeups() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<TabKey>('pending');
  const [search, setSearch] = useState('');
  const [arrangeItem, setArrangeItem] = useState<MakeupItem | null>(null);
  const [arrangeType, setArrangeType] = useState<string>('課室補課');
  const [arrangeTargetId, setArrangeTargetId] = useState<number | null>(null);

  const { data, isLoading } = useQuery<ManageData>({
    queryKey: ['makeups-manage'],
    queryFn: () => api.get<any>('/makeups/manage'),
  });

  const allItems: MakeupItem[] = data?.makeups ?? [];
  const avMap = data?.avMap ?? {};

  // Auto-open arrange modal when navigated from Dashboard
  const location = useLocation();
  const focusState = location.state as { focusStudentId?: number; focusMakeupId?: number } | null;
  useEffect(() => {
    if (focusState?.focusStudentId && allItems.length > 0) {
      const target = allItems.find(mk =>
        mk.studentId === focusState.focusStudentId && mk.status === 'waiting'
      ) ?? allItems.find(mk => mk.studentId === focusState.focusStudentId);
      if (target && !arrangeItem) {
        setActiveTab(classifyItem(target));
        openArrange(target);
      }
    }
  }, [focusState, allItems, arrangeItem]);

  const itemsByTab = useMemo(() => {
    const grouped: Record<TabKey, MakeupItem[]> = { pending: [], scheduled: [], waiting: [], done: [] };
    for (const mk of allItems) {
      const key = classifyItem(mk);
      grouped[key].push(mk);
    }
    return grouped;
  }, [allItems]);

  const tabCounts = useMemo(() => {
    return Object.fromEntries(
      TABS.map(t => [t.key, itemsByTab[t.key].length])
    ) as Record<TabKey, number>;
  }, [itemsByTab]);

  // Filter by search within active tab
  const filtered = useMemo(() => {
    const items = itemsByTab[activeTab];
    if (!search.trim()) return items;
    const q = search.trim().toLowerCase();
    return items.filter(mk => mk.studentName.toLowerCase().includes(q));
  }, [itemsByTab, activeTab, search]);

  // Search across all tabs (for showing total match count)
  const searchMatchCount = useMemo(() => {
    if (!search.trim()) return 0;
    const q = search.trim().toLowerCase();
    return allItems.filter(mk => mk.studentName.toLowerCase().includes(q)).length;
  }, [allItems, search]);

  // Mutations
  const createMutation = useMutation({
    mutationFn: (body: any) => api.post('/makeups', body),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['makeups-manage'] }); setArrangeItem(null); },
    onError: (err: Error) => alert('安排補課失敗：' + err.message),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: number; body: any }) => api.put(`/makeups/${id}`, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['makeups-manage'] }),
    onError: (err: Error) => alert('更新失敗：' + err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/makeups/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['makeups-manage'] }),
  });

  const openArrange = (mk: MakeupItem) => {
    setArrangeItem(mk);
    setArrangeType(mk.makeupType || '課室補課');
    setArrangeTargetId(null);
  };

  const doArrange = () => {
    if (!arrangeItem) return;
    const mk = arrangeItem;
    const isNew = mk.id < 0;

    const buildBody = () => {
      if (arrangeType === '線上錄播' || arrangeType === '課室錄播') {
        return {
          student_id: mk.studentId,
          original_class_id: mk.originalClassId,
          original_topic: mk.originalTopic,
          lesson_num: mk.lessonNum,
          absent_date: mk.absentDate,
          makeup_type: arrangeType,
          makeup_class: null,
          target_lesson_id: null,
          status: 'scheduled',
        };
      }
      const avKey = `${mk.originalClassId ?? 0}_${mk.lessonNum ?? 0}`;
      const avLessons = avMap[avKey] ?? [];
      const selected = avLessons.find(l => l.lessonId === arrangeTargetId);
      const isFull = selected ? selected.available <= 0 : false;
      return {
        student_id: mk.studentId,
        original_class_id: mk.originalClassId,
        original_topic: mk.originalTopic,
        lesson_num: mk.lessonNum,
        absent_date: mk.absentDate,
        makeup_type: '課室補課',
        makeup_class: selected?.className ?? null,
        target_lesson_id: selected?.lessonId ?? null,
        status: isFull ? 'waiting' : 'scheduled',
      };
    };

    if (isNew) {
      createMutation.mutate(buildBody());
    } else {
      const body: any = {};
      const avKey = `${mk.originalClassId ?? 0}_${mk.lessonNum ?? 0}`;
      const selected = (avMap[avKey] ?? []).find(l => l.lessonId === arrangeTargetId);
      if (arrangeType !== mk.makeupType) body.makeup_type = arrangeType;
      if (arrangeType === '課室補課' && selected) {
        body.makeup_class = selected.className;
        body.target_lesson_id = selected.lessonId;
        body.status = selected.available <= 0 ? 'waiting' : 'scheduled';
      }
      if (arrangeType === '線上錄播' || arrangeType === '課室錄播') {
        body.makeup_type = arrangeType;
        body.makeup_class = null;
        body.target_lesson_id = null;
        body.status = 'scheduled';
      }
      updateMutation.mutate({ id: mk.id, body });
    }
  };

  const handleDelete = (id: number) => {
    if (confirm('確定刪除此補課記錄？')) deleteMutation.mutate(id);
  };

  if (isLoading) return <div className="text-gray-500 py-8 text-center">載入中...</div>;

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">🔄 補課管理</h1>
      </div>

      {/* Search bar */}
      <div className="relative mb-4">
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="🔍 搜尋學生姓名..."
          className="w-full px-4 py-2.5 pl-10 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-lg">🔍</span>
        {search && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">
            找到 {searchMatchCount} 項
          </span>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1.5 mb-4 flex-wrap bg-gray-50 p-1 rounded-xl">
        {TABS.map(tab => {
          const count = tabCounts[tab.key];
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => { setActiveTab(tab.key); setSearch(''); }}
              className={`flex-1 min-w-[100px] py-2 px-3 rounded-lg text-sm font-medium transition-all ${
                isActive
                  ? tab.activeColor + ' shadow-sm'
                  : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              {tab.label}
              <span className={`ml-1.5 text-xs ${isActive ? 'opacity-80' : 'text-gray-400'}`}>
                ({count})
              </span>
            </button>
          );
        })}
      </div>

      {/* Cards */}
      <div className="space-y-2.5">
        {filtered.length === 0 && (
          <div className="text-center py-12 text-gray-400 text-sm">
            {search ? '沒有符合的學生' : `暫無${TABS.find(t => t.key === activeTab)?.label ?? ''}記錄`}
          </div>
        )}
        {filtered.map(mk => {
          const badge = getStatusBadge(mk);
          const cat = classifyItem(mk);
          return (
            <div
              key={`${mk.studentId}_${mk.lessonNum}_${mk.originalClassId}`}
              className={`bg-white rounded-xl border p-4 transition-shadow hover:shadow-sm ${
                cat === 'pending' ? 'border-l-4 border-l-red-400 border-gray-200' :
                cat === 'waiting' ? 'border-l-4 border-l-orange-400 border-gray-200 bg-orange-50/30' :
                cat === 'scheduled' ? 'border-gray-200' :
                'border-gray-200'
              }`}
            >
              {/* Top row: name + status badge */}
              <div className="flex items-start justify-between mb-2">
                  <div>
                  <span className="text-base font-semibold text-gray-900">{mk.studentName}</span>
                  {mk.studentSchool && (
                    <span className="ml-2 text-xs text-gray-400">{mk.studentSchool}</span>
                  )}
                  <div className="text-xs text-gray-500 mt-0.5 space-x-2">
                    <span>{mk.originalClassName || `#${mk.originalClassId}`}</span>
                    <span className="text-gray-300">·</span>
                    <span>第{mk.lessonNum || '?'}課</span>
                    {mk.absentDate && (
                      <>
                        <span className="text-gray-300">·</span>
                        <span>缺課 {mk.absentDate}</span>
                      </>
                    )}
                  </div>
                </div>
                <span className={`shrink-0 px-2.5 py-1 rounded-full text-xs font-medium ${badge.color}`}>
                  {badge.text}
                </span>
              </div>

              {/* Bottom row: action buttons */}
              <div className="flex items-center gap-2 mt-3">
                {cat === 'pending' && (
                  <button
                    onClick={() => openArrange(mk)}
                    disabled={createMutation.isPending}
                    className="px-3 py-1.5 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40 transition-colors"
                  >
                    {createMutation.isPending ? '處理中...' : '🔄 安排補課'}
                  </button>
                )}
                {cat === 'waiting' && (
                  <button
                    onClick={() => openArrange(mk)}
                    className="px-3 py-1.5 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                  >
                    🔄 安排補課
                  </button>
                )}
                {cat === 'scheduled' && (
                  <>
                    <button
                      onClick={() => openArrange(mk)}
                      className="px-3 py-1.5 text-xs font-medium bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors"
                    >
                      更改
                    </button>
                    {mk.makeupClass && (
                      <span className="text-xs text-gray-500">
                        🏫 {mk.makeupClass} · {mk.makeupType === '線上錄播' ? '🎥線上' : mk.makeupType === '課室錄播' ? '📹課室錄播' : ''}
                      </span>
                    )}
                    {!mk.makeupClass && (
                      <span className="text-xs text-gray-400">
                        {mk.makeupType === '線上錄播' || mk.makeupType === '課室錄播' ? '🎥 到「補課錄播班」簽到' : '到課室簽到'}
                      </span>
                    )}
                  </>
                )}
                {cat === 'done' && (
                  <button
                    onClick={() => handleDelete(mk.id)}
                    className="px-3 py-1.5 text-xs font-medium bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors"
                  >
                    刪除記錄
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Arrange modal */}
      {arrangeItem && (
        <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center" onClick={() => setArrangeItem(null)}>
          <div className="bg-white rounded-xl shadow-xl p-6 max-w-lg w-full mx-4 max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold mb-4">🔄 安排補課</h3>
            <div className="space-y-4 text-sm">
              {/* Student info row */}
              <div className="grid grid-cols-2 gap-3 bg-gray-50 rounded-lg p-3">
                <div>
                  <span className="text-xs text-gray-400 block">學生</span>
                  <span className="font-medium">{arrangeItem.studentName}</span>
                </div>
                <div>
                  <span className="text-xs text-gray-400 block">原班級</span>
                  <span>{arrangeItem.originalClassName || `#${arrangeItem.originalClassId}`}</span>
                </div>
                <div>
                  <span className="text-xs text-gray-400 block">課節</span>
                  <span>第{arrangeItem.lessonNum}課</span>
                </div>
                <div>
                  <span className="text-xs text-gray-400 block">缺課日期</span>
                  <span>{arrangeItem.absentDate}</span>
                </div>
              </div>

              {/* Type selector */}
              <div>
                <label className="font-medium text-gray-600 text-xs block mb-2">補課類型</label>
                <div className="flex gap-2">
                  {(['課室補課', '線上錄播', '課室錄播'] as const).map(t => (
                    <button
                      key={t}
                      onClick={() => { setArrangeType(t); setArrangeTargetId(null); }}
                      className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
                        arrangeType === t
                          ? 'bg-blue-600 text-white shadow-sm'
                          : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                      }`}
                    >
                      {t === '課室補課' ? '🏫 課堂' : t === '線上錄播' ? '🎥 線上' : '📹 課室錄播'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Lesson selector */}
              {arrangeType === '課室補課' && (() => {
                const avKey = `${arrangeItem.originalClassId ?? 0}_${arrangeItem.lessonNum ?? 0}`;
                const avLessons = avMap[avKey] ?? [];
                return (
                  <div>
                    <label className="font-medium text-gray-600 text-xs block mb-2">選擇可安排課節</label>
                    {avLessons.length === 0 ? (
                      <div className="text-gray-400 text-center py-6 bg-gray-50 rounded-lg text-sm">
                        暫無其他同 Topic 班級有第 {arrangeItem.lessonNum} 課
                      </div>
                    ) : (
                      <div className="space-y-2">
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
                                <span>座位{l.seat}</span>
                                <span className="text-gray-300">|</span>
                                <span>已報{l.enrolled}</span>
                                <span className="text-gray-300">|</span>
                                <span className="text-blue-500">請假{l.leave}</span>
                                <span className="text-gray-300">|</span>
                                <span className="text-amber-500">封鎖{l.blocked}</span>
                                <span className="text-gray-300">|</span>
                                <span className="text-purple-500">補課{l.pending}</span>
                                <span className="text-gray-300">|</span>
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
                      const l = (avMap[avKey] ?? []).find(x => x.lessonId === arrangeTargetId);
                      if (!l) return null;
                      return l.full
                        ? <p className="mt-2 text-amber-600 text-xs">⏳ 該課已滿，將排入候補</p>
                        : <p className="mt-2 text-green-600 text-xs">✅ 有空位，可直接安排</p>;
                    })()}
                  </div>
                );
              })()}

              {/* Recording info */}
              {(arrangeType === '線上錄播' || arrangeType === '課室錄播') && (
                <div className="bg-purple-50 border border-purple-200 rounded-lg p-3 text-xs text-purple-700">
                  🎥 揀選咗 {arrangeType === '線上錄播' ? '線上錄播' : '課室錄播'}，系統會自動加入「補課錄播班」並設為已安排。
                </div>
              )}

              {/* Buttons */}
              <div className="flex justify-end gap-3 pt-2 border-t border-gray-100">
                <button onClick={() => setArrangeItem(null)} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg text-sm transition-colors">
                  取消
                </button>
                <button
                  onClick={doArrange}
                  disabled={arrangeType === '課室補課' && !arrangeTargetId || createMutation.isPending}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed text-sm transition-colors"
                >
                  {createMutation.isPending ? '處理中...' : '✅ 確定安排'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
