// ─── API Response wrapper ─────────────────────────────────────────────
export interface ApiResponse<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
}

// ─── Auth ────────────────────────────────────────────────────────────
export interface LoginResponse {
  token: string;
}

// ─── Course tree ─────────────────────────────────────────────────────
export interface YearCourse {
  id: number;
  year: number;
  name: string;
  grade?: string;
  is_deleted: boolean;
}

export interface Topic {
  id: number;
  year_course_id: number;
  name: string;
  type?: string;
  lessons: number;
  fee: number;
  is_deleted: boolean;
  is_archived: boolean;
  sort: number;
}

export interface Class {
  id: number;
  topic_id: number;
  name?: string;
  week?: string;
  start?: string;
  end?: string;
  first_lesson?: string;
  seat: number;
  is_completed: boolean;
  is_deleted: boolean;
}

export interface ClassTreeData {
  year_courses: YearCourse[];
  topics: Topic[];
  classes: Class[];
}

// ─── Lessons ─────────────────────────────────────────────────────────
export interface Lesson {
  id: number;
  class_id: number;
  num: number;
  date?: string;
  start?: string;
  end?: string;
  status?: string;
  is_deleted: boolean;
}

// ─── Students ────────────────────────────────────────────────────────
export interface Student {
  id: number;
  surname: string;
  given_name: string;
  school?: string;
  email?: string;
  password?: string;
  phone?: string;
  parent_phone?: string;
  note?: string;
  dse_year?: string;
  enroll_date?: string;
  create_time?: string;
  is_deleted: boolean;
}

// ─── Enrollments ─────────────────────────────────────────────────────
export interface Enrollment {
  id: number;
  class_id: number;
  student_id: number;
  pay_status: string;
  purchase: number;
  used: number;
  remaining: number;
  is_deleted: boolean;
}

// ─── Checkin ─────────────────────────────────────────────────────────
export type CheckinStatus = 'present' | 'leave' | 'absent' | 'makeup' | 'video_makeup' | 'recording_room_present' | 'waiting' | 'scheduled_room' | 'scheduled_video' | 'scheduled_classroom' | '';

export interface CheckinEntry {
  lesson_id: number;
  student_id: number;
  status: CheckinStatus;
  checkin_time?: string;
  source?: 'enrolled' | 'makeup' | 'standby';
}

export type AttendanceRow = {
  lesson_id: number;
  student_id: number;
  lesson_num: number;
  student_name: string;
  school?: string;
  source: 'enrolled' | 'makeup' | 'standby';
  status: CheckinStatus;
  checkin_time?: string;
  blocked: boolean;
};

// ─── Makeup ──────────────────────────────────────────────────────────
export interface MakeupLesson {
  id: number;
  student_id: number;
  original_class_id: number;
  original_topic?: string;
  lesson_num: number;
  absent_date?: string;
  makeup_class?: string;
  makeup_type?: string;
  status: 'scheduled' | 'waiting' | 'done';
  trigger_time?: string;
  create_time?: string;
  is_deleted: boolean;
}

// ─── Standby ─────────────────────────────────────────────────────────
export interface StandbyEntry {
  id: number;
  student_id: number;
  class_id: number;
  lesson_num: number;
  status: 'waiting' | 'confirmed' | 'cancelled';
  student_name?: string;
  trigger_time?: string;
}

// ─── Report / Timeline ───────────────────────────────────────────────
export interface ReportEvent {
  date: string;
  sort_key: string;
  student_name: string;
  event_type: string;
  lesson_label: string;
  class_name: string;
  lesson_date: string;
  checkin_time: string;
  makeup_type: string;
  makeup_class: string;
  original_topic: string;
  mk_status: string;
  change_note: string;
}

export interface CellDetail {
  student_name: string;
  lesson_label: string;
  lesson_num: number;
  lesson_id: number;
  lesson_date: string;
  class_name: string;
  status: CheckinStatus;
  checkin_time: string;
  mk_status: string;
}

// ─── AI Parser ───────────────────────────────────────────────────────
export interface AiParsedStudent {
  surname: string;
  given_name: string;
  school: string;
  phone: string;
  grade: string;
  dse_year: string;
  raw: string;
}

export interface AiEnrollResult {
  enrolled: number;
  errors: string[];
}

// ─── Calendar ────────────────────────────────────────────────────────
export interface CalendarDayData {
  lessons: number;
  present: number;
  leave: number;
  absent: number;
  unchecked: number;
}

export interface CalendarResponse {
  [date: string]: CalendarDayData;
}

// ─── Dashboard ───────────────────────────────────────────────────────
export interface DashboardStats {
  student_count: number;
  class_count: number;
  course_count: number;
  makeup_pending: number;
}

// ─── Invoice ─────────────────────────────────────────────────────────
export interface Invoice {
  id: number;
  enrollment_id: number;
  student_id: number;
  topic_id: number | null;
  type: string;
  amount: number;
  makeup_fee: number;
  status: string;
  pay_method: string;
  note: string | null;
  created_at: string | null;
  paid_at: string | null;
}
