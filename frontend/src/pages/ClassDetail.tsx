import { useState, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import {
  ArrowLeft, Calendar, Users, Search, Plus, X,
  Phone, Mail, School, ExternalLink, BarChart3,
  UserCheck, UserX, AlertCircle, Clock3, Check
} from 'lucide-react';

type Tab = 'lessons' | 'students' | 'attendance' | 'homework';

interface MenuState {
  show: boolean;
  eid: number;
  sid: number;
  lnum: number;
  lid: number;
  sname: string;
  cur: string;
}

// ─── Status label helper ──────────────────────────────────────────────────

function statusLabel(st: string): { text: string; bg: string; fg: string } {
  const map: Record<string, { text: string; bg: string; fg: string }> = {
    present:            { text: '✅課堂教學出席', bg: 'bg-green-100',  fg: 'text-green-700' },
    makeup:             { text: '✅課堂補堂出席', bg: 'bg-green-100',  fg: 'text-green-700' },
    recording_room_present: { text: '✅課室錄播出席', bg: 'bg-emerald-100', fg: 'text-emerald-700' },
    video_makeup:       { text: '✅線上錄播出席',   bg: 'bg-purple-100', fg: 'text-purple-700' },
    leave:              { text: '📋請假待安排',       bg: 'bg-blue-100',   fg: 'text-blue-700' },
    absent:             { text: '❌缺勤待安排',       bg: 'bg-red-100',    fg: 'text-red-700' },
    scheduled_room:     { text: '⌛️課室錄播待補',   bg: 'bg-amber-100',  fg: 'text-amber-700' },
    scheduled_video:    { text: '⌛️線上錄播待補',  bg: 'bg-purple-100', fg: 'text-purple-700' },
    scheduled_classroom: { text: '⌛️課堂教學待補',  bg: 'bg-amber-100',  fg: 'text-amber-700' },
    waiting:            { text: '‼️課堂教學候補',       bg: 'bg-orange-100', fg: 'text-orange-700' },
  };
  return map[st] || { text: '🟡未處理', bg: 'bg-yellow-100', fg: 'text-yellow-700' };
}

// ─── Main Component ───────────────────────────────────────────────────────

export default function ClassDetail() {
  const { id } = useParams<{ id: string }>();
  const classId = Number(id);
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>('attendance');
  const [studentSearch, setStudentSearch] = useState('');

  // ─── Enroll modal state ────────────────────────────────────────────
  const [showEnrollModal, setShowEnrollModal] = useState(false);
  const [enrollSearch, setEnrollSearch] = useState('');
  const [enrollResult, setEnrollResult] = useState<any>(null); // selected student
  const [enrollPurchase, setEnrollPurchase] = useState(12);
  const [enrollAmount, setEnrollAmount] = useState(0);
  const [enrollPayStatus, setEnrollPayStatus] = useState('未繳');

  // ─── Transfer modal state ────────────────────────────────────────
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [transferEnrId, setTransferEnrId] = useState(0);
  const [transferStudentName, setTransferStudentName] = useState('');
  const [transferCurrentClass, setTransferCurrentClass] = useState('');
  const [transferTarget, setTransferTarget] = useState<number | null>(null);
  const [transferClassList, setTransferClassList] = useState<any[]>([]);

  // ─── Lesson inline edit ──────────────────────────────────────────
  const [editing, setEditing] = useState<{ id: number; field: string } | null>(null);
  const [editVal, setEditVal] = useState('');
  const updateLesson = useMutation({
    mutationFn: ({ id, data }: { id: number; data: { date?: string; start?: string; end?: string } }) =>
      api.updateLesson(id, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['lessons', classId] }),
  });

  // ─── Data queries ───────────────────────────────────────────────
  const { data: cls } = useQuery({
    queryKey: ['class', classId],
    queryFn: () => api.listClasses().then((classes: any[]) =>
      classes.find((c: any) => c.id === classId)
    ),
  });

  const { data: enrollments } = useQuery({
    queryKey: ['enrollments', classId],
    queryFn: () => api.getEnrollments(classId),
  });

  const { data: lessons } = useQuery({
    queryKey: ['lessons', classId],
    queryFn: () => api.getLessons(classId),
  });

  const { data: checkinData } = useQuery({
    queryKey: ['checkins', classId],
    queryFn: () => api.getCheckins(classId),
  });

  const { data: allStudents } = useQuery({
    queryKey: ['students'],
    queryFn: () => api.getStudents(),
  });

  const { data: allClasses } = useQuery({
    queryKey: ['all-classes'],
    queryFn: () => api.listClasses(),
  });

  // ─── Enroll mutation ─────────────────────────────────────────────
  const createEnroll = useMutation({
    mutationFn: (data: any) => api.createEnrollment(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['enrollments', classId] });
      queryClient.invalidateQueries({ queryKey: ['students'] });
      setShowEnrollModal(false);
      setEnrollSearch('');
      setEnrollResult(null);
      setEnrollPurchase(12);
      setEnrollAmount(0);
      setEnrollPayStatus('未繳');
    },
  });

  // ─── Homework toggle ────────────────────────────────────────────
  const toggleHw = useMutation({
    mutationFn: (data: { lessonId: number; studentId: number; done: boolean }) =>
      api.toggleHomework(data.lessonId, data.studentId, data.done),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['checkins', classId] });
    },
  });

  const transferEnroll = useMutation({
    mutationFn: ({ id, newClassId }: { id: number; newClassId: number }) =>
      api.transferEnrollment(id, newClassId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['enrollments', classId] });
      setShowTransferModal(false);
      setTransferTarget(null);
    },
  });

  const createStudentAndEnroll = useMutation({
    mutationFn: async (data: { student: any; enrollment: any }) => {
      const newStudent = await api.createStudent(data.student);
      return api.createEnrollment({ ...data.enrollment, student_id: newStudent.id });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['enrollments', classId] });
      queryClient.invalidateQueries({ queryKey: ['students'] });
      setShowEnrollModal(false);
      setEnrollSearch('');
      setEnrollResult(null);
      setEnrollPurchase(12);
      setEnrollAmount(0);
      setEnrollPayStatus('未繳');
    },
  });

  // ─── Derived data ───────────────────────────────────────────────
  const studentMap = useMemo(() => {
    const m = new Map<number, any>();
    (allStudents || []).forEach((s: any) => m.set(s.id, s));
    return m;
  }, [allStudents]);

  const enrolledIds = useMemo(() => {
    return new Set((enrollments || []).map((e: any) => e.student_id));
  }, [enrollments]);

  const checkinMap = useMemo(() => {
    const m = new Map<string, string>();
    (checkinData?.checkins || []).forEach((c: any) => {
      m.set(`${c.student_id}_${c.lesson_id}`, c.status);
    });
    return m;
  }, [checkinData]);

  const checkinTimeMap = useMemo(() => {
    const m = new Map<string, string>();
    (checkinData?.checkins || []).forEach((c: any) => {
      if (c.checkin_time) m.set(`${c.student_id}_${c.lesson_id}`, c.checkin_time);
    });
    return m;
  }, [checkinData]);

  const makeupMap = useMemo(() => {
    const m = new Map<string, string>();
    (checkinData?.makeups || []).forEach((mk: any) => {
      m.set(`${mk.student_id}_${mk.lesson_num}`, mk.status);
    });
    return m;
  }, [checkinData]);

  const blockedMap = useMemo(() => {
    const m = new Map<string, boolean>();
    const lessonByNum = new Map<number, number>();
    (lessons || []).forEach((l: any) => lessonByNum.set(l.num, l.id));
    (enrollments || []).forEach((e: any) => {
      (lessons || []).forEach((l: any) => {
        if (l.num <= 1) return;
        const prevLid = lessonByNum.get(l.num - 1);
        if (!prevLid) return;
        const prevKey = `${e.student_id}_${prevLid}`;
        const prevSt = checkinMap.get(prevKey) || '';
        const blocked = prevSt !== 'present' && prevSt !== 'makeup' && prevSt !== 'recording_room_present' && prevSt !== 'video_makeup';
        if (blocked) m.set(`${e.student_id}_${l.id}`, true);
      });
    });
    return m;
  }, [enrollments, lessons, checkinMap]);

  // ─── Lesson stats ───────────────────────────────────────────────
  const lessonStats = useMemo(() => {
    const stats: Record<number, { present: number; total: number; leave: number; absent: number }> = {};
    (lessons || []).forEach((l: any) => {
      let present = 0, total = 0, leave = 0, absent = 0;
      (enrollments || []).forEach((e: any) => {
        const key = `${e.student_id}_${l.id}`;
        const st = checkinMap.get(key);
        total++;
        if (st === 'present' || st === 'makeup' || st === 'recording_room_present' || st === 'video_makeup') present++;
        else if (st === 'leave') leave++;
        else if (st === 'absent') absent++;
      });
      stats[l.id] = { present, total, leave, absent };
    });
    return stats;
  }, [lessons, enrollments, checkinMap]);

  const totalLessons = lessons?.length || 0;
  const pastLessons = (lessons || []).filter((l: any) => l.date && l.date <= new Date().toLocaleDateString('en-CA')).length;

  // ─── Student attendance summary ─────────────────────────────────
  const studentAttendance = useMemo(() => {
    const m = new Map<number, { present: number; total: number }>();
    (enrollments || []).forEach((e: any) => {
      let present = 0, total = 0;
      (lessons || []).forEach((l: any) => {
        total++;
        const st = checkinMap.get(`${e.student_id}_${l.id}`);
        if (st && ['present', 'makeup', 'recording_room_present', 'video_makeup'].includes(st)) present++;
      });
      m.set(e.student_id, { present, total });
    });
    return m;
  }, [enrollments, lessons, checkinMap]);

  // ─── Mutations ─────────────────────────────────────────────────
  const updateAttendance = useMutation({
    mutationFn: ({ lessonId, studentId, status }: any) =>
      api.updateCheckin(lessonId, studentId, status),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['checkins', classId] }),
  });

  // ─── Detail modal state ────────────────────────────────────────
  const [menu, setMenu] = useState<MenuState>({
    show: false, eid: 0, sid: 0, lnum: 0, lid: 0, sname: '', cur: '',
  });
  const [detail, setDetail] = useState<any>(null);
  const [showMkModal, setShowMkModal] = useState(false);
  const [mkForm, setMkForm] = useState<any>({
    student_id: 0, original_class_id: classId, original_topic: '',
    lesson_num: 0, absent_date: '', makeup_type: '課室補課',
    makeup_class: '', status: 'waiting',
  });
  const [avLessons, setAvLessons] = useState<any[]>([]);
  const [selectedAvLesson, setSelectedAvLesson] = useState<any>(null);

  const openMenu = (eid: number, sid: number, lnum: number, lid: number, sname: string, cur: string) => {
    setMenu({ show: true, eid, sid, lnum, lid, sname, cur });
    const lesson = (lessons || []).find((l: any) => l.id === lid);
    const mkKey = `${sid}_${lnum}`;
    const lessonByNum = new Map<number, any>();
    (lessons || []).forEach((l: any) => lessonByNum.set(l.num, l));

    const studentCheckins = (checkinData?.checkins || [])
      .filter((c: any) => c.student_id === sid && c.lesson_id === lid)
      .map((c: any) => {
        const l = (lessons || []).find((x: any) => x.id === c.lesson_id);
        return { ...c, lesson_label: l ? `第${l.num}課` : `lesson ${c.lesson_id}`, lesson_date: l?.date || '' };
      });
    const studentMakeups = (checkinData?.makeups || [])
      .filter((mk: any) => mk.student_id === sid && mk.lesson_num === String(lnum))
      .map((mk: any) => ({
        ...mk,
        lesson_label: `第${mk.lesson_num}課`,
        lesson: lessonByNum.get(Number(mk.lesson_num)),
      }));
    const studentStandby = (checkinData?.standby || []).filter((sb: any) => sb.student_id === sid);
    const changeLogs = ((checkinData as any)?.logs || [])
      .filter((lg: any) => lg.student_id === sid && lg.lesson_id === lnum)
      .sort((a: any, b: any) => b.created_at.localeCompare(a.created_at));

    setDetail({
      student_name: sname, lesson_label: `第${lnum}課`, lesson_num: lnum,
      lesson_id: lid, lesson_date: lesson?.date || '', class_name: cls?.name || '',
      status: cur, checkin_time: checkinTimeMap.get(`${sid}_${lid}`) || '',
      mk_status: makeupMap.get(mkKey) || '', student_checkins: studentCheckins,
      student_makeups: studentMakeups, student_standby: studentStandby, change_logs: changeLogs,
    });
  };

  const setStatus = (st: string) => {
    updateAttendance.mutate({ lessonId: menu.lid, studentId: menu.sid, status: st });
    setMenu({ ...menu, show: false });
    setDetail(null);
  };

  const openMakeup = () => {
    setMkForm({
      student_id: menu.sid, original_class_id: classId,
      original_topic: cls?.topic_name || '', lesson_num: String(menu.lnum),
      absent_date: detail?.lesson_date || '', makeup_type: '課室補課',
      makeup_class: '', status: 'waiting',
    });
    setSelectedAvLesson(null);
    setAvLessons([]);
    api.getAvailableLessons(classId, menu.lnum).then(setAvLessons).catch(() => {});
    setMenu({ ...menu, show: false });
    setDetail(null);
    setShowMkModal(true);
  };

  const submitMakeup = () => {
    const payload = {
      ...mkForm,
      lesson_num: String(mkForm.lesson_num),
      target_lesson_id: selectedAvLesson?.lessonId ?? null,
      makeup_class: selectedAvLesson?.className ?? null,
      status: mkForm.makeup_type === '課室補課'
        ? (selectedAvLesson ? (selectedAvLesson.full ? 'waiting' : 'scheduled') : 'waiting')
        : mkForm.status,
    };
    api.createMakeup(payload).then(() => {
      setShowMkModal(false);
      queryClient.invalidateQueries({ queryKey: ['checkins', classId] });
    }).catch((err: any) => {
      alert('安排補課失敗：' + (err.message || '未知錯誤'));
    });
  };

  const saveEdit = () => {
    if (!editing) return;
    const lesson = (lessons || []).find((l: any) => l.id === editing.id);
    if (!lesson) { setEditing(null); return; }
    const payload: { date?: string; start?: string; end?: string } = {};
    if (editing.field === 'date') payload.date = editVal || null as any;
    else if (editing.field === 'start') payload.start = editVal || null as any;
    else if (editing.field === 'end') payload.end = editVal || null as any;
    updateLesson.mutate({ id: editing.id, data: payload });
    setEditing(null);
  };
  const isEditing = (lid: number, field: string) => editing?.id === lid && editing?.field === field;
  const startEdit = (lid: number, field: string, val: string) => { setEditing({ id: lid, field }); setEditVal(val); };

  const today = new Date().toLocaleDateString('en-CA');

  const confirmStandby = (studentId: number, standbyId: number) => {
    api.confirmStandby(studentId, standbyId, classId).then(() => {
      queryClient.invalidateQueries({ queryKey: ['checkins', classId] });
    }).catch((err: any) => {
      alert('確認候補失敗：' + (err.message || '未知錯誤'));
    });
  };

  // ─── Enroll search ──────────────────────────────────────────────
  const searchResults = useMemo(() => {
    if (!enrollSearch.trim()) return [];
    const q = enrollSearch.trim().toLowerCase();
    return (allStudents || [])
      .filter((s: any) => {
        const name = `${s.surname} ${s.given_name}`.toLowerCase();
        const school = (s.school || '').toLowerCase();
        const phone = (s.phone || '');
        return name.includes(q) || school.includes(q) || phone.includes(q);
      })
      .slice(0, 10);
  }, [enrollSearch, allStudents]);

  const handleEnroll = () => {
    if (!enrollResult) return;
    const payload = {
      student_id: enrollResult.id,
      class_id: classId,
      pay_status: enrollPayStatus,
      purchase: enrollPurchase,
      pay_amount: enrollAmount || null,
    };
    createEnroll.mutate(payload);
  };

  const [newStudentSurname, setNewStudentSurname] = useState('');
  const [newStudentGivenName, setNewStudentGivenName] = useState('');
  const [newStudentSchool, setNewStudentSchool] = useState('');
  const [newStudentPhone, setNewStudentPhone] = useState('');
  const [newStudentParentPhone, setNewStudentParentPhone] = useState('');
  const [newStudentEmail, setNewStudentEmail] = useState('');
  const [newStudentNote, setNewStudentNote] = useState('');
  const [newStudentDseYear, setNewStudentDseYear] = useState(0);
  const [showNewStudent, setShowNewStudent] = useState(false);
  const [enrollMode, setEnrollMode] = useState<'single' | 'batch'>('single');

  // ─── Batch enroll state ─────────────────────────────────────────
  const [batchPasteText, setBatchPasteText] = useState('');
  const [batchParsed, setBatchParsed] = useState<any[]>([]);
  const [batchErrors, setBatchErrors] = useState<string[]>([]);
  const [batchEnrolling, setBatchEnrolling] = useState(false);
  const [batchEnrollResult, setBatchEnrollResult] = useState<any>(null);
  const [batchParsing, setBatchParsing] = useState(false);
  const [batchAiSource, setBatchAiSource] = useState('');

  // ─── Client-side tab-separated parser ─────────────────────────
  function parseBatchText(text: string) {
    const lines = text.split('\n').filter((l: string) => l.trim());
    const parsed: any[] = [];
    const errors: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      const parts = lines[i].split('\t');
      const surname = (parts[0] || '').trim();
      const school = (parts[1] || '').trim();
      const given_name = (parts[2] || '').trim();
      const email = (parts[3] || '').trim();
      const phone = (parts[4] || '').trim();
      const parent_phone = (parts[5] || '').trim();
      const dse_year = parseInt(parts[6]) || 0;
      const note = (parts[7] || '').trim();
      if (!surname || !given_name) {
        errors.push(`第 ${i + 1} 行：缺少姓或名`);
        continue;
      }
      parsed.push({ surname, given_name, school, email, phone, parent_phone, dse_year, note });
    }
    return { parsed, errors };
  }

  function handleBatchParse(text: string) {
    setBatchPasteText(text);
    setBatchEnrollResult(null);
    if (!text.trim()) {
      setBatchParsed([]);
      setBatchErrors([]);
      setBatchAiSource('');
      return;
    }
    const result = parseBatchText(text);
    setBatchParsed(result.parsed);
    setBatchErrors(result.errors);
    setBatchAiSource('');
  }

  function handleBatchAiParse() {
    if (!batchPasteText.trim()) return;
    setBatchParsing(true);
    setBatchErrors([]);
    fetch(`/api/classes/${classId}/ai-parse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('token')}` },
      body: JSON.stringify({ text: batchPasteText }),
    })
    .then(r => r.json())
    .then(resp => {
      if (resp.ok) {
        setBatchParsed(resp.data);
        setBatchAiSource(resp.source || '');
      } else {
        setBatchErrors([resp.error || '識別失敗']);
      }
    })
    .catch((err: any) => {
      setBatchErrors([err.message || '網絡錯誤']);
    })
    .finally(() => setBatchParsing(false));
  }

  const handleBatchEnroll = async () => {
    if (batchParsed.length === 0) return;
    setBatchEnrolling(true);
    setBatchEnrollResult(null);
    try {
      const result = await api.aiEnroll(classId, batchParsed);
      setBatchEnrollResult(result);
    } catch (err: any) {
      setBatchEnrollResult({ enrolled: 0, errors: [err.message || '請求失敗'] });
    } finally {
      setBatchEnrolling(false);
    }
  };

  const openEnrollModal = () => {
    setEnrollSearch('');
    setEnrollResult(null);
    setEnrollPurchase(12);
    setEnrollAmount(cls?.topic_fee || 0);
    setEnrollPayStatus('未繳');
    setNewStudentSurname('');
    setNewStudentGivenName('');
    setNewStudentSchool('');
    setNewStudentPhone('');
    setNewStudentParentPhone('');
    setNewStudentEmail('');
    setNewStudentNote('');
    setNewStudentDseYear(0);
    setShowNewStudent(false);
    setEnrollMode('single');
    setBatchPasteText('');
    setBatchParsed([]);
    setBatchEnrolling(false);
    setBatchEnrollResult(null);
    setBatchAiSource('');
    setShowEnrollModal(true);
  };

  const openTransfer = (enrId: number, sname: string) => {
    setTransferEnrId(enrId);
    setTransferStudentName(sname);
    setTransferCurrentClass(cls?.name || '');
    setTransferTarget(null);
    // Get all classes in the same topic, excluding current class
    const sameTopic = (allClasses || []).filter((c: any) =>
      c.topic_id === cls?.topic_id && c.id !== classId && !c.is_completed
    );
    // Filter out classes the student is already enrolled in
    const enrolledClassIds = new Set((enrollments || []).map((e: any) => e.class_id));
    const available = sameTopic.filter((c: any) => !enrolledClassIds.has(c.id));
    setTransferClassList(available);
    setShowTransferModal(true);
  };

  const handleCreateStudentAndEnroll = () => {
    createStudentAndEnroll.mutate({
      student: {
        surname: newStudentSurname,
        given_name: newStudentGivenName,
        school: newStudentSchool,
        phone: newStudentPhone,
        parent_phone: newStudentParentPhone,
        email: newStudentEmail,
        note: newStudentNote,
        dse_year: newStudentDseYear || null,
      },
      enrollment: { class_id: classId, pay_status: enrollPayStatus, purchase: enrollPurchase, pay_amount: enrollAmount || null },
    });
  };

  // ─── Modal content variable ─────────────────────────────────────────
  const modalContent = enrollMode === 'batch' ? (
    <div className="space-y-3">
      <div>
        <label className="text-sm font-medium text-gray-700 block mb-1">
          貼上學生資料
        </label>
        <p className="text-xs text-gray-400 mb-2">
          從 Excel 複製貼上（tab 分隔欄位：姓、學校、名、電郵、電話、家長電話、DSE年份、備註），有問題再按 AI 糾正
        </p>
        <textarea value={batchPasteText} onChange={e => handleBatchParse(e.target.value)}
          className="w-full min-h-[100px] p-3 border border-gray-300 rounded-xl text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition-colors font-mono"
          placeholder={`陳小明\t皇仁書院\tF.5\t\t91234567\t\t2026\t\n李小華\t喇沙書院\tF.4\t\t98765432\t\t\t\nPoon\t皇仁書院\tWing Yi\t\t91234567\t\t6B\t`} />
        <div className="flex gap-2 mt-2">
          <button onClick={handleBatchAiParse} disabled={!batchPasteText.trim() || batchParsing}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50 transition-colors">
            {batchParsing ? '🤖 識別中...' : '🤖 AI 糾正'}
          </button>
          {batchParsed.length > 0 && (
            <button onClick={() => handleBatchParse('')}
              className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg text-sm">重新輸入</button>
          )}
        </div>
      </div>

      {batchErrors.length > 0 && (
        <div className="text-red-600 text-xs bg-red-50 border border-red-200 rounded-lg p-2.5">
          {batchErrors.map((e: string, i: number) => <div key={i}>⚠️ {e}</div>)}
        </div>
      )}

      {batchParsed.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <h3 className="font-bold text-sm">識別結果</h3>
            {batchAiSource === 'ai' ? (
              <span className="px-2 py-0.5 text-xs bg-purple-100 text-purple-700 rounded-full font-medium">🤖 DeepSeek AI</span>
            ) : batchAiSource === 'regex' ? (
              <span className="px-2 py-0.5 text-xs bg-gray-100 text-gray-600 rounded-full font-medium">⚙️ 正則</span>
            ) : null}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b bg-gray-50">
                  <th className="text-left p-2 text-gray-500 font-medium">#</th>
                  <th className="text-left p-2 text-gray-500 font-medium">姓</th>
                  <th className="text-left p-2 text-gray-500 font-medium">名</th>
                  <th className="text-left p-2 text-gray-500 font-medium">學校</th>
                  <th className="text-left p-2 text-gray-500 font-medium">電郵</th>
                  <th className="text-left p-2 text-gray-500 font-medium">電話</th>
                  <th className="text-left p-2 text-gray-500 font-medium">家長電話</th>
                  <th className="text-left p-2 text-gray-500 font-medium">DSE</th>
                  <th className="text-left p-2 text-gray-500 font-medium">備註</th>
                  <th className="text-center p-2"></th>
                </tr>
              </thead>
              <tbody>
                {batchParsed.map((s: any, i: number) => (
                  <tr key={i} className="border-b hover:bg-gray-50">
                    <td className="p-2 text-gray-400 text-center">{i + 1}</td>
                    <td className="p-2"><input className="w-full px-1.5 py-1 border border-transparent hover:border-gray-300 focus:border-blue-400 rounded text-xs outline-none bg-transparent focus:bg-white" value={s.surname} onChange={e => { const n = [...batchParsed]; n[i] = {...n[i], surname: e.target.value}; setBatchParsed(n); }} /></td>
                    <td className="p-2"><input className="w-full px-1.5 py-1 border border-transparent hover:border-gray-300 focus:border-blue-400 rounded text-xs outline-none bg-transparent focus:bg-white" value={s.given_name} onChange={e => { const n = [...batchParsed]; n[i] = {...n[i], given_name: e.target.value}; setBatchParsed(n); }} /></td>
                    <td className="p-2"><input className="w-full px-1.5 py-1 border border-transparent hover:border-gray-300 focus:border-blue-400 rounded text-xs outline-none bg-transparent focus:bg-white" value={s.school} onChange={e => { const n = [...batchParsed]; n[i] = {...n[i], school: e.target.value}; setBatchParsed(n); }} /></td>
                    <td className="p-2"><input className="w-full px-1.5 py-1 border border-transparent hover:border-gray-300 focus:border-blue-400 rounded text-xs outline-none bg-transparent focus:bg-white" value={s.email || ''} onChange={e => { const n = [...batchParsed]; n[i] = {...n[i], email: e.target.value}; setBatchParsed(n); }} /></td>
                    <td className="p-2"><input className="w-full px-1.5 py-1 border border-transparent hover:border-gray-300 focus:border-blue-400 rounded text-xs outline-none bg-transparent focus:bg-white font-mono" value={s.phone || ''} onChange={e => { const n = [...batchParsed]; n[i] = {...n[i], phone: e.target.value}; setBatchParsed(n); }} /></td>
                    <td className="p-2"><input className="w-full px-1.5 py-1 border border-transparent hover:border-gray-300 focus:border-blue-400 rounded text-xs outline-none bg-transparent focus:bg-white font-mono" value={s.parent_phone || ''} onChange={e => { const n = [...batchParsed]; n[i] = {...n[i], parent_phone: e.target.value}; setBatchParsed(n); }} /></td>
                    <td className="p-2"><input className="w-full px-1.5 py-1 border border-transparent hover:border-gray-300 focus:border-blue-400 rounded text-xs outline-none bg-transparent focus:bg-white font-mono text-center" value={s.dse_year || ''} onChange={e => { const dse = parseInt(e.target.value) || 0; const n = [...batchParsed]; n[i] = {...n[i], dse_year: dse}; setBatchParsed(n); }} /></td>
                    <td className="p-2"><input className="w-full px-1.5 py-1 border border-transparent hover:border-gray-300 focus:border-blue-400 rounded text-xs outline-none bg-transparent focus:bg-white" value={s.note || ''} onChange={e => { const n = [...batchParsed]; n[i] = {...n[i], note: e.target.value}; setBatchParsed(n); }} /></td>
                    <td className="p-2 text-center"><button onClick={() => setBatchParsed(batchParsed.filter((_: any, j: number) => j !== i))} className="text-red-400 hover:text-red-600">✕</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex gap-2 mt-3">
            <button onClick={handleBatchEnroll} disabled={batchParsed.length === 0 || batchEnrolling}
              className="flex items-center gap-2 px-5 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors text-sm">
              {batchEnrolling ? '加入中...' : <>✅ 確認報名 {batchParsed.length} 位學生</>}
            </button>
          </div>
        </div>
      )}

      {batchEnrollResult && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-3 text-sm text-green-800">
          ✅ 成功加入 <strong>{batchEnrollResult.enrolled}</strong> 位學生
          {batchEnrollResult.errors?.length > 0 && (
            <div className="mt-1 text-red-700 text-xs">
              {batchEnrollResult.errors.map((e: string, i: number) => <div key={i}>⚠️ {e}</div>)}
            </div>
          )}
          <button onClick={() => { setShowEnrollModal(false); queryClient.invalidateQueries({ queryKey: ['enrollments', classId] }); }}
            className="mt-2 px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs mr-2">關閉</button>
          <button onClick={() => handleBatchParse('')}
            className="mt-2 px-3 py-1.5 bg-gray-600 text-white rounded-lg text-xs">繼續加入</button>
        </div>
      )}
    </div>
  ) : (
    <>
      {/* ── Step 1: Search or create ── */}
      <div>
        <label className="text-sm font-medium text-gray-700 block mb-1.5">搜尋現有學生</label>
        <input type="text" value={enrollSearch} onChange={e => { setEnrollSearch(e.target.value); setEnrollResult(null); setShowNewStudent(false); }}
          placeholder="輸入姓名、學校或電話..."
          className="w-full px-3 py-2.5 border border-gray-300 rounded-xl text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition-colors"
          autoFocus />
      </div>

      {/* ── Search results ── */}
      {enrollSearch && !enrollResult && searchResults.length > 0 && (
        <div className="space-y-1 max-h-48 overflow-y-auto border border-gray-200 rounded-xl">
          {searchResults.map((s: any) => {
            const alreadyEnrolled = enrolledIds.has(s.id);
            return (
              <button key={s.id}
                onClick={() => {
                  if (!alreadyEnrolled) {
                    setEnrollResult(s);
                    setEnrollSearch(`${s.surname} ${s.given_name}`);
                    // Auto-set fee from topic
                    const topicFee = cls?.topic_fee || 0;
                    setEnrollAmount(topicFee);
                  }
                }}
                disabled={alreadyEnrolled}
                className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors ${
                  alreadyEnrolled ? 'opacity-40 cursor-not-allowed' : 'hover:bg-blue-50'
                } border-b border-gray-100 last:border-b-0`}>
                <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-xs font-bold text-gray-500 shrink-0">
                  {s.surname?.charAt(0) || '?'}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-gray-800">{s.surname} {s.given_name}</div>
                  {s.school && <div className="text-xs text-gray-400 truncate">{s.school}</div>}
                </div>
                {s.phone && <span className="text-xs text-gray-400 font-mono">{s.phone}</span>}
                {alreadyEnrolled ? (
                  <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">已報名</span>
                ) : (
                  <span className="text-blue-600 text-sm font-medium">+ 選擇</span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* ── No results: show "Create new" ── */}
      {enrollSearch && !enrollResult && searchResults.length === 0 && (
        <div className="border border-dashed border-gray-300 rounded-xl p-4 text-center">
          <p className="text-sm text-gray-500 mb-2">找不到「{enrollSearch}」</p>
          <button onClick={() => { setShowNewStudent(true); setNewStudentSurname(enrollSearch); }}
            className="px-4 py-2 bg-blue-50 text-blue-700 rounded-lg text-sm hover:bg-blue-100 transition-colors">
            <Plus size={14} className="inline mr-1" />新增學生
          </button>
        </div>
      )}

      {/* ── New student form ── */}
      {showNewStudent && (
        <div className="border border-blue-200 bg-blue-50/50 rounded-xl p-4 space-y-3">
          <h3 className="text-sm font-semibold text-blue-800">📝 新增學生</h3>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-500 block mb-1">姓氏 *</label>
              <input type="text" value={newStudentSurname} onChange={e => setNewStudentSurname(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:border-blue-400" placeholder="陳" />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">名字 *</label>
              <input type="text" value={newStudentGivenName} onChange={e => setNewStudentGivenName(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:border-blue-400" placeholder="小明" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-500 block mb-1">學校</label>
              <input type="text" value={newStudentSchool} onChange={e => setNewStudentSchool(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:border-blue-400" placeholder="皇仁書院" />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">年級 / DSE年份</label>
              <select value={newStudentDseYear} onChange={e => setNewStudentDseYear(Number(e.target.value))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:border-blue-400 bg-white">
                <option value={0}>揀選年級</option>
                <option value={2026}>F.6 (DSE 2026)</option>
                <option value={2027}>F.5 (DSE 2027)</option>
                <option value={2028}>F.4 (DSE 2028)</option>
                <option value={2029}>F.3 (DSE 2029)</option>
                <option value={2030}>F.2 (DSE 2030)</option>
                <option value={2031}>F.1 (DSE 2031)</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-500 block mb-1">電話</label>
              <input type="text" value={newStudentPhone} onChange={e => setNewStudentPhone(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:border-blue-400 font-mono" placeholder="91234567" />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">家長電話</label>
              <input type="text" value={newStudentParentPhone} onChange={e => setNewStudentParentPhone(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:border-blue-400 font-mono" placeholder="98765432" />
            </div>
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">電郵</label>
            <input type="email" value={newStudentEmail} onChange={e => setNewStudentEmail(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:border-blue-400" placeholder="student@example.com" />
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">備註</label>
            <input type="text" value={newStudentNote} onChange={e => setNewStudentNote(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:border-blue-400" placeholder="任何補充資料" />
          </div>
        </div>
      )}

      {/* ── Step 2: Enrollment options (only when student selected) ── */}
      {enrollResult && (
        <div className="border-t pt-4 space-y-3">
          <h3 className="text-sm font-semibold text-gray-700">📋 報名設定</h3>
          <div className="bg-gray-50 rounded-lg p-3 flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-blue-500 flex items-center justify-center text-white font-bold text-sm">
              {enrollResult.surname?.charAt(0) || '?'}
            </div>
            <div>
              <div className="text-sm font-medium">{enrollResult.surname} {enrollResult.given_name}</div>
              <div className="text-xs text-gray-400">{enrollResult.school || ''} {enrollResult.phone ? `· ${enrollResult.phone}` : ''}</div>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-xs text-gray-500 block mb-1">購買節數</label>
              <input type="number" value={enrollPurchase} onChange={e => setEnrollPurchase(Number(e.target.value))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:border-blue-400" min={1} />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">費用 ($)</label>
              <input type="number" value={enrollAmount} onChange={e => setEnrollAmount(Number(e.target.value))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:border-blue-400" min={0} />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">繳費狀態</label>
              <select value={enrollPayStatus} onChange={e => setEnrollPayStatus(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:border-blue-400 bg-white">
                <option value="未繳">未繳</option>
                <option value="已繳">已繳</option>
                <option value="paid">Paid</option>
              </select>
            </div>
          </div>
        </div>
      )}

      {/* ── Submit ── */}
      <div className="flex justify-end gap-3 pt-2 border-t">
        <button onClick={() => setShowEnrollModal(false)} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg text-sm">取消</button>
        {enrollResult ? (
          <button onClick={handleEnroll} disabled={createEnroll.isPending}
            className="flex items-center gap-2 px-5 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors text-sm">
            {createEnroll.isPending ? '報名中...' : <><Check size={16} /> 確認報名</>}
          </button>
        ) : showNewStudent ? (
          <button onClick={handleCreateStudentAndEnroll} disabled={createStudentAndEnroll.isPending || !newStudentSurname.trim() || !newStudentGivenName.trim()}
            className="flex items-center gap-2 px-5 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors text-sm">
            {createStudentAndEnroll.isPending ? '建立中...' : <><Check size={16} /> 建立並報名</>}
          </button>
        ) : null}
      </div>
    </>
  );

  if (!cls) return <div className="text-gray-500 py-8 text-center">載入中...</div>;

  return (
    <div>
      {/* ═══ Header ═══ */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Link to="/classes" className="p-2 hover:bg-gray-100 rounded"><ArrowLeft size={20} /></Link>
          <div>
            <h1 className="text-2xl font-bold">🏫 {cls.name || '(未命名)'}</h1>
            <div className="flex items-center gap-3 mt-1 text-sm text-gray-500">
              <span className="flex items-center gap-1"><Calendar size={14} />{cls.week || ''}</span>
              <span className="flex items-center gap-1"><Users size={14} />{(enrollments || []).length} 學員</span>
              <span className="flex items-center gap-1"><BarChart3 size={14} />{totalLessons} 課 · {pastLessons}/{totalLessons} 已完成</span>
            </div>
          </div>
        </div>
      </div>

      {/* ═══ Tabs ═══ */}
      <div className="flex gap-2 mb-4 border-b border-gray-200 pb-2">
        {(['lessons', 'students', 'attendance', 'homework'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              tab === t ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            {t === 'lessons' ? '📅 課節' : t === 'students' ? '👤 學員' : t === 'attendance' ? '✅ 出席表' : '📋 功課概覽'}
          </button>
        ))}
      </div>

      {/* ═══════════════════ Lessons Tab ═══════════════════ */}
      {tab === 'lessons' && (
        <div>
          <div className="grid grid-cols-4 gap-3 mb-4">
            <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
              <div className="text-xs text-gray-500 mb-1">總課節</div>
              <div className="text-2xl font-bold text-gray-800">{totalLessons}</div>
            </div>
            <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
              <div className="text-xs text-gray-500 mb-1">已完成</div>
              <div className="text-2xl font-bold text-green-600">{pastLessons}</div>
            </div>
            <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
              <div className="text-xs text-gray-500 mb-1">剩餘</div>
              <div className="text-2xl font-bold text-blue-600">{totalLessons - pastLessons}</div>
            </div>
            <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
              <div className="text-xs text-gray-500 mb-1">完成率</div>
              <div className="text-2xl font-bold text-amber-600">
                {totalLessons > 0 ? Math.round(pastLessons / totalLessons * 100) : 0}%
              </div>
            </div>
          </div>

          {totalLessons > 0 && (
            <div className="w-full bg-gray-100 rounded-full h-2 mb-4 overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-blue-500 to-green-500 rounded-full transition-all duration-500"
                style={{ width: `${pastLessons / totalLessons * 100}%` }}
              />
            </div>
          )}

          <div className="bg-white rounded-xl shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
              <h3 className="font-bold text-gray-800">📅 課節時間表</h3>
              <span className="text-xs text-gray-400">點擊日期/時間直接修改</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b">
                    <th className="text-left p-3 text-gray-500 font-medium w-12">#</th>
                    <th className="text-left p-3 text-gray-500 font-medium">日期</th>
                    <th className="text-left p-3 text-gray-500 font-medium">時間</th>
                    <th className="text-center p-3 text-gray-500 font-medium">出席統計</th>
                    <th className="text-center p-3 text-gray-500 font-medium">狀態</th>
                  </tr>
                </thead>
                <tbody>
                  {(lessons || []).map((l: any) => {
                    const stats = lessonStats[l.id];
                    const isPast = l.date && l.date <= today;
                    const isToday = l.date === today;
                    const attendanceRate = stats && stats.total > 0 ? Math.round(stats.present / stats.total * 100) : 0;

                    return (
                      <tr key={l.id} className={`border-b hover:bg-gray-50 transition-colors ${isToday ? 'bg-blue-50/50' : ''} ${!isPast && !isToday ? 'opacity-70' : ''}`}>
                        <td className="p-3 font-mono text-gray-400 text-xs">{String(l.num).padStart(2, '0')}</td>
                        <td className="p-3">
                          {isEditing(l.id, 'date') ? (
                            <input type="date" value={editVal}
                              onChange={e => setEditVal(e.target.value)}
                              onBlur={saveEdit}
                              onKeyDown={e => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') setEditing(null); }}
                              className="w-28 px-1.5 py-1 border border-blue-400 rounded text-sm outline-none focus:ring-2 focus:ring-blue-200" autoFocus />
                          ) : (
                            <span onClick={() => startEdit(l.id, 'date', l.date || '')}
                              className={`cursor-pointer hover:bg-blue-50 px-1.5 py-1 -ml-1.5 rounded transition-colors inline-flex items-center gap-1 ${isToday ? 'text-blue-700 font-medium' : ''}`}>
                              {isToday && <span className="w-1.5 h-1.5 bg-blue-500 rounded-full" />}
                              {l.date || <span className="text-gray-300">—</span>}
                            </span>
                          )}
                        </td>
                        <td className="p-3">
                          <span className="inline-flex items-center gap-1">
                            {isEditing(l.id, 'start') ? (
                              <input type="time" value={editVal}
                                onChange={e => setEditVal(e.target.value)}
                                onBlur={saveEdit}
                                onKeyDown={e => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') setEditing(null); }}
                                className="w-20 px-1.5 py-1 border border-blue-400 rounded text-sm outline-none focus:ring-2 focus:ring-blue-200" autoFocus />
                            ) : (
                              <span onClick={() => startEdit(l.id, 'start', l.start || '')}
                                className="cursor-pointer hover:bg-blue-50 px-1.5 py-1 -ml-1.5 rounded transition-colors">
                                {l.start || <span className="text-gray-300">—</span>}
                              </span>
                            )}
                            <span className="text-gray-300">—</span>
                            {isEditing(l.id, 'end') ? (
                              <input type="time" value={editVal}
                                onChange={e => setEditVal(e.target.value)}
                                onBlur={saveEdit}
                                onKeyDown={e => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') setEditing(null); }}
                                className="w-20 px-1.5 py-1 border border-blue-400 rounded text-sm outline-none focus:ring-2 focus:ring-blue-200" autoFocus />
                            ) : (
                              <span onClick={() => startEdit(l.id, 'end', l.end || '')}
                                className="cursor-pointer hover:bg-blue-50 px-1.5 py-1 -ml-1.5 rounded transition-colors">
                                {l.end || <span className="text-gray-300">—</span>}
                              </span>
                            )}
                          </span>
                        </td>
                        <td className="p-3">
                          {stats ? (
                            <div className="flex items-center justify-center gap-3 text-xs">
                              <span className="flex items-center gap-1 text-green-600"><UserCheck size={13} />{stats.present}</span>
                              <span className="flex items-center gap-1 text-blue-600"><Clock3 size={13} />{stats.leave}</span>
                              <span className="flex items-center gap-1 text-red-600"><UserX size={13} />{stats.absent}</span>
                              <span className={`ml-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${
                                attendanceRate >= 80 ? 'bg-green-100 text-green-700' :
                                attendanceRate >= 50 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}`}>{attendanceRate}%</span>
                            </div>
                          ) : <span className="text-gray-300 text-xs">—</span>}
                        </td>
                        <td className="p-3 text-center">
                          {isPast ? <span className="text-xs text-green-600 bg-green-50 px-2 py-0.5 rounded-full">已完成</span>
                          : isToday ? <span className="text-xs text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">今日</span>
                          : <span className="text-xs text-gray-400 bg-gray-50 px-2 py-0.5 rounded-full">未開始</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════ Students Tab ═══════════════════ */}
      {tab === 'students' && (
        <div>
          {/* Top bar */}
          <div className="flex items-center gap-3 mb-4">
            <div className="relative flex-1">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input type="text" value={studentSearch} onChange={e => setStudentSearch(e.target.value)}
                placeholder="搜尋學生姓名或學校..."
                className="w-full pl-9 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition-colors" />
            </div>
            <button onClick={openEnrollModal}
              className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors shadow-sm">
              <Plus size={18} /> 加入學員
            </button>
          </div>

          {/* ⏳ 候補中學生 */}
          {(() => { const waiting = (checkinData?.standby || []).filter((sb: any) => sb.status === 'waiting'); return waiting.length > 0 && (
            <div className="mb-6 p-4 bg-amber-50 rounded-xl border border-amber-200">
              <h4 className="text-sm font-bold text-amber-800 mb-2 flex items-center justify-between">
                <span className="flex items-center gap-2"><AlertCircle size={16} /> 候補中學生（{waiting.length} 人）</span>
              </h4>
              {(() => {
                const capacity = cls?.seat || 0;
                if (!capacity) return null;
                const enrolled = (enrollments || []).length;
                const available = capacity - enrolled;
                return (
                  <div className="mb-3 px-3 py-2 bg-white/80 rounded-lg border border-amber-200/60">
                    <div className="text-xs text-gray-500 mb-1 font-medium">🪑 班級容量</div>
                    <div className="text-[11px] text-gray-600 leading-relaxed">
                      座位上限 <span className="font-semibold text-gray-800">{capacity}</span>
                      <span className="text-gray-400"> — </span>
                      已報名 <span className="font-semibold text-gray-800">{enrolled}</span>
                    </div>
                    <div className={`mt-1.5 text-xs font-bold ${available > 0 ? 'text-green-700' : 'text-red-600'}`}>
                      = <span className="text-sm">{available}</span> 個可用座位
                      {available > 0 ? ' ✅ 可確認新學生' : ' 🈵 無法再確認'}
                    </div>
                    <div className="mt-1 text-[10px] text-gray-400">
                      ℹ️ 每課實際可用座位需考慮請假、補課、候補等，出席表內可見課節詳情
                    </div>
                  </div>
                );
              })()}
              <div className="space-y-2">
                {(() => {
                  const enrolled = (enrollments || []).length;
                  const capacity = cls?.seat || 0;
                  const left = capacity > 0 ? capacity - enrolled : 0;
                  return waiting.map((sb: any) => {
                    const s = studentMap.get(sb.student_id);
                    const sn = s ? `${s.surname} ${s.given_name}` : '---';
                    const school = s?.school || '';
                    const phone = s?.phone || '';
                    const email = s?.email || '';
                    const noSeat = capacity > 0 && left <= 0;
                    return (
                      <div key={sb.id} className={`flex items-start gap-3 bg-white px-4 py-3 rounded-lg border ${noSeat ? 'border-gray-200 opacity-60' : 'border-amber-300'}`}>
                        <div className="w-9 h-9 rounded-full bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center text-white font-bold text-sm shrink-0 mt-0.5">
                          {sn.charAt(0)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <div className="font-medium text-gray-800">{sn}</div>
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-100 text-amber-700 shrink-0 whitespace-nowrap">
                              🕐 {sb.trigger_time}
                            </span>
                          </div>
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-0.5 text-xs text-gray-400">
                            {school && <span>{school}</span>}
                            {phone && <span>📞 {phone}</span>}
                            {email && <span>✉️ {email}</span>}
                          </div>
                        </div>
                        <div className="shrink-0 mt-0.5">
                          {noSeat ? (
                            <div className="flex flex-col items-end gap-1">
                              <span className="text-[10px] font-semibold text-red-500">🈵 滿額</span>
                              <span className="inline-block px-3 py-1.5 rounded text-xs font-medium bg-gray-100 text-gray-400 border border-gray-200">無法確認</span>
                            </div>
                          ) : (
                            <button onClick={() => confirmStandby(sb.student_id, sb.id)}
                              className="px-3 py-1.5 rounded-lg text-xs font-bold bg-green-600 text-white hover:bg-green-700 transition-colors whitespace-nowrap shadow-sm">
                              確認報名
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  });
                })()}
              </div>
            </div>
          )})()}

          {/* Student cards */}
          <div className="space-y-2">
            {(enrollments || []).filter((e: any) => {
              if (!studentSearch) return true;
              const s = studentMap.get(e.student_id);
              const name = s ? `${s.surname} ${s.given_name}` : '';
              const school = s?.school || '';
              return name.includes(studentSearch) || school.includes(studentSearch);
            }).map((e: any) => {
              const student = studentMap.get(e.student_id);
              const name = student ? `${student.surname} ${student.given_name}` : '---';
              const phone = student?.phone || '';
              const paid = e.pay_status === 'paid' || e.pay_status === '已繳';
              const att = studentAttendance.get(e.student_id);
              const attRate = att && att.total > 0 ? Math.round(att.present / att.total * 100) : 0;
              const daysLeft = e.remaining || 0;

              return (
                <div key={e.id} className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 hover:shadow-md transition-shadow">
                  <div className="flex items-start gap-4">
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center text-white font-bold text-sm shrink-0">
                      {student?.surname?.charAt(0) || '?'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Link to={`/student/${e.student_id}`} className="font-semibold text-gray-800 hover:text-blue-600 transition-colors">{name}</Link>
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${paid ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                          {paid ? '✅ 已繳' : '❌ 未繳'}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1.5 text-xs text-gray-500">
                        {student?.school && <span className="flex items-center gap-1"><School size={12} />{student?.school}</span>}
                        {phone && <span className="flex items-center gap-1"><Phone size={12} />{phone}</span>}
                        {student?.email && <span className="flex items-center gap-1"><Mail size={12} />{student.email}</span>}
                      </div>
                      <div className="flex items-center gap-4 mt-2">
                        <div className="flex-1">
                          <div className="flex items-center justify-between text-[10px] text-gray-400 mb-1">
                            <span>出席率</span>
                            <span className={attRate >= 80 ? 'text-green-600' : attRate >= 50 ? 'text-amber-600' : 'text-red-600'}>
                              {att?.present || 0}/{att?.total || 0} ({attRate}%)
                            </span>
                          </div>
                          <div className="w-full bg-gray-100 rounded-full h-1.5">
                            <div className={`h-full rounded-full ${attRate >= 80 ? 'bg-green-500' : attRate >= 50 ? 'bg-amber-500' : 'bg-red-500'}`}
                              style={{ width: `${attRate}%` }} />
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="text-[10px] text-gray-400">課堂</div>
                          <div className="text-sm font-semibold text-gray-700">{e.used || 0}/{e.purchase || 0}</div>
                          <div className="text-[10px] text-gray-400">剩 {daysLeft}</div>
                        </div>
                        <Link to={`/student/${e.student_id}`} className="p-2 text-gray-300 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors" title="查看學生詳情">
                          <ExternalLink size={16} />
                        </Link>
                        <button onClick={() => openTransfer(e.id, name)}
                          className="p-2 text-gray-300 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-colors text-xs font-medium"
                          title="調班">
                          🔄
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {(!enrollments || enrollments.length === 0) && (
            <div className="text-center py-12 bg-white rounded-xl shadow-sm border border-gray-100">
              <Users size={40} className="mx-auto text-gray-300 mb-3" />
              <p className="text-gray-400 mb-3">暫無學員</p>
              <button onClick={openEnrollModal} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">
                <Plus size={16} className="inline mr-1" />加入第一個學員
              </button>
            </div>
          )}

          {(() => {
            const searchFiltered = studentSearch ? (enrollments || []).filter((e: any) => {
              const s = studentMap.get(e.student_id);
              const name = s ? `${s.surname} ${s.given_name}` : '';
              const school = s?.school || '';
              return name.includes(studentSearch) || school.includes(studentSearch);
            }) : [];
            return studentSearch && searchFiltered.length === 0 && (
              <div className="text-center py-8 text-gray-400 text-sm">無相符結果</div>
            );
          })()}
        </div>
      )}

      {/* ═══════════════════ Attendance Tab ═══════════════════ */}
      {tab === 'attendance' && (
        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-200 bg-gradient-to-r from-gray-50 to-white flex items-center justify-between">
            <h3 className="font-bold">✅ 出席表</h3>
            <span className="text-xs text-gray-400">點擊 cell 可修改狀態 / 安排補課</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm" style={{ minWidth: `${(lessons?.length || 1) * 80 + 220}px` }}>
              <thead>
                <tr className="border-b bg-gray-50">
                  <th className="text-left p-3 sticky left-0 bg-gray-50 z-10 font-semibold text-gray-600">學生 / 學校</th>
                  {(lessons || []).map((l: any) => (
                    <th key={l.id} className="text-center p-2 text-xs min-w-[72px]">
                      第{l.num}課<br /><span className="text-gray-400">{l.date ? l.date.slice(5) : ''}</span>
                      {cls?.week && <span className="block text-gray-500">{cls.week}</span>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(enrollments || []).map((e: any) => {
                  const student = studentMap.get(e.student_id);
                  const name = student ? `${student.surname} ${student.given_name}` : '---';
                  const school = student?.school || '';
                  return (
                    <tr key={e.id} className="border-b hover:bg-gray-50">
                      <td className="p-2.5 sticky left-0 bg-white z-10 whitespace-nowrap border-r border-gray-100">
                        <div className="font-medium text-gray-800">{name}</div>
                        {school && <div className="text-[10px] text-gray-400">{school}</div>}
                      </td>
                      {(lessons || []).map((l: any) => {
                        const att = checkinMap.get(`${e.student_id}_${l.id}`) || '';
                        const ctime = checkinTimeMap.get(`${e.student_id}_${l.id}`) || '';
                        const mk = makeupMap.get(`${e.student_id}_${l.num}`) || '';
                        const blocked = blockedMap.get(`${e.student_id}_${l.id}`) || false;
                        const label = statusLabel(att);
                        return (
                          <td key={l.id} className={`text-center p-1 align-middle ${blocked ? 'cursor-not-allowed' : 'cursor-pointer'} ${label.bg}`}
                            onClick={() => !blocked && openMenu(e.id, e.student_id, l.num, l.id, name, att)}>
                            <span className={`inline-block px-2 py-1 rounded text-xs font-medium ${label.fg} ${!blocked && !att && !mk ? 'border border-dashed border-yellow-300' : ''}`}>
                              {label.text}
                              {ctime && att === 'present' && <span className="block text-[9px] opacity-60 mt-0.5">{ctime}</span>}
                            </span>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {(!enrollments || enrollments.length === 0) && (
              <div className="text-center py-8 text-gray-400 text-sm">暫無學員</div>
            )}
          </div>

          <div className="px-4 py-2.5 border-t border-gray-100 bg-gray-50 text-[10px] text-gray-400 flex flex-wrap gap-x-4 gap-y-1">
            <span>✅課堂教學出席</span><span>✅課堂補堂出席</span><span>✅課室錄播出席</span>
            <span>✅線上錄播出席</span><span>📋請假待安排</span><span>❌缺勤待安排</span>
            <span>⌛️課室錄播待補</span><span>⌛️線上錄播待補</span><span>⌛️課堂教學待補</span>
            <span>‼️課堂教學候補</span><span>🟡未處理</span><span>🔒未完成</span>
          </div>
        </div>
      )}

      {/* ═══════════════════ Homework Tab ═══════════════════ */}
      {tab === 'homework' && (
        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          <div className="px-4 py-2.5 bg-gradient-to-r from-amber-50 to-white border-b border-amber-100">
            <h3 className="font-bold text-amber-800">📋 功課概覽 <span className="text-xs text-amber-500 font-normal ml-2">已交 ✅ / 未交 ❌</span></h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm" style={{ minWidth: `${(lessons?.length || 1) * 72 + 220}px` }}>
              <thead>
                <tr className="border-b bg-amber-50/50">
                  <th className="text-left p-2.5 sticky left-0 bg-amber-50/50 z-10 font-semibold text-amber-700">學生</th>
                  {(lessons || []).map((l: any) => (
                    <th key={l.id} className="text-center p-2 text-xs min-w-[68px] text-amber-700">
                      第{l.num}課
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(enrollments || []).map((e: any) => {
                  const student = studentMap.get(e.student_id);
                  const name = student ? `${student.surname} ${student.given_name}` : '---';
                  const totalHw = (lessons || []).length;
                  const doneHw = (lessons || []).filter((l: any) => {
                    const c = (checkinData?.checkins || []).find(
                      (c: any) => c.student_id === e.student_id && c.lesson_id === l.id
                    );
                    return c ? c.homework_done !== false : true;
                  }).length;
                  return (
                    <tr key={e.id} className="border-b hover:bg-amber-50/30">
                      {/* ⭐ 學生欄 — 跟出席表一樣的樣式 */}
                      <td className="p-2.5 sticky left-0 bg-white z-10 whitespace-nowrap border-r border-amber-100">
                        <div className="font-medium text-gray-800">{name}</div>
                        {student?.school && <div className="text-[10px] text-gray-400">{student.school}</div>}
                        <span className={`inline-block mt-1 text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                          doneHw === totalHw ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
                        }`}>{doneHw}/{totalHw}</span>
                      </td>
                      {(lessons || []).map((l: any) => {
                        const c = (checkinData?.checkins || []).find(
                          (c: any) => c.student_id === e.student_id && c.lesson_id === l.id
                        );
                        const done = c ? c.homework_done !== false : true;
                        return (
                          <td key={l.id} className="text-center p-2 align-middle">
                            <button
                              onClick={() => toggleHw.mutate({ lessonId: l.id, studentId: e.student_id, done: !done })}
                              disabled={toggleHw.isPending}
                              className={`inline-block text-xs transition-colors ${
                                done ? 'text-green-600 hover:text-green-800' : 'text-red-400 hover:text-red-600'
                              } disabled:opacity-50`}
                            >
                              {done ? '✅' : '❌'}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {(!enrollments || enrollments.length === 0) && (
              <div className="text-center py-8 text-gray-400 text-sm">暫無學員</div>
            )}
          </div>
        </div>
      )}

      {/* ═══════════════════ Enroll Modal ═══════════════════ */}
      {showEnrollModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-start justify-center pt-[10vh]" onClick={() => setShowEnrollModal(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg mx-4 overflow-hidden" onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <h2 className="text-lg font-bold">➕ 加入學員 — {cls?.name}</h2>
              <button onClick={() => setShowEnrollModal(false)} className="p-1 text-gray-400 hover:bg-gray-100 rounded"><X size={20} /></button>
            </div>

            {/* Mode toggle */}
            <div className="px-5 pt-4 flex gap-2">
              <button onClick={() => setEnrollMode('single')}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${enrollMode === 'single' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                單個加入
              </button>
              <button onClick={() => setEnrollMode('batch')}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${enrollMode === 'batch' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                批量貼上
              </button>
            </div>

            <div className="p-5 space-y-4">
              {modalContent}
            </div>
          </div>
        </div>
      )}

      {/* ═══ Transfer Modal ═══ */}
      {showTransferModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-start justify-center pt-[10vh]" onClick={() => setShowTransferModal(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg mx-4 overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <h2 className="text-lg font-bold">🔄 調班</h2>
              <button onClick={() => setShowTransferModal(false)} className="p-1 text-gray-400 hover:bg-gray-100 rounded"><X size={20} /></button>
            </div>
            <div className="p-5 space-y-4">
              <div className="bg-gray-50 rounded-lg p-3">
                <div className="text-sm font-medium text-gray-800">{transferStudentName}</div>
                <div className="text-xs text-gray-500 mt-0.5">
                  目前班級：<strong>{transferCurrentClass}</strong>
                </div>
              </div>

              {transferClassList.length === 0 ? (
                <div className="text-center py-8 text-gray-400 text-sm">
                  此主題下沒有其他可調入嘅班級
                </div>
              ) : (
                <div>
                  <label className="text-sm font-medium text-gray-700 block mb-2">選擇目標班級</label>
                  <div className="space-y-2 max-h-60 overflow-y-auto">
                    {transferClassList.map((c: any) => {
                      const selected = transferTarget === c.id;
                      return (
                        <button key={c.id} onClick={() => setTransferTarget(c.id)}
                          className={`w-full flex items-center gap-3 p-3 rounded-lg border text-left text-sm transition-colors ${
                            selected ? 'border-amber-500 bg-amber-50' : 'border-gray-200 hover:bg-gray-50'
                          }`}>
                          <span className="text-lg">{selected ? '🔘' : '○'}</span>
                          <div className="flex-1">
                            <div className="font-medium text-gray-800">{c.name || '(未命名)'}</div>
                            <div className="text-xs text-gray-400 mt-0.5">{c.week} · {c.seat || 0}位</div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-3 pt-2 border-t">
                <button onClick={() => setShowTransferModal(false)} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg text-sm">取消</button>
                <button onClick={() => transferTarget && transferEnroll.mutate({ id: transferEnrId, newClassId: transferTarget })}
                  disabled={!transferTarget || transferEnroll.isPending}
                  className="flex items-center gap-2 px-5 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50 transition-colors text-sm">
                  {transferEnroll.isPending ? '調班中...' : '🔄 確認調班'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══ Detail Modal ═══ */}
      {detail && (
        <ModalOverlay onClose={() => { setDetail(null); setMenu({ ...menu, show: false }); }}>
          <h3 className="font-bold mb-3">{detail.student_name} · {detail.lesson_label}</h3>
          <div className="space-y-2 text-sm mb-4">
            <div className="grid grid-cols-[80px_1fr] gap-1 p-3 bg-gray-50 rounded-lg">
              <span className="text-gray-500">狀態</span>
              <span><span className={`px-2 py-0.5 rounded text-xs font-medium ${statusLabel(detail.status).bg} ${statusLabel(detail.status).fg}`}>{statusLabel(detail.status).text}</span></span>
              <span className="text-gray-500">日期</span><span>{detail.lesson_date || '—'}</span>
              <span className="text-gray-500">簽到</span><span>{detail.checkin_time || '—'}</span>
            </div>
            <div>
              <p className="font-medium text-gray-600 text-xs mb-2">⚡ 操作</p>
              <div className="grid grid-cols-2 gap-2">
                <button onClick={() => setStatus('present')} className="px-3 py-2 bg-green-100 text-green-700 rounded-lg text-sm hover:bg-green-200">課堂出席</button>
                <button onClick={() => setStatus('leave')} className="px-3 py-2 bg-blue-100 text-blue-700 rounded-lg text-sm hover:bg-blue-200">📋 請假</button>
                <button onClick={openMakeup} className="px-3 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">🔄 安排補課</button>
                <button onClick={() => setStatus('absent')} className="px-3 py-2 bg-red-100 text-red-700 rounded-lg text-sm hover:bg-red-200">❌ 缺勤</button>
                {detail.status && (
                  <button onClick={() => setStatus('')} className="col-span-2 px-3 py-2 bg-yellow-100 text-yellow-700 rounded-lg text-sm hover:bg-yellow-200 border border-dashed border-yellow-300">
                    🔄 改回未處理
                  </button>
                )}
              </div>
            </div>
            {(detail.student_checkins?.length > 0 || detail.student_makeups?.length > 0 || detail.student_standby?.length > 0) && (
              <div className="border-t pt-3 mt-2 max-h-48 overflow-y-auto space-y-2">
                <p className="font-medium text-gray-600 text-xs">📋 {detail.student_name} · 第{detail.lesson_num}課</p>
                {detail.student_checkins?.map((c: any, i: number) => (
                  <div key={`ci-${i}`} className="flex items-center justify-between py-1 px-2 bg-white rounded border text-xs">
                    <span className="text-gray-700">{c.lesson_label}<span className="text-gray-400 ml-1">{c.lesson_date ? `(${c.lesson_date})` : ''}</span></span>
                    <span><span className={`px-1.5 py-0.5 rounded ${statusLabel(c.status).bg} ${statusLabel(c.status).fg}`}>{statusLabel(c.status).text}</span></span>
                  </div>
                ))}
                {detail.student_makeups?.map((mk: any, i: number) => {
                  const mkTypeLabel: Record<string, string> = { '課室補課': '🏫', '線上錄播': '🎥', '課室錄播': '📹' };
                  const mkStatusLabel: Record<string, string> = { 'waiting': '⏳ 候補', 'scheduled': '📅 已安排', 'done': '✅ 完成' };
                  return (
                    <div key={`mk-${i}`} className="flex items-center justify-between py-1 px-2 bg-orange-50 rounded border text-xs border-orange-200">
                      <span><span className="mr-1">{mkTypeLabel[mk.makeup_type] || '🔄'}</span><span className="text-gray-700">{mk.lesson_label} {mk.makeup_class ? `→ ${mk.makeup_class}` : ''}</span></span>
                      <span className={mk.status === 'done' ? 'text-green-700' : mk.status === 'scheduled' ? 'text-blue-700' : 'text-amber-700'}>{mkStatusLabel[mk.status] || mk.status}</span>
                    </div>
                  );
                })}
                {detail.student_standby?.map((sb: any, i: number) => (
                  <div key={`sb-${i}`} className="flex items-center justify-between py-1 px-2 bg-yellow-50 rounded border text-xs border-yellow-200">
                    <span className="text-gray-700">⏳ 候補</span>
                    <span className="text-gray-500">{sb.trigger_time || '—'}</span>
                  </div>
                ))}
              </div>
            )}
            {detail.change_logs?.length > 0 && (
              <div className="border-t pt-3 mt-2 space-y-1">
                <p className="font-medium text-gray-600 text-xs mb-1.5">📝 變更記錄</p>
                {detail.change_logs.map((lg: any, i: number) => {
                  const time = lg.created_at?.slice(11, 19) || '';
                  return (
                    <div key={i} className="flex items-center justify-between py-1 px-2 bg-white rounded border text-xs">
                      <span>
                        <span className={`px-1 py-0.5 rounded line-through opacity-60 ${statusLabel(lg.old_status).bg} ${statusLabel(lg.old_status).fg}`}>{statusLabel(lg.old_status).text}</span>
                        <span className="text-gray-300 mx-1">→</span>
                        <span className={`px-1 py-0.5 rounded ${statusLabel(lg.new_status).bg} ${statusLabel(lg.new_status).fg}`}>{statusLabel(lg.new_status).text}</span>
                      </span>
                      <span className="text-gray-400 text-[10px]">{time}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          <div className="flex justify-end">
            <button onClick={() => { setDetail(null); }} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg text-sm">關閉</button>
          </div>
        </ModalOverlay>
      )}

      {/* ═══ Makeup Modal ═══ */}
      {showMkModal && (
        <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center p-4" onClick={() => setShowMkModal(false)}>
          <div className="bg-white rounded-xl shadow-xl p-6 max-w-lg w-full mx-4 max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold mb-4">🔄 安排補課</h3>
            <div className="space-y-4 text-sm">
              <p className="text-gray-500"><strong>學生：</strong>{menu.sname} &nbsp;|&nbsp; <strong>班級：</strong>{cls?.name} &nbsp;|&nbsp; <strong>課節：</strong>第{mkForm.lesson_num}課</p>
              <div>
                <label className="font-medium text-gray-600 text-xs block mb-2">補課類型</label>
                <div className="flex gap-2">
                  {(['課室補課', '線上錄播', '課室錄播'] as const).map(t => (
                    <button key={t} onClick={() => { setMkForm({...mkForm, makeup_type: t, makeup_class: '', status: t === '課室補課' ? 'waiting' : 'scheduled'}); setSelectedAvLesson(null); }}
                      className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${mkForm.makeup_type === t ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-50'}`}>
                      {t === '課室補課' ? '🏫 課堂' : t === '線上錄播' ? '🎥 線上' : '📹 課室錄播'}
                    </button>
                  ))}
                </div>
              </div>
              {mkForm.makeup_type === '課室補課' && (
                <div>
                  <label className="font-medium text-gray-600 text-xs block mb-2">🎯 選擇同 Topic 班級的第 {mkForm.lesson_num} 課</label>
                  {avLessons.length === 0 ? (
                    <div className="text-gray-400 text-center py-4 bg-gray-50 rounded-lg">暫無其他同 Topic 班級有第 {mkForm.lesson_num} 課</div>
                  ) : (
                    <div className="space-y-2 max-h-60 overflow-y-auto">
                      {avLessons.map((l: any) => (
                        <div key={l.lessonId} onClick={() => setSelectedAvLesson(l)}
                          className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer text-sm ${selectedAvLesson?.lessonId === l.lessonId ? 'border-green-500 bg-green-50' : 'border-gray-200 hover:bg-gray-50'}`}>
                          <span className="text-lg">{selectedAvLesson?.lessonId === l.lessonId ? '🔘' : '○'}</span>
                          <div className="flex-1">
                            <strong>{l.className}</strong><span className="text-gray-400 text-xs ml-2">{l.week}</span>
                            <div className="text-xs text-gray-400 mt-0.5">第{l.lessonNum}課 · {l.lessonDate ?? '—'} · {l.time}</div>
                            <div className="text-xs text-gray-400 mt-0.5">
                              容量 {l.seat} − 已報 {l.enrolled}
                              {l.leave > 0 && <span className="text-green-600"> + 請假 {l.leave}</span>}
                              {l.blocked > 0 && <span className="text-orange-500"> + 封鎖 {l.blocked}</span>}
                              {l.pending > 0 && <span className="text-red-500"> − 另有安排 {l.pending}</span>}
                              {l.waiting > 0 && <span className="text-amber-500"> − 候補 {l.waiting}</span>}
                              <span className="font-medium ml-1">= <span className={l.available > 0 ? 'text-green-600' : 'text-red-500'}>{l.available}</span></span>
                            </div>
                          </div>
                          {l.full ? <span className="text-amber-600 text-xs">⏳ {l.seatText}</span> : <span className="text-green-600 text-xs">{l.seatText}</span>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {(mkForm.makeup_type === '線上錄播' || mkForm.makeup_type === '課室錄播') && (
                <div className="bg-purple-50 border border-purple-200 rounded-lg p-3 text-xs text-purple-700">
                  🎥 系統會自動加入「補課錄播班」並設為已安排。
                </div>
              )}
              <div className="flex justify-end gap-3 pt-2">
                <button onClick={() => setShowMkModal(false)} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg text-sm">取消</button>
                <button onClick={submitMakeup} disabled={mkForm.makeup_type === '課室補課' && !selectedAvLesson}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40 text-sm">✅ 確定安排</button>
              </div>
            </div>
          </div>
        </div>
      )}


    </div>
  );
}

// ─── Reusable ─────────────────────────────────────────────────────────

function ModalOverlay({ children, onClose, wide }: { children: React.ReactNode; onClose: () => void; wide?: boolean }) {
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className={`bg-white rounded-xl p-6 mx-4 shadow-xl max-h-[90vh] overflow-y-auto ${wide ? 'w-full max-w-5xl' : 'w-full max-w-lg'}`} onClick={e => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}