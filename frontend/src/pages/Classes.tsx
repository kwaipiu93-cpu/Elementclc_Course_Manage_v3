import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { Link } from 'react-router-dom';
import {
  Plus, ChevronDown, ChevronRight, Pencil, Trash2, X,
  UserPlus, ExternalLink
} from 'lucide-react';

// ─── Helpers ──────────────────────────────────────────────────────────────

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];

function formatWeek(weekStr?: string): string {
  if (!weekStr) return '';
  // Parse "逢六 10:00-12:00" → "逢六 10:00-12:00" (keep as is)
  return weekStr;
}

// ─── Types ────────────────────────────────────────────────────────────────

interface YearCourse { id: number; name: string; year: number; grade?: string; is_archived: boolean; }
interface TopicItem { id: number; year_course_id: number; name: string; type?: string; lessons?: number; fee?: number; sort?: number; is_archived: boolean; }
interface ClassItem { id: number; topic_id: number; name?: string; week?: string; seat?: number; is_completed: boolean; }

// ─── Confirm Dialog ───────────────────────────────────────────────────────

function ConfirmDialog({ message, onConfirm, onCancel }: {
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center" onClick={e => e.target === e.currentTarget && onCancel()}>
      <div className="bg-white rounded-xl p-6 w-full max-w-sm mx-4 shadow-xl" onClick={e => e.stopPropagation()}>
        <p className="text-gray-800 mb-6">{message}</p>
        <div className="flex justify-end gap-3">
          <button onClick={onCancel} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg">取消</button>
          <button onClick={onConfirm} className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700">確認刪除</button>
        </div>
      </div>
    </div>
  );
}

// ─── Modal ────────────────────────────────────────────────────────────────

