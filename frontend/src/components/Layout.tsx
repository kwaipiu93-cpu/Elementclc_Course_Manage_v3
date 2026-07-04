import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import {
  LayoutDashboard,
  Users,
  CalendarCheck,
  RefreshCw,
  BookOpen,
  Settings,
  LogOut,
  Menu,
  X,
  ChevronDown,
  ChevronRight,
  Shield,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';

const navItems = [
  { path: '/', label: '概覽', icon: LayoutDashboard },
  { path: '/students', label: '學生', icon: Users },
  { path: '/attendance', label: '每日簽到', icon: CalendarCheck },
  { path: '/makeups', label: '補課', icon: RefreshCw },
];

export default function Layout({ children }: { children: React.ReactNode }) {
  const { logout, user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [treeOpen, setTreeOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(true);
  const isSuperAdmin = user?.role === 'superadmin';

  const { data: treeData } = useQuery({
    queryKey: ['class-tree'],
    queryFn: () => api.getClassTree(),
    enabled: treeOpen,
  });

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/30 z-20 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`
          fixed lg:static inset-y-0 left-0 z-30
          w-64 bg-gray-900 text-gray-300 flex flex-col
          transition-transform duration-200
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0 lg:w-16'}
        `}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-700">
          <span className="font-bold text-lg text-white">📐 CM</span>
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="p-1 hover:text-white"
          >
            {sidebarOpen ? <X size={18} /> : <Menu size={18} />}
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto p-2 space-y-1">
          {navItems.map((item) => {
            const active = location.pathname === item.path;
            return (
              <Link
                key={item.path}
                to={item.path}
                className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                  active
                    ? 'bg-gray-700 text-white'
                    : 'hover:bg-gray-800 hover:text-white'
                }`}
              >
                <item.icon size={18} />
                {sidebarOpen && <span>{item.label}</span>}
              </Link>
            );
          })}

          {/* Course tree */}
          <div>
            <button
              onClick={() => setTreeOpen(!treeOpen)}
              className="flex items-center gap-3 w-full px-3 py-2 rounded-lg text-sm hover:bg-gray-800 hover:text-white transition-colors"
            >
              {treeOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              <BookOpen size={18} />
              {sidebarOpen && <span>課程</span>}
              {sidebarOpen && (
                <Link
                  to="/classes"
                  onClick={(e) => e.stopPropagation()}
                  className="ml-auto text-xs text-gray-500 hover:text-white"
                >
                  ⚙️
                </Link>
              )}
            </button>

            {sidebarOpen && treeOpen && treeData && (
              <div className="ml-4 border-l border-gray-700 pl-3 mt-1 space-y-1">
                {treeData.year_courses?.map((yc: any) => (
                  <div key={yc.id}>
                    <div className="text-xs text-gray-500 py-1">
                      {yc.name}
                    </div>
                    <div className="ml-2 space-y-1">
                      {treeData.topics
                        ?.filter((t: any) => t.year_course_id === yc.id)
                        .map((t: any) => (
                          <div key={t.id}>
                            <div className="text-xs text-gray-400 py-1">
                              📘 {t.name}
                            </div>
                            <div className="ml-2 space-y-1">
                              {treeData.classes
                                ?.filter((c: any) => c.topic_id === t.id)
                                .map((c: any) => (
                                  <Link
                                    key={c.id}
                                    to={`/class/${c.id}`}
                                    className="block text-xs text-gray-500 hover:text-white py-0.5"
                                  >
                                    🏫 {c.name || '(未命名)'}
                                  </Link>
                                ))}
                            </div>
                          </div>
                        ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ⚙️ 配置管理 — only superadmin */}
          {isSuperAdmin && (
            <div>
              <button
                onClick={() => setSettingsOpen(!settingsOpen)}
                className="flex items-center gap-3 w-full px-3 py-2 rounded-lg text-sm hover:bg-gray-800 hover:text-white transition-colors"
              >
                {settingsOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                <Settings size={18} />
                {sidebarOpen && <span>配置管理</span>}
              </button>

              {sidebarOpen && settingsOpen && (
                <div className="ml-4 border-l border-gray-700 pl-3 mt-1 space-y-1">
                  <Link
                    to="/settings/accounts"
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs transition-colors ${
                      location.pathname === '/settings/accounts'
                        ? 'bg-gray-700 text-white'
                        : 'text-gray-400 hover:text-white hover:bg-gray-800'
                    }`}
                  >
                    <Shield size={14} />
                    <span>帳號管理</span>
                  </Link>
                </div>
              )}
            </div>
          )}
        </nav>

        {/* Footer */}
        <div className="p-4 border-t border-gray-700 space-y-2">
          {sidebarOpen && user && (
            <div className="flex items-center gap-2 px-3 py-1.5 text-xs text-gray-400">
              <div className={`w-2 h-2 rounded-full ${
                user.role === 'superadmin' ? 'bg-red-500' :
                user.role === 'admin' ? 'bg-blue-500' : 'bg-green-500'
              }`} />
              <span>{user.display_name}</span>
              <span className="text-gray-600">·</span>
              <span className={
                user.role === 'superadmin' ? 'text-red-400' :
                user.role === 'admin' ? 'text-blue-400' : 'text-green-400'
              }>
                {user.role === 'superadmin' ? 'Super Admin' :
                 user.role === 'admin' ? 'Admin' : 'User'}
              </span>
            </div>
          )}
          <button
            onClick={handleLogout}
            className="flex items-center gap-3 w-full px-3 py-2 text-sm rounded-lg hover:bg-gray-800 hover:text-white transition-colors"
          >
            <LogOut size={18} />
            {sidebarOpen && <span>登出</span>}
          </button>
        </div>
      </aside>

      {/* Mobile toggle */}
      <button
        onClick={() => setSidebarOpen(!sidebarOpen)}
        className="fixed top-3 left-3 z-40 p-2 bg-white rounded-lg shadow lg:hidden"
      >
        <Menu size={20} />
      </button>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto p-4 lg:p-6">
        {children}
      </main>
    </div>
  );
}
