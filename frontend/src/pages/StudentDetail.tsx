import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { ArrowLeft, Plus, ShoppingCart } from 'lucide-react';
import { useState } from 'react';

// ─── Cell label helpers (same legend as ClassDetail) ────────────────────

function cellLabel(att: string, blocked: boolean) {
  if (blocked) return { text: '🔒未完成', bg: 'bg-gray-100', fg: 'text-gray-400' };
  switch (att) {
    case 'present':                  return { text: '✅課堂教學出席', bg: 'bg-green-50', fg: 'text-green-700' };
    case 'makeup':                   return { text: '✅課堂補堂出席', bg: 'bg-green-50', fg: 'text-green-700' };
    case 'recording_room_present':   return { text: '✅課室錄播出席', bg: 'bg-emerald-50', fg: 'text-emerald-700' };
    case 'video_makeup':             return { text: '✅線上錄播出席', bg: 'bg-purple-50', fg: 'text-purple-700' };
    case 'leave':                    return { text: '📋請假待安排', bg: 'bg-blue-50', fg: 'text-blue-700' };
    case 'absent':                   return { text: '❌缺勤待安排', bg: 'bg-red-50', fg: 'text-red-700' };
    case 'scheduled_room':           return { text: '⌛️課室錄播待補', bg: 'bg-amber-50', fg: 'text-amber-700' };
    case 'scheduled_video':          return { text: '⌛️線上錄播待補', bg: 'bg-purple-50', fg: 'text-purple-700' };
    case 'scheduled_classroom':      return { text: '⌛️課堂教學待補', bg: 'bg-amber-50', fg: 'text-amber-700' };
    case 'waiting':                  return { text: '‼️課堂教學候補', bg: 'bg-red-50 border border-red-300', fg: 'text-red-700 font-bold' };
    default:                         return { text: '🟡未處理', bg: '', fg: 'text-yellow-600' };
  }
}