function Modal({ title, children, onClose }: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-xl p-6 w-full max-w-lg mx-4 shadow-xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold">{title}</h2>
          <button onClick={onClose} className="p-1 text-gray-400 hover:bg-gray-100 rounded"><X size={20} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      {children}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────

export default function Classes() {
  const queryClient = useQueryClient();

  // ── Tree state — default all expanded ──
  const [collapsedYc, setCollapsedYc] = useState<Set<number>>(new Set());
  const [collapsedTopic, setCollapsedTopic] = useState<Set<number>>(new Set());

  const toggleYc = (id: number) => {
    setCollapsedYc(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const toggleTopic = (id: number) => {
    setCollapsedTopic(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // ── Modal state ──
  type ModalType = 'yc' | 'topic' | 'class' | null;
  const [modal, setModal] = useState<ModalType>(null);

  // ── Confirm delete state ──
  const [confirmDelete, setConfirmDelete] = useState<{
    type: 'yc' | 'topic' | 'class';
    id: number;
    name: string;
  } | null>(null);

  // ── Edit topic modal (full edit) ──
  const [editingTopic, setEditingTopic] = useState<TopicItem | null>(null);
  const [editTopicForm, setEditTopicForm] = useState<any>({});

  // ── Edit class modal ──
  const [editingClass, setEditingClass] = useState<ClassItem | null>(null);
  const [editClassForm, setEditClassForm] = useState<any>({});

  // ── Form state (create) ──
  const [ycForm, setYcForm] = useState({ name: '', year: new Date().getFullYear(), grade: '' });
  const [topicForm, setTopicForm] = useState({ year_course_id: 0, name: '', type: '課堂教學', lessons: 12, fee: 0, unit_price_new: 0, unit_price_insert: 0, makeup_fee: 0, sort: 0 });
  const [classForm, setClassForm] = useState({ topic_id: 0, name: '', weekDay: '六', startTime: '10:00', endTime: '12:00', first_lesson: '', seat: 0 });

  // ── Data ──
  const { data: treeData, isLoading } = useQuery({
    queryKey: ['class-tree'],
    queryFn: () => api.getClassTree(),
  });

  const ycs: YearCourse[] = treeData?.year_courses || [];
  const topics: TopicItem[] = treeData?.topics || [];
  const classes: ClassItem[] = treeData?.classes || [];
  const enrollStats: Record<number, { total: number; paid: number; unpaid: number }> = {};
  (treeData?.enroll_stats || []).forEach((s: any) => {
    enrollStats[s.class_id] = { total: s.total, paid: s.paid, unpaid: s.unpaid };
  });

  // Derived stats
  const totalEnrolled = Object.values(enrollStats).reduce((a, s) => a + s.total, 0);
  const totalPaid = Object.values(enrollStats).reduce((a, s) => a + s.paid, 0);
  const totalUnpaid = Object.values(enrollStats).reduce((a, s) => a + s.unpaid, 0);

  // ── Mutations ──
  const inval = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['class-tree'] });
  }, [queryClient]);

  const createYc = useMutation({ mutationFn: (d: any) => api.createYearCourse(d), onSuccess: () => { inval(); closeModal(); } });
  const createTopic = useMutation({ mutationFn: (d: any) => api.createTopic(d), onSuccess: () => { inval(); closeModal(); } });
  const createClass = useMutation({ mutationFn: (d: any) => api.createClass({ ...d, seat: Number(d.seat) }), onSuccess: () => { inval(); closeModal(); } });
  const deleteYc = useMutation({ mutationFn: (id: number) => api.deleteYearCourse(id), onSuccess: inval });
  const updateTopic = useMutation({ mutationFn: ({ id, d }: { id: number; d: any }) => api.updateTopic(id, d), onSuccess: inval });
  const deleteTopic = useMutation({ mutationFn: (id: number) => api.deleteTopic(id), onSuccess: inval });
  const updateClass = useMutation({ mutationFn: ({ id, d }: { id: number; d: any }) => api.updateClass(id, d), onSuccess: inval });
  const deleteClass = useMutation({ mutationFn: (id: number) => api.deleteClass(id), onSuccess: inval });

  // ── Modal actions ──
  const openYcModal = () => {
    setYcForm({ name: '', year: new Date().getFullYear(), grade: '' });
    setModal('yc');
  };
  const openTopicModal = (ycId: number) => {
    setTopicForm({ year_course_id: ycId, name: '', type: '課堂教學', lessons: 12, fee: 0, unit_price_new: 0, unit_price_insert: 0, makeup_fee: 0, sort: 0 });
    setModal('topic');
  };
  const openClassModal = (tId: number) => {
    setClassForm({ topic_id: tId, name: '', weekDay: '六', startTime: '10:00', endTime: '12:00', first_lesson: '', seat: 0 });
    setModal('class');
  };
  const closeModal = () => { setModal(null); setEditingTopic(null); setEditingClass(null); };

  const submitYc = (e: React.FormEvent) => { e.preventDefault(); createYc.mutate({ ...ycForm, year: Number(ycForm.year) }); };
  const submitTopic = (e: React.FormEvent) => { e.preventDefault(); createTopic.mutate(topicForm); };
  const submitClass = (e: React.FormEvent) => {
    e.preventDefault();
    const weekStr = `逢${classForm.weekDay} ${classForm.startTime}-${classForm.endTime}`;
    createClass.mutate({ topic_id: classForm.topic_id, name: classForm.name, week: weekStr, first_lesson: classForm.first_lesson, seat: Number(classForm.seat) } as any);
  };

  const saveEditTopic = () => {
    if (!editingTopic) return;
    updateTopic.mutate({ id: editingTopic.id, d: editTopicForm });
    setEditingTopic(null);
  };

  const saveEditClass = () => {
    if (!editingClass) return;
    updateClass.mutate({ id: editingClass.id, d: editClassForm });
    setEditingClass(null);
  };

  const handleDelete = () => {
    if (!confirmDelete) return;
    const { type, id } = confirmDelete;
    if (type === 'yc') deleteYc.mutate(id);
    else if (type === 'topic') deleteTopic.mutate(id);
    else deleteClass.mutate(id);
    setConfirmDelete(null);
  };

  // ── Derived ──
  const topicCount = (ycId: number) => topics.filter(t => t.year_course_id === ycId).length;

  // ── Loading ──
  if (isLoading) return <div className="text-gray-500 py-8 text-center">載入中...</div>;

  return (
    <div>
      {/* ═══ Header ═══ */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">📚 課程與班級</h1>
          <p className="text-sm text-gray-400 mt-1">
            {ycs.length} 個年度 · {topics.length} 個主題 · {classes.length} 個班級
          </p>
        </div>
        <button onClick={openYcModal} className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors shadow-sm">
          <Plus size={18} /> 新增年度課程
        </button>
      </div>

      {/* ═══ Payment Stats Bar ═══ */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 mb-6">
        <div className="flex items-center gap-6 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-400 uppercase tracking-wider font-medium">繳費概覽</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-blue-500" />
              <span className="text-sm text-gray-600">總報讀</span>
              <span className="text-lg font-bold text-gray-800">{totalEnrolled}</span>
            </div>
            <div className="w-px h-6 bg-gray-200" />
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-green-500" />
              <span className="text-sm text-gray-600">已繳</span>
              <span className="text-lg font-bold text-green-700">{totalPaid}</span>
            </div>
            <div className="w-px h-6 bg-gray-200" />
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-red-400" />
              <span className="text-sm text-gray-600">未繳</span>
              <span className="text-lg font-bold text-red-600">{totalUnpaid}</span>
            </div>
            <div className="w-px h-6 bg-gray-200" />
            <div className="flex items-center gap-1.5">
              <div className="h-2 w-16 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-green-500 rounded-full transition-all"
                  style={{ width: `${totalEnrolled > 0 ? (totalPaid / totalEnrolled) * 100 : 0}%` }}
                />
              </div>
              <span className="text-xs text-gray-500">
                繳費率 {totalEnrolled > 0 ? Math.round((totalPaid / totalEnrolled) * 100) : 0}%
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* ═══ Year Course Cards ═══ */}
      {ycs.length === 0 ? (
        <div className="text-center py-16">
          <div className="text-4xl mb-3">📚</div>
          <p className="text-gray-400 mb-4">尚未建立任何課程</p>
          <button onClick={openYcModal} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">
            建立第一個年度課程
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {ycs.map(yc => {
            const isExpanded = !collapsedYc.has(yc.id);
            const tCount = topicCount(yc.id);
            return (
              <div key={yc.id} className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden hover:shadow-md transition-shadow">
                {/* Card Header */}
                <div
                  className={`flex items-center gap-3 p-4 cursor-pointer transition-colors ${isExpanded ? 'bg-blue-50 border-b border-blue-100' : 'hover:bg-gray-50'}`}
                  onClick={() => toggleYc(yc.id)}
                >
                  <span className="text-blue-600">{isExpanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}</span>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-gray-800 truncate">
                      📁 {yc.name}
                      {yc.grade ? <span className="text-gray-400 font-normal ml-1">（{yc.grade}）</span> : null}
                    </div>
                    <div className="text-xs text-gray-400 mt-0.5">
                      {yc.year} · {tCount} 個主題 · {classes.filter(c => topics.filter(t => t.year_course_id === yc.id).some(t => t.id === c.topic_id)).length} 個班級
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={(e) => { e.stopPropagation(); openTopicModal(yc.id); }}
                      className="p-1.5 text-blue-600 hover:bg-blue-100 rounded-lg transition-colors"
                      title="新增主題"
                    >
                      <Plus size={16} />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); setYcForm({ name: yc.name, year: yc.year, grade: yc.grade || '' }); setModal('yc'); }}
                      className="p-1.5 text-gray-400 hover:bg-gray-100 rounded-lg transition-colors"
                      title="編輯年度課程"
                    >
                      <Pencil size={15} />
                    </button>
                    {/* Rename modal uses ycForm but we repurpose the YC modal for edit */}
                  </div>
                </div>

                {/* Expanded Content */}
                {isExpanded && (
                  <div className="p-3 space-y-2">
                    {topics.filter(t => t.year_course_id === yc.id).length === 0 ? (
                      <div className="text-center py-4">
                        <p className="text-gray-400 text-sm mb-2">暫無主題</p>
                        <button
                          onClick={() => openTopicModal(yc.id)}
                          className="inline-flex items-center gap-1 px-3 py-1.5 text-sm bg-blue-50 text-blue-700 rounded-lg hover:bg-blue-100 transition-colors"
                        >
                          <Plus size={14} /> 新增主題
                        </button>
                      </div>
                    ) : (
                      topics.filter(t => t.year_course_id === yc.id).map(t => {
                        const isTopicExpanded = !collapsedTopic.has(t.id);
                        const cls = classes.filter(c => c.topic_id === t.id);
                        return (
                          <div key={t.id} className="border border-gray-100 rounded-lg overflow-hidden">
                            {/* Topic Row */}
                            <div
                              className={`flex items-center gap-2 p-3 cursor-pointer transition-colors ${isTopicExpanded ? 'bg-gray-50' : 'hover:bg-gray-50'}`}
                              onClick={() => toggleTopic(t.id)}
                            >
                              <span className="text-gray-400 text-xs">{isTopicExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</span>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className="text-sm font-medium text-gray-800">📘 {t.name}</span>
                                  <span className="text-xs text-gray-400">
                                    {t.lessons || 0}節{t.fee ? ` · $${t.fee}` : ''}
                                  </span>
                                </div>
                              </div>
                              <div className="flex items-center gap-1 shrink-0">
                                <button
                                  onClick={(e) => { e.stopPropagation(); openClassModal(t.id); }}
                                  className="p-1 text-blue-600 hover:bg-blue-100 rounded transition-colors"
                                  title="新增班級"
                                >
                                  <UserPlus size={14} />
                                </button>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setEditingTopic(t);
                                    setEditTopicForm({
                                      name: t.name,
                                      type: t.type || '課堂教學',
                                      lessons: t.lessons || 12,
                                      fee: t.fee || 0,
                                    });
                                  }}
                                  className="p-1 text-gray-400 hover:bg-gray-100 rounded transition-colors"
                                  title="編輯主題"
                                >
                                  <Pencil size={13} />
                                </button>
                                <button
                                  onClick={(e) => { e.stopPropagation(); setConfirmDelete({ type: 'topic', id: t.id, name: t.name }); }}
                                  className="p-1 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
                                  title="刪除主題"
                                >
                                  <Trash2 size={13} />
                                </button>
                              </div>
                            </div>

                            {/* Classes under this topic */}
                            {isTopicExpanded && (
                              <div className="ml-6 pb-2 pr-2 space-y-1">
                                {cls.length === 0 ? (
                                  <p className="text-xs text-gray-400 py-2 pl-2">暫無班級</p>
                                ) : (
                                  cls.map(c => (
                                    <div key={c.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-gray-50 group">
                                      <span className="text-xs">🏫</span>
                                      <Link
                                        to={`/class/${c.id}`}
                                        className="flex-1 flex items-center gap-2 text-sm no-underline text-inherit min-w-0"
                                      >
                                        <span className="font-medium text-gray-700 truncate">{c.name || '(未命名)'}</span>
                                        <span className="text-xs text-gray-400 shrink-0">
                                          {c.week ? formatWeek(c.week) : ''}
                                          {c.seat ? ` · ${c.seat}位` : ''}
                                        </span>
                                        {/* Enroll stats badge */}
                                        {enrollStats[c.id] && (
                                          <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full shrink-0 ${
                                            enrollStats[c.id].unpaid > 0
                                              ? 'bg-amber-50 text-amber-700'
                                              : 'bg-green-50 text-green-700'
                                          }`}>
                                            {enrollStats[c.id].paid}/{enrollStats[c.id].total}
                                            {enrollStats[c.id].unpaid > 0 && ` (${enrollStats[c.id].unpaid}未繳)`}
                                          </span>
                                        )}
                                        <ExternalLink size={12} className="text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                                      </Link>
                                      <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <button
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            setEditingClass(c);
                                            setEditClassForm({
                                              name: c.name || '',
                                              week: c.week || '',
                                              seat: c.seat || 0,
                                            });
                                          }}
                                          className="p-1 text-gray-400 hover:bg-gray-100 rounded transition-colors"
                                          title="編輯班級"
                                        >
                                          <Pencil size={12} />
                                        </button>
                                        <button
                                          onClick={(e) => { e.stopPropagation(); setConfirmDelete({ type: 'class', id: c.id, name: c.name || '(未命名)' }); }}
                                          className="p-1 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
                                          title="刪除班級"
                                        >
                                          <Trash2 size={12} />
                                        </button>
                                      </div>
                                    </div>
                                  ))
                                )}
                                <button
                                  onClick={() => openClassModal(t.id)}
                                  className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 px-2 py-1 rounded hover:bg-blue-50 transition-colors w-full"
                                >
                                  <Plus size={12} /> 新增班級
                                </button>
                              </div>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ─── Modal: Year Course ──────────────────────────────────────── */}
      {modal === 'yc' && (
        <Modal title="年度課程" onClose={closeModal}>
          <form onSubmit={submitYc} className="space-y-4">
            <FormField label="名稱">
              <input type="text" value={ycForm.name} onChange={e => setYcForm({...ycForm, name: e.target.value})} className="form-input" required placeholder="e.g. 2026 DSE 常規課程" />
            </FormField>
            <div className="grid grid-cols-2 gap-4">
              <FormField label="年份">
                <input type="number" value={ycForm.year} onChange={e => setYcForm({...ycForm, year: Number(e.target.value)})} className="form-input" required />
              </FormField>
              <FormField label="年級">
                <input type="text" value={ycForm.grade} onChange={e => setYcForm({...ycForm, grade: e.target.value})} className="form-input" placeholder="e.g. F.3-F.6" />
              </FormField>
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <button type="button" onClick={closeModal} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">取消</button>
              <button type="submit" disabled={createYc.isPending} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors">
                {createYc.isPending ? '儲存中...' : '儲存'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* ─── Modal: Topic Create ─────────────────────────────────────── */}
      {modal === 'topic' && (
        <Modal title="新增主題" onClose={closeModal}>
          <form onSubmit={submitTopic} className="space-y-4">
            <FormField label="主題名稱">
              <input type="text" value={topicForm.name} onChange={e => setTopicForm({...topicForm, name: e.target.value})} className="form-input" required placeholder="e.g. 數學必修" />
            </FormField>
            <div className="grid grid-cols-2 gap-4">
              <FormField label="類型">
                <select value={topicForm.type} onChange={e => setTopicForm({...topicForm, type: e.target.value})} className="form-input">
                  <option>課堂教學</option><option>課室錄播</option><option>線上錄播</option>
                </select>
              </FormField>
              <FormField label="節數">
                <input type="number" value={topicForm.lessons} onChange={e => setTopicForm({...topicForm, lessons: Number(e.target.value)})} className="form-input" />
              </FormField>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <FormField label="費用 ($)">
                <input type="number" step="0.01" value={topicForm.fee} onChange={e => setTopicForm({...topicForm, fee: Number(e.target.value)})} className="form-input" />
              </FormField>
              <FormField label="新生單價">
                <input type="number" step="0.01" value={topicForm.unit_price_new} onChange={e => setTopicForm({...topicForm, unit_price_new: Number(e.target.value)})} className="form-input" />
              </FormField>
              <FormField label="插班單價">
                <input type="number" step="0.01" value={topicForm.unit_price_insert} onChange={e => setTopicForm({...topicForm, unit_price_insert: Number(e.target.value)})} className="form-input" />
              </FormField>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <FormField label="補課手續費">
                <input type="number" step="0.01" value={topicForm.makeup_fee} onChange={e => setTopicForm({...topicForm, makeup_fee: Number(e.target.value)})} className="form-input" />
              </FormField>
              <FormField label="排序">
                <input type="number" value={topicForm.sort} onChange={e => setTopicForm({...topicForm, sort: Number(e.target.value)})} className="form-input" />
              </FormField>
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <button type="button" onClick={closeModal} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg">取消</button>
              <button type="submit" disabled={createTopic.isPending} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">{createTopic.isPending ? '儲存中...' : '儲存'}</button>
            </div>
          </form>
        </Modal>
      )}

      {/* ─── Modal: Class Create ─────────────────────────────────────── */}
      {modal === 'class' && (
        <Modal title="新增班級" onClose={closeModal}>
          <form onSubmit={submitClass} className="space-y-4">
            <FormField label="班級名稱">
              <input type="text" value={classForm.name} onChange={e => setClassForm({...classForm, name: e.target.value})} className="form-input" required placeholder="e.g. 數學必修 A班" />
            </FormField>
            <div className="grid grid-cols-3 gap-3">
              <FormField label="星期">
                <select value={classForm.weekDay} onChange={e => setClassForm({...classForm, weekDay: e.target.value})} className="form-input">
                  {WEEKDAYS.map(d => <option key={d} value={d}>逢{d}</option>)}
                </select>
              </FormField>
              <FormField label="開始">
                <input type="time" value={classForm.startTime} onChange={e => setClassForm({...classForm, startTime: e.target.value})} className="form-input" />
              </FormField>
              <FormField label="結束">
                <input type="time" value={classForm.endTime} onChange={e => setClassForm({...classForm, endTime: e.target.value})} className="form-input" />
              </FormField>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <FormField label="首課日期">
                <input type="date" value={classForm.first_lesson} onChange={e => setClassForm({...classForm, first_lesson: e.target.value})} className="form-input" />
              </FormField>
              <FormField label="名額">
                <input type="number" value={classForm.seat} onChange={e => setClassForm({...classForm, seat: Number(e.target.value)})} className="form-input" />
              </FormField>
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <button type="button" onClick={closeModal} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg">取消</button>
              <button type="submit" disabled={createClass.isPending} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">{createClass.isPending ? '儲存中...' : '儲存'}</button>
            </div>
          </form>
        </Modal>
      )}

      {/* ─── Modal: Edit Topic ───────────────────────────────────────── */}
      {editingTopic && (
        <Modal title={`編輯主題 — ${editingTopic.name}`} onClose={() => setEditingTopic(null)}>
          <div className="space-y-4">
            <FormField label="主題名稱">
              <input type="text" value={editTopicForm.name} onChange={e => setEditTopicForm({...editTopicForm, name: e.target.value})} className="form-input" />
            </FormField>
            <div className="grid grid-cols-2 gap-4">
              <FormField label="類型">
                <select value={editTopicForm.type} onChange={e => setEditTopicForm({...editTopicForm, type: e.target.value})} className="form-input">
                  <option>課堂教學</option><option>課室錄播</option><option>線上錄播</option>
                </select>
              </FormField>
              <FormField label="節數">
                <input type="number" value={editTopicForm.lessons} onChange={e => setEditTopicForm({...editTopicForm, lessons: Number(e.target.value)})} className="form-input" />
              </FormField>
            </div>
            <FormField label="費用 ($)">
              <input type="number" step="0.01" value={editTopicForm.fee} onChange={e => setEditTopicForm({...editTopicForm, fee: Number(e.target.value)})} className="form-input" />
            </FormField>
            <div className="flex justify-end gap-3 pt-2">
              <button type="button" onClick={() => setEditingTopic(null)} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg">取消</button>
              <button type="button" onClick={saveEditTopic} disabled={updateTopic.isPending} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
                {updateTopic.isPending ? '儲存中...' : '儲存'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* ─── Modal: Edit Class ───────────────────────────────────────── */}
      {editingClass && (
        <Modal title={`編輯班級 — ${editingClass.name || '(未命名)'}`} onClose={() => setEditingClass(null)}>
          <div className="space-y-4">
            <FormField label="班級名稱">
              <input type="text" value={editClassForm.name} onChange={e => setEditClassForm({...editClassForm, name: e.target.value})} className="form-input" />
            </FormField>
            <FormField label="時間 (逢X HH:MM-HH:MM)">
              <input type="text" value={editClassForm.week} onChange={e => setEditClassForm({...editClassForm, week: e.target.value})} className="form-input" placeholder="逢六 10:00-12:00" />
            </FormField>
            <FormField label="名額">
              <input type="number" value={editClassForm.seat} onChange={e => setEditClassForm({...editClassForm, seat: Number(e.target.value)})} className="form-input" />
            </FormField>
            <div className="flex justify-end gap-3 pt-2">
              <button type="button" onClick={() => setEditingClass(null)} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg">取消</button>
              <button type="button" onClick={saveEditClass} disabled={updateClass.isPending} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
                {updateClass.isPending ? '儲存中...' : '儲存'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* ─── Confirm Delete ──────────────────────────────────────────── */}
      {confirmDelete && (
        <ConfirmDialog
          message={`確定刪除「${confirmDelete.name}」？\n此操作無法復原。`}
          onConfirm={handleDelete}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  );
}
