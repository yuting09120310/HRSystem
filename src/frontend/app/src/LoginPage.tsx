import React, { useState } from 'react';
import axios from 'axios';
import { LogIn, Lock, User as UserIcon } from 'lucide-react';

const API_BASE = 'http://localhost:3001/api';

interface LoginProps {
  onLoginSuccess: (token: string, user: any) => void;
}

const LoginPage = ({ onLoginSuccess }: LoginProps) => {
  const [account, setAccount] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await axios.post(`${API_BASE}/auth/login`, { account, password });
      if (res.data.success) {
        localStorage.setItem('token', res.data.token);
        localStorage.setItem('user', JSON.stringify(res.data.user));
        axios.defaults.headers.common['Authorization'] = `Bearer ${res.data.token}`;
        onLoginSuccess(res.data.token, res.data.user);
      }
    } catch (err: any) {
      setError(err.response?.data?.error || '登入失敗');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className='min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 flex items-center justify-center p-4'>
      <div className='bg-white rounded-2xl shadow-2xl w-full max-w-md p-8'>
        <div className='text-center mb-8'>
          <div className='inline-flex items-center justify-center w-16 h-16 bg-blue-600 rounded-full mb-4'>
            <LogIn size={32} className='text-white' />
          </div>
          <h1 className='text-3xl font-bold text-gray-800'>HR System</h1>
          <p className='text-gray-500 mt-2'>請輸入帳號密碼登入</p>
        </div>

        <form onSubmit={handleLogin} className='space-y-6'>
          <div>
            <label className='block text-sm font-medium text-gray-700 mb-2'>帳號</label>
            <div className='relative'>
              <UserIcon size={20} className='absolute left-3 top-1/2 -translate-y-1/2 text-gray-400' />
              <input
                type='text'
                value={account}
                onChange={e => setAccount(e.target.value)}
                className='w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition'
                placeholder='請輸入帳號'
                required
              />
            </div>
          </div>

          <div>
            <label className='block text-sm font-medium text-gray-700 mb-2'>密碼</label>
            <div className='relative'>
              <Lock size={20} className='absolute left-3 top-1/2 -translate-y-1/2 text-gray-400' />
              <input
                type='password'
                value={password}
                onChange={e => setPassword(e.target.value)}
                className='w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition'
                placeholder='請輸入密碼'
                required
              />
            </div>
          </div>

          {error && (
            <div className='bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-lg text-sm'>
              {error}
            </div>
          )}

          <button
            type='submit'
            disabled={loading}
            className='w-full bg-blue-600 text-white py-3 rounded-lg font-semibold hover:bg-blue-700 transition disabled:opacity-50 disabled:cursor-not-allowed'
          >
            {loading ? '登入中...' : '登入'}
          </button>
        </form>

        <div className='mt-6 p-4 bg-gray-50 rounded-lg text-xs text-gray-500'>
          <p className='font-medium mb-1'>測試帳號（密碼皆為 pass）：</p>
          <p>admin（管理員）</p>
          <p>it_manager（資訊主管）</p>
          <p>it_staff（資訊員工）</p>
        </div>
      </div>
    </div>
  );
};

export default LoginPage;
