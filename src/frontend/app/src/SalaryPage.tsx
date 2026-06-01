import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { DollarSign, Calendar, History, X } from 'lucide-react';

const API_BASE = 'http://localhost:3001/api';

const SalaryPage = () => {
  const [records, setRecords] = useState<any[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    axios.get(`${API_BASE}/salary/my`).then(res => setRecords(res.data)).finally(() => setLoading(false));
  }, []);

  const viewHistory = async () => {
    try {
      const res = await axios.get(`${API_BASE}/salary/history/me`);
      setHistory(res.data);
      setShowHistory(true);
    } catch (e) {
      alert('無法載入歷史記錄');
    }
  };

  if (loading) return <div className='text-gray-500'>載入中...</div>;

  return (
    <div className='max-w-4xl mx-auto'>
      <div className='flex justify-between items-center mb-6'>
        <h2 className='text-3xl font-bold flex items-center gap-3'>
          <DollarSign size={32} /> 我的薪資
        </h2>
        <button onClick={viewHistory} className='flex items-center gap-2 px-4 py-2 bg-gray-100 rounded-lg hover:bg-gray-200 transition'>
          <History size={18} /> 調薪歷史
        </button>
      </div>

      {records.length === 0 ? (
        <div className='bg-white p-8 rounded-xl shadow text-center text-gray-500'>
          目前沒有薪資紀錄
        </div>
      ) : (
        <div className='space-y-6'>
          {records.map(r => (
            <div key={r.id} className='bg-white shadow rounded-xl overflow-hidden'>
              <div className='p-6 border-b border-gray-100 flex justify-between items-center'>
                <h3 className='text-xl font-bold flex items-center gap-2'><Calendar size={20} className='text-blue-600' /> {r.month}</h3>
                <span className={`px-3 py-1 rounded-full text-xs font-bold ${r.status === 'CALCULATED' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>
                  {r.status === 'CALCULATED' ? '已計算' : '草稿'}
                </span>
              </div>
              
              <div className='p-6 grid grid-cols-1 md:grid-cols-2 gap-6'>
                <div>
                  <h4 className='text-sm font-semibold text-gray-500 mb-3'>薪資結構</h4>
                  <div className='space-y-2'>
                    <div className='flex justify-between'><span>本薪</span><span className='font-medium'>${r.base_salary}</span></div>
                    <div className='flex justify-between'><span>專業加給</span><span className='font-medium'>${r.professional_allowance}</span></div>
                    <div className='flex justify-between'><span>伙食津貼</span><span className='font-medium'>${r.meal_allowance}</span></div>
                    <div className='flex justify-between pt-2 border-t'><span className='font-bold'>應發總額</span><span className='font-bold text-blue-600'>${parseFloat(r.base_salary) + parseFloat(r.professional_allowance) + parseFloat(r.meal_allowance)}</span></div>
                  </div>
                </div>

                <div>
                  <h4 className='text-sm font-semibold text-gray-500 mb-3'>扣款明細</h4>
                  {r.deductions && r.deductions.length > 0 ? (
                    <div className='space-y-2'>
                      {r.deductions.map((d: any, i: number) => (
                        <div key={i} className='flex justify-between text-red-600'>
                          <span>{d.leave_type} ({d.days}{d.leave_type === '考勤扣款' ? '分鐘' : '日'})</span>
                          <span>-${d.amount}</span>
                        </div>
                      ))}
                      <div className='flex justify-between pt-2 border-t'><span className='font-bold text-red-600'>扣款總計</span><span className='font-bold text-red-600'>-${r.total_deductions}</span></div>
                    </div>
                  ) : (
                    <p className='text-gray-400 text-sm'>無扣款</p>
                  )}
                </div>
              </div>

              <div className='p-6 bg-gray-50 flex justify-between items-center'>
                <div>
                  <span className='text-lg font-bold text-gray-700'>實領金額</span>
                  {r.paid_status === 'UNPAID' && r.payment_date && (
                    <p className='text-sm text-orange-600 mt-1'>
                      預計發放日：{new Date(r.payment_date).toLocaleDateString('zh-TW')}
                    </p>
                  )}
                </div>
                {r.paid_status === 'UNPAID' ? (
                  <span className='text-2xl font-bold text-orange-600'>尚未發放</span>
                ) : (
                  <span className='text-2xl font-bold text-green-600'>${r.net_salary}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {showHistory && (
        <div className='fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4'>
          <div className='bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col'>
            <div className='p-6 border-b flex justify-between items-center'>
              <h3 className='text-xl font-bold flex items-center gap-2'><History size={24} /> 調薪歷史記錄</h3>
              <button onClick={() => setShowHistory(false)} className='p-2 hover:bg-gray-100 rounded'><X size={24} /></button>
            </div>
            <div className='overflow-y-auto p-6'>
              {history.length === 0 ? (
                <p className='text-center text-gray-500 py-8'>尚無調薪記錄</p>
              ) : (
                <div className='space-y-4'>
                  {history.map((h, i) => (
                    <div key={i} className='p-4 border rounded-lg bg-gray-50'>
                      <div className='flex justify-between items-center mb-2'>
                        <span className='font-bold text-blue-600'>{h.month}</span>
                        <span className='text-xs text-gray-500'>{new Date(h.created_at).toLocaleString()}</span>
                      </div>
                      <div className='grid grid-cols-3 gap-4 text-sm mb-2'>
                        <div><span className='text-gray-500'>本薪:</span> ${h.base_salary}</div>
                        <div><span className='text-gray-500'>專業加給:</span> ${h.professional_allowance}</div>
                        <div><span className='text-gray-500'>伙食津貼:</span> ${h.meal_allowance}</div>
                      </div>
                      <div className='text-sm'>
                        <span className='text-gray-500'>理由:</span> <span className='font-medium'>{h.reason}</span>
                        <span className='text-gray-400 ml-2'>由 {h.updated_by_name} 調整</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SalaryPage;
