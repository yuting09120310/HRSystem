import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { DollarSign, Users, Calculator, Save, Info, History, X, Edit3, Check } from 'lucide-react';

const API_BASE = 'http://localhost:3001/api';

const SalaryManagementPage = () => {
  const [employees, setEmployees] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingUser, setEditingUser] = useState<any>(null);
  const [structure, setStructure] = useState({ baseSalary: '', professionalAllowance: '', mealAllowance: '' });
  const [reason, setReason] = useState('');
  const [calcMonth, setCalcMonth] = useState(new Date().toISOString().slice(0, 7));
  const [history, setHistory] = useState<any[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [showTooltip, setShowTooltip] = useState(false);

  useEffect(() => {
    fetchData();
  }, []);

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
      const res = await axios.post(`${API_BASE}/salary/calculate`, { userId, month: calcMonth });
      alert(`計算完成！實領薪資：$${res.data.netSalary}`);
      fetchData();
    } catch (e: any) {
      alert(e.response?.data?.error || '計算失敗');
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

  const formatMoney = (val: any) => {
    if (!val && val !== 0) return '-';
    return `$${Number(val).toLocaleString()}`;
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
                  <li>• 病假：(總薪資 ÷ 30  2) × 天數</li>
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
        </div>
      </div>

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
                    <td className='px-6 py-4'>
                      <div className='flex items-center justify-center gap-2'>
                        <button onClick={() => viewHistory(u)} className='p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition' title='歷史記錄'>
                          <History size={18} />
                        </button>
                        <button onClick={() => handleCalculate(u.id)} className='p-2 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded-lg transition' title='計算薪資'>
                          <Calculator size={18} />
                        </button>
                        <button onClick={() => openEdit(u)} className='p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition' title='編輯薪資'>
                          <Edit3 size={18} />
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
    </div>
  );
};

export default SalaryManagementPage;
