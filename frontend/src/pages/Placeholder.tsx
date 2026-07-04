import { Construction } from 'lucide-react';

export default function Placeholder({ title }: { title: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-gray-400">
      <Construction size={48} className="mb-4" />
      <h2 className="text-xl font-semibold text-gray-600 mb-2">{title}</h2>
      <p>此頁面正在遷移至 React，敬請期待</p>
    </div>
  );
}