export default function StudentDetail() {
  const { id } = useParams<{ id: string }>();
  const studentId = Number(id);

  const { data, isLoading } = useQuery({
    queryKey: ['student-detail', studentId],
    queryFn: () => api.get<any>(`/students/${studentId}/detail`),
  });

  const student = data?.student;
  const enrollments: any[] = data?.enrollments || [];

  // ─── Invoices ─────────────────────────────────────────────────────
  const { data: invoiceData } = useQuery({
    queryKey: ['invoices', studentId],
    queryFn: () => api.get<any>(`/students/${studentId}/invoices`),
    enabled: !!studentId,
  });
  const invoices: any[] = invoiceData?.data || [];
  const queryClient = useQueryClient();

  const [showForm, setShowForm] = useState<number | null>(null);
  const [invAmount, setInvAmount] = useState('');
  const [invType, setInvType] = useState('tuition');
  const [invMakeupFee, setInvMakeupFee] = useState('0');
  const [invNote, setInvNote] = useState('');

  const createInvoice = useMutation({
    mutationFn: (data: any) => api.post('/invoices', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoices', studentId] });
      setShowForm(null);
      setInvAmount('');
      setInvNote('');
    },
  });

  const markPaid = useMutation({
    mutationFn: (id: number) => api.put(`/invoices/${id}`, { status: 'paid', pay_method: 'cash' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['invoices', studentId] }),
  });

  if (isLoading) return <div className="text-gray-500 py-8 text-center">載入中...</div>;
  if (!student) return <div className="text-gray-500 py-8 text-center">學生不存在</div>;

  const fullName = `${student.surname} ${student.given_name}`;

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <Link to="/students" className="p-2 hover:bg-gray-100 rounded">
          <ArrowLeft size={20} />
        </Link>
        <h1 className="text-2xl font-bold">👤 {fullName}</h1>
      </div>

      {/* Student info card */}
      <div className="bg-white rounded-xl shadow-sm p-4 mb-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div>
            <span className="text-gray-400 text-xs block">學校</span>
            <span className="font-medium">{student.school || '—'}</span>
          </div>
          <div>
            <span className="text-gray-400 text-xs block">電話</span>
            <span className="font-medium">{student.phone || '—'}</span>
          </div>
          <div>
            <span className="text-gray-400 text-xs block">DSE年份</span>
            <span className="font-medium">{student.dse_year || '—'}</span>
          </div>
          <div>
            <span className="text-gray-400 text-xs block">報名日期</span>
            <span className="font-medium">{student.enroll_date || '—'}</span>
          </div>
          <div className="col-span-2">
            <span className="text-gray-400 text-xs block">電郵</span>
            <span className="font-medium">{student.email || '—'}</span>
          </div>
          <div className="col-span-2">
            <span className="text-gray-400 text-xs block">備註</span>
            <span className="font-medium">{student.note || '—'}</span>
          </div>
        </div>
      </div>

      {/* Enrollments count */}
      <h2 className="font-bold text-lg mb-3">
        已報班級 <span className="text-gray-400 text-sm font-normal">({enrollments.length} 班)</span>
      </h2>

      {enrollments.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm p-8 text-center text-gray-400">
          該學生尚未報讀任何班級
        </div>
      ) : (
        enrollments.map((enr: any) => {
          const lessons: any[] = enr.lessons || [];
          const blockedSet = new Set<number>();
          lessons.forEach((l: any, idx: number) => {
            if (idx === 0) return;
            const prevStatus = lessons[idx - 1]?.status;
            if (prevStatus !== 'present' && prevStatus !== 'makeup' && prevStatus !== 'recording_room_present' && prevStatus !== 'video_makeup') {
              blockedSet.add(l.lesson_id);
            }
          });

          return (
            <div key={enr.enrollment_id} className="bg-white rounded-xl shadow-sm mb-4 overflow-hidden">
              {/* Class header */}
              <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between bg-gradient-to-r from-gray-50 to-white">
                <div className="flex items-center gap-3">
                  <Link
                    to={`/class/${enr.class_id}`}
                    className="font-bold text-blue-700 hover:text-blue-900 hover:underline text-base"
                  >
                    🏫 {enr.class_name || '(未命名)'}
                  </Link>
                  {enr.class_week && (
                    <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded">
                      {enr.class_week}
                    </span>
                  )}
                  {enr.class_time && (
                    <span className="text-xs text-gray-400">{enr.class_time}</span>
                  )}
                </div>
                <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                  enr.pay_status === 'paid' || enr.pay_status === '已繳'
                    ? 'bg-green-100 text-green-700'
                    : 'bg-red-100 text-red-700'
                }`}>
                  {enr.pay_status}
                </span>
              </div>

              {/* Lesson grid */}
              {lessons.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm" style={{ minWidth: `${lessons.length * 72 + 20}px` }}>
                    <thead>
                      <tr className="border-b bg-gray-50">
                        <th className="text-left p-2 text-xs text-gray-500 font-medium w-[20px]"></th>
                        {lessons.map((l: any) => (
                          <th key={l.lesson_id} className="text-center p-1.5 text-xs min-w-[64px]">
                            第{l.lesson_num}課
                            <span className="block text-gray-400 font-normal">
                              {l.lesson_date ? l.lesson_date.slice(5) : ''}
                            </span>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="border-b hover:bg-gray-50">
                        <td className="p-1.5 text-[10px] text-gray-400">狀態</td>
                        {lessons.map((l: any) => {
                          const blocked = blockedSet.has(l.lesson_id);
                          const label = cellLabel(l.status, blocked);
                          return (
                            <td
                              key={l.lesson_id}
                              className={`text-center p-1 align-middle ${blocked ? 'cursor-not-allowed' : ''} ${label.bg}`}
                            >
                              <span className={`inline-block px-1.5 py-1 rounded text-[10px] font-medium ${label.fg} ${!l.status ? 'border border-dashed border-yellow-300' : ''}`}>
                                {label.text}
                              </span>
                            </td>
                          );
                        })}
                      </tr>
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="p-4 text-center text-gray-400 text-xs">暫無課節</div>
              )}
            </div>
          );
        })
      )}

      {/* ─── Invoices ───────────────────────────────────────────── */}
      <h2 className="font-bold text-lg mb-3 mt-8">
        💳 帳單 <span className="text-gray-400 text-sm font-normal">({invoices.length} 筆)</span>
      </h2>

      {invoices.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm p-4 text-center text-gray-400 text-sm mb-4">
          暫無帳單
        </div>
      ) : (
        <div className="space-y-2 mb-4">
          {invoices.map((inv) => (
            <div key={inv.id} className="bg-white rounded-xl shadow-sm p-4 flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                    inv.type === 'tuition' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'
                  }`}>
                    {inv.type === 'tuition' ? '學費' : '補課費'}
                  </span>
                  <span className="text-sm font-bold">${inv.amount}</span>
                  {inv.makeup_fee > 0 && (
                    <span className="text-xs text-gray-400">(含手續費 ${inv.makeup_fee})</span>
                  )}
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                    inv.status === 'paid' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                  }`}>
                    {inv.status === 'paid' ? '已繳' : '未繳'}
                  </span>
                </div>
                {inv.pay_method && <div className="text-xs text-gray-400 mt-1">付款方式: {inv.pay_method}</div>}
                {inv.note && <div className="text-xs text-gray-400">{inv.note}</div>}
                {inv.created_at && <div className="text-xs text-gray-400 mt-0.5">開單: {inv.created_at}</div>}
                {inv.paid_at && <div className="text-xs text-green-600">已繳: {inv.paid_at}</div>}
              </div>
              {inv.status !== 'paid' && (
                <button
                  onClick={() => markPaid.mutate(inv.id)}
                  disabled={markPaid.isPending}
                  className="px-3 py-1.5 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
                >
                  已繳
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Add invoice form (per enrollment) */}
      {enrollments.map((enr: any) => (
        showForm === enr.enrollment_id && (
          <div key={`form-${enr.enrollment_id}`} className="bg-white rounded-xl shadow-sm p-4 mb-4">
            <h3 className="text-sm font-bold mb-3">開帳單 — {enr.class_name}</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">類型</label>
                <select
                  value={invType}
                  onChange={(e) => setInvType(e.target.value)}
                  className="w-full border rounded-lg px-3 py-1.5 text-sm"
                >
                  <option value="tuition">學費</option>
                  <option value="makeup">補課費</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">金額</label>
                <input
                  type="number"
                  value={invAmount}
                  onChange={(e) => setInvAmount(e.target.value)}
                  className="w-full border rounded-lg px-3 py-1.5 text-sm"
                  placeholder="300"
                />
              </div>
              {invType === 'makeup' && (
                <div>
                  <label className="block text-xs text-gray-500 mb-1">補課手續費</label>
                  <input
                    type="number"
                    value={invMakeupFee}
                    onChange={(e) => setInvMakeupFee(e.target.value)}
                    className="w-full border rounded-lg px-3 py-1.5 text-sm"
                    placeholder="50"
                  />
                </div>
              )}
              <div className={invType === 'makeup' ? '' : 'col-span-2'}>
                <label className="block text-xs text-gray-500 mb-1">備註</label>
                <input
                  type="text"
                  value={invNote}
                  onChange={(e) => setInvNote(e.target.value)}
                  className="w-full border rounded-lg px-3 py-1.5 text-sm"
                  placeholder="optional"
                />
              </div>
            </div>
            <div className="flex gap-2 mt-3">
              <button
                onClick={() => {
                  createInvoice.mutate({
                    enrollment_id: enr.enrollment_id,
                    student_id: studentId,
                    topic_id: null,
                    type: invType,
                    amount: parseFloat(invAmount) || 0,
                    makeup_fee: invType === 'makeup' ? (parseFloat(invMakeupFee) || 0) : 0,
                    note: invNote || null,
                  });
                }}
                disabled={createInvoice.isPending || !invAmount}
                className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {createInvoice.isPending ? '建立中...' : '建立'}
              </button>
              <button
                onClick={() => setShowForm(null)}
                className="px-4 py-1.5 text-sm border rounded-lg hover:bg-gray-50"
              >
                取消
              </button>
            </div>
          </div>
        )
      ))}

      {/* Enrollment-level add invoice button */}
      {enrollments.length > 0 && (
        <div className="flex flex-wrap gap-4 mb-4">
          {enrollments.map((enr: any) => (
            <button
              key={enr.enrollment_id}
              onClick={() => setShowForm(showForm === enr.enrollment_id ? null : enr.enrollment_id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border transition-colors ${
                showForm === enr.enrollment_id
                  ? 'bg-blue-50 border-blue-300 text-blue-700'
                  : 'hover:bg-gray-50 border-gray-200 text-gray-600'
              }`}
            >
              <Plus size={14} />
              開帳單 {enr.class_name}
            </button>
          ))}
        </div>
      )}

      {/* ─── Product Purchases ───────────────────────────────── */}
      <h2 className="font-bold text-lg mb-3 mt-8">
        🛒 貨品購買 <span className="text-gray-400 text-sm font-normal">(耳機、手續費等)</span>
      </h2>

      <PurchaseSection studentId={studentId} studentName={fullName} />

      {/* Legend */}
      <div className="text-[10px] text-gray-400 flex flex-wrap gap-x-4 gap-y-1 mt-2 px-1">
        <span>✅課堂教學出席</span>
        <span>✅課堂補堂出席</span>
        <span>✅課室錄播出席</span>
        <span>✅線上錄播出席</span>
        <span>📋請假待安排</span>
        <span>❌缺勤待安排</span>
        <span>⌛️課室錄播待補</span>
        <span>⌛️線上錄播待補</span>
        <span>⌛️課堂教學待補</span>
        <span>‼️課堂教學候補</span>
        <span>🟡未處理</span>
        <span>🔒未完成</span>
      </div>
    </div>
  );
}

