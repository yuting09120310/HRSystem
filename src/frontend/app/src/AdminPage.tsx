import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Users, Building2, Plus, Save, Trash2, Edit2, CheckCircle, XCircle } from 'lucide-react';

const API_BASE = 'http://localhost:3001/api';

const AdminPage = () => {
  const [tab, setTab] = useState('users');
  const [users, setUsers] = useState<any[]>([]);
  const [departments, setDepartments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const [showUserModal, setShowUserModal] = useState(false);
  const [showDeptModal, setShowDeptModal] = useState(false);
  const [editingUser, setEditingUser] = useState<any>(null);
  const [currentStep, setCurrentStep] = useState(1);
  const [selectedOrgType, setSelectedOrgType] = useState<'DEPARTMENT' | 'STORE' | ''>('');
  
  const [userForm, setUserForm] = useState({ 
    username: '', 
    password: '', 
    fullName: '', 
    email: '',
    deptId: '', 
    role: 'EMPLOYEE', 
    status: 'ACTIVE', 
    employmentType: 'FULL_TIME', 
    position: '',
    hourlyWage: '',
    baseSalary: '',
    professionalAllowance: '',
    mealAllowance: '',
    educationLevel: '',
    universityName: '',
    department: ''
  });
  const [deptForm, setDeptForm] = useState({ name: '', scheduleType: 'FIXED', type: 'DEPARTMENT' });

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [usersRes, deptsRes] = await Promise.all([
        axios.get(`${API_BASE}/admin/users`),
        axios.get(`${API_BASE}/admin/departments`)
      ]);
      setUsers(usersRes.data);
      setDepartments(deptsRes.data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveUser = async () => {
    try {
      if (editingUser) {
        await axios.put(`${API_BASE}/admin/users/${editingUser.id}`, userForm);
      } else {
        await axios.post(`${API_BASE}/admin/users`, userForm);
      }
      setShowUserModal(false);
      setEditingUser(null);
      fetchData();
    } catch (e: any) {
      alert(e.response?.data?.error || '操作失敗');
    }
  };

  const openEditUser = (user: any) => {
    setEditingUser(user);
    setCurrentStep(1);
    // 管理員不需要部門，直接設定為空
    if (user.role === 'ADMIN') {
      setSelectedOrgType('');
    } else {
      setSelectedOrgType(departments.find(d => d.id === user.dept_id)?.type || '');
    }
    setUserForm({ 
      username: user.username, 
      password: '', 
      fullName: user.full_name, 
      email: user.email || '',
      deptId: user.dept_id || '', 
      role: user.role, 
      status: user.status,
      employmentType: user.employment_type || 'FULL_TIME',
      position: user.position || '',
      hourlyWage: user.hourly_wage || '',
      baseSalary: user.base_salary || '',
      professionalAllowance: user.professional_allowance || '',
      mealAllowance: user.meal_allowance || '',
      educationLevel: user.education_level || '',
      universityName: user.university_name || '',
      department: user.department || ''
    });
    setShowUserModal(true);
  };

  const openAddUser = () => {
    setEditingUser(null);
    setCurrentStep(1);
    setSelectedOrgType('');
    setUserForm({ 
      username: '', 
      password: '', 
      fullName: '', 
      email: '',
      deptId: '', 
      role: 'EMPLOYEE', 
      status: 'ACTIVE', 
      employmentType: 'FULL_TIME', 
      position: '',
      hourlyWage: '',
      baseSalary: '',
      professionalAllowance: '',
      mealAllowance: '',
      educationLevel: '',
      universityName: '',
      department: ''
    });
    setShowUserModal(true);
  };

  const validateStep = (step: number): boolean => {
    if (step === 1) {
      // Step 1: Personal info
      if (!userForm.fullName) {
        alert('請填寫姓名');
        return false;
      }
      if (!editingUser && !userForm.username) {
        alert('請填寫帳號');
        return false;
      }
      if (!editingUser && !userForm.password) {
        alert('請填寫密碼');
        return false;
      }
      return true;
    }
    if (step === 2) {
      // Step 2: Department & Type
      // ADMIN 角色不需要選擇部門
      if (userForm.role !== 'ADMIN' && !userForm.deptId) {
        alert('請選擇部門');
        return false;
      }
      return true;
    }
    if (step === 3) {
      // Step 3: Education - no required fields
      return true;
    }
    if (step === 4 && !editingUser) {
      // Step 4: Salary structure (only for new employees)
      if (userForm.employmentType === 'PART_TIME') {
        if (!userForm.hourlyWage) {
          alert('請填寫時薪');
          return false;
        }
      } else {
        if (!userForm.baseSalary) {
          alert('請填寫基本薪資');
          return false;
        }
      }
      return true;
    }
    return true;
  };

  const getMaxStep = () => {
    return editingUser ? 3 : 4;
  };

  const handleNextStep = () => {
    if (validateStep(currentStep)) {
      setCurrentStep(currentStep + 1);
    }
  };

  const handlePrevStep = () => {
    setCurrentStep(currentStep - 1);
  };

  const handleUpdateDeptManager = async (deptId: number, managerId: number | null) => {
    try {
      await axios.put(`${API_BASE}/admin/departments/${deptId}`, { managerId });
      fetchData();
    } catch (e: any) {
      alert(e.response?.data?.error || '更新失敗');
    }
  };

  const handleCreateDept = async () => {
    if (!deptForm.name) return;
    try {
      await axios.post(`${API_BASE}/admin/departments`, deptForm);
      setShowDeptModal(false);
      setDeptForm({ name: '', scheduleType: 'FIXED', type: 'DEPARTMENT' });
      fetchData();
    } catch (e: any) {
      alert(e.response?.data?.error || '建立失敗');
    }
  };

  if (loading) return <div className='text-gray-500'>載入中...</div>;

  return (
    <div className='max-w-6xl mx-auto'>
      <h2 className='text-3xl font-bold mb-6 flex items-center gap-3'>
        <Building2 size={32} /> 系統管理
      </h2>

      <div className='flex gap-4 mb-6 border-b border-gray-200'>
        <button onClick={() => setTab('users')} className={`pb-3 px-4 font-medium transition ${tab === 'users' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-gray-500 hover:text-gray-700'}`}>
          <Users size={18} className='inline mr-2' />人員管理
        </button>
        <button onClick={() => setTab('departments')} className={`pb-3 px-4 font-medium transition ${tab === 'departments' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-gray-500 hover:text-gray-700'}`}>
          <Building2 size={18} className='inline mr-2' />部門管理
        </button>
      </div>

      {tab === 'users' && (
        <div>
          <div className='flex justify-between items-center mb-4'>
            <h3 className='text-xl font-semibold'>人員列表</h3>
            <button onClick={openAddUser} className='flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700'>
              <Plus size={18} /> 新增人員
            </button>
          </div>
          <div className='bg-white shadow rounded-xl overflow-hidden'>
            <table className='w-full text-left'>
              <thead className='bg-gray-100 text-gray-600 uppercase text-sm'>
                <tr>
                  <th className='p-4'>帳號</th>
                  <th className='p-4'>姓名</th>
                  <th className='p-4'>Email</th>
                  <th className='p-4'>部門</th>
                  <th className='p-4'>僱用類型</th>
                  <th className='p-4'>職位</th>
                  <th className='p-4'>薪資結構</th>
                  <th className='p-4'>角色</th>
                  <th className='p-4'>狀態</th>
                  <th className='p-4 text-right'>操作</th>
                </tr>
              </thead>
              <tbody className='divide-y'>
                {users.map(u => (
                  <tr key={u.id} className='hover:bg-gray-50'>
                    <td className='p-4 font-medium'>{u.username}</td>
                    <td className='p-4'>{u.full_name}</td>
                    <td className='p-4 text-sm text-gray-600'>{u.email || '-'}</td>
                    <td className='p-4'>{u.dept_name || (u.role === 'ADMIN' ? '系統管理' : '-')}</td>
                    <td className='p-4'>
                      <span className={`px-2 py-1 rounded text-xs font-bold ${u.employment_type === 'PART_TIME' ? 'bg-orange-100 text-orange-700' : 'bg-green-100 text-green-700'}`}>
                        {u.employment_type === 'PART_TIME' ? '工讀' : '正職'}
                      </span>
                    </td>
                    <td className='p-4'>
                      <span className='text-sm'>{u.position || '-'}</span>
                    </td>
                    <td className='p-4'>
                      {u.employment_type === 'PART_TIME' ? (
                        <span className='text-sm'>時薪 ${u.hourly_wage || 0}</span>
                      ) : (
                        <div className='text-xs'>
                          <div>基本: ${u.currentSalary?.base_salary || 0}</div>
                          <div>加給: ${u.currentSalary?.professional_allowance || 0}</div>
                          <div>伙食: ${u.currentSalary?.meal_allowance || 0}</div>
                        </div>
                      )}
                    </td>
                    <td className='p-4'>
                      <span className={`px-2 py-1 rounded text-xs font-bold ${u.role === 'ADMIN' ? 'bg-red-100 text-red-700' : u.role === 'MANAGER' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>
                        {u.role === 'ADMIN' ? '系統管理員' : u.role === 'MANAGER' ? '部門主管' : '員工'}
                      </span>
                    </td>
                    <td className='p-4'>
                      <span className={`px-2 py-1 rounded text-xs font-bold ${u.status === 'ACTIVE' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                        {u.status === 'ACTIVE' ? '在職' : '離職'}
                      </span>
                    </td>
                    <td className='p-4 text-right'>
                      <button onClick={() => openEditUser(u)} className='p-2 text-blue-600 hover:bg-blue-50 rounded'><Edit2 size={18} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'departments' && (
        <div>
          <div className='flex justify-between items-center mb-6'>
            <h3 className='text-xl font-semibold'>部門列表</h3>
            <button onClick={() => setShowDeptModal(true)} className='flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700'>
              <Plus size={18} /> 新增部門/門市
            </button>
          </div>
          <div className='grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6'>
            {departments.map(dept => (
              <div key={dept.id} className='bg-white p-6 shadow rounded-xl relative'>
                <div className='absolute top-4 right-4'>
                  <span className={`px-2 py-1 rounded text-xs font-bold ${dept.schedule_type === 'SHIFT' ? 'bg-orange-100 text-orange-700' : 'bg-gray-100 text-gray-600'}`}>
                    {dept.schedule_type === 'SHIFT' ? '排班制' : '固定制'}
                  </span>
                </div>
                <h3 className='text-lg font-bold mb-4 flex items-center gap-2'><Building2 size={20} className='text-blue-600' /> {dept.name}</h3>
                <div className='mb-4'>
                  <label className='block text-sm text-gray-500 mb-2'>部門最高管理員</label>
                  <select
                    value={dept.manager_id || ''}
                    onChange={e => handleUpdateDeptManager(dept.id, e.target.value ? parseInt(e.target.value) : null)}
                    className='w-full p-2 border rounded focus:ring-2 focus:ring-blue-500 outline-none'
                  >
                    <option value=''>無</option>
                    {users.filter(u => u.dept_id === dept.id && u.status === 'ACTIVE').map(u => (
                      <option key={u.id} value={u.id}>{u.full_name} ({u.role === 'MANAGER' ? '主管' : '員工'})</option>
                    ))}
                  </select>
                </div>
                {dept.manager_name && (
                  <p className='text-sm text-gray-600'>當前管理員：<span className='font-medium'>{dept.manager_name}</span></p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {showUserModal && (
        <div className='fixed inset-0 bg-black/50 flex items-center justify-center z-50'>
          <div className='bg-white rounded-xl shadow-2xl w-full max-w-2xl p-6'>
            <h3 className='text-xl font-bold mb-4'>{editingUser ? '編輯人員' : '新增人員'}</h3>
            
            {/* Step Indicator */}
            <div className='flex items-center justify-center mb-6'>
              <div className={`flex items-center ${currentStep >= 1 ? 'text-blue-600' : 'text-gray-400'}`}>
                <div className={`w-8 h-8 rounded-full flex items-center justify-center ${currentStep >= 1 ? 'bg-blue-600 text-white' : 'bg-gray-200'}`}>1</div>
                <span className='ml-2 text-sm font-medium'>個資帳號</span>
              </div>
              <div className={`w-12 h-1 mx-2 ${currentStep >= 2 ? 'bg-blue-600' : 'bg-gray-200'}`}></div>
              <div className={`flex items-center ${currentStep >= 2 ? 'text-blue-600' : 'text-gray-400'}`}>
                <div className={`w-8 h-8 rounded-full flex items-center justify-center ${currentStep >= 2 ? 'bg-blue-600 text-white' : 'bg-gray-200'}`}>2</div>
                <span className='ml-2 text-sm font-medium'>部門職位</span>
              </div>
              <div className={`w-12 h-1 mx-2 ${currentStep >= 3 ? 'bg-blue-600' : 'bg-gray-200'}`}></div>
              <div className={`flex items-center ${currentStep >= 3 ? 'text-blue-600' : 'text-gray-400'}`}>
                <div className={`w-8 h-8 rounded-full flex items-center justify-center ${currentStep >= 3 ? 'bg-blue-600 text-white' : 'bg-gray-200'}`}>3</div>
                <span className='ml-2 text-sm font-medium'>教育程度</span>
              </div>
              {!editingUser && (
                <>
                  <div className={`w-12 h-1 mx-2 ${currentStep >= 4 ? 'bg-blue-600' : 'bg-gray-200'}`}></div>
                  <div className={`flex items-center ${currentStep >= 4 ? 'text-blue-600' : 'text-gray-400'}`}>
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center ${currentStep >= 4 ? 'bg-blue-600 text-white' : 'bg-gray-200'}`}>4</div>
                    <span className='ml-2 text-sm font-medium'>薪資結構</span>
                  </div>
                </>
              )}
            </div>

            <div className='space-y-4 min-h-[300px]'>
              {/* Step 1: Personal Info */}
              {currentStep === 1 && (
                <>
                  <h4 className='text-lg font-semibold text-gray-700 mb-4'>步驟 1：個人資訊與帳號</h4>
                  <div>
                    <label className='block text-sm text-gray-500 mb-1'>姓名 *</label>
                    <input type='text' value={userForm.fullName} onChange={e => setUserForm({...userForm, fullName: e.target.value})} className='w-full p-2 border rounded' placeholder='請填寫真實姓名' />
                  </div>
                   <div>
                     <label className='block text-sm text-gray-500 mb-1'>帳號 *</label>
                     <input type='text' value={userForm.username} onChange={e => setUserForm({...userForm, username: e.target.value})} className='w-full p-2 border rounded' disabled={!!editingUser} placeholder='登入系統使用的帳號' />
                   </div>
                   <div>
                     <label className='block text-sm text-gray-500 mb-1'>Email</label>
                     <input type='email' value={userForm.email} onChange={e => setUserForm({...userForm, email: e.target.value})} className='w-full p-2 border rounded' placeholder='例如：user@example.com' />
                     <p className='text-xs text-gray-400 mt-1'>用於打卡異常與後續通知寄送</p>
                   </div>
                   {!editingUser && (
                    <div>
                      <label className='block text-sm text-gray-500 mb-1'>密碼 *</label>
                      <input type='text' value={userForm.password} onChange={e => setUserForm({...userForm, password: e.target.value})} className='w-full p-2 border rounded' placeholder='請設定密碼' />
                    </div>
                  )}
                </>
              )}

              {/* Step 2: Department & Position */}
              {currentStep === 2 && (
                <>
                  <h4 className='text-lg font-semibold text-gray-700 mb-4'>步驟 2：部門與職位</h4>
                  <div>
                    <label className='block text-sm text-gray-500 mb-1'>系統角色</label>
                    <select value={userForm.role} onChange={e => {
                      const newRole = e.target.value;
                      setUserForm({...userForm, role: newRole, deptId: newRole === 'ADMIN' ? '' : userForm.deptId});
                      if (newRole === 'ADMIN') {
                        setSelectedOrgType('');
                      }
                    }} className='w-full p-2 border rounded'>
                      <option value='EMPLOYEE'>員工</option>
                      <option value='MANAGER'>部門主管</option>
                      <option value='ADMIN'>系統管理員（最高權限，不限部門）</option>
                    </select>
                  </div>
                  {userForm.role !== 'ADMIN' && (
                    <>
                      <div>
                        <label className='block text-sm text-gray-500 mb-1'>單位類型 *</label>
                        <select 
                          value={selectedOrgType} 
                          onChange={e => {
                            setSelectedOrgType(e.target.value as 'DEPARTMENT' | 'STORE' | '');
                            setUserForm({...userForm, deptId: ''});
                          }} 
                          className='w-full p-2 border rounded'
                          disabled={!!editingUser}
                        >
                          <option value=''>請選擇單位類型</option>
                          <option value='DEPARTMENT'>總公司部門</option>
                          <option value='STORE'>門市</option>
                        </select>
                      </div>
                      {selectedOrgType && (
                        <div>
                          <label className='block text-sm text-gray-500 mb-1'>
                            {selectedOrgType === 'DEPARTMENT' ? '選擇部門' : '選擇門市'} *
                          </label>
                          <select 
                            value={userForm.deptId} 
                            onChange={e => setUserForm({...userForm, deptId: e.target.value})} 
                            className='w-full p-2 border rounded'
                          >
                            <option value=''>請選擇{selectedOrgType === 'DEPARTMENT' ? '部門' : '門市'}</option>
                            {departments
                              .filter(d => d.type === selectedOrgType)
                              .map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                          </select>
                        </div>
                      )}
                    </>
                  )}
                  <div>
                    <label className='block text-sm text-gray-500 mb-1'>僱用類型 *</label>
                    <select value={userForm.employmentType} onChange={e => setUserForm({...userForm, employmentType: e.target.value})} className='w-full p-2 border rounded'>
                      <option value='FULL_TIME'>正職</option>
                      <option value='PART_TIME'>工讀 (PT)</option>
                    </select>
                  </div>
                  <div>
                    <label className='block text-sm text-gray-500 mb-1'>職位名稱（選填）</label>
                    <input type='text' value={userForm.position} onChange={e => setUserForm({...userForm, position: e.target.value})} className='w-full p-2 border rounded' placeholder='例如：資深工程師、專案經理' />
                  </div>
                </>
              )}

              {/* Step 3: Education */}
              {currentStep === 3 && (
                <>
                  <h4 className='text-lg font-semibold text-gray-700 mb-4'>步驟 3：教育程度</h4>
                  <div>
                    <label className='block text-sm text-gray-500 mb-1'>教育程度</label>
                    <select value={userForm.educationLevel} onChange={e => setUserForm({...userForm, educationLevel: e.target.value})} className='w-full p-2 border rounded'>
                      <option value=''>請選擇</option>
                      <option value='HIGH_SCHOOL'>高中</option>
                      <option value='BACHELOR'>大學</option>
                      <option value='MASTER'>碩士</option>
                      <option value='PHD'>博士</option>
                    </select>
                  </div>
                  {userForm.educationLevel === 'BACHELOR' && (
                    <>
                      <div>
                        <label className='block text-sm text-gray-500 mb-1'>大學名稱</label>
                        <input type='text' value={userForm.universityName} onChange={e => setUserForm({...userForm, universityName: e.target.value})} className='w-full p-2 border rounded' placeholder='例如：台灣大學' />
                      </div>
                      <div>
                        <label className='block text-sm text-gray-500 mb-1'>科系</label>
                        <input type='text' value={userForm.department} onChange={e => setUserForm({...userForm, department: e.target.value})} className='w-full p-2 border rounded' placeholder='例如：資訊工程學系' />
                      </div>
                    </>
                  )}
                </>
              )}

              {/* Step 4: Salary Structure (Only for new employees) */}
              {currentStep === 4 && !editingUser && (
                <>
                  <h4 className='text-lg font-semibold text-gray-700 mb-4'>步驟 4：薪資結構</h4>
                  {userForm.employmentType === 'PART_TIME' ? (
                    <div>
                      <label className='block text-sm text-gray-500 mb-1'>時薪 (元) *</label>
                      <input type='number' value={userForm.hourlyWage} onChange={e => setUserForm({...userForm, hourlyWage: e.target.value})} className='w-full p-2 border rounded' placeholder='例如：180' />
                      <p className='text-xs text-gray-400 mt-1'>工讀生依實際工作時數計算薪資</p>
                    </div>
                  ) : (
                    <>
                      <div>
                        <label className='block text-sm text-gray-500 mb-1'>基本薪資 *</label>
                        <input type='number' value={userForm.baseSalary} onChange={e => setUserForm({...userForm, baseSalary: e.target.value})} className='w-full p-2 border rounded' placeholder='例如：35000' />
                      </div>
                      <div>
                        <label className='block text-sm text-gray-500 mb-1'>專業加給</label>
                        <input type='number' value={userForm.professionalAllowance} onChange={e => setUserForm({...userForm, professionalAllowance: e.target.value})} className='w-full p-2 border rounded' placeholder='例如：5000' />
                      </div>
                      <div>
                        <label className='block text-sm text-gray-500 mb-1'>伙食津貼</label>
                        <input type='number' value={userForm.mealAllowance} onChange={e => setUserForm({...userForm, mealAllowance: e.target.value})} className='w-full p-2 border rounded' placeholder='例如：2000' />
                      </div>
                      <div className='bg-gray-50 p-3 rounded mt-4'>
                        <p className='text-sm text-gray-600'>預計月薪：<span className='font-bold text-blue-600'>${(Number(userForm.baseSalary || 0) + Number(userForm.professionalAllowance || 0) + Number(userForm.mealAllowance || 0)).toLocaleString()}</span></p>
                      </div>
                    </>
                  )}
                </>
              )}
            </div>
            
            <div className='flex justify-between mt-6 pt-4 border-t'>
              <div>
                {currentStep > 1 && (
                  <button onClick={handlePrevStep} className='px-4 py-2 text-gray-600 hover:bg-gray-100 rounded'>上一步</button>
                )}
              </div>
              <div className='flex gap-3'>
                <button onClick={() => setShowUserModal(false)} className='px-4 py-2 text-gray-600 hover:bg-gray-100 rounded'>取消</button>
                {currentStep < getMaxStep() ? (
                  <button onClick={handleNextStep} className='px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700'>下一步</button>
                ) : (
                  <button onClick={handleSaveUser} className='px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 flex items-center gap-2'><Save size={18} /> {editingUser ? '儲存變更' : '完成建立'}</button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {showDeptModal && (
        <div className='fixed inset-0 bg-black/50 flex items-center justify-center z-50'>
          <div className='bg-white rounded-xl shadow-2xl w-full max-w-md p-6'>
            <h3 className='text-xl font-bold mb-4'>新增單位</h3>
            <div className='space-y-4'>
              <div>
                <label className='block text-sm text-gray-500 mb-1'>單位類型</label>
                <select value={deptForm.type} onChange={e => setDeptForm({...deptForm, type: e.target.value})} className='w-full p-2 border rounded'>
                  <option value='DEPARTMENT'>總公司部門</option>
                  <option value='STORE'>門市</option>
                </select>
              </div>
              <div>
                <label className='block text-sm text-gray-500 mb-1'>名稱</label>
                <input type='text' value={deptForm.name} onChange={e => setDeptForm({...deptForm, name: e.target.value})} className='w-full p-2 border rounded' placeholder={deptForm.type === 'STORE' ? '例如：忠孝店' : '例如：資訊部'} />
              </div>
              <div>
                <label className='block text-sm text-gray-500 mb-1'>班制類型</label>
                <select value={deptForm.scheduleType} onChange={e => setDeptForm({...deptForm, scheduleType: e.target.value})} className='w-full p-2 border rounded'>
                  <option value='FIXED'>固定制 (如：資訊部)</option>
                  <option value='SHIFT'>排班制 (如：門市)</option>
                </select>
              </div>
            </div>
            <div className='flex justify-end gap-3 mt-6'>
              <button onClick={() => setShowDeptModal(false)} className='px-4 py-2 text-gray-600 hover:bg-gray-100 rounded'>取消</button>
              <button onClick={handleCreateDept} className='px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 flex items-center gap-2'><Save size={18} /> 儲存</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminPage;
