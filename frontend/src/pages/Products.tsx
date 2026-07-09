import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { Plus, Package, Pencil, Trash2, Archive, DollarSign } from 'lucide-react';

interface ProductForm {
  name: string;
  description: string;
  price: string;
}

const emptyForm: ProductForm = { name: '', description: '', price: '' };

export default function Products() {
  const queryClient = useQueryClient();
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<ProductForm>(emptyForm);

  const { data: products, isLoading } = useQuery({
    queryKey: ['products'],
    queryFn: () => api.listProducts(),
  });

  const createMutation = useMutation({
    mutationFn: (data: any) => api.createProduct(data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['products'] }); closeModal(); },
    onError: (err: Error) => alert('新增失敗：' + err.message),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => api.updateProduct(id, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['products'] }); closeModal(); },
    onError: (err: Error) => alert('更新失敗：' + err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.deleteProduct(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['products'] }),
  });

  const openAdd = () => { setEditingId(null); setForm(emptyForm); setShowModal(true); };
  const openEdit = (p: any) => {
    setEditingId(p.id);
    setForm({ name: p.name, description: p.description || '', price: String(p.price) });
    setShowModal(true);
  };
  const closeModal = () => { setShowModal(false); setEditingId(null); setForm(emptyForm); };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const price = parseFloat(form.price);
    if (!form.name.trim() || isNaN(price)) return;
    const payload = { name: form.name.trim(), description: form.description.trim() || undefined, price };
    if (editingId) {
      updateMutation.mutate({ id: editingId, data: payload });
    } else {
      createMutation.mutate(payload);
    }
  };

  const handleArchiveToggle = (p: any) => {
    updateMutation.mutate({ id: p.id, data: { is_archived: !p.is_archived } });
  };

  const activeProducts = (products || []).filter((p: any) => !p.is_archived);
  const archivedProducts = (products || []).filter((p: any) => p.is_archived);

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">🧾 貨品管理</h1>
        <button onClick={openAdd} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors shadow-sm">
          <Plus size={18} /> 新增貨品
        </button>
      </div>

      {isLoading ? (
        <div className="text-gray-500 py-8 text-center">載入中...</div>
      ) : (
        <>
          {/* Active products */}
          {activeProducts.length === 0 && archivedProducts.length === 0 && (
            <div className="text-gray-400 py-12 text-center">
              <Package size={48} className="mx-auto mb-3 opacity-30" />
              <p>暫無貨品，點擊「新增貨品」開始添加</p>
              <p className="text-xs mt-2">例如：耳機 $20、Video 補課手續費 $50</p>
            </div>
          )}

          {activeProducts.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {activeProducts.map((p: any) => (
                <div key={p.id} className="bg-white rounded-xl border border-gray-200 p-4 hover:shadow-md transition-shadow">
                  <div className="flex items-start justify-between mb-2">
                    <div className="min-w-0 flex-1">
                      <h3 className="font-semibold text-gray-900 truncate">{p.name}</h3>
                      {p.description && (
                        <p className="text-xs text-gray-500 mt-0.5 truncate">{p.description}</p>
                      )}
                    </div>
                    <span className="text-lg font-bold text-blue-600 shrink-0 ml-2">${p.price}</span>
                  </div>
                  <div className="flex items-center gap-2 mt-3 pt-3 border-t border-gray-100">
                    <button onClick={() => openEdit(p)}
                      className="flex-1 text-center py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
                      <Pencil size={14} className="inline mr-1" />{p.is_system ? '費用' : '編輯'}
                    </button>
                    {!p.is_system && (
                      <button onClick={() => handleArchiveToggle(p)}
                        className="flex-1 text-center py-1.5 text-xs font-medium text-amber-600 hover:bg-amber-50 rounded-lg transition-colors">
                        <Archive size={14} className="inline mr-1" />封存
                      </button>
                    )}
                    {!p.is_system ? (
                      <button onClick={() => { if (confirm(`確認刪除「${p.name}」？`)) deleteMutation.mutate(p.id); }}
                        className="flex-1 text-center py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                        <Trash2 size={14} className="inline mr-1" />刪除
                      </button>
                    ) : (
                      <span className="flex-1 text-center py-1.5 text-xs text-gray-300">🔒 系統</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Archived */}
          {archivedProducts.length > 0 && (
            <div className="mt-6">
              <h2 className="text-sm font-medium text-gray-400 mb-2">已封存 ({archivedProducts.length})</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {archivedProducts.map((p: any) => (
                  <div key={p.id} className="bg-gray-50 rounded-xl border border-gray-200 p-3 flex items-center justify-between opacity-60">
                    <div className="min-w-0">
                      <span className="text-sm text-gray-500 line-through truncate block">{p.name}</span>
                      <span className="text-xs text-gray-400">${p.price}</span>
                    </div>
                    <button onClick={() => handleArchiveToggle(p)}
                      className="text-xs text-blue-500 hover:text-blue-700 shrink-0">
                      還原
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* Add/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center" onClick={(e) => e.target === e.currentTarget && closeModal()}>
          <div className="bg-white rounded-xl p-6 w-full max-w-md mx-4 shadow-xl">
            <h2 className="text-lg font-bold mb-4">{editingId ? '編輯貨品' : '新增貨品'}</h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">名稱 *</label>
                <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" required
                  placeholder="例：耳機" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">描述</label>
                <input type="text" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                  placeholder="例：學生忘記帶耳機時購買" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">價格 *</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"><DollarSign size={16} /></span>
                  <input type="number" step="0.1" min="0" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })}
                    className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" required
                    placeholder="0" />
                </div>
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={closeModal} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">取消</button>
                <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">
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
