import React, { useState, useEffect } from 'react';
import axios, { AxiosResponse } from 'axios';
import { Clock, Calendar, User, CheckCircle, XCircle, LayoutDashboard, LogOut, Settings, Lock, Shield, DollarSign, Edit3 } from 'lucide-react';
import LoginPage from './LoginPage';
import ProfilePage from './ProfilePage';
import PasswordPage from './PasswordPage';
import AdminPage from './AdminPage';
import SalaryPage from './SalaryPage';
import SalaryManagementPage from './SalaryManagementPage';
import LeaveBalancePage from './LeaveBalancePage';
import SchedulePage from './SchedulePage';

const API_BASE = 'http://localhost:3001/api';

interface UserData {
  id: number;
  full_name: string;
  dept_name: string;
  role: string;
  dept_id: number;
  account: string;
}

interface AttendanceRecord {
  date: string;
  clock_in: string;
  clock_out: string;
}

interface LeaveRequest {
  id: number;
  leave_type: string;
  start_date: string;
  end_date: string;
  reason: string;
  status: string;
  requester_name?: string;
}

interface AttendanceExceptionRequest {
  id: number;
  exception_type: string;
  date: string;
  requested_clock_in?: string | null;
  requested_clock_out?: string | null;
  reason: string;
  status: string;
  requester_name?: string;
}