/* ─── Purchase Section Component ──────────────────────────── */

function PurchaseSection({ studentId, studentName }: { studentId: number; studentName: string }) {
  const queryClient = useQueryClient();

  const { data: purchaseData, isLoading } = useQuery({
    queryKey: ['student-purchases', studentId],
    queryFn: () => api.getStudentPurchases(studentId),
  });

  const products: any[] = purchaseData?.products || [];
  const purchases: any[] = purchaseData?.purchases || [];
  const activeProducts = products.filter((p: any) => !p.is_archived);

  const [showAdd, setShowAdd] = useState(false);
  const [selProduct, setSelProduct] = useState('');
  const [selQty, setSelQty] = useState('1');
  const [selNote, setSelNote] = useState('');

  const buyMutation = useMutation({
    mutationFn: (data: any) => api.createPurchase(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['student-purchases', studentId] });
      setShowAdd(false);
      setSelProduct('');
      setSelQty('1');
      setSelNote('');
    },
    onError: (err: Error) => alert('購買記錄失敗：' + err.message),
  });

  const togglePaidMutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) =>
      api.updatePurchase(id, { pay_status: status }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['student-purchases', studentId] }),
  });

  const deletePurchaseMutation = useMutation({
    mutationFn: (id: number) => api.deletePurchase(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['student-purchases', studentId] }),
  });

  const productMap = new Map(products.map((p: any) => [p.id, p]));

  return (
    <div className="mb-4">
      {/* Purchase list */}
      {isLoading ? (
        <div className="text-gray-400 py-4 text-center text-sm">載入中...</div>
      ) : purchases.length === 0 && !showAdd ? (
        <div className="bg-white rounded-xl shadow-sm p-4 text-center text-gray-400 text-sm mb-3">
          暫無購買記錄
        </div>
      ) : (
        <div className="space-y-2 mb-3">
          {purchases.map((pp: any) => {
            const prod = productMap.get(pp.product_id);
            const isPaid = pp.pay_status === 'Paid';
            return (
              <div key={pp.id} className="bg-white rounded-xl shadow-sm p-3 flex items-center justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium">{prod?.name || `#${pp.product_id}`}</span>
                    <span className="text-xs text-gray-400">×{pp.quantity}</span>
                    <span className="text-sm font-bold text-blue-600">${pp.total_price}</span>
                    {/* Clickable pay status pill */}
                    <button
                      onClick={() => togglePaidMutation.mutate({ id: pp.id, status: isPaid ? 'Unpaid' : 'Paid' })}
                      disabled={togglePaidMutation.isPending}
                      className={`px-2 py-0.5 rounded-full text-xs font-bold border-2 cursor-pointer transition-all hover:scale-105 active:scale-95 ${
                        isPaid
                          ? 'bg-green-50 text-green-700 border-green-300 hover:bg-green-100'
                          : 'bg-amber-50 text-amber-700 border-amber-300 hover:bg-amber-100'
                      }`}
                      title={isPaid ? 'Click 標記為未繳' : 'Click 標記為已繳'}
                    >
                      {isPaid ? '💰 已繳 ✓' : '💰 未繳 ✗'}
                    </button>
                  </div>
                  {pp.note && <div className="text-xs text-gray-400 mt-0.5">{pp.note}</div>}
                  {pp.created_at && <div className="text-xs text-gray-400">{pp.created_at}</div>}
                </div>
                <button
                  onClick={() => { if (confirm('刪除此購買記錄？')) deletePurchaseMutation.mutate(pp.id); }}
                  className="px-2 py-1 text-xs text-red-500 hover:bg-red-50 rounded-lg shrink-0 ml-2"
                >
                  刪除
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Add purchase form */}
      {showAdd ? (
        <div className="bg-white rounded-xl shadow-sm p-4">
          <h3 className="text-sm font-bold mb-3">購買貨品 — {studentName}</h3>
          <div className="space-y-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">貨品</label>
              <select value={selProduct} onChange={(e) => setSelProduct(e.target.value)}
                className="w-full border rounded-lg px-3 py-1.5 text-sm">
                <option value="">-- 選擇貨品 --</option>
                {activeProducts.map((p: any) => (
                  <option key={p.id} value={p.id}>{p.name} (${p.price})</option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">數量</label>
                <input type="number" min="1" value={selQty}
                  onChange={(e) => setSelQty(e.target.value)}
                  className="w-full border rounded-lg px-3 py-1.5 text-sm" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">金額</label>
                <div className="text-sm font-bold py-1.5 text-blue-600">
                  ${selProduct ? (parseFloat(selQty || '1') * (activeProducts.find((p: any) => String(p.id) === selProduct)?.price || 0)).toFixed(1) : '0'}
                </div>
              </div>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">備註</label>
              <input type="text" value={selNote}
                onChange={(e) => setSelNote(e.target.value)}
                className="w-full border rounded-lg px-3 py-1.5 text-sm"
                placeholder="optional" />
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  const pid = parseInt(selProduct);
                  const qty = parseInt(selQty) || 1;
                  const prod = activeProducts.find((p: any) => p.id === pid);
                  if (!prod) return;
                  buyMutation.mutate({
                    student_id: studentId,
                    product_id: pid,
                    quantity: qty,
                    total_price: qty * prod.price,
                    note: selNote || undefined,
                  });
                }}
                disabled={!selProduct || buyMutation.isPending}
                className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {buyMutation.isPending ? '處理中...' : '記錄購買'}
              </button>
              <button onClick={() => setShowAdd(false)}
                className="px-4 py-1.5 text-sm border rounded-lg hover:bg-gray-50">
                取消
              </button>
            </div>
          </div>
        </div>
      ) : (
        <button onClick={() => setShowAdd(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors">
          <ShoppingCart size={14} /> 記錄購買
        </button>
      )}
    </div>
  );
}
