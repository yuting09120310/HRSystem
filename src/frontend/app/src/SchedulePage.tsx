import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { ChevronLeft, ChevronRight, Settings, X, Save, Plus, Trash2 } from 'lucide-react';

const API_BASE = 'http://localhost:3001/api';

interface Department {
  id: number;
  name: string;
  type: 'DEPARTMENT' | 'STORE';
  schedule_type: 'FIXED' | 'SHIFT';
}

interface Employee {
  id: number;
  full_name: string;
  work_start_time: string;
  work_end_time: string;
}

interface Shift {
  id: number;
  name: string;
  start_time: string;
  end_time: string;
  color: string;
}

interface ScheduleEntry {
  id: number;
  user_id: number;
  date: string;
  shift_id: number | null;
  shift_name: string | null;
  color: string | null;
  custom_time_start: string | null;
  custom_time_end: string | null;
}

const SchedulePage = () => {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [selectedDept, setSelectedDept] = useState<Department | null>(null);
  const [selectedOrgType, setSelectedOrgType] = useState<'DEPARTMENT' | 'STORE' | ''>('');
  const [userRole, setUserRole] = useState<string>('');
  
  // Fixed Mode State
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState({ work_start_time: '', work_end_time: '' });

  // Shift Mode State
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [schedule, setSchedule] = useState<ScheduleEntry[]>([]);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [loading, setLoading] = useState(false);
  const [dragOverCell, setDragOverCell] = useState<string | null>(null);

  // Settings State
  const [showSettings, setShowSettings] = useState(false);
  const [editingShifts, setEditingShifts] = useState<Shift[]>([]);
  
  // Custom Time Modal State
  const [showCustomTimeModal, setShowCustomTimeModal] = useState(false);
  const [customTimeData, setCustomTimeData] = useState<{userId: number, date: string} | null>(null);
  const [customTimeForm, setCustomTimeForm] = useState({ start_time: '10:00', end_time: '14:00' });

  useEffect(() => {
    // Get user role from localStorage or API
    const storedUser = localStorage.getItem('user');
    if (storedUser) {
      try {
        const user = JSON.parse(storedUser);
        setUserRole(user.role);
      } catch (e) {}
    }

    axios.get(`${API_BASE}/admin/departments`).then(res => setDepartments(res.data));
    fetchShifts();
  }, []);

  const fetchShifts = async () => {
    try {
      const res = await axios.get(`${API_BASE}/shifts`);
      setShifts(res.data);
      setEditingShifts(res.data);
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    if (selectedDept) {
      if (selectedDept.schedule_type === 'FIXED') {
        fetchFixedEmployees(selectedDept.id);
      } else {
        fetchShiftData(selectedDept.id);
      }
    }
  }, [selectedDept, currentDate]);

  const fetchFixedEmployees = async (deptId: number) => {
    setLoading(true);
    try {
      const res = await axios.get(`${API_BASE}/admin/work-schedules`);
      const deptEmployees = res.data.filter((e: any) => e.dept_id === deptId);
      setEmployees(deptEmployees);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const fetchShiftData = async (deptId: number) => {
    setLoading(true);
    try {
      const year = currentDate.getFullYear();
      const month = currentDate.getMonth() + 1;
      const monthStr = `${year}-${String(month).padStart(2, '0')}`;
      console.log('Fetching shift data for:', { deptId, monthStr });
      
      const [empRes, schedRes] = await Promise.all([
        axios.get(`${API_BASE}/stores/${deptId}/employees`),
        axios.get(`${API_BASE}/schedule?storeId=${deptId}&month=${monthStr}`)
      ]);
      
      console.log('Employees:', empRes.data);
      console.log('Schedule:', schedRes.data);
      
      setEmployees(empRes.data);
      setSchedule(schedRes.data);
    } catch (e) {
      console.error('Failed to fetch shift data:', e);
    } finally {
      setLoading(false);
    }
  };

  // Fixed Mode Handlers
  const handleEditFixed = (emp: Employee) => {
    setEditingId(emp.id);
    setEditForm({
      work_start_time: emp.work_start_time ? emp.work_start_time.substring(0, 5) : '08:00',
      work_end_time: emp.work_end_time ? emp.work_end_time.substring(0, 5) : '17:00'
    });
  };

  const handleSaveFixed = async (id: number) => {
    try {
      await axios.put(`${API_BASE}/admin/work-schedules/${id}`, editForm);
      setEditingId(null);
      if (selectedDept) fetchFixedEmployees(selectedDept.id);
    } catch (e) {
      alert('儲存失敗');
    }
  };

  // Shift Mode Helpers
  const getWeekDays = () => {
    const curr = new Date(currentDate);
    const day = curr.getDay();
    const diff = curr.getDate() - day + (day === 0 ? -6 : 1); 
    const monday = new Date(curr.setDate(diff));
    
    const days = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      days.push(d);
    }
    return days;
  };

  const weekDays = getWeekDays();
  const weekStart = weekDays[0];
  const weekEnd = weekDays[6];
  const weekLabel = `${weekStart.getFullYear()}/${String(weekStart.getMonth()+1).padStart(2,'0')}/${String(weekStart.getDate()).padStart(2,'0')} - ${weekEnd.getFullYear()}/${String(weekEnd.getMonth()+1).padStart(2,'0')}/${String(weekEnd.getDate()).padStart(2,'0')}`;

  const handlePrevWeek = () => {
    const newDate = new Date(currentDate);
    newDate.setDate(newDate.getDate() - 7);
    setCurrentDate(newDate);
  };

  const handleNextWeek = () => {
    const newDate = new Date(currentDate);
    newDate.setDate(newDate.getDate() + 7);
    setCurrentDate(newDate);
  };

  const handleToday = () => {
    setCurrentDate(new Date());
  };

  const handleDragStart = (e: React.DragEvent, shiftId: number) => {
    e.dataTransfer.setData('shiftId', shiftId.toString());
    e.dataTransfer.effectAllowed = 'copy';
  };

  const handleDrop = async (e: React.DragEvent, userId: number, date: Date) => {
    e.preventDefault();
    e.stopPropagation();
    
    const shiftIdStr = e.dataTransfer.getData('shiftId');
    console.log('Drop event fired', { shiftIdStr, userId, date });
    
    if (!shiftIdStr || !selectedDept) {
      setDragOverCell(null);
      return;
    }
    
    const shiftId = parseInt(shiftIdStr);
    
    // Check if this is a custom time shift (id = -1)
    if (shiftId === -1) {
      const year = date.getFullYear();
      const month = date.getMonth() + 1;
      const day = date.getDate();
      const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      
      setCustomTimeData({ userId, date: dateStr });
      setShowCustomTimeModal(true);
      setDragOverCell(null);
      return;
    }

    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

    try {
      console.log('Sending to API:', { userId, date: dateStr, shiftId });
      const response = await axios.post(`${API_BASE}/schedule`, { userId, date: dateStr, shiftId });
      console.log('API response:', response.data);
      
      // Refresh the schedule data
      await fetchShiftData(selectedDept.id);
      console.log('Data refreshed');
    } catch (err: any) {
      console.error('排班失敗:', err);
      alert(`排班失敗: ${err.response?.data?.error || err.message}`);
    } finally {
      setDragOverCell(null);
    }
  };
  
  const handleSaveCustomTime = async () => {
    if (!customTimeData || !selectedDept) return;
    
    try {
      // Send custom time as a special shift with start/end times
      await axios.post(`${API_BASE}/schedule/custom`, {
        userId: customTimeData.userId,
        date: customTimeData.date,
        startTime: customTimeForm.start_time,
        endTime: customTimeForm.end_time
      });
      
      await fetchShiftData(selectedDept.id);
      setShowCustomTimeModal(false);
      setCustomTimeData(null);
    } catch (err: any) {
      console.error('自訂時間失敗:', err);
      alert(`儲存失敗: ${err.response?.data?.error || err.message}`);
    }
  };

  const handleDragOver = (e: React.DragEvent, cellId: string) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
    setDragOverCell(cellId);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    // Only clear if we're actually leaving the cell, not moving to a child element
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = e.clientX;
    const y = e.clientY;
    
    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
      setDragOverCell(null);
    }
  };

  const getEntry = (userId: number, date: Date) => {
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    
    // Find entry by comparing dates (handle both ISO strings and simple date strings)
    return schedule.find(s => {
      if (s.user_id !== userId) return false;
      
      // Parse the date from backend (could be ISO string or simple date)
      const entryDate = new Date(s.date);
      const entryDateStr = `${entryDate.getFullYear()}-${String(entryDate.getMonth() + 1).padStart(2, '0')}-${String(entryDate.getDate()).padStart(2, '0')}`;
      
      return entryDateStr === dateStr;
    });
  };

  const isToday = (date: Date) => {
    const today = new Date();
    return date.toDateString() === today.toDateString();
  };

  const formatTime = (time: string | null) => {
    if (!time) return '';
    return time.substring(0, 5);
  };

  // Settings Handlers
  const handleSaveSettings = async () => {
    try {
      for (const shift of editingShifts) {
        if (shift.id) {
          await axios.put(`${API_BASE}/shifts/${shift.id}`, shift);
        }
      }
      fetchShifts();
      setShowSettings(false);
      alert('設定已儲存');
    } catch (e) {
      alert('儲存失敗');
    }
  };

  const handleAddShift = () => {
    const newShift: Shift = {
      id: 0, // Temporary ID for new shifts
      name: '新班別',
      start_time: '09:00:00',
      end_time: '13:00:00',
      color: 'bg-green-100 text-green-800'
    };
    setEditingShifts([...editingShifts, newShift]);
  };

  const handleDeleteShift = (id: number) => {
    if (id > 0) {
      // If it's an existing shift, we might want to warn or handle deletion differently.
      // For now, just remove from editing list.
    }
    setEditingShifts(prev => prev.filter(s => s.id !== id));
  };

  const updateEditingShift = (id: number, field: string, value: string) => {
    setEditingShifts(prev => prev.map(s => s.id === id ? { ...s, [field]: value } : s));
  };

  const handleSaveNewShifts = async () => {
    try {
      // First, save new shifts
      const newShifts = editingShifts.filter(s => s.id === 0);
      for (const shift of newShifts) {
        const res = await axios.post(`${API_BASE}/shifts`, shift);
        shift.id = res.data.id; // Update ID
      }
      
      // Then update existing shifts
      for (const shift of editingShifts) {
        if (shift.id) {
          await axios.put(`${API_BASE}/shifts/${shift.id}`, shift);
        }
      }
      
      fetchShifts();
      setShowSettings(false);
      alert('設定已儲存');
    } catch (e) {
      alert('儲存失敗');
    }
  };

  return (
    <div className='max-w-7xl mx-auto h-screen flex flex-col'>
      <div className='flex justify-between items-center mb-6'>
        <h2 className='text-3xl font-bold'>排班管理</h2>
        <div className='flex gap-4 items-center'>
          <select 
            className='p-2 border rounded text-lg' 
            value={selectedOrgType} 
            onChange={e => {
              setSelectedOrgType(e.target.value as 'DEPARTMENT' | 'STORE' | '');
              setSelectedDept(null);
            }}
          >
            <option value=''>選擇單位類型</option>
            <option value='DEPARTMENT'>總公司部門</option>
            <option value='STORE'>門市</option>
          </select>
          {selectedOrgType && (
            <select 
              className='p-2 border rounded text-lg' 
              value={selectedDept?.id || ''} 
              onChange={e => {
                const dept = departments.find(d => d.id === Number(e.target.value));
                setSelectedDept(dept || null);
              }}
            >
              <option value=''>選擇{selectedOrgType === 'DEPARTMENT' ? '部門' : '門市'}</option>
              {departments
                .filter(d => d.type === selectedOrgType)
                .map(d => <option key={d.id} value={d.id}>{d.name} ({d.schedule_type === 'FIXED' ? '固定制' : '排班制'})</option>)}
            </select>
          )}
        </div>
      </div>

      {!selectedDept ? (
        <div className='flex-1 flex items-center justify-center text-gray-400 text-xl'>
          請選擇要管理的部門或門市
        </div>
      ) : selectedDept.schedule_type === 'FIXED' ? (
        // Fixed Mode View
        <div className='flex-1 bg-white shadow rounded-xl overflow-hidden flex flex-col'>
          <div className='p-4 bg-gray-50 border-b flex justify-between items-center'>
            <h3 className='text-lg font-bold'>{selectedDept.name} - 固定班制管理</h3>
            <span className='text-sm text-gray-500'>設定標準上下班時間</span>
          </div>
          <div className='flex-1 overflow-auto p-6'>
            {loading ? <p className='text-center text-gray-500'>載入中...</p> : (
              <table className='w-full text-left'>
                <thead className='bg-gray-100 text-gray-600 uppercase text-sm'>
                  <tr>
                    <th className='p-4'>姓名</th>
                    <th className='p-4'>上班時間</th>
                    <th className='p-4'>下班時間</th>
                    <th className='p-4'>操作</th>
                  </tr>
                </thead>
                <tbody className='divide-y'>
                  {employees.map((emp) => (
                    <tr key={emp.id} className='hover:bg-gray-50'>
                      <td className='p-4 font-medium'>{emp.full_name}</td>
                      <td className='p-4'>
                        {editingId === emp.id ? (
                          <input type='time' className='p-1 border rounded' value={editForm.work_start_time} onChange={e => setEditForm({ ...editForm, work_start_time: e.target.value })} />
                        ) : (
                          emp.work_start_time ? emp.work_start_time.substring(0, 5) : '08:00'
                        )}
                      </td>
                      <td className='p-4'>
                        {editingId === emp.id ? (
                          <input type='time' className='p-1 border rounded' value={editForm.work_end_time} onChange={e => setEditForm({ ...editForm, work_end_time: e.target.value })} />
                        ) : (
                          emp.work_end_time ? emp.work_end_time.substring(0, 5) : '17:00'
                        )}
                      </td>
                      <td className='p-4'>
                        {editingId === emp.id ? (
                          <div className='flex gap-2'>
                            <button onClick={() => handleSaveFixed(emp.id)} className='px-3 py-1 bg-green-500 text-white rounded hover:bg-green-600'>儲存</button>
                            <button onClick={() => setEditingId(null)} className='px-3 py-1 bg-gray-500 text-white rounded hover:bg-gray-600'>取消</button>
                          </div>
                        ) : (
                          <button onClick={() => handleEditFixed(emp)} className='px-3 py-1 bg-blue-500 text-white rounded hover:bg-blue-600'>編輯</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      ) : (
        // Shift Mode View - Weekly Calendar
        <div className='flex flex-1 gap-4 overflow-hidden'>
          {/* Sidebar */}
          <div className='w-56 bg-white p-4 shadow rounded-xl flex flex-col gap-3'>
            <h3 className='font-bold text-gray-700 border-b pb-2'>班別設定</h3>
            {shifts.map(shift => (
              <div
                key={shift.id}
                draggable
                onDragStart={e => handleDragStart(e, shift.id)}
                className={`p-3 rounded cursor-move text-center font-medium transition hover:shadow-md ${shift.color}`}
              >
                <div className='font-bold'>{shift.name}</div>
                <div className='text-xs mt-1 opacity-80'>
                  {shift.name === '休假' ? '全天' : `${formatTime(shift.start_time)} - ${formatTime(shift.end_time)}`}
                </div>
              </div>
            ))}
            
            {/* Custom Time Shift */}
            <div
              draggable
              onDragStart={e => handleDragStart(e, -1)}
              className='p-3 rounded cursor-move text-center font-medium transition hover:shadow-md bg-gradient-to-r from-indigo-100 to-purple-100 text-indigo-800 border-2 border-dashed border-indigo-300'
            >
              <div className='font-bold'>⏰ 自訂時間</div>
              <div className='text-xs mt-1 opacity-80'>
                拖曳後輸入時間
              </div>
            </div>
            
            <div className='mt-auto pt-4 border-t'>
              {(userRole === 'ADMIN' || userRole === 'MANAGER') && (
                <button 
                  onClick={() => setShowSettings(true)} 
                  className='w-full p-2 bg-gray-100 rounded hover:bg-gray-200 transition flex items-center justify-center gap-2 text-sm font-medium'
                >
                  <Settings size={16} /> 管理班別定義
                </button>
              )}
              <div className='text-xs text-gray-500 pt-2 text-center'>
                拖曳班別至表格中
              </div>
            </div>
          </div>

          {/* Calendar Grid */}
          <div className='flex-1 bg-white shadow rounded-xl overflow-hidden flex flex-col'>
            {/* Calendar Header */}
            <div className='p-4 border-b flex justify-between items-center bg-gray-50'>
              <div className='flex items-center gap-4'>
                <h3 className='font-bold text-lg'>{selectedDept.name}</h3>
                <div className='flex items-center gap-2 bg-white border rounded-lg p-1'>
                  <button onClick={handlePrevWeek} className='p-1 hover:bg-gray-100 rounded'><ChevronLeft size={20} /></button>
                  <span className='px-2 font-medium text-sm'>{weekLabel}</span>
                  <button onClick={handleNextWeek} className='p-1 hover:bg-gray-100 rounded'><ChevronRight size={20} /></button>
                </div>
                <button onClick={handleToday} className='text-sm text-blue-600 hover:underline'>回到本週</button>
              </div>
            </div>

            {/* Grid Content */}
            <div className='flex-1 overflow-auto'>
              {loading ? (
                <p className='p-10 text-center text-gray-500'>載入中...</p>
              ) : (
                <table className='w-full border-collapse min-w-[800px]'>
                  <thead className='bg-gray-50 sticky top-0 z-10'>
                    <tr>
                      <th className='p-3 border-b border-r w-32 text-left bg-gray-50'>員工</th>
                      {weekDays.map((d, i) => (
                        <th key={i} className={`p-2 border-b border-r text-center text-sm font-medium ${isToday(d) ? 'bg-blue-50 text-blue-600' : ''}`}>
                          <div>{['日', '一', '二', '三', '四', '五', '六'][d.getDay()]}</div>
                          <div className='text-lg font-bold'>{d.getDate()}</div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {employees.map(emp => (
                      <tr key={emp.id} className='hover:bg-gray-50'>
                        <td className='p-3 border-r font-medium text-sm bg-white sticky left-0 z-10'>{emp.full_name}</td>
                        {weekDays.map((d, i) => {
                          const entry = getEntry(emp.id, d);
                          const cellId = `${emp.id}-${d.toISOString()}`;
                          const isDragOver = dragOverCell === cellId;
                          return (
                            <td
                              key={i}
                              className={`border-r border-b p-1 h-16 relative transition-colors ${isToday(d) ? 'bg-blue-50/30' : ''} ${isDragOver ? 'bg-blue-100 ring-2 ring-blue-400 ring-inset' : ''}`}
                              onDragOver={e => handleDragOver(e, cellId)}
                              onDragLeave={handleDragLeave}
                              onDrop={e => handleDrop(e, emp.id, d)}
                            >
                              {entry ? (
                                entry.custom_time_start ? (
                                  <div className='h-full rounded flex flex-col items-center justify-center text-xs font-bold cursor-pointer bg-gradient-to-r from-indigo-100 to-purple-100 text-indigo-800 shadow-sm border border-indigo-200'>
                                    <div>⏰ 自訂</div>
                                    <div>{formatTime(entry.custom_time_start)}-{formatTime(entry.custom_time_end)}</div>
                                  </div>
                                ) : (
                                  <div className={`h-full rounded flex items-center justify-center text-xs font-bold cursor-pointer ${entry.color} shadow-sm`}>
                                    {entry.shift_name}
                                  </div>
                                )
                              ) : (
                                <div className='h-full w-full' />
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Settings Modal */}
      {showSettings && (
        <div className='fixed inset-0 bg-black/50 flex items-center justify-center z-50'>
          <div className='bg-white rounded-xl shadow-2xl w-full max-w-3xl p-6 max-h-[90vh] flex flex-col'>
            <div className='flex justify-between items-center mb-6'>
              <h3 className='text-xl font-bold flex items-center gap-2'><Settings size={24} /> 班別定義設定</h3>
              <button onClick={() => setShowSettings(false)} className='p-2 hover:bg-gray-100 rounded'><X size={24} /></button>
            </div>
            <div className='overflow-y-auto flex-1 space-y-4 pr-2'>
              <div className='flex justify-between items-center mb-2'>
                <p className='text-sm text-gray-500'>在此定義所有可用的班別。PT 工讀生可新增 4 小時班別。</p>
                <button onClick={handleAddShift} className='flex items-center gap-1 px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm'>
                  <Plus size={16} /> 新增班別
                </button>
              </div>
              
              {editingShifts.map((shift, idx) => (
                <div key={idx} className='p-4 border rounded-lg bg-gray-50 relative group'>
                  <button 
                    onClick={() => handleDeleteShift(shift.id)}
                    className='absolute top-2 right-2 p-1 text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition'
                  >
                    <Trash2 size={16} />
                  </button>
                  <div className='grid grid-cols-4 gap-4 items-center'>
                    <div>
                      <label className='block text-xs text-gray-500 mb-1'>班別名稱</label>
                      <input 
                        type='text' 
                        value={shift.name} 
                        onChange={e => updateEditingShift(shift.id, 'name', e.target.value)}
                        className='w-full p-2 border rounded focus:ring-2 focus:ring-blue-500 outline-none'
                      />
                    </div>
                    <div>
                      <label className='block text-xs text-gray-500 mb-1'>開始時間</label>
                      <input 
                        type='time' 
                        value={formatTime(shift.start_time)} 
                        onChange={e => updateEditingShift(shift.id, 'start_time', e.target.value + ':00')}
                        className='w-full p-2 border rounded focus:ring-2 focus:ring-blue-500 outline-none'
                        disabled={shift.name === '休假'}
                      />
                    </div>
                    <div>
                      <label className='block text-xs text-gray-500 mb-1'>結束時間</label>
                      <input 
                        type='time' 
                        value={formatTime(shift.end_time)} 
                        onChange={e => updateEditingShift(shift.id, 'end_time', e.target.value + ':00')}
                        className='w-full p-2 border rounded focus:ring-2 focus:ring-blue-500 outline-none'
                        disabled={shift.name === '休假'}
                      />
                    </div>
                    <div>
                      <label className='block text-xs text-gray-500 mb-1'>顏色樣式</label>
                      <select 
                        value={shift.color} 
                        onChange={e => updateEditingShift(shift.id, 'color', e.target.value)}
                        className='w-full p-2 border rounded focus:ring-2 focus:ring-blue-500 outline-none'
                      >
                        <option value='bg-yellow-100 text-yellow-800'>黃色 (早班)</option>
                        <option value='bg-blue-100 text-blue-800'>藍色 (午班)</option>
                        <option value='bg-purple-100 text-purple-800'>紫色 (晚班)</option>
                        <option value='bg-green-100 text-green-800'>綠色</option>
                        <option value='bg-red-100 text-red-800'>紅色</option>
                        <option value='bg-gray-100 text-gray-500'>灰色 (休假)</option>
                        <option value='bg-orange-100 text-orange-800'>橘色</option>
                      </select>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className='flex justify-end gap-3 mt-6 pt-4 border-t'>
              <button onClick={() => setShowSettings(false)} className='px-4 py-2 text-gray-600 hover:bg-gray-100 rounded'>取消</button>
              <button onClick={handleSaveNewShifts} className='px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 flex items-center gap-2'><Save size={18} /> 儲存設定</button>
            </div>
          </div>
        </div>
      )}
      
      {/* Custom Time Modal */}
      {showCustomTimeModal && (
        <div className='fixed inset-0 bg-black/50 flex items-center justify-center z-50'>
          <div className='bg-white rounded-xl shadow-2xl w-full max-w-md p-6'>
            <div className='flex justify-between items-center mb-6'>
              <h3 className='text-xl font-bold flex items-center gap-2'>⏰ 自訂上班時間</h3>
              <button onClick={() => setShowCustomTimeModal(false)} className='p-2 hover:bg-gray-100 rounded'><X size={24} /></button>
            </div>
            
            <div className='space-y-4'>
              <div>
                <label className='block text-sm font-medium text-gray-700 mb-2'>上班時間</label>
                <input 
                  type='time' 
                  value={customTimeForm.start_time}
                  onChange={e => setCustomTimeForm({ ...customTimeForm, start_time: e.target.value })}
                  className='w-full p-3 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-lg'
                />
              </div>
              
              <div>
                <label className='block text-sm font-medium text-gray-700 mb-2'>下班時間</label>
                <input 
                  type='time' 
                  value={customTimeForm.end_time}
                  onChange={e => setCustomTimeForm({ ...customTimeForm, end_time: e.target.value })}
                  className='w-full p-3 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-lg'
                />
              </div>
              
              {customTimeData && (
                <div className='bg-gray-50 p-3 rounded-lg text-sm text-gray-600'>
                  <p>日期：{customTimeData.date}</p>
                </div>
              )}
            </div>
            
            <div className='flex justify-end gap-3 mt-6 pt-4 border-t'>
              <button onClick={() => setShowCustomTimeModal(false)} className='px-4 py-2 text-gray-600 hover:bg-gray-100 rounded'>取消</button>
              <button onClick={handleSaveCustomTime} className='px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 flex items-center gap-2'><Save size={18} /> 儲存</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SchedulePage;
