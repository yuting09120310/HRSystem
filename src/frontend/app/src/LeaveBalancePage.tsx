import React, { useState, useEffect } from 'react';
import axios from 'axios';

const API_BASE = 'http://localhost:3001/api';

interface LeaveBalance {
  leave_type: string;
  total_days: number;
  used_days: number;
}

const LeaveBalancePage = () => {
  const [balances, setBalances] = useState<LeaveBalance[]>([]);
  const [loading, setLoading] = useState(true);
  const year = new Date().getFullYear();

  useEffect(() => {
    fetchBalances();
  }, []);

  const fetchBalances = async () => {
    try {
      setLoading(true);
      const res = await axios.get(`${API_BASE}/leave/balance?year=${year}`);
      setBalances(res.data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const getRemaining = (total: number, used: number) => Math.max(0, total - used);

  const getLeaveIcon = (type: string) => {
    switch (type) {
      case '特休': return '🌴';
      case '事假': return '📝';
      case '病假': return '🏥';
      case '婚假': return '💍';
      case '喪假': return '🕊️';
      case '公假': return '🏛️';
      default: return '📅';
    }
  };

  const getProgressColor = (remaining: number, total: number) => {
    const ratio = remaining / total;
    if (ratio <= 0.2) return 'bg-red-500';
    if (ratio <= 0.5) return 'bg-yellow-500';
    return 'bg-green-500';
  };

  return (
    <div className='max-w-4xl mx-auto'>
      <div className='flex justify-between items-center mb-6'>
        <h2 className='text-3xl font-bold'>我的假別餘額 ({year})</h2>
        <button onClick={fetchBalances} className='px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700'>重新整理</button>
      </div>

      {loading ? (
        <p className='text-gray-500'>載入中...</p>
      ) : balances.length === 0 ? (
        <p className='text-gray-500'>目前沒有假別資料，請確認入職日是否已設定。</p>
      ) : (
        <div className='grid grid-cols-1 md:grid-cols-2 gap-6'>
          {balances.map((b, i) => {
            const remaining = getRemaining(b.total_days, b.used_days);
            const progress = b.total_days > 0 ? (b.used_days / b.total_days) * 100 : 0;
            return (
              <div key={i} className='bg-white p-6 shadow rounded-xl'>
                <div className='flex items-center gap-3 mb-4'>
                  <span className='text-3xl'>{getLeaveIcon(b.leave_type)}</span>
                  <div>
                    <h3 className='text-xl font-bold'>{b.leave_type}</h3>
                    <p className='text-sm text-gray-500'>{year} 年度</p>
                  </div>
                </div>
                <div className='space-y-3'>
                  <div className='flex justify-between text-sm'>
                    <span className='text-gray-500'>總計</span>
                    <span className='font-bold'>{b.total_days} 天</span>
                  </div>
                  <div className='flex justify-between text-sm'>
                    <span className='text-gray-500'>已使用</span>
                    <span className='font-bold text-blue-600'>{b.used_days} 天</span>
                  </div>
                  <div className='flex justify-between text-sm'>
                    <span className='text-gray-500'>剩餘</span>
                    <span className='font-bold text-green-600'>{remaining} 天</span>
                  </div>
                  {b.total_days > 0 && (
                    <div className='w-full bg-gray-200 rounded-full h-2.5 mt-2'>
                      <div
                        className={`h-2.5 rounded-full ${getProgressColor(remaining, b.total_days)}`}
                        style={{ width: `${progress}%` }}
                      ></div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default LeaveBalancePage;
