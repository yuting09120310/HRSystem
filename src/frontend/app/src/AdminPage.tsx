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
  const [editingUser, setEditingUser] = useState<any>(null);
  const [userForm, setUserForm] = useState({ username: '', password: '', fullName: '', deptId: '', role: 'EMPLOYEE', status: 'ACTIVE' });

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
    setUserForm({ username: user.username, password: '', fullName: user.full_name, deptId: user.dept_id, role: user.role, status: user.status });
    setShowUserModal(true);
  };

  const openAddUser = () => {
    setEditingUser(null);
    setUserForm({ username: '', password: '', fullName: '', deptId: departments[0]?.id || '', role: 'EMPLOYEE', status: 'ACTIVE' });
    setShowUserModal(true);
  };

  const handleUpdateDeptManager = async (deptId: number, managerId: number | null) => {
    try {
      await axios.put(`${API_BASE}/admin/departments/${deptId}`, { managerId });
      fetchData();
    } catch (e: any) {
      alert(e.response?.data?.error || '更新失敗');
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
                  <th className='p-4'>部門</th>
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
                    <td className='p-4'>{u.dept_name || '-'}</td>
                    <td className='p-4'>
                      <span className={`px-2 py-1 rounded text-xs font-bold ${u.role === 'ADMIN' ? 'bg-purple-100 text-purple-700' : u.role === 'MANAGER' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>
                        {u.role === 'ADMIN' ? '管理員' : u.role === 'MANAGER' ? '主管' : '員工'}
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
        <div className='grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6'>
          {departments.map(dept => (
            <div key={dept.id} className='bg-white p-6 shadow rounded-xl'>
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
      )}

      {showUserModal && (
        <div className='fixed inset-0 bg-black/50 flex items-center justify-center z-50'>
          <div className='bg-white rounded-xl shadow-2xl w-full max-w-md p-6'>
            <h3 className='text-xl font-bold mb-4'>{editingUser ? '編輯人員' : '新增人員'}</h3>
            <div className='space-y-4'>
              <div>
                <label className='block text-sm text-gray-500 mb-1'>帳號</label>
                <input type='text' value={userForm.username} onChange={e => setUserForm({...userForm, username: e.target.value})} className='w-full p-2 border rounded' disabled={!!editingUser} />
              </div>
              {!editingUser && (
                <div>
                  <label className='block text-sm text-gray-500 mb-1'>密碼</label>
                  <input type='text' value={userForm.password} onChange={e => setUserForm({...userForm, password: e.target.value})} className='w-full p-2 border rounded' />
                </div>
              )}
              <div>
                <label className='block text-sm text-gray-500 mb-1'>姓名</label>
                <input type='text' value={userForm.fullName} onChange={e => setUserForm({...userForm, fullName: e.target.value})} className='w-full p-2 border rounded' />
              </div>
              <div>
                <label className='block text-sm text-gray-500 mb-1'>部門</label>
                <select value={userForm.deptId} onChange={e => setUserForm({...userForm, deptId: e.target.value})} className='w-full p-2 border rounded'>
                  {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
              <div>
                <label className='block text-sm text-gray-500 mb-1'>角色</label>
                <select value={userForm.role} onChange={e => setUserForm({...userForm, role: e.target.value})} className='w-full p-2 border rounded'>
                  <option value='EMPLOYEE'>員工</option>
                  <option value='MANAGER'>主管</option>
                  <option value='ADMIN'>管理員</option>
                </select>
              </div>
              {editingUser && (
                <div>
                  <label className='block text-sm text-gray-500 mb-1'>狀態</label>
                  <select value={userForm.status} onChange={e => setUserForm({...userForm, status: e.target.value})} className='w-full p-2 border rounded'>
                    <option value='ACTIVE'>在職</option>
                    <option value='RESIGNED'>離職</option>
                  </select>
                </div>
              )}
            </div>
            <div className='flex justify-end gap-3 mt-6'>
              <button onClick={() => setShowUserModal(false)} className='px-4 py-2 text-gray-600 hover:bg-gray-100 rounded'>取消</button>
              <button onClick={handleSaveUser} className='px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 flex items-center gap-2'><Save size={18} /> 儲存</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminPage;
