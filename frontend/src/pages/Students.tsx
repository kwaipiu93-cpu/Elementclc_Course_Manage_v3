import { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { Plus, ExternalLink, Phone, Mail, GraduationCap, School, Camera, Loader2, CheckSquare, X, Users } from 'lucide-react';

interface StudentForm {
  surname: string;
  given_name: string;
  school: string;
  email: string;
  password: string;
  phone: string;
  parent_phone: string;
  note: string;
  dse_year: string;
  enroll_date: string;
}

const emptyForm: StudentForm = {
  surname: '', given_name: '', school: '', email: '', password: '',
  phone: '', parent_phone: '', note: '', dse_year: '', enroll_date: '',
};

interface ClassTreeData {
  year_courses: any[];
  topics: any[];
  classes: any[];
  enroll_stats?: any[];
}

export default function Students() {
  const queryClient = useQueryClient();
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<StudentForm>(emptyForm);
  const [search, setSearch] = useState('');
  const [highlightId, setHighlightId] = useState<number | null>(null);

  // ─── Multi-select state ──────────────────────────────────
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [showEnrollModal, setShowEnrollModal] = useState(false);
  const [selectedClassIds, setSelectedClassIds] = useState<Set<number>>(new Set());
  const [enrolledCount, setEnrolledCount] = useState(0);
  const [enrollErrors, setEnrollErrors] = useState<string[]>([]);
  const [isEnrolling, setIsEnrolling] = useState(false);
  const [showSuccessBanner, setShowSuccessBanner] = useState(false);
  const successTimerRef = useRef<ReturnType<typeof setTimeout>>(null);

  const { data: students, isLoading } = useQuery({
    queryKey: ['students'],
    queryFn: () => api.getStudents(),
  });

  // ─── Class tree for enroll modal ─────────────────────────
  const { data: classTree } = useQuery<ClassTreeData>({
    queryKey: ['classTree'],
    queryFn: () => api.get<ClassTreeData>('/class-tree'),
  });

  const [expandedYears, setExpandedYears] = useState<Set<number>>(new Set());
  const [expandedTopics, setExpandedTopics] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (classTree?.year_courses && classTree.year_courses.length > 0) {
      setExpandedYears(new Set([classTree.year_courses[0].id]));
    }
  }, [classTree]);

  const toggleYear = (id: number) => {
    setExpandedYears(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleTopic = (id: number) => {
    setExpandedTopics(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const createMutation = useMutation({
    mutationFn: (data: any) => api.createStudent(data),
    onSuccess: (result: any) => {
      queryClient.invalidateQueries({ queryKey: ['students'] });
      const newId = result?.id;
      if (newId) {
        setHighlightId(newId);
        setTimeout(() => setHighlightId(null), 3000);
      }
      closeModal();
    },
    onError: (err: Error) => alert('儲存失敗：' + err.message),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => api.updateStudent(id, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['students'] }); closeModal(); },
    onError: (err: Error) => alert('更新失敗：' + err.message),
  });
  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.deleteStudent(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['students'] }),
  });

  const uploadAvatarMutation = useMutation({
    mutationFn: ({ id, file }: { id: number; file: File }) => api.uploadAvatar(id, file),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['students'] }),
    onError: (err: Error) => alert('上傳失敗：' + err.message),
  });

  const avatarInputRef = useRef<HTMLInputElement>(null);
  const [uploadingId, setUploadingId] = useState<number | null>(null);
  const [pendingAvatarId, setPendingAvatarId] = useState<number | null>(null);

  const handleAvatarClick = (id: number) => {
    setPendingAvatarId(id);
    avatarInputRef.current?.click();
  };

  const openAdd = () => { setEditingId(null); setForm(emptyForm); setShowModal(true); };
  const openEdit = (s: any) => {
    setEditingId(s.id);
    setForm({
      surname: s.surname || '', given_name: s.given_name || '', school: s.school || '',
      email: s.email || '', password: '', phone: s.phone || '', parent_phone: s.parent_phone || '',
      note: s.note || '', dse_year: s.dse_year || '', enroll_date: s.enroll_date || '',
    });
    setShowModal(true);
  };
  const closeModal = () => { setShowModal(false); setEditingId(null); setForm(emptyForm); };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const payload = { ...form, dse_year: form.dse_year ? Number(form.dse_year) : null };
    if (editingId) {
      updateMutation.mutate({ id: editingId, data: payload });
    } else {
      createMutation.mutate(payload);
    }
  };

  const handleDelete = (id: number, name: string) => {
    if (confirm(`確認刪除學生 ${name}？`)) deleteMutation.mutate(id);
  };

  const fullName = (s: any) => `${s.surname} ${s.given_name}`;
  const filteredStudents = (students || []).filter((s: any) => {
    if (!search.trim()) return true;
    const q = search.trim().toLowerCase();
    return fullName(s).toLowerCase().includes(q)
      || (s.school || '').toLowerCase().includes(q)
      || (s.phone || '').includes(q);
  });

  // ─── Multi-select handlers ────────────────────────────────
  const toggleSelect = (id: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredStudents.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredStudents.map((s: any) => s.id)));
    }
  };

  const clearSelection = () => setSelectedIds(new Set());

  // ─── Batch enroll ─────────────────────────────────────────
  const openEnrollModal = () => {
    setSelectedClassIds(new Set());
    setEnrolledCount(0);
    setEnrollErrors([]);
    setShowEnrollModal(true);
  };

  const closeEnrollModal = () => {
    setShowEnrollModal(false);
    if (enrolledCount > 0) {
      clearSelection();
    }
  };

  const toggleClass = (id: number) => {
    setSelectedClassIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const doBatchEnroll = async () => {
    if (selectedClassIds.size === 0) return;
    setIsEnrolling(true);
    setEnrolledCount(0);
    setEnrollErrors([]);

    let success = 0;
    let errors: string[] = [];
    const classNames = new Map(
      (classTree?.classes || []).map((c: any) => [c.id, c.name])
    );

    for (const cid of selectedClassIds) {
      for (const sid of selectedIds) {
        try {
          await api.createEnrollment({
            student_id: sid,
            class_id: cid,
            purchase: 0,
            remaining: 0,
            pay_status: 'Unpaid',
          });
          success++;
        } catch (e: any) {
          const student = students?.find((s: any) => s.id === sid);
          const name = student ? `${student.surname} ${student.given_name}` : `#${sid}`;
          const clsName = classNames.get(cid) || `#${cid}`;
          errors.push(`${name} @ ${clsName}: ${e.message}`);
        }
      }
    }

    setEnrolledCount(success);
    setEnrollErrors(errors);
    setIsEnrolling(false);
    queryClient.invalidateQueries({ queryKey: ['students'] });

    if (errors.length === 0) {
      setTimeout(closeEnrollModal, 2000);
    }
  };

  // ─── Success banner timeout ───────────────────────────────
  useEffect(() => {
    if (successTimerRef.current) clearTimeout(successTimerRef.current);
    if (showSuccessBanner) {
      successTimerRef.current = setTimeout(() => setShowSuccessBanner(false), 3000);
    }
    return () => { if (successTimerRef.current) clearTimeout(successTimerRef.current); };
  }, [showSuccessBanner]);

  const selectedList = (students || []).filter((s: any) => selectedIds.has(s.id));
  const selectedCount = selectedIds.size;

  return (
    <div>
      {/* Success banner */}
      {showSuccessBanner && (
        <div className="fixed top-4 right-4 z-50 bg-green-50 border border-green-200 text-green-800 px-4 py-3 rounded-xl shadow-lg flex items-center gap-2 animate-slide-down">
          <CheckSquare size={18} className="text-green-600" />
          <span className="font-medium">批量報名成功！</span>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">👤 學生</h1>
        <button onClick={openAdd} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors shadow-sm">
          <Plus size={18} /> 新增學生
        </button>
      </div>

      {/* Search bar */}
      <div className="mb-4">
        <div className="relative max-w-md">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-lg">🔍</span>
          <input
            type="text"
            placeholder="搜尋姓名、學校、電話..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          {filteredStudents.length > 0 && search && (
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">{filteredStudents.length} 項</span>
          )}
        </div>
      </div>

      {/* Student cards */}
      {isLoading ? (
        <div className="text-gray-500 py-8 text-center">載入中...</div>
      ) : (
        <>
          {/* Select all bar — when search is active & > 0 results */}
          {filteredStudents.length > 0 && (
            <div className="flex items-center gap-2 mb-3 px-1">
              <button
                onClick={toggleSelectAll}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  selectedIds.size === filteredStudents.length
                    ? 'bg-blue-100 text-blue-700'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                <CheckSquare size={14} />
                {selectedIds.size === filteredStudents.length
                  ? '取消全選'
                  : `全選 ${filteredStudents.length} 項`
                }
              </button>
              {selectedCount > 0 && (
                <span className="text-xs text-gray-500">
                  已選 {selectedCount} 人
                </span>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {filteredStudents.map((s: any) => {
              const isSelected = selectedIds.has(s.id);
              return (
                <div
                  key={s.id}
                  className={`bg-white rounded-xl border transition-all group ${
                    highlightId === s.id
                      ? 'ring-2 ring-yellow-400 bg-yellow-50 animate-pulse'
                      : isSelected
                        ? 'border-blue-400 ring-1 ring-blue-300 bg-blue-50/40'
                        : 'border-gray-200 hover:shadow-md'
                  }`}
                >
                  <div className="p-4">
                    {/* Top: Avatar + Name + School */}
                    <div className="flex items-start gap-3 mb-2">
                      {/* Checkbox */}
                      <button
                        onClick={() => toggleSelect(s.id)}
                        className={`shrink-0 w-5 h-5 mt-0.5 rounded border-2 flex items-center justify-center transition-colors ${
                          isSelected
                            ? 'bg-blue-600 border-blue-600 text-white'
                            : 'border-gray-300 hover:border-blue-400'
                        }`}
                      >
                        {isSelected && (
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        )}
                      </button>

                      {/* Avatar */}
                      <div className="relative shrink-0">
                        <input
                          type="file"
                          accept="image/png,image/jpeg,image/gif,image/webp"
                          className="hidden"
                          ref={avatarInputRef}
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file && pendingAvatarId) {
                              const id = pendingAvatarId;
                              setPendingAvatarId(null);
                              setUploadingId(id);
                              uploadAvatarMutation.mutate(
                                { id, file },
                                { onSettled: () => { setUploadingId(null); if (avatarInputRef.current) avatarInputRef.current.value = ''; } }
                              );
                            }
                          }}
                        />
                        <button
                          type="button"
                          onClick={() => handleAvatarClick(s.id)}
                          disabled={uploadingId === s.id}
                          className="block w-10 h-10 rounded-full overflow-hidden focus:outline-none focus:ring-2 focus:ring-blue-400 relative group"
                        >
                          {s.avatar ? (
                            <img src={s.avatar} alt="" className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center text-white text-sm font-bold shadow-sm">
                              {s.surname?.charAt(0) || '?'}{s.given_name?.charAt(0) || ''}
                            </div>
                          )}
                          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center">
                            {uploadingId === s.id ? (
                              <Loader2 size={14} className="text-white animate-spin" />
                            ) : (
                              <Camera size={14} className="text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                            )}
                          </div>
                        </button>
                      </div>

                      <div className="min-w-0 flex-1">
                        <Link to={`/student/${s.id}`} className="hover:underline">
                          <span className="font-bold text-gray-900 text-base">{s.surname} {s.given_name}</span>
                        </Link>
                        {s.school && (
                          <div className="flex items-center gap-1 mt-0.5">
                            <School size={12} className="text-gray-400 shrink-0" />
                            <span className="text-xs text-gray-500 truncate">{s.school}</span>
                          </div>
                        )}
                      </div>
                      <Link to={`/student/${s.id}`}
                        className="shrink-0 p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg opacity-0 group-hover:opacity-100 transition-all"
                        title="詳情"
                      >
                        <ExternalLink size={15} />
                      </Link>
                    </div>

                    {/* Info rows */}
                    <div className="space-y-1 text-xs text-gray-500">
                      <div className="flex items-center gap-1.5">
                        <Phone size={11} className="text-gray-400 shrink-0" />
                        <span>{s.phone || '—'}</span>
                        {s.parent_phone && <><span className="text-gray-300">·</span><span>{s.parent_phone} (家長)</span></>}
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Mail size={11} className="text-gray-400 shrink-0" />
                        <span className="truncate">{s.email || '—'}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <GraduationCap size={11} className="text-gray-400 shrink-0" />
                        <span>{s.dse_year ? `${s.dse_year} DSE` : '—'}</span>
                        <span className="text-gray-300">·</span>
                        <span>報名 {s.enroll_date || '—'}</span>
                      </div>
                      <div className="text-gray-400 truncate pt-0.5 border-t border-gray-100 mt-1 max-w-full">
                        📝 {s.note || '—'}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1 mt-3 pt-3 border-t border-gray-100">
                      <Link
                        to={`/student/${s.id}`}
                        className="flex-1 text-center py-1.5 text-xs font-medium text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                      >
                        詳情
                      </Link>
                      <button
                        onClick={() => openEdit(s)}
                        className="flex-1 text-center py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                      >
                        編輯
                      </button>
                      <button
                        onClick={() => handleDelete(s.id, `${s.surname} ${s.given_name}`)}
                        className="flex-1 text-center py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                      >
                        刪除
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}

            {/* Empty states */}
            {(!students || students.length === 0) && (
              <div className="col-span-full py-12 text-center text-gray-400">
                暫無學生資料
              </div>
            )}
            {(students && students.length > 0 && filteredStudents.length === 0) && (
              <div className="col-span-full py-12 text-center text-gray-400">
                無符合「{search}」的學生
              </div>
            )}
          </div>
        </>
      )}

      {/* ─── Floating action bar (when students selected) ───── */}
      {selectedCount > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 bg-white rounded-2xl shadow-2xl border border-gray-200 px-5 py-3 flex items-center gap-4 animate-slide-up">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center">
              <Users size={16} className="text-blue-600" />
            </div>
            <div>
              <span className="font-semibold text-sm text-gray-900">{selectedCount}</span>
              <span className="text-xs text-gray-500 ml-1">位學生已選</span>
            </div>
            {/* Selected names preview */}
            <div className="hidden sm:flex items-center gap-1 ml-2 max-w-[200px] overflow-hidden">
              {selectedList.slice(0, 3).map((s: any) => (
                <span key={s.id} className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full truncate">
                  {s.surname}{s.given_name}
                </span>
              ))}
              {selectedList.length > 3 && (
                <span className="text-xs text-gray-400">+{selectedList.length - 3}</span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={openEnrollModal}
              className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors text-sm font-medium shadow-sm"
            >
              <Plus size={16} />
              報名
            </button>
            <button
              onClick={clearSelection}
              className="flex items-center gap-1.5 px-3 py-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-xl transition-colors text-sm"
            >
              <X size={16} />
              取消
            </button>
          </div>
        </div>
      )}

      {/* ─── Batch Enroll Modal ─────────────────────────────── */}
      {showEnrollModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center" onClick={(e) => e.target === e.currentTarget && !isEnrolling && closeEnrollModal()}>
          <div className="bg-white rounded-xl p-6 w-full max-w-lg mx-4 shadow-xl max-h-[80vh] overflow-y-auto">
            <h2 className="text-lg font-bold mb-1">批量報名</h2>
            <p className="text-sm text-gray-500 mb-4">
              為 {selectedCount} 位學生選擇班級
            </p>

            {/* Selected students summary */}
            <div className="mb-4 p-3 bg-blue-50 rounded-xl">
              <div className="flex items-center gap-2 mb-1">
                <Users size={15} className="text-blue-600" />
                <span className="text-sm font-medium text-blue-800">已選學生</span>
              </div>
              <div className="flex flex-wrap gap-1 mt-2">
                {selectedList.map((s: any) => (
                  <span key={s.id} className="text-xs bg-white text-gray-700 px-2 py-0.5 rounded-full border border-blue-200">
                    {s.surname}{s.given_name}
                  </span>
                ))}
              </div>
            </div>

            {/* Success state */}
            {enrolledCount > 0 && (
              <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-xl">
                <div className="flex items-center gap-2">
                  <CheckSquare size={18} className="text-green-600" />
                  <span className="text-sm font-medium text-green-800">
                    成功 {enrolledCount} 筆報名
                    {selectedClassIds.size > 0 && `（${selectedClassIds.size} 班 × ${selectedIds.size} 人）`}
                  </span>
                </div>
                {enrollErrors.length > 0 && (
                  <div className="mt-2 text-xs text-red-600 space-y-0.5 max-h-24 overflow-y-auto">
                    {enrollErrors.map((e, i) => (
                      <div key={i}>⚠ {e}</div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Class tree selector */}
            {enrolledCount === 0 && (
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  選擇報名班級（可選多班）
                  {selectedClassIds.size > 0 && (
                    <span className="text-blue-600 ml-2">已選 {selectedClassIds.size} 班</span>
                  )}
                </label>
                <div className="border border-gray-200 rounded-xl overflow-hidden max-h-60 overflow-y-auto">
                  {classTree?.year_courses?.map((year: any) => (
                    <div key={year.id}>
                      <button
                        onClick={() => toggleYear(year.id)}
                        className={`w-full flex items-center gap-2 px-3 py-2.5 text-sm font-medium text-left hover:bg-gray-50 transition-colors ${
                          expandedYears.has(year.id) ? 'bg-gray-50 border-b border-gray-100' : ''
                        }`}
                      >
                        <span className={`text-xs text-gray-400 transition-transform ${expandedYears.has(year.id) ? 'rotate-90' : ''}`}>▶</span>
                        {year.name}
                      </button>
                      {expandedYears.has(year.id) && classTree?.topics
                        ?.filter((t: any) => t.year_course_id === year.id)
                        .map((topic: any) => (
                          <div key={topic.id} className="pl-4">
                            <button
                              onClick={() => toggleTopic(topic.id)}
                              className={`w-full flex items-center gap-2 px-3 py-2 text-xs text-left text-gray-600 hover:bg-gray-50 transition-colors ${
                                expandedTopics.has(topic.id) ? 'bg-gray-50 border-b border-gray-100' : ''
                              }`}
                            >
                              <span className={`text-xs text-gray-400 transition-transform ${expandedTopics.has(topic.id) ? 'rotate-90' : ''}`}>▶</span>
                              {topic.name} ({topic.type}, ${topic.fee})
                            </button>
                            {expandedTopics.has(topic.id) && classTree?.classes
                              ?.filter((c: any) => c.topic_id === topic.id && !c.is_completed && !c.is_deleted)
                              .map((cls: any) => {
                                const stat = classTree?.enroll_stats?.find((e: any) => e.class_id === cls.id);
                                const enrolled = stat?.total || 0;
                                const seat = cls.seat || 0;
                                const available = seat - enrolled;
                                const isFull = available <= 0;
                                const isSelected = selectedClassIds.has(cls.id);
                                return (
                                  <button
                                    key={cls.id}
                                    onClick={() => !isFull && toggleClass(cls.id)}
                                    disabled={isFull}
                                    className={`w-full flex items-center justify-between gap-2 pl-8 pr-3 py-2 text-xs text-left transition-colors ${
                                      isSelected
                                        ? 'bg-blue-100 text-blue-800 font-medium'
                                        : isFull
                                          ? 'text-gray-300 cursor-not-allowed'
                                          : 'text-gray-600 hover:bg-gray-50'
                                    }`}
                                  >
                                    <div className="flex items-center gap-2 min-w-0">
                                      <div className={`w-3.5 h-3.5 rounded border-2 flex items-center justify-center shrink-0 ${
                                        isSelected
                                          ? 'bg-blue-600 border-blue-600'
                                          : isFull
                                            ? 'border-gray-300'
                                            : 'border-gray-400'
                                      }`}>
                                        {isSelected && (
                                          <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
                                            <polyline points="20 6 9 17 4 12" />
                                          </svg>
                                        )}
                                      </div>
                                      <span className="truncate">{cls.name}</span>
                                      <span className="text-gray-400">{cls.week} {cls.start}-{cls.end}</span>
                                    </div>
                                    <span className={`shrink-0 ${isFull ? 'text-red-300' : available <= 2 ? 'text-orange-500' : 'text-gray-400'}`}>
                                      {seat > 0 ? `${available}/${seat}` : `${enrolled} 人`}
                                    </span>
                                  </button>
                                );
                              })}
                          </div>
                        ))}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="flex justify-end gap-3 pt-2">
              <button
                onClick={closeEnrollModal}
                disabled={isEnrolling}
                className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-50"
              >
                {enrolledCount > 0 ? '完成' : '取消'}
              </button>
              {enrolledCount === 0 && (
                <button
                  onClick={doBatchEnroll}
                  disabled={selectedClassIds.size === 0 || isEnrolling}
                  className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
                >
                  {isEnrolling ? (
                    <>
                      <Loader2 size={16} className="animate-spin" />
                      報名中...
                    </>
                  ) : (
                    <>
                      <Users size={16} />
                      為 {selectedIds.size} 人報 {selectedClassIds.size} 班
                    </>
                  )}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Add/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center" onClick={(e) => e.target === e.currentTarget && closeModal()}>
          <div className="bg-white rounded-xl p-6 w-full max-w-lg mx-4 shadow-xl">
            <h2 className="text-lg font-bold mb-4">{editingId ? '編輯學生' : '新增學生'}</h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">姓氏 *</label>
                  <input type="text" value={form.surname} onChange={(e) => setForm({ ...form, surname: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" required />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">名字 *</label>
                  <input type="text" value={form.given_name} onChange={(e) => setForm({ ...form, given_name: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" required />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">學校</label>
                <input type="text" value={form.school} onChange={(e) => setForm({ ...form, school: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">電郵 *</label>
                  <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" required />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">密碼</label>
                  <input type="text" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="留空=使用電郵作密碼" className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">電話</label>
                  <input type="text" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">家長電話</label>
                  <input type="text" value={form.parent_phone} onChange={(e) => setForm({ ...form, parent_phone: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">DSE年份</label>
                  <input type="text" value={form.dse_year} onChange={(e) => setForm({ ...form, dse_year: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">報名日期</label>
                  <input type="date" value={form.enroll_date} onChange={(e) => setForm({ ...form, enroll_date: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">備註</label>
                  <input type="text" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" />
                </div>
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={closeModal} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">取消</button>
                <button type="submit" disabled={createMutation.isPending || updateMutation.isPending} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors">
                  {createMutation.isPending || updateMutation.isPending ? '儲存中...' : '儲存'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
