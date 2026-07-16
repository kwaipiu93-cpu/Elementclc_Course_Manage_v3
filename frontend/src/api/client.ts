const API_BASE = '/api';

function getToken(): string | null {
  return localStorage.getItem('token');
}

async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  // Token expired → clear auth and redirect to login
  if (res.status === 401) {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    // Only redirect if not already on login page
    if (window.location.pathname !== '/login') {
      window.location.href = '/login';
    }
    throw new Error('登入已過期，請重新登入');
  }

  const data = await res.json();

  if (!data.ok) {
    throw new Error(data.error || data.message || 'Request failed');
  }

  return data.data ?? data;
}

export const api = {
  // Generic HTTP helpers
  get: <T = any>(path: string) => request<T>(path),
  post: <T = any>(path: string, body?: any) =>
    request<T>(path, {
      method: 'POST',
      body: body ? JSON.stringify(body) : undefined,
    }),
  put: <T = any>(path: string, body?: any) =>
    request<T>(path, {
      method: 'PUT',
      body: body ? JSON.stringify(body) : undefined,
    }),
  delete: <T = any>(path: string) =>
    request<T>(path, { method: 'DELETE' }),

  // Auth
  login: (email: string, password: string) =>
    request<any>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }).then((res: any) => ({ token: res.token, user: res.user })),

  // Class tree
  getClassTree: () => request<{
    year_courses: any[];
    topics: any[];
    classes: any[];
    enroll_stats: any[];
  }>('/class-tree'),

  // Students
  getStudents: () => request<any[]>('/students'),
  createStudent: (data: any) =>
    request<any>('/students', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  updateStudent: (id: number, data: any) =>
    request<any>(`/students/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  deleteStudent: (id: number) =>
    request<any>(`/students/${id}`, { method: 'DELETE' }),

  // Year courses
  listYearCourses: () => request<any[]>('/year_courses'),
  createYearCourse: (data: any) =>
    request<any>('/year_courses', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  updateYearCourse: (id: number, data: any) =>
    request<any>(`/year_courses/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  deleteYearCourse: (id: number) =>
    request<any>(`/year_courses/${id}`, { method: 'DELETE' }),

  // Topics
  listTopics: () => request<any[]>('/topics'),
  createTopic: (data: any) =>
    request<any>('/topics', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  updateTopic: (id: number, data: any) =>
    request<any>(`/topics/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  deleteTopic: (id: number) =>
    request<any>(`/topics/${id}`, { method: 'DELETE' }),

  // Classes
  listClasses: () => request<any[]>('/classes'),
  createClass: (data: any) =>
    request<any>('/classes', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  updateClass: (id: number, data: any) =>
    request<any>(`/classes/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  deleteClass: (id: number) =>
    request<any>(`/classes/${id}`, { method: 'DELETE' }),

  // Lessons
  getLessons: (classId: number) =>
    request<any[]>(`/classes/${classId}/lessons`),
  updateLesson: (id: number, data: { date?: string; start?: string; end?: string }) =>
    request(`/lessons/${id}`, { method: 'PUT', body: JSON.stringify(data) }),

  // Enrollments
  getEnrollments: (classId: number) =>
    request<any[]>(`/classes/${classId}/enrollments`),
  getCheckins: (classId: number) =>
    request<{ checkins: any[]; makeups: any[]; standby: any[] }>(
      `/classes/${classId}/checkins`
    ),
  createEnrollment: (data: any) =>
    request<any>('/enrollments', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  deleteEnrollment: (id: number) =>
    request<any>(`/enrollments/${id}`, { method: 'DELETE' }),
  updatePayment: (id: number, payStatus: string) =>
    request<any>(`/enrollments/${id}/payment`, {
      method: 'PUT',
      body: JSON.stringify({ pay_status: payStatus }),
    }),
  transferEnrollment: (id: number, newClassId: number) =>
    request<any>(`/enrollments/${id}/transfer`, {
      method: 'PUT',
      body: JSON.stringify({ new_class_id: newClassId }),
    }),

  // AI Registration
  aiParse: (classId: number, text: string) =>
    request<any[]>(`/classes/${classId}/ai-parse`, {
      method: 'POST',
      body: JSON.stringify({ text }),
    }),
  aiEnroll: (classId: number, students: any[]) =>
    request<{ enrolled: number; errors: string[] }>(
      `/classes/${classId}/ai-enroll`,
      {
        method: 'POST',
        body: JSON.stringify({ students }),
      }
    ),

  // Attendance
  updateCheckin: (lessonId: number, studentId: number, status: string) =>
    request<any>('/attendance', {
      method: 'PUT',
      body: JSON.stringify({ lesson_id: lessonId, student_id: studentId, status }),
    }),
  getAttendanceDaily: (date: string) =>
    request<any[]>(`/attendance/daily?date=${date}`),
  getAttendanceCalendar: (year: number, month: number) =>
    request<Record<string, any>>(
      `/attendance/calendar?year=${year}&month=${month}`
    ),
  toggleHomework: (lessonId: number, studentId: number, done: boolean) =>
    request<any>('/attendance/homework', {
      method: 'PUT',
      body: JSON.stringify({ lesson_id: lessonId, student_id: studentId, done }),
    }),
  updateStudentNote: (studentId: number, note: string) =>
    request<any>('/attendance/student-note', {
      method: 'PUT',
      body: JSON.stringify({ student_id: studentId, note }),
    }),

  // Makeups
  getMakeups: () => request<any[]>('/makeups'),
  createMakeup: (data: any) =>
    request<any>('/makeups', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  // Users
  listUsers: () => request<any[]>('/users'),
  getUser: (id: number) => request<any>(`/users/${id}`),
  createUser: (data: any) =>
    request<any>('/users', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  updateUser: (id: number, data: any) =>
    request<any>(`/users/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  deleteUser: (id: number) =>
    request<any>(`/users/${id}`, { method: 'DELETE' }),

  // Standby
  getStandbyList: () => request<any[]>('/standby'),
  confirmStandby: (studentId: number, standbyId: number, classId: number) =>
    request<any>('/standby/confirm', {
      method: 'POST',
      body: JSON.stringify({
        student_id: studentId,
        standby_id: standbyId,
        class_id: classId,
      }),
    }),

  // Scan
  scanStart: (lessonId: number) =>
    request<any>('/scan/start', {
      method: 'POST',
      body: JSON.stringify({ lesson_id: lessonId }),
    }),
  scanStop: () => request<any>('/scan/stop', { method: 'POST' }),
  scanActive: () => request<any>('/scan/active'),

  // Init data
  initData: () => request<any>('/init_data', { method: 'GET' }),

  // Available lessons for makeup arrangement
  getAvailableLessons: (classId: number, lessonNum: number) =>
    request<any[]>(`/makeups/available?class_id=${classId}&lesson_num=${lessonNum}`),

  // Avatar upload (multipart, not JSON)
  uploadAvatar: async (id: number, file: File) => {
    const formData = new FormData();
    formData.append('avatar', file);
    const token = getToken();
    const res = await fetch(`${API_BASE}/students/${id}/avatar`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: formData,
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.message || '上傳失敗');
    return data.data;
  },

  // Products
  listProducts: () => request<any[]>('/products'),
  createProduct: (data: { name: string; description?: string; price: number }) =>
    request<any>('/products', { method: 'POST', body: JSON.stringify(data) }),
  updateProduct: (id: number, data: any) =>
    request<any>(`/products/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteProduct: (id: number) =>
    request<any>(`/products/${id}`, { method: 'DELETE' }),

  // Product purchases
  getStudentPurchases: (studentId: number) =>
    request<{ purchases: any[]; products: any[] }>(`/students/${studentId}/purchases`),
  createPurchase: (data: { student_id: number; product_id: number; quantity?: number; total_price: number; note?: string }) =>
    request<any>('/purchases', { method: 'POST', body: JSON.stringify(data) }),
  updatePurchase: (id: number, data: { pay_status?: string; note?: string }) =>
    request<any>(`/purchases/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deletePurchase: (id: number) =>
    request<any>(`/purchases/${id}`, { method: 'DELETE' }),
};
