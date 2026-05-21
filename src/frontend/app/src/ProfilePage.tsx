import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { User, Save, CheckCircle } from 'lucide-react';

const API_BASE = 'http://localhost:3001/api';

const ProfilePage = () => {
  const [profile, setProfile] = useState<any>(null);
  const [fullName, setFullName] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });

  useEffect(() => {
    axios.get(`${API_BASE}/profile`).then(res => {
      setProfile(res.data);
      setFullName(res.data.full_name);
    });
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setMessage({ type: '', text: '' });
    try {
      await axios.put(`${API_BASE}/profile`, { fullName });
      setMessage({ type: 'success', text: '個人資料已更新' });
      const res = await axios.get(`${API_BASE}/profile`);
      setProfile(res.data);
      const savedUser = JSON.parse(localStorage.getItem('user') || '{}');
      savedUser.full_name = fullName;
      localStorage.setItem('user', JSON.stringify(savedUser));
    } catch (err: any) {
      setMessage({ type: 'error', text: err.response?.data?.error || '更新失敗' });
    } finally {
      setSaving(false);
    }
  };

  if (!profile) return <div className='text-gray-500'>載入中...</div>;

  return (
    <div className='max-w-2xl mx-auto'>
      <h2 className='text-3xl font-bold mb-6 flex items-center gap-3'>
        <User size={32} /> 個人資料
      </h2>

      <div className='bg-white shadow rounded-xl overflow-hidden'>
        <div className='p-6 border-b border-gray-100'>
          <h3 className='text-lg font-semibold text-gray-700 mb-4'>基本資訊</h3>
          <div className='grid grid-cols-2 gap-6'>
            <div>
              <label className='block text-sm text-gray-500 mb-1'>帳號</label>
              <div className='p-3 bg-gray-50 rounded-lg text-gray-700 font-medium'>{profile.username}</div>
            </div>
            <div>
              <label className='block text-sm text-gray-500 mb-1'>部門</label>
              <div className='p-3 bg-gray-50 rounded-lg text-gray-700 font-medium'>{profile.dept_name}</div>
            </div>
            <div>
              <label className='block text-sm text-gray-500 mb-1'>角色</label>
              <div className='p-3 bg-gray-50 rounded-lg'>
                <span className={`px-3 py-1 rounded-full text-xs font-bold ${
                  profile.role === 'ADMIN' ? 'bg-purple-100 text-purple-700' :
                  profile.role === 'MANAGER' ? 'bg-blue-100 text-blue-700' :
                  'bg-gray-100 text-gray-600'
                }`}>
                  {profile.role === 'ADMIN' ? '管理員' : profile.role === 'MANAGER' ? '主管' : '員工'}
                </span>
              </div>
            </div>
            <div>
              <label className='block text-sm text-gray-500 mb-1'>姓名</label>
              <input
                type='text'
                value={fullName}
                onChange={e => setFullName(e.target.value)}
                className='w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none'
              />
            </div>
          </div>
        </div>

        {message.text && (
          <div className={`px-6 py-3 flex items-center gap-2 ${message.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
            {message.type === 'success' && <CheckCircle size={18} />}
            {message.text}
          </div>
        )}

        <div className='p-6 bg-gray-50 flex justify-end'>
          <button
            onClick={handleSave}
            disabled={saving}
            className='flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition disabled:opacity-50'
          >
            <Save size={18} /> {saving ? '儲存中...' : '儲存變更'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ProfilePage;
