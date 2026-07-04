import { useState, useRef } from 'react';
import { X, Minus } from 'lucide-react';

interface ScanCard {
  id: string;
  studentId: number;
  name: string;
  school: string;
  phone: string;
  email: string;
  note: string;
  payStatus: string;
  checkinTime: string;
  homeworkDone: boolean;
  status: 'success' | 'duplicate' | 'error';
  message?: string;
}

interface Props {
  lessonId: number;
  className: string;
  lessonNum: number;
  onStop: () => void;
  stopping: boolean;
  onToggleHomework: (studentId: number, lessonId: number, done: boolean) => void;
}

export default function ScanPanel({ lessonId, className, lessonNum, onStop, stopping, onToggleHomework }: Props) {
  const [card, setCard] = useState<ScanCard | null>(null);
  const [minimized, setMinimized] = useState(false);
  const [pos, setPos] = useState(() => {
    const w = window.innerWidth;
    return { x: Math.max(16, w - 16 - 340), y: 80 };
  });
  const dragging = useRef(false);
  const dragOff = useRef({ x: 0, y: 0 });

  const setLatestCard = (c: ScanCard) => {
    setCard(c);
  };

  // Expose via window bridge for the attendance page to push scan events
  (window as any).__scanAddCard = setLatestCard;

  const onPointerDown = (e: React.PointerEvent) => {
    dragging.current = true;
    dragOff.current = { x: e.clientX - pos.x, y: e.clientY - pos.y };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging.current) return;
    const nx = e.clientX - dragOff.current.x;
    const ny = e.clientY - dragOff.current.y;
    const maxX = Math.max(0, window.innerWidth - 340);
    const maxY = Math.max(0, window.innerHeight - (minimized ? 70 : 500));
    setPos({
      x: Math.min(Math.max(0, nx), maxX),
      y: Math.min(Math.max(0, ny), maxY),
    });
  };

  const onPointerUp = () => {
    dragging.current = false;
  };

  return (
    <div
      className="fixed z-50 w-80 bg-white rounded-xl shadow-2xl border border-gray-200 overflow-hidden select-none"
      style={{ left: pos.x, top: pos.y }}
    >
      {/* Header — draggable */}
      <div
        className="px-3 py-2 bg-gradient-to-r from-green-500 to-emerald-500 text-white flex items-center justify-between cursor-grab active:cursor-grabbing"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 bg-white rounded-full animate-pulse" />
          <span className="font-semibold text-sm">📷 掃碼簽到</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setMinimized(!minimized)}
            className="p-0.5 hover:bg-white/20 rounded"
          >
            <Minus size={15} />
          </button>
          <button
            onClick={onStop}
            disabled={stopping}
            className="p-0.5 hover:bg-white/20 rounded"
          >
            <X size={15} />
          </button>
        </div>
      </div>

      {/* Lesson info */}
      <div className="px-3 py-1.5 bg-gray-50 border-b border-gray-100 flex items-center justify-between text-xs text-gray-500">
        <span>{className} · 第{lessonNum}節</span>
        <span>📡 {window.location.origin}/api/qr-checkin</span>
      </div>

      {!minimized && (
        <div className="max-h-[400px] overflow-y-auto">
          {!card ? (
            <div className="px-3 py-8 text-center">
              <div className="text-2xl mb-2">📷</div>
              <p className="text-xs text-gray-400">等待學生掃碼簽到...</p>
              <p className="text-[10px] text-gray-300 mt-1">學生 QR 碼需包含 email</p>
            </div>
          ) : (
            <div
              className={`px-3 py-2.5 transition-all ${
                card.status === 'success'
                  ? 'bg-green-50'
                  : card.status === 'duplicate'
                  ? 'bg-amber-50'
                  : 'bg-red-50'
              }`}
            >
              {/* Header row */}
              <div className="flex items-start gap-2.5">
                {/* Avatar */}
                <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold shrink-0 ${
                  card.status === 'success'
                    ? 'bg-green-200 text-green-800'
                    : card.status === 'duplicate'
                    ? 'bg-amber-200 text-amber-800'
                    : 'bg-red-200 text-red-800'
                }`}>
                  {card.name.charAt(0)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-1">
                    <span className="font-semibold text-sm text-gray-800 truncate">{card.name}</span>
                    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full shrink-0 ${
                      card.status === 'success'
                        ? 'bg-green-100 text-green-700'
                        : card.status === 'duplicate'
                        ? 'bg-amber-100 text-amber-700'
                        : 'bg-red-100 text-red-700'
                    }`}>
                      {card.status === 'success' ? '✅ 簽到成功'
                        : card.status === 'duplicate' ? '⚠️ 已簽到'
                        : '❌ 失敗'}
                    </span>
                  </div>
                  <div className="text-[11px] text-gray-500 mt-0.5">{card.school || '—'}</div>
                </div>
              </div>

              {/* Detail grid */}
              <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
                <div><span className="text-gray-400">💰</span> <span className={`font-medium ${card.payStatus === '已繳' ? 'text-green-700' : 'text-red-600'}`}>{card.payStatus || '—'}</span></div>
                <div><span className="text-gray-400">⏱️</span> <span className="text-gray-700">{card.checkinTime ? card.checkinTime.slice(11, 16) : '—'}</span></div>
                {(card.note || '').trim() && (
                  <div className="col-span-2"><span className="text-gray-400">📝 備註</span> <span className="text-gray-700">{card.note}</span></div>
                )}
              </div>

              {/* Homework toggle */}
              {card.status === 'success' && (
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-[11px] text-gray-500">📋 功課</span>
                  <button
                    onClick={() => onToggleHomework(card.studentId, lessonId, !card.homeworkDone)}
                    className={`inline-block px-2 py-1 rounded text-xs font-medium transition-colors ${
                      card.homeworkDone
                        ? 'bg-green-50 text-green-700 hover:bg-green-100'
                        : 'bg-red-50 text-red-700 hover:bg-red-100 border border-red-200'
                    }`}
                  >
                    {card.homeworkDone ? '✅ 已交' : '❌ 未交'}
                  </button>
                </div>
              )}

              {card.message && (
                <div className="mt-1 text-[10px] text-red-600">{card.message}</div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Footer */}
      <div className="px-3 py-1 bg-gray-50 border-t border-gray-100 flex items-center justify-between text-[10px] text-gray-400">
        <span>🔄 自動更新</span>
        <span>{card ? '1 人已簽到' : '等待中'}</span>
      </div>
    </div>
  );
}
