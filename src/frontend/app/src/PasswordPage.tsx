import React, { useState } from 'react';
import axios from 'axios';
import { Lock, Save, CheckCircle, Eye, EyeOff } from 'lucide-react';

const API_BASE = 'http://localhost:3001/api';

const PasswordPage = () => {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage({ type: '', text: '' });

    if (newPassword !== confirmPassword) {
      return setMessage({ type: 'error', text: '新密碼與確認密碼不一致' });
    }
    if (newPassword.length < 4) {
      return setMessage({ type: 'error', text: '新密碼至少需要 4 個字元' });
    }

    setSaving(true);
    try {
      await axios.put(`${API_BASE}/password`, { currentPassword, newPassword });
      setMessage({ type: 'success', text: '密碼已成功修改' });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err: any) {
      setMessage({ type: 'error', text: err.response?.data?.error || '修改失敗' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className='max-w-2xl mx-auto'>
      <h2 className='text-3xl font-bold mb-6 flex items-center gap-3'>
        <Lock size={32} /> 修改密碼
      </h2>

      <div className='bg-white shadow rounded-xl overflow-hidden'>
        <form onSubmit={handleSubmit} className='p-6 space-y-6'>
          <div>
            <label className='block text-sm font-medium text-gray-700 mb-2'>目前密碼</label>
            <div className='relative'>
              <Lock size={18} className='absolute left-3 top-1/2 -translate-y-1/2 text-gray-400' />
              <input
                type={showPassword ? 'text' : 'password'}
                value={currentPassword}
                onChange={e => setCurrentPassword(e.target.value)}
                className='w-full pl-10 pr-12 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none'
                placeholder='請輸入目前密碼'
                required
              />
            </div>
          </div>

          <div>
            <label className='block text-sm font-medium text-gray-700 mb-2'>新密碼</label>
            <div className='relative'>
              <Lock size={18} className='absolute left-3 top-1/2 -translate-y-1/2 text-gray-400' />
              <input
                type={showPassword ? 'text' : 'password'}
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                className='w-full pl-10 pr-12 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none'
                placeholder='請輸入新密碼（至少 4 個字元）'
                required
              />
              <button
                type='button'
                onClick={() => setShowPassword(!showPassword)}
                className='absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600'
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          <div>
            <label className='block text-sm font-medium text-gray-700 mb-2'>確認新密碼</label>
            <div className='relative'>
              <Lock size={18} className='absolute left-3 top-1/2 -translate-y-1/2 text-gray-400' />
              <input
                type={showPassword ? 'text' : 'password'}
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                className='w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none'
                placeholder='請再次輸入新密碼'
                required
              />
            </div>
          </div>

          {message.text && (
            <div className={`p-4 rounded-lg flex items-center gap-2 ${message.type === 'success' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
              {message.type === 'success' && <CheckCircle size={18} />}
              {message.text}
            </div>
          )}

          <div className='flex justify-end pt-2'>
            <button
              type='submit'
              disabled={saving}
              className='flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition disabled:opacity-50'
            >
              <Save size={18} /> {saving ? '修改中...' : '確認修改'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default PasswordPage;
