import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { DollarSign, Calendar, History, X, Info } from 'lucide-react';

const API_BASE = 'http://localhost:3001/api';

const SalaryPage = () => {
  const [records, setRecords] = useState<any[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showHistory, setShowHistory] = useState(false);
  const [selectedRecord, setSelectedRecord] = useState<any>(null);

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

  const formatDate = (val: any) => val ? new Date(val).toLocaleDateString('zh-TW') : '-';
  const formatTime = (val: any) => val ? String(val).slice(0, 5) : '-';
  const formatMoney = (val: any) => `$${Number(val || 0).toLocaleString()}`;
  const formatDetailAmount = (val: any) => {
    const amount = Number(val || 0);
    if (amount < 0) return `+${formatMoney(Math.abs(amount))}`;
    if (amount > 0) return `-${formatMoney(amount)}`;
    return formatMoney(0);
  };
  const formatNetAdjustment = (val: any) => {
    const amount = Number(val || 0);
    if (amount < 0) return `+${formatMoney(Math.abs(amount))}`;
    if (amount > 0) return `-${formatMoney(amount)}`;
    return formatMoney(0);
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
                <div>
                  <h3 className='text-xl font-bold flex items-center gap-2'><Calendar size={20} className='text-blue-600' /> {r.month}</h3>
                  <p className='text-xs text-gray-500 mt-1'>統計截止日：{formatDate(r.calculation_date)}</p>
                </div>
                <div className='flex items-center gap-3'>
                  <button onClick={() => setSelectedRecord(r)} className='flex items-center gap-2 px-3 py-2 text-sm bg-blue-50 text-blue-700 rounded-lg hover:bg-blue-100 transition'>
                    <Info size={16} /> 詳情
                  </button>
                  <span className={`px-3 py-1 rounded-full text-xs font-bold ${r.status === 'CALCULATED' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>
                    {r.status === 'CALCULATED' ? '已計算' : '草稿'}
                  </span>
                </div>
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
                      {r.deductions.slice(0, 4).map((d: any, i: number) => (
                        <div key={i} className='flex justify-between text-red-600'>
                          <span>{formatDate(d.detail_date)} {d.leave_type} ({d.days}{d.leave_type === '考勤扣款' ? '分鐘' : d.leave_type === '工作時數' ? '小時' : '日'})</span>
                          <span>{formatDetailAmount(d.amount)}</span>
                        </div>
                      ))}
                      {r.deductions.length > 4 && <p className='text-xs text-gray-400'>另有 {r.deductions.length - 4} 筆，請點詳情查看</p>}
                      <div className='flex justify-between pt-2 border-t'><span className='font-bold text-red-600'>扣款/調整</span><span className='font-bold text-red-600'>{formatNetAdjustment(r.total_deductions)}</span></div>
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

      {selectedRecord && (
        <div className='fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4'>
          <div className='bg-white rounded-xl shadow-2xl w-full max-w-5xl max-h-[85vh] flex flex-col'>
            <div className='p-6 border-b flex justify-between items-start'>
              <div>
                <h3 className='text-xl font-bold flex items-center gap-2'><Info size={24} /> {selectedRecord.month} 薪資詳情</h3>
                <p className='text-sm text-gray-500 mt-1'>統計截止日：{formatDate(selectedRecord.calculation_date)}</p>
              </div>
              <button onClick={() => setSelectedRecord(null)} className='p-2 hover:bg-gray-100 rounded'><X size={24} /></button>
            </div>
            <div className='overflow-y-auto p-6 space-y-6'>
              <div className='grid grid-cols-1 md:grid-cols-5 gap-4'>
                <div className='bg-gray-50 p-4 rounded-xl'><p className='text-xs text-gray-500'>本薪</p><p className='font-bold'>{formatMoney(selectedRecord.base_salary)}</p></div>
                <div className='bg-gray-50 p-4 rounded-xl'><p className='text-xs text-gray-500'>專業加給</p><p className='font-bold'>{formatMoney(selectedRecord.professional_allowance)}</p></div>
                <div className='bg-gray-50 p-4 rounded-xl'><p className='text-xs text-gray-500'>伙食津貼</p><p className='font-bold'>{formatMoney(selectedRecord.meal_allowance)}</p></div>
                <div className='bg-red-50 p-4 rounded-xl'><p className='text-xs text-red-500'>扣款/調整</p><p className='font-bold text-red-600'>{formatNetAdjustment(selectedRecord.total_deductions)}</p></div>
                <div className='bg-green-50 p-4 rounded-xl'><p className='text-xs text-green-600'>實領薪資</p><p className='font-bold text-green-700'>{formatMoney(selectedRecord.net_salary)}</p></div>
              </div>
              <div className='overflow-x-auto border border-gray-200 rounded-xl'>
                <table className='w-full text-left text-sm'>
                  <thead className='bg-gray-50 text-gray-500 border-b border-gray-200'>
                    <tr>
                      <th className='px-5 py-3'>日期</th>
                      <th className='px-5 py-3'>項目</th>
                      <th className='px-5 py-3'>時間</th>
                      <th className='px-5 py-3'>數量</th>
                      <th className='px-5 py-3 text-right'>金額</th>
                      <th className='px-5 py-3'>說明</th>
                    </tr>
                  </thead>
                  <tbody className='divide-y divide-gray-100'>
                    {selectedRecord.deductions?.length ? selectedRecord.deductions.map((d: any) => (
                      <tr key={d.id} className='align-top'>
                        <td className='px-5 py-3 whitespace-nowrap'>{formatDate(d.detail_date)}</td>
                        <td className='px-5 py-3 whitespace-nowrap font-medium'>{d.leave_type}</td>
                        <td className='px-5 py-3 whitespace-nowrap'>{formatTime(d.start_time)} - {formatTime(d.end_time)}</td>
                        <td className='px-5 py-3 whitespace-nowrap'>{Number(d.days).toLocaleString()} {d.leave_type === '考勤扣款' ? '分鐘' : d.leave_type === '工作時數' ? '小時' : '日'}</td>
                        <td className={`px-5 py-3 text-right font-mono ${Number(d.amount) < 0 ? 'text-green-600' : Number(d.amount) > 0 ? 'text-red-600' : 'text-gray-500'}`}>{formatDetailAmount(d.amount)}</td>
                        <td className='px-5 py-3 min-w-[280px] text-gray-600'>{d.description || '-'}</td>
                      </tr>
                    )) : (
                      <tr><td className='px-5 py-8 text-center text-gray-400' colSpan={6}>無扣款或異常明細</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SalaryPage;