const App = () => {
  const [user, setUser] = useState<UserData | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState('punch');

  useEffect(() => {
    const token = localStorage.getItem('token');
    const savedUser = localStorage.getItem('user');
    if (token && savedUser) {
      axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
      axios.get(`${API_BASE}/auth/me`)
        .then((res: AxiosResponse<UserData>) => setUser(res.data))
        .catch(() => {
          localStorage.removeItem('token');
          localStorage.removeItem('user');
          delete axios.defaults.headers.common['Authorization'];
        })
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  const handleLoginSuccess = (token: string, userData: UserData) => {
    setUser(userData);
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    delete axios.defaults.headers.common['Authorization'];
    setUser(null);
  };

  if (loading) return <div className='min-h-screen bg-gray-50 flex items-center justify-center'><p className='text-gray-500'>載入中...</p></div>;
  if (!user) return <LoginPage onLoginSuccess={handleLoginSuccess} />;

  return (
    <div className='min-h-screen bg-gray-50 flex'>
      <nav className='w-64 bg-slate-900 text-white p-6 flex flex-col gap-2'>
        <h1 className='text-xl font-bold mb-6 flex items-center gap-2'><LayoutDashboard /> HR System</h1>
        <div className='flex flex-col gap-1'>
          <p className='text-xs text-gray-500 uppercase tracking-wider px-3 mb-1'>主要功能</p>
          <button onClick={() => setView('punch')} className={`p-3 rounded flex items-center gap-2 transition text-left ${view === 'punch' ? 'bg-slate-700' : 'hover:bg-slate-800'}`}><Clock size={20}/> 打卡系統</button>
          <button onClick={() => setView('exception')} className={`p-3 rounded flex items-center gap-2 transition text-left ${view === 'exception' ? 'bg-slate-700' : 'hover:bg-slate-800'}`}><Edit3 size={20}/> 補登申請</button>
          <button onClick={() => setView('leave')} className={`p-3 rounded flex items-center gap-2 transition text-left ${view === 'leave' ? 'bg-slate-700' : 'hover:bg-slate-800'}`}><Calendar size={20}/> 請假申請</button>
          {(user.role === 'MANAGER' || user.role === 'ADMIN') && (
            <button onClick={() => setView('schedule')} className={`p-3 rounded flex items-center gap-2 transition text-left ${view === 'schedule' ? 'bg-slate-700' : 'hover:bg-slate-800'}`}><Calendar size={20}/> 排班系統</button>
          )}
          <button onClick={() => setView('balance')} className={`p-3 rounded flex items-center gap-2 transition text-left ${view === 'balance' ? 'bg-slate-700' : 'hover:bg-slate-800'}`}><Calendar size={20}/> 假別餘額</button>
          {(user.role === 'MANAGER' || user.role === 'ADMIN') && (
            <button onClick={() => setView('approval')} className={`p-3 rounded flex items-center gap-2 transition text-left ${view === 'approval' ? 'bg-slate-700' : 'hover:bg-slate-800'}`}><User size={20}/> 簽核管理</button>
          )}
        </div>
        <div className='flex flex-col gap-1 mt-2'>
          <p className='text-xs text-gray-500 uppercase tracking-wider px-3 mb-1'>薪資相關</p>
          <button onClick={() => setView('salary')} className={`p-3 rounded flex items-center gap-2 transition text-left ${view === 'salary' ? 'bg-slate-700' : 'hover:bg-slate-800'}`}><DollarSign size={20}/> 我的薪資</button>
          {(user.role === 'MANAGER' || user.role === 'ADMIN') && (
            <button onClick={() => setView('salary-manage')} className={`p-3 rounded flex items-center gap-2 transition text-left ${view === 'salary-manage' ? 'bg-slate-700' : 'hover:bg-slate-800'}`}><DollarSign size={20}/> 薪資管理</button>
          )}
        </div>
        {user.role === 'ADMIN' && (
          <div className='flex flex-col gap-1 mt-2'>
            <p className='text-xs text-gray-500 uppercase tracking-wider px-3 mb-1'>系統管理</p>
            <button onClick={() => setView('admin')} className={`p-3 rounded flex items-center gap-2 transition text-left ${view === 'admin' ? 'bg-slate-700' : 'hover:bg-slate-800'}`}><Shield size={20}/> 人員與部門</button>
          </div>
        )}
        <div className='flex flex-col gap-1 mt-4'>
          <p className='text-xs text-gray-500 uppercase tracking-wider px-3 mb-1'>個人設定</p>
          <button onClick={() => setView('profile')} className={`p-3 rounded flex items-center gap-2 transition text-left ${view === 'profile' ? 'bg-slate-700' : 'hover:bg-slate-800'}`}><Settings size={20}/> 個人資料</button>
          <button onClick={() => setView('password')} className={`p-3 rounded flex items-center gap-2 transition text-left ${view === 'password' ? 'bg-slate-700' : 'hover:bg-slate-800'}`}><Lock size={20}/> 修改密碼</button>
        </div>
        <div className='mt-auto pt-4 border-t border-slate-700'>
          <div className='p-4 bg-slate-800 rounded text-xs mb-3'>
            <p className='text-gray-400'>當前使用者</p>
            <p className='font-medium'>{user.full_name}</p>
            <p className='text-gray-500'>{user.dept_name} | {user.account}</p>
          </div>
          <button onClick={handleLogout} className='w-full p-3 rounded flex items-center justify-center gap-2 bg-red-600 hover:bg-red-700 transition'>
            <LogOut size={18} /> 登出
          </button>
        </div>
      </nav>
      <main className='flex-1 p-10 overflow-auto'>
        {view === 'punch' && <PunchView userId={user.id} />}
        {view === 'exception' && <AttendanceExceptionView />}
        {view === 'leave' && <LeaveView userId={user.id} user={user} />}
        {view === 'schedule' && <SchedulePage />}
        {view === 'balance' && <LeaveBalancePage />}
        {view === 'approval' && <AdminView userId={user.id} />}
        {view === 'salary' && <SalaryPage />}
        {view === 'salary-manage' && <SalaryManagementPage />}
        {view === 'admin' && <AdminPage />}
        {view === 'profile' && <ProfilePage />}
        {view === 'password' && <PasswordPage />}
      </main>
    </div>
  );
};

const PunchView = ({ userId }: { userId: number }) => {
  const [history, setHistory] = useState<AttendanceRecord[]>([]);
  const refresh = async () => {
    try {
      const res = await axios.get(`${API_BASE}/attendance/history`);
      setHistory(res.data);
    } catch (e) { console.error(e); }
  };
  useEffect(() => { refresh(); }, []);
  const handleClockIn = async () => { await axios.post(`${API_BASE}/attendance/clock-in`); refresh(); };
  const handleClockOut = async () => { await axios.post(`${API_BASE}/attendance/clock-out`); refresh(); };
  return (
    <div className='max-w-4xl mx-auto'>
      <h2 className='text-3xl font-bold mb-6'>上班打卡</h2>
      <div className='grid grid-cols-2 gap-6 mb-8'>
        <button onClick={handleClockIn} className='p-10 bg-white shadow rounded-xl border-b-4 border-green-500 hover:bg-green-50 text-center'>
          <div className='text-5xl mb-4'>🌅</div><div className='text-xl font-bold'>上班打卡</div>
        </button>
        <button onClick={handleClockOut} className='p-10 bg-white shadow rounded-xl border-b-4 border-red-500 hover:bg-red-50 text-center'>
          <div className='text-5xl mb-4'>🌃</div><div className='text-xl font-bold'>下班打卡</div>
        </button>
      </div>
      <div className='bg-white shadow rounded-xl overflow-hidden'>
        <table className='w-full text-left'>
          <thead className='bg-gray-100 text-gray-600 uppercase text-sm'><tr><th className='p-4'>日期</th><th className='p-4'>上班時間</th><th className='p-4'>下班時間</th></tr></thead>
          <tbody className='divide-y'>
            {history.map((h, i) => (
              <tr key={i} className='hover:bg-gray-50'>
                <td className='p-4'>{h.date}</td>
                <td className='p-4'>{h.clock_in ? new Date(h.clock_in).toLocaleString() : '-'}</td>
                <td className='p-4'>{h.clock_out ? new Date(h.clock_out).toLocaleString() : '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const AttendanceExceptionView = () => {
  const [form, setForm] = useState({
    exceptionType: 'MISSING_CLOCK_IN',
    date: '',
    requestedClockIn: '',
    requestedClockOut: '',
    reason: ''
  });
  const [exceptions, setExceptions] = useState<AttendanceExceptionRequest[]>([]);
  const refresh = async () => {
    try {
      const res = await axios.get(`${API_BASE}/attendance/exceptions/my`);
      setExceptions(res.data);
    } catch (e) { console.error(e); }
  };
  useEffect(() => { refresh(); }, []);
  const submit = async () => {
    try {
      await axios.post(`${API_BASE}/attendance/exceptions`, form);
      setForm({ exceptionType: 'MISSING_CLOCK_IN', date: '', requestedClockIn: '', requestedClockOut: '', reason: '' });
      refresh();
      alert('補登申請已送出');
    } catch (e: any) {
      alert(e.response?.data?.error || '補登申請失敗');
    }
  };
  const needsClockIn = form.exceptionType === 'MISSING_CLOCK_IN' || form.exceptionType === 'BOTH';
  const needsClockOut = form.exceptionType === 'MISSING_CLOCK_OUT' || form.exceptionType === 'BOTH';
  const formatExceptionType = (type: string) => {
    if (type === 'MISSING_CLOCK_IN') return '忘刷上班';
    if (type === 'MISSING_CLOCK_OUT') return '忘刷下班';
    if (type === 'BOTH') return '上下班皆忘刷';
    return type;
  };
  return (
    <div className='max-w-4xl mx-auto'>
      <h2 className='text-3xl font-bold mb-6'>補登申請</h2>
      <div className='bg-white p-6 shadow rounded-xl mb-8'>
        <h3 className='text-xl font-bold mb-4'>忘刷卡補登申請</h3>
        <div className='grid grid-cols-2 gap-4'>
          <div className='flex flex-col gap-2'>
            <label className='text-sm text-gray-500'>補登類型</label>
            <select className='p-2 border rounded' value={form.exceptionType} onChange={e => setForm({ ...form, exceptionType: e.target.value })}>
              <option value='MISSING_CLOCK_IN'>忘刷上班</option>
              <option value='MISSING_CLOCK_OUT'>忘刷下班</option>
              <option value='BOTH'>上下班皆忘刷</option>
            </select>
          </div>
          <div className='flex flex-col gap-2'>
            <label className='text-sm text-gray-500'>日期</label>
            <input type='date' className='p-2 border rounded' value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} />
          </div>
          {needsClockIn && (
            <div className='flex flex-col gap-2'>
              <label className='text-sm text-gray-500'>補登上班時間</label>
              <input type='time' className='p-2 border rounded' value={form.requestedClockIn} onChange={e => setForm({ ...form, requestedClockIn: e.target.value })} />
            </div>
          )}
          {needsClockOut && (
            <div className='flex flex-col gap-2'>
              <label className='text-sm text-gray-500'>補登下班時間</label>
              <input type='time' className='p-2 border rounded' value={form.requestedClockOut} onChange={e => setForm({ ...form, requestedClockOut: e.target.value })} />
            </div>
          )}
          <div className='col-span-2 flex flex-col gap-2'>
            <label className='text-sm text-gray-500'>原因</label>
            <input className='p-2 border rounded' value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })} placeholder='請說明忘刷原因' />
          </div>
          <button onClick={submit} className='col-span-2 p-3 bg-indigo-600 text-white rounded-lg font-bold hover:bg-indigo-700'>送出補登申請</button>
        </div>
      </div>
      <div className='bg-white shadow rounded-xl overflow-hidden'>
        <div className='p-4 border-b font-bold'>我的補登申請紀錄</div>
        <table className='w-full text-left'>
          <thead className='bg-gray-100 text-gray-600 uppercase text-sm'><tr><th className='p-4'>日期</th><th className='p-4'>類型</th><th className='p-4'>補登時間</th><th className='p-4'>原因</th><th className='p-4'>狀態</th></tr></thead>
          <tbody className='divide-y'>
            {exceptions.length === 0 ? (
              <tr><td className='p-4 text-gray-400 text-center' colSpan={5}>尚無補登申請</td></tr>
            ) : exceptions.map(r => (
              <tr key={r.id} className='hover:bg-gray-50'>
                <td className='p-4'>{r.date}</td>
                <td className='p-4'>{formatExceptionType(r.exception_type)}</td>
                <td className='p-4'>{r.requested_clock_in || '-'} / {r.requested_clock_out || '-'}</td>
                <td className='p-4'>{r.reason}</td>
                <td className='p-4'><span className={`px-2 py-1 rounded text-xs font-bold ${r.status === 'APPROVED' ? 'bg-green-100 text-green-800' : r.status === 'REJECTED' ? 'bg-red-100 text-red-800' : 'bg-yellow-100 text-yellow-800'}`}>{r.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const LeaveView = ({ userId, user }: { userId: number; user: UserData }) => {
  const [form, setForm] = useState({ leaveType: '事假', startDate: '', endDate: '', reason: '' });
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [leaveRules, setLeaveRules] = useState<{ leave_type: string }[]>([]);

  useEffect(() => { 
    axios.get(`${API_BASE}/leave/my`).then((res: AxiosResponse<LeaveRequest[]>) => setRequests(res.data));
    axios.get(`${API_BASE}/leave/rules`).then((res) => {
      const rules = res.data.map((r: any) => ({ leave_type: r.leave_type }));
      // 確保特休也在選項中
      if (!rules.find((r: any) => r.leave_type === '特休')) {
        rules.push({ leave_type: '特休' });
      }
      setLeaveRules(rules);
    });
  }, []);

  const submit = async () => {
    await axios.post(`${API_BASE}/leave`, { ...form });
    setForm({ leaveType: '事假', startDate: '', endDate: '', reason: '' });
    axios.get(`${API_BASE}/leave/my`).then((res: AxiosResponse<LeaveRequest[]>) => setRequests(res.data));
  };

  return (
    <div className='max-w-4xl mx-auto'>
      <h2 className='text-3xl font-bold mb-6'>請假申請</h2>
      <div className='bg-white p-6 shadow rounded-xl mb-8 grid grid-cols-2 gap-4'>
        <div className='flex flex-col gap-2'><label className='text-sm text-gray-500'>種類</label><select className='p-2 border rounded' value={form.leaveType} onChange={e => setForm({...form, leaveType: e.target.value})}>{leaveRules.map(r => <option key={r.leave_type}>{r.leave_type}</option>)}</select></div>
        <div className='flex flex-col gap-2'><label className='text-sm text-gray-500'>開始</label><input type='date' className='p-2 border rounded' value={form.startDate} onChange={e => setForm({...form, startDate: e.target.value})} /></div>
        <div className='flex flex-col gap-2'><label className='text-sm text-gray-500'>結束</label><input type='date' className='p-2 border rounded' value={form.endDate} onChange={e => setForm({...form, endDate: e.target.value})} /></div>
        <div className='flex flex-col gap-2'><label className='text-sm text-gray-500'>原因</label><input className='p-2 border rounded' value={form.reason} onChange={e => setForm({...form, reason: e.target.value})} /></div>
        <button onClick={submit} className='col-span-2 p-3 bg-blue-600 text-white rounded-lg font-bold hover:bg-blue-700'>提交申請</button>
      </div>
      <div className='bg-white shadow rounded-xl overflow-hidden'>
        <table className='w-full text-left'>
          <thead className='bg-gray-100 text-gray-600 uppercase text-sm'><tr><th className='p-4'>種類</th><th className='p-4'>日期</th><th className='p-4'>原因</th><th className='p-4'>狀態</th></tr></thead>
          <tbody className='divide-y'>
            {requests.map((r, i) => (
              <tr key={i} className='hover:bg-gray-50'>
                <td className='p-4'>{r.leave_type}</td>
                <td className='p-4'>{r.start_date} ~ {r.end_date}</td>
                <td className='p-4'>{r.reason}</td>
                <td className='p-4'>
                  <span className={`px-2 py-1 rounded text-xs font-bold ${r.status === 'APPROVED' ? 'bg-green-100 text-green-800' : r.status === 'REJECTED' ? 'bg-red-100 text-red-800' : 'bg-yellow-100 text-yellow-800'}`}>{r.status}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const AdminView = ({ userId }: { userId: number }) => {
  const [pending, setPending] = useState<LeaveRequest[]>([]);
  const [pendingExceptions, setPendingExceptions] = useState<AttendanceExceptionRequest[]>([]);
  useEffect(() => { 
    axios.get(`${API_BASE}/leave/pending`).then((res: AxiosResponse<LeaveRequest[]>) => setPending(res.data));
    axios.get(`${API_BASE}/attendance/exceptions/pending`).then((res: AxiosResponse<AttendanceExceptionRequest[]>) => setPendingExceptions(res.data));
  }, []);
  const handleApprove = async (requestId: number, status: string) => {
    await axios.post(`${API_BASE}/leave/approve`, { requestId, status, comment: 'Checked' });
    setPending(prev => prev.filter(p => p.id !== requestId));
  };
  const handleApproveException = async (requestId: number, status: string) => {
    await axios.post(`${API_BASE}/attendance/exceptions/approve`, { requestId, status, comment: 'Checked' });
    setPendingExceptions(prev => prev.filter(p => p.id !== requestId));
  };
  const formatExceptionType = (type: string) => {
    if (type === 'MISSING_CLOCK_IN') return '忘刷上班';
    if (type === 'MISSING_CLOCK_OUT') return '忘刷下班';
    if (type === 'BOTH') return '上下班皆忘刷';
    return type;
  };
  return (
    <div className='max-w-4xl mx-auto'>
      <h2 className='text-3xl font-bold mb-6'>簽核管理</h2>
      <h3 className='text-xl font-semibold mb-4'>請假申請</h3>
      <div className='grid grid-cols-1 gap-4'>
        {pending.length === 0 ? (<p className='text-gray-500 italic'>目前沒有待簽核的申請單</p>) : pending.map((r, i) => (
          <div key={i} className='bg-white p-6 shadow rounded-xl flex justify-between items-center'>
            <div>
              <p className='font-bold text-lg'>{r.requester_name} <span className='text-sm font-normal text-gray-500'>({r.leave_type})</span></p>
              <p className='text-sm text-gray-400'>{r.start_date} ~ {r.end_date} | 原因: {r.reason}</p>
            </div>
            <div className='flex gap-2'>
              <button onClick={() => handleApprove(r.id, 'APPROVED')} className='p-2 bg-green-500 text-white rounded-lg hover:bg-green-600'><CheckCircle size={20}/></button>
              <button onClick={() => handleApprove(r.id, 'REJECTED')} className='p-2 bg-red-500 text-white rounded-lg hover:bg-red-600'><XCircle size={20}/></button>
            </div>
          </div>
        ))}
      </div>
      <h3 className='text-xl font-semibold mt-10 mb-4'>忘刷卡補登申請</h3>
      <div className='grid grid-cols-1 gap-4'>
        {pendingExceptions.length === 0 ? (<p className='text-gray-500 italic'>目前沒有待審核的補登申請</p>) : pendingExceptions.map((r) => (
          <div key={r.id} className='bg-white p-6 shadow rounded-xl flex justify-between items-center'>
            <div>
              <p className='font-bold text-lg'>{r.requester_name} <span className='text-sm font-normal text-gray-500'>({formatExceptionType(r.exception_type)})</span></p>
              <p className='text-sm text-gray-400'>{r.date} | 上班：{r.requested_clock_in || '-'} | 下班：{r.requested_clock_out || '-'} | 原因: {r.reason}</p>
            </div>
            <div className='flex gap-2'>
              <button onClick={() => handleApproveException(r.id, 'APPROVED')} className='p-2 bg-green-500 text-white rounded-lg hover:bg-green-600'><CheckCircle size={20}/></button>
              <button onClick={() => handleApproveException(r.id, 'REJECTED')} className='p-2 bg-red-500 text-white rounded-lg hover:bg-red-600'><XCircle size={20}/></button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default App;

