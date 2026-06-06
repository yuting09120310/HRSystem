import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Calculator, Save, Info, History, X, Edit3 } from 'lucide-react';

const API_BASE = 'http://localhost:3001/api';

const SalaryManagementPage = () => {
  const [employees, setEmployees] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingUser, setEditingUser] = useState<any>(null);
  const [structure, setStructure] = useState({ baseSalary: '', professionalAllowance: '', mealAllowance: '' });
  const [reason, setReason] = useState('');
  const [calcMonth, setCalcMonth] = useState(new Date().toISOString().slice(0, 7));
  const [calcDate, setCalcDate] = useState(new Date().toISOString().slice(0, 10));
  const [history, setHistory] = useState<any[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [showTooltip, setShowTooltip] = useState(false);
  const [detailUser, setDetailUser] = useState<any>(null);
  const [salaryRecords, setSalaryRecords] = useState<any[]>([]);
  const [adjustmentForm, setAdjustmentForm] = useState({ month: new Date().toISOString().slice(0, 7), adjustmentType: '補發薪資', amount: '', description: '' });
  const [batchResult, setBatchResult] = useState<any>(null);
  const [monthSummary, setMonthSummary] = useState<any>({ DRAFT: 0, CALCULATED: 0, CONFIRMED: 0, PAID: 0, LOCKED: 0 });
  const [batchPreview, setBatchPreview] = useState<any>(null);

  useEffect(() => {
    fetchData();
  }, []);

  useEffect(() => {
    fetchMonthSummary();
  }, [calcMonth]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const empRes = await axios.get(`${API_BASE}/salary/employees`);
      setEmployees(empRes.data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveStructure = async () => {
    if (!editingUser) return;
    if (!reason) return alert('請填寫調薪理由');
    try {
      await axios.put(`${API_BASE}/salary/structure`, {
        userId: editingUser.id,
        baseSalary: parseFloat(structure.baseSalary),
        professionalAllowance: parseFloat(structure.professionalAllowance),
        mealAllowance: parseFloat(structure.mealAllowance),
        reason
      });
      alert('薪資結構已更新');
      setEditingUser(null);
      setReason('');
      fetchData();
    } catch (e: any) {
      alert(e.response?.data?.error || '更新失敗');
    }
  };

  const handleCalculate = async (userId: number) => {
    try {
      const res = await axios.post(`${API_BASE}/salary/calculate`, { userId, month: calcMonth, calculationDate: calcDate });
      alert(`計算完成！實領薪資：$${res.data.netSalary}`);
      fetchData();
    } catch (e: any) {
      alert(e.response?.data?.error || '計算失敗');
    }
  };

  const fetchMonthSummary = async () => {
    try {
      const res = await axios.get(`${API_BASE}/salary/month-summary`, { params: { month: calcMonth } });
      setMonthSummary(res.data.summary);
    } catch (e) {
      console.error(e);
    }
  };

  const handleCalculateAll = async () => {
    if (!window.confirm(`確定要計算 ${calcMonth} 全部在職人員薪資？統計截止日：${calcDate}`)) return;
    try {
      const res = await axios.post(`${API_BASE}/salary/calculate-all`, { month: calcMonth, calculationDate: calcDate });
      const errorText = res.data.errors?.length ? `，${res.data.errors.length} 筆失敗` : '';
      alert(`全員薪資計算完成：${res.data.count} 筆成功${errorText}`);
      fetchData();
    } catch (e: any) {
      alert(e.response?.data?.error || '全員計算失敗');
    }
  };

  const handleBatchAction = async (action: 'confirm' | 'pay' | 'lock') => {
    const actionText = action === 'confirm' ? '批次確認' : action === 'pay' ? '批次發放' : '批次鎖定';
    try {
      const previewRes = await axios.post(`${API_BASE}/salary/batch/${action}/preview`, { month: calcMonth });
      setBatchPreview({ ...previewRes.data, actionText, action });
    } catch (e: any) {
      alert(e.response?.data?.error || `${actionText}預覽失敗`);
    }
  };

  const handleConfirmBatchAction = async () => {
    if (!batchPreview) return;
    try {
      const res = await axios.post(`${API_BASE}/salary/batch/${batchPreview.action}`, { month: calcMonth });
      setBatchResult(res.data);
      setBatchPreview(null);
      fetchData();
      fetchMonthSummary();
      if (detailUser) {
        const detailRes = await axios.get(`${API_BASE}/salary/employees/${detailUser.id}/records`);
        setSalaryRecords(detailRes.data.records);
      }
    } catch (e: any) {
      alert(e.response?.data?.error || `${batchPreview.actionText}失敗`);
    }
  };

  const openEdit = (user: any) => {
    setEditingUser(user);
    setStructure({
      baseSalary: user.currentSalary?.base_salary || '',
      professionalAllowance: user.currentSalary?.professional_allowance || '',
      mealAllowance: user.currentSalary?.meal_allowance || ''
    });
    setReason('');
  };

  const viewHistory = async (user: any) => {
    try {
      const res = await axios.get(`${API_BASE}/salary/history/${user.id}`);
      setHistory(res.data);
      setShowHistory(true);
    } catch (e) {
      alert('無法載入歷史記錄');
    }
  };

  const viewSalaryDetails = async (user: any) => {
    try {
      const res = await axios.get(`${API_BASE}/salary/employees/${user.id}/records`);
      setDetailUser(res.data.employee);
      setSalaryRecords(res.data.records);
      setAdjustmentForm({ month: calcMonth, adjustmentType: '補發薪資', amount: '', description: '' });
    } catch (e: any) {
      alert(e.response?.data?.error || '無法載入薪資詳情');
    }
  };

  const handleCreateAdjustment = async () => {
    if (!detailUser) return;
    if (!adjustmentForm.amount || !adjustmentForm.description) return alert('請填寫金額與調整原因');
    const amount = Math.abs(parseFloat(adjustmentForm.amount));
    const signedAmount = adjustmentForm.adjustmentType.includes('扣款') ? -amount : amount;
    try {
      await axios.post(`${API_BASE}/salary/adjustments`, {
        userId: detailUser.id,
        month: adjustmentForm.month,
        adjustmentType: adjustmentForm.adjustmentType,
        amount: signedAmount,
        description: adjustmentForm.description
      });
      const res = await axios.get(`${API_BASE}/salary/employees/${detailUser.id}/records`);
      setSalaryRecords(res.data.records);
      setAdjustmentForm({ ...adjustmentForm, amount: '', description: '' });
      fetchData();
    } catch (e: any) {
      alert(e.response?.data?.error || '新增調整失敗');
    }
  };

  const refreshDetailRecords = async () => {
    if (!detailUser) return;
    const res = await axios.get(`${API_BASE}/salary/employees/${detailUser.id}/records`);
    setSalaryRecords(res.data.records);
  };

  const handleRecordAction = async (recordId: number, action: 'confirm' | 'pay' | 'lock') => {
    const labels = { confirm: '確認', pay: '發放', lock: '鎖定' };
    try {
      await axios.post(`${API_BASE}/salary/records/${recordId}/${action}`);
      await refreshDetailRecords();
      fetchData();
      alert(`薪資表已${labels[action]}`);
    } catch (e: any) {
      alert(e.response?.data?.error || `${labels[action]}失敗`);
    }
  };

  const formatMoney = (val: any) => {
    if (!val && val !== 0) return '-';
    return `$${Number(val).toLocaleString()}`;
  };

  const formatDate = (val: any) => val ? new Date(val).toLocaleDateString('zh-TW') : '-';
  const formatTime = (val: any) => val ? String(val).slice(0, 5) : '-';
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
  const getStatusMeta = (status: string) => {
    if (status === 'LOCKED') return { label: '已鎖定', className: 'bg-slate-100 text-slate-700' };
    if (status === 'PAID') return { label: '已發放', className: 'bg-emerald-100 text-emerald-700' };
    if (status === 'CONFIRMED') return { label: '已確認', className: 'bg-blue-100 text-blue-700' };
    if (status === 'CALCULATED') return { label: '已計算', className: 'bg-amber-100 text-amber-700' };
    return { label: '草稿', className: 'bg-gray-100 text-gray-600' };
  };

  if (loading) return <div className='flex items-center justify-center h-64 text-gray-400'>載入中...</div>;

  return (
    <div className='max-w-7xl mx-auto'>
      <div className='flex items-center justify-between mb-8'>
        <div>
          <h2 className='text-3xl font-bold text-gray-900'>薪資管理</h2>
          <p className='text-gray-500 mt-1'>管理員工薪資結構與計算</p>
        </div>
        <div className='flex items-center gap-4'>
          <div className='relative'>
            <button 
              onMouseEnter={() => setShowTooltip(true)}
              onMouseLeave={() => setShowTooltip(false)}
              className='flex items-center gap-2 px-4 py-2 text-sm text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50'
            >
              <Info size={16} /> 扣款規則
            </button>
            {showTooltip && (
              <div className='absolute right-0 top-full mt-2 w-72 p-4 bg-gray-900 text-white text-sm rounded-lg shadow-xl z-50'>
                <p className='font-semibold mb-2'>薪資扣款計算方式</p>
                <ul className='space-y-1 text-gray-300'>
                  <li>• 事假：總薪資 ÷ 30 × 天數</li>
                  <li>• 病假：(總薪資 ÷ 30 ÷ 2) × 天數</li>
                </ul>
              </div>
            )}
          </div>
          <div className='flex items-center gap-2'>
            <label className='text-sm text-gray-500'>計算月份</label>
            <input 
              type='month' 
              value={calcMonth} 
              onChange={e => setCalcMonth(e.target.value)} 
              className='px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none' 
            />
          </div>
          <div className='flex items-center gap-2'>
            <label className='text-sm text-gray-500'>薪資計算日</label>
            <input 
              type='date' 
              value={calcDate} 
              onChange={e => setCalcDate(e.target.value)} 
              className='px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none' 
            />
          </div>
          <button onClick={handleCalculateAll} className='flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 font-medium transition shadow-sm'>
            <Calculator size={16} /> 全員計算
          </button>
          <button onClick={() => handleBatchAction('confirm')} className='px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium transition shadow-sm'>批次確認</button>
          <button onClick={() => handleBatchAction('pay')} className='px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 font-medium transition shadow-sm'>批次發放</button>
          <button onClick={() => handleBatchAction('lock')} className='px-4 py-2 bg-slate-700 text-white rounded-lg hover:bg-slate-800 font-medium transition shadow-sm'>批次鎖定</button>
        </div>
      </div>

      <div className='grid grid-cols-2 md:grid-cols-5 gap-4 mb-6'>
        {[
          { key: 'DRAFT', label: '草稿', color: 'bg-gray-50 text-gray-700 border-gray-200' },
          { key: 'CALCULATED', label: '已計算', color: 'bg-amber-50 text-amber-700 border-amber-200' },
          { key: 'CONFIRMED', label: '已確認', color: 'bg-blue-50 text-blue-700 border-blue-200' },
          { key: 'PAID', label: '已發放', color: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
          { key: 'LOCKED', label: '已鎖定', color: 'bg-slate-50 text-slate-700 border-slate-200' }
        ].map(item => (
          <div key={item.key} className={`rounded-xl border p-4 ${item.color}`}>
            <p className='text-xs font-medium mb-1'>{calcMonth} {item.label}</p>
            <p className='text-2xl font-bold'>{monthSummary[item.key] || 0}</p>
          </div>
        ))}
      </div>

      {batchResult && (
        <div className='mb-6 bg-white border border-gray-200 rounded-xl p-4 shadow-sm'>
          <div className='flex items-start justify-between gap-4'>
            <div>
              <p className='font-semibold text-gray-900'>{batchResult.message}</p>
              <p className='text-sm text-gray-600 mt-1'>成功 {batchResult.processedCount} 筆，跳過 {batchResult.skippedCount} 筆</p>
              {batchResult.skipped?.length > 0 && (
                <p className='text-xs text-gray-500 mt-2'>跳過原因範例：{batchResult.skipped.slice(0, 3).map((s: any) => `${s.name}(${s.reason})`).join('、')}</p>
              )}
            </div>
            <button onClick={() => setBatchResult(null)} className='text-sm text-gray-500 hover:text-gray-700'>關閉</button>
          </div>
        </div>
      )}

      {batchPreview && (
        <div className='fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4'>
          <div className='bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[80vh] flex flex-col'>
            <div className='p-6 border-b border-gray-100 flex justify-between items-start'>
              <div>
                <h3 className='text-xl font-bold text-gray-900'>{batchPreview.actionText}預覽</h3>
                <p className='text-sm text-gray-500 mt-1'>月份：{batchPreview.month}</p>
              </div>
              <button onClick={() => setBatchPreview(null)} className='p-2 hover:bg-gray-100 rounded-lg transition'>
                <X size={20} className='text-gray-400' />
              </button>
            </div>
            <div className='p-6 overflow-y-auto space-y-4'>
              <div className='grid grid-cols-2 gap-4'>
                <div className='p-4 rounded-xl bg-emerald-50 text-emerald-700'>
                  <p className='text-sm'>本次可處理</p>
                  <p className='text-2xl font-bold mt-1'>{batchPreview.eligibleCount}</p>
                </div>
                <div className='p-4 rounded-xl bg-amber-50 text-amber-700'>
                  <p className='text-sm'>本次跳過</p>
                  <p className='text-2xl font-bold mt-1'>{batchPreview.skippedCount}</p>
                </div>
              </div>
              <div>
                <p className='font-semibold text-gray-900 mb-2'>可處理名單</p>
                <div className='text-sm text-gray-600 bg-gray-50 rounded-xl p-4 max-h-40 overflow-y-auto'>
                  {batchPreview.eligible?.length ? batchPreview.eligible.map((item: any) => item.name).join('、') : '無符合條件的薪資表'}
                </div>
              </div>
              <div>
                <p className='font-semibold text-gray-900 mb-2'>跳過名單</p>
                <div className='text-sm text-gray-600 bg-gray-50 rounded-xl p-4 max-h-40 overflow-y-auto'>
                  {batchPreview.skipped?.length ? batchPreview.skipped.map((item: any) => `${item.name}(${item.reason})`).join('、') : '無'}
                </div>
              </div>
            </div>
            <div className='p-6 border-t border-gray-100 flex justify-end gap-3'>
              <button onClick={() => setBatchPreview(null)} className='px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50'>取消</button>
              <button onClick={handleConfirmBatchAction} className='px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700'>確認執行</button>
            </div>
          </div>
        </div>
      )}

      <div className='bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden'>
        <div className='overflow-x-auto'>
          <table className='w-full text-left'>
            <thead className='bg-gray-50 border-b border-gray-200'>
              <tr>
                <th className='px-6 py-4 text-sm font-semibold text-gray-600'>員工</th>
                <th className='px-6 py-4 text-sm font-semibold text-gray-600'>部門</th>
                <th className='px-6 py-4 text-sm font-semibold text-gray-600 text-right'>本薪</th>
                <th className='px-6 py-4 text-sm font-semibold text-gray-600 text-right'>專業加給</th>
                <th className='px-6 py-4 text-sm font-semibold text-gray-600 text-right'>伙食津貼</th>
                <th className='px-6 py-4 text-sm font-semibold text-gray-600 text-right'>總計</th>
                <th className='px-6 py-4 text-sm font-semibold text-gray-600 text-right'>扣款</th>
                <th className='px-6 py-4 text-sm font-semibold text-gray-600 text-right'>實領</th>
                <th className='px-6 py-4 text-sm font-semibold text-gray-600 text-center'>操作</th>
              </tr>
            </thead>
            <tbody className='divide-y divide-gray-100'>
              {employees.map(u => {
                const total = u.currentSalary 
                  ? parseFloat(u.currentSalary.base_salary) + parseFloat(u.currentSalary.professional_allowance) + parseFloat(u.currentSalary.meal_allowance)
                  : 0;
                return (
                  <tr key={u.id} className='hover:bg-gray-50 transition-colors'>
                    <td className='px-6 py-4'>
                      <div className='flex items-center gap-3'>
                        <div className='w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-bold text-sm'>
                          {u.full_name.charAt(0)}
                        </div>
                        <div>
                          <p className='font-semibold text-gray-900'>{u.full_name}</p>
                          <p className='text-xs text-gray-500'>{u.username}</p>
                        </div>
                      </div>
                    </td>
                    <td className='px-6 py-4 text-gray-600'>{u.dept_name}</td>
                    <td className='px-6 py-4 text-right font-mono text-gray-700'>{formatMoney(u.currentSalary?.base_salary)}</td>
                    <td className='px-6 py-4 text-right font-mono text-gray-700'>{formatMoney(u.currentSalary?.professional_allowance)}</td>
                    <td className='px-6 py-4 text-right font-mono text-gray-700'>{formatMoney(u.currentSalary?.meal_allowance)}</td>
                    <td className='px-6 py-4 text-right font-mono font-bold text-gray-900'>{formatMoney(total)}</td>
                    <td className='px-6 py-4 text-right font-mono text-red-600'>{formatNetAdjustment(u.currentSalary?.total_deductions)}</td>
                    <td className='px-6 py-4 text-right font-mono text-green-700'>{formatMoney(u.currentSalary?.net_salary)}</td>
                    <td className='px-6 py-4'>
                      <div className='flex items-center justify-center gap-2 whitespace-nowrap'>
                        <button onClick={() => viewSalaryDetails(u)} className='px-3 py-2 text-sm text-purple-700 bg-purple-50 hover:bg-purple-100 rounded-lg transition flex items-center gap-1' title='薪資詳情與人工調整'>
                          <Info size={16} /> 詳情/調整
                        </button>
                        <button onClick={() => handleCalculate(u.id)} className='px-3 py-2 text-sm text-green-700 bg-green-50 hover:bg-green-100 rounded-lg transition flex items-center gap-1' title='計算薪資'>
                          <Calculator size={16} /> 計算
                        </button>
                        <button onClick={() => openEdit(u)} className='px-3 py-2 text-sm text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg transition flex items-center gap-1' title='編輯薪資'>
                          <Edit3 size={16} /> 結構
                        </button>
                        <button onClick={() => viewHistory(u)} className='px-3 py-2 text-sm text-gray-600 bg-gray-50 hover:bg-gray-100 rounded-lg transition flex items-center gap-1' title='歷史記錄'>
                          <History size={16} /> 歷史
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {editingUser && (
        <div className='fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4'>
          <div className='bg-white rounded-2xl shadow-2xl w-full max-w-lg'>
            <div className='p-6 border-b border-gray-100 flex justify-between items-center'>
              <div>
                <h3 className='text-xl font-bold text-gray-900'>調整薪資結構</h3>
                <p className='text-sm text-gray-500 mt-1'>{editingUser.full_name} - {editingUser.dept_name}</p>
              </div>
              <button onClick={() => setEditingUser(null)} className='p-2 hover:bg-gray-100 rounded-lg transition'>
                <X size={20} className='text-gray-400' />
              </button>
            </div>
            
            <div className='p-6 space-y-5'>
              <div className='grid grid-cols-3 gap-4'>
                <div>
                  <label className='block text-sm font-medium text-gray-700 mb-2'>本薪</label>
                  <input 
                    type='number' 
                    value={structure.baseSalary} 
                    onChange={e => setStructure({...structure, baseSalary: e.target.value})} 
                    className='w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none text-lg font-mono' 
                    placeholder='40000'
                  />
                </div>
                <div>
                  <label className='block text-sm font-medium text-gray-700 mb-2'>專業加給</label>
                  <input 
                    type='number' 
                    value={structure.professionalAllowance} 
                    onChange={e => setStructure({...structure, professionalAllowance: e.target.value})} 
                    className='w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none text-lg font-mono' 
                    placeholder='3000'
                  />
                </div>
                <div>
                  <label className='block text-sm font-medium text-gray-700 mb-2'>伙食津貼</label>
                  <input 
                    type='number' 
                    value={structure.mealAllowance} 
                    onChange={e => setStructure({...structure, mealAllowance: e.target.value})} 
                    className='w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none text-lg font-mono' 
                    placeholder='2000'
                  />
                </div>
              </div>

              <div className='bg-blue-50 border border-blue-200 rounded-lg p-4'>
                <p className='text-sm text-blue-800 font-medium mb-1'>調薪後總計</p>
                <p className='text-2xl font-bold text-blue-600'>
                  ${(parseFloat(structure.baseSalary || '0') + parseFloat(structure.professionalAllowance || '0') + parseFloat(structure.mealAllowance || '0')).toLocaleString()}
                </p>
              </div>

              <div>
                <label className='block text-sm font-medium text-gray-700 mb-2'>調薪理由 <span className='text-red-500'>*</span></label>
                <input 
                  type='text' 
                  value={reason} 
                  onChange={e => setReason(e.target.value)} 
                  className='w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none' 
                  placeholder='例如：例行調薪、績效考核調整...'
                />
              </div>
            </div>

            <div className='p-6 border-t border-gray-100 flex justify-end gap-3 bg-gray-50 rounded-b-2xl'>
              <button onClick={() => setEditingUser(null)} className='px-6 py-3 text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 font-medium transition'>
                取消
              </button>
              <button onClick={handleSaveStructure} className='px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium flex items-center gap-2 transition shadow-sm'>
                <Save size={18} /> 儲存變更
              </button>
            </div>
          </div>
        </div>
      )}

      {showHistory && (
        <div className='fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4'>
          <div className='bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col'>
            <div className='p-6 border-b border-gray-100 flex justify-between items-center'>
              <div>
                <h3 className='text-xl font-bold text-gray-900 flex items-center gap-2'>
                  <History size={24} className='text-blue-600' /> 調薪歷史記錄
                </h3>
                <p className='text-sm text-gray-500 mt-1'>查看所有薪資調整紀錄</p>
              </div>
              <button onClick={() => setShowHistory(false)} className='p-2 hover:bg-gray-100 rounded-lg transition'>
                <X size={20} className='text-gray-400' />
              </button>
            </div>
            <div className='overflow-y-auto p-6'>
              {history.length === 0 ? (
                <div className='text-center py-12'>
                  <History size={48} className='mx-auto text-gray-300 mb-4' />
                  <p className='text-gray-500'>尚無調薪記錄</p>
                </div>
              ) : (
                <div className='space-y-4'>
                  {history.map((h, i) => (
                    <div key={i} className='p-5 border border-gray-200 rounded-xl hover:border-blue-300 hover:shadow-sm transition'>
                      <div className='flex justify-between items-center mb-3'>
                        <span className='px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-sm font-bold'>{h.month}</span>
                        <span className='text-xs text-gray-400'>{new Date(h.created_at).toLocaleString()}</span>
                      </div>
                      <div className='grid grid-cols-3 gap-4 mb-3'>
                        <div className='bg-gray-50 p-3 rounded-lg'>
                          <p className='text-xs text-gray-500 mb-1'>本薪</p>
                          <p className='font-bold text-gray-900'>${Number(h.base_salary).toLocaleString()}</p>
                        </div>
                        <div className='bg-gray-50 p-3 rounded-lg'>
                          <p className='text-xs text-gray-500 mb-1'>專業加給</p>
                          <p className='font-bold text-gray-900'>${Number(h.professional_allowance).toLocaleString()}</p>
                        </div>
                        <div className='bg-gray-50 p-3 rounded-lg'>
                          <p className='text-xs text-gray-500 mb-1'>伙食津貼</p>
                          <p className='font-bold text-gray-900'>${Number(h.meal_allowance).toLocaleString()}</p>
                        </div>
                      </div>
                      <div className='flex items-center gap-2 text-sm'>
                        <span className='text-gray-500'>理由：</span>
                        <span className='font-medium text-gray-900'>{h.reason}</span>
                        <span className='text-gray-400 ml-auto'>由 {h.updated_by_name} 調整</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {detailUser && (
        <div className='fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4'>
          <div className='bg-white rounded-2xl shadow-2xl w-full max-w-5xl max-h-[85vh] flex flex-col'>
            <div className='p-6 border-b border-gray-100 flex justify-between items-start'>
              <div>
                <h3 className='text-xl font-bold text-gray-900'>{detailUser.full_name} 薪資詳情</h3>
                <p className='text-sm text-gray-500 mt-1'>{detailUser.dept_name || '未分配部門'} · {detailUser.username}</p>
              </div>
              <button onClick={() => setDetailUser(null)} className='p-2 hover:bg-gray-100 rounded-lg transition'>
                <X size={20} className='text-gray-400' />
              </button>
            </div>
            <div className='overflow-y-auto p-6 space-y-6'>
              <div className='grid grid-cols-1 md:grid-cols-4 gap-4'>
                <div className='bg-gray-50 p-4 rounded-xl'>
                  <p className='text-xs text-gray-500 mb-1'>僱用類型</p>
                  <p className='font-bold text-gray-900'>{detailUser.employment_type === 'PART_TIME' ? '工讀' : '正職'}</p>
                </div>
                <div className='bg-gray-50 p-4 rounded-xl'>
                  <p className='text-xs text-gray-500 mb-1'>本薪/時薪</p>
                  <p className='font-bold text-gray-900'>{detailUser.employment_type === 'PART_TIME' ? formatMoney(detailUser.hourly_wage) : formatMoney(detailUser.base_salary)}</p>
                </div>
                <div className='bg-gray-50 p-4 rounded-xl'>
                  <p className='text-xs text-gray-500 mb-1'>專業加給</p>
                  <p className='font-bold text-gray-900'>{formatMoney(detailUser.professional_allowance)}</p>
                </div>
                <div className='bg-gray-50 p-4 rounded-xl'>
                  <p className='text-xs text-gray-500 mb-1'>伙食津貼</p>
                  <p className='font-bold text-gray-900'>{formatMoney(detailUser.meal_allowance)}</p>
                </div>
              </div>

              <div className='p-5 bg-blue-50 border border-blue-100 rounded-xl'>
                <div className='flex items-start justify-between gap-4 mb-3'>
                  <div>
                    <p className='font-semibold text-blue-900'>新增人工調整</p>
                    <p className='text-xs text-blue-700 mt-1'>補發薪資、專案獎金、人工加項會增加實領；人工扣款會減少實領。新增後會立即重算該員工該月薪資。</p>
                  </div>
                </div>
                <div className='grid grid-cols-1 md:grid-cols-5 gap-3'>
                  <div>
                    <label className='block text-xs text-blue-800 mb-1'>調整月份</label>
                    <input type='month' value={adjustmentForm.month} onChange={e => setAdjustmentForm({...adjustmentForm, month: e.target.value})} className='w-full px-3 py-2 border border-blue-200 rounded-lg text-sm outline-none' />
                  </div>
                  <div>
                    <label className='block text-xs text-blue-800 mb-1'>調整類型</label>
                    <select value={adjustmentForm.adjustmentType} onChange={e => setAdjustmentForm({...adjustmentForm, adjustmentType: e.target.value})} className='w-full px-3 py-2 border border-blue-200 rounded-lg text-sm outline-none'>
                      <option value='補發薪資'>補發薪資</option>
                      <option value='專案獎金'>專案獎金</option>
                      <option value='人工加項'>人工加項</option>
                      <option value='人工扣款'>人工扣款</option>
                    </select>
                  </div>
                  <div>
                    <label className='block text-xs text-blue-800 mb-1'>金額</label>
                    <input type='number' min='0' value={adjustmentForm.amount} onChange={e => setAdjustmentForm({...adjustmentForm, amount: e.target.value})} className='w-full px-3 py-2 border border-blue-200 rounded-lg text-sm outline-none' placeholder='例如 3000' />
                  </div>
                  <div>
                    <label className='block text-xs text-blue-800 mb-1'>原因</label>
                    <input type='text' value={adjustmentForm.description} onChange={e => setAdjustmentForm({...adjustmentForm, description: e.target.value})} className='w-full px-3 py-2 border border-blue-200 rounded-lg text-sm outline-none' placeholder='例如薪資爭議補發' />
                  </div>
                  <div className='flex items-end'>
                    <button onClick={handleCreateAdjustment} className='w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium'>新增並重算</button>
                  </div>
                </div>
                <p className='text-xs text-blue-700 mt-3'>若該月薪資表已發放或已鎖定，系統會禁止直接調整，請改以下月補發/補扣處理。</p>
              </div>

              {salaryRecords.length === 0 ? (
                <div className='text-center py-12 text-gray-500'>尚無薪資紀錄</div>
              ) : salaryRecords.map(record => (
                <div key={record.id} className='border border-gray-200 rounded-xl overflow-hidden'>
                  <div className='bg-gray-50 px-5 py-4 flex flex-wrap items-center justify-between gap-3 border-b border-gray-200'>
                    <div>
                      <p className='font-bold text-gray-900'>{record.month} 薪資表</p>
                      <p className='text-xs text-gray-500'>統計截止日：{formatDate(record.calculation_date)}</p>
                    </div>
                    <div className='flex flex-wrap items-center gap-3 text-sm'>
                      <span>本薪 {formatMoney(record.base_salary)}</span>
                      <span>加給 {formatMoney(record.professional_allowance)}</span>
                      <span>伙食 {formatMoney(record.meal_allowance)}</span>
                      <span className='text-red-600'>扣款/調整 {formatNetAdjustment(record.total_deductions)}</span>
                      <span className='font-bold text-green-700'>實領 {formatMoney(record.net_salary)}</span>
                      <span className={`px-2 py-1 rounded-full text-xs font-bold ${getStatusMeta(record.status).className}`}>{getStatusMeta(record.status).label}</span>
                      {record.status === 'CALCULATED' && <button onClick={() => handleRecordAction(record.id, 'confirm')} className='px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-medium hover:bg-blue-700'>確認</button>}
                      {record.status === 'CONFIRMED' && <button onClick={() => handleRecordAction(record.id, 'pay')} className='px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-xs font-medium hover:bg-emerald-700'>標記發放</button>}
                      {record.status === 'PAID' && <button onClick={() => handleRecordAction(record.id, 'lock')} className='px-3 py-1.5 bg-slate-700 text-white rounded-lg text-xs font-medium hover:bg-slate-800'>鎖定</button>}
                    </div>
                  </div>
                  <div className='overflow-x-auto'>
                    <table className='w-full text-left text-sm'>
                      <thead className='bg-white border-b border-gray-100 text-gray-500'>
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
                        {record.deductions?.length ? record.deductions.map((d: any) => (
                          <tr key={d.id} className='align-top'>
                            <td className='px-5 py-3 whitespace-nowrap'>{formatDate(d.detail_date)}</td>
                            <td className='px-5 py-3 whitespace-nowrap font-medium text-gray-900'>{d.leave_type}</td>
                            <td className='px-5 py-3 whitespace-nowrap'>{formatTime(d.start_time)} - {formatTime(d.end_time)}</td>
                            <td className='px-5 py-3 whitespace-nowrap'>{Number(d.days).toLocaleString()} {d.leave_type === '考勤扣款' ? '分鐘' : d.leave_type === '工作時數' ? '小時' : '日'}</td>
                            <td className={`px-5 py-3 text-right font-mono ${Number(d.amount) < 0 ? 'text-green-600' : Number(d.amount) > 0 ? 'text-red-600' : 'text-gray-500'}`}>{formatDetailAmount(d.amount)}</td>
                            <td className='px-5 py-3 min-w-[280px] text-gray-600'>{d.description || '-'}</td>
                          </tr>
                        )) : (
                          <tr>
                            <td className='px-5 py-6 text-center text-gray-400' colSpan={6}>無扣款或異常明細</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SalaryManagementPage;
