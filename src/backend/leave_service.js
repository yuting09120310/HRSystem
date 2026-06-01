const pool = require('./db');

const LEAVE_RULES = [
  { type: '事假', days: 14, paid: false, desc: '全年合計不得超過十四日' },
  { type: '病假', days: 30, paid: 'half', desc: '全年合計不得超過三十日' },
  { type: '婚假', days: 8, paid: true, desc: '勞工結婚者給婚假八日' },
  { type: '喪假', days: 10, paid: true, desc: '依民法親屬編之規定' },
  { type: '公假', days: 0, paid: true, desc: '依法令規定應給公假者' }
];

// 週年制特休計算（依照到職日，每日滾算）
function calculateSpecialLeave(hireDateStr, currentDate = new Date()) {
  const hireDate = new Date(hireDateStr);
  const today = new Date(currentDate);
  
  // 計算到職天數
  const diffTime = Math.abs(today - hireDate);
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
  
  // 計算年資（以週年制計算）
  let yearsOfService = 0;
  let currentAnniversary = new Date(hireDate);
  
  while (true) {
    const nextAnniversary = new Date(currentAnniversary);
    nextAnniversary.setFullYear(nextAnniversary.getFullYear() + 1);
    
    if (today >= nextAnniversary) {
      yearsOfService++;
      currentAnniversary = nextAnniversary;
    } else {
      break;
    }
  }
  
  // 未滿半年無特休
  if (diffDays < 180) return 0;
  
  // 滿半年未滿一年：3天
  if (yearsOfService === 0 && diffDays >= 180) return 3;
  
  // 依照勞基法特休天數表
  if (yearsOfService >= 25) return 30;
  if (yearsOfService >= 20) return 30;
  if (yearsOfService >= 15) return 21;
  if (yearsOfService >= 10) return 15;
  if (yearsOfService >= 5) return 14;
  if (yearsOfService >= 3) return 10;
  if (yearsOfService >= 2) return 7;
  if (yearsOfService >= 1) return 7;
  
  return 0;
}

// 計算當前週年制年度的特休天數（考慮到職日）
function getCurrentAnniversarySpecialLeave(hireDateStr, currentDate = new Date()) {
  const hireDate = new Date(hireDateStr);
  const today = new Date(currentDate);
  
  // 找到當前所屬的週年制年度開始日（最近一次的到職週年日）
  let currentAnniversaryStart = new Date(hireDate);
  while (true) {
    const nextAnniversary = new Date(currentAnniversaryStart);
    nextAnniversary.setFullYear(nextAnniversary.getFullYear() + 1);
    
    if (today >= nextAnniversary) {
      currentAnniversaryStart = nextAnniversary;
    } else {
      break;
    }
  }
  
  // 計算年資
  const yearsOfService = Math.floor(
    (currentAnniversaryStart - hireDate) / (365.25 * 24 * 60 * 60 * 1000)
  );
  
  // 依照勞基法特休天數表
  if (yearsOfService >= 25) return 30;
  if (yearsOfService >= 20) return 30;
  if (yearsOfService >= 15) return 21;
  if (yearsOfService >= 10) return 15;
  if (yearsOfService >= 5) return 14;
  if (yearsOfService >= 3) return 10;
  if (yearsOfService >= 2) return 7;
  if (yearsOfService >= 1) return 7;
  
  // 未滿一年但滿半年：3天
  const diffTime = Math.abs(today - hireDate);
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
  if (diffDays >= 180 && yearsOfService === 0) return 3;
  
  return 0;
}

async function getLeaveBalance(userId, year) {
  const [rows] = await pool.query('SELECT * FROM employee_leave_balances WHERE user_id = ? AND year = ?', [userId, year]);
  if (rows.length > 0) return rows;
  
  const [[user]] = await pool.query('SELECT hire_date FROM users WHERE id = ?', [userId]);
  if (!user || !user.hire_date) return [];
  
  const balances = [];
  const currentDate = new Date();
  
  // 特休：週年制（依照到職日計算，每日滾算）
  const specialDays = getCurrentAnniversarySpecialLeave(user.hire_date, currentDate);
  if (specialDays > 0) {
    await pool.query('INSERT INTO employee_leave_balances (user_id, year, leave_type, total_days, used_days) VALUES (?, ?, ?, ?, 0)', [userId, year, '特休', specialDays]);
    balances.push({ leave_type: '特休', total_days: specialDays, used_days: 0 });
  }
  
  // 其他假別：曆年制（每年1/1重置）
  for (const rule of LEAVE_RULES) {
    if (rule.days > 0) {
      await pool.query('INSERT IGNORE INTO employee_leave_balances (user_id, year, leave_type, total_days, used_days) VALUES (?, ?, ?, ?, 0)', [userId, year, rule.type, rule.days]);
      balances.push({ leave_type: rule.type, total_days: rule.days, used_days: 0 });
    }
  }
  
  return balances.length ? balances : await getLeaveBalance(userId, year);
}

// 每日更新特休天數（週年制，每日滾算）
async function updateDailySpecialLeave() {
  const currentDate = new Date();
  const currentYear = currentDate.getFullYear();
  
  // 取得所有在職員工
  const [users] = await pool.query('SELECT id, hire_date FROM users WHERE status = "ACTIVE"');
  
  if (users.length === 0) {
    console.log(`[${new Date().toISOString()}] 無在職員工，跳過特休更新`);
    return;
  }
  
  // 批次計算所有員工的特休天數
  const updates = [];
  const inserts = [];
  
  for (const user of users) {
    const specialDays = getCurrentAnniversarySpecialLeave(user.hire_date, currentDate);
    updates.push({ userId: user.id, days: specialDays });
  }
  
  // 批次查詢現有記錄
  const userIds = users.map(u => u.id);
  const [existingRecords] = await pool.query(
    'SELECT user_id, total_days FROM employee_leave_balances WHERE year = ? AND leave_type = "特休" AND user_id IN (?)',
    [currentYear, userIds]
  );
  
  const existingMap = new Map();
  existingRecords.forEach(record => {
    existingMap.set(record.user_id, record.total_days);
  });
  
  // 分批處理更新和插入
  const batchSize = 50;
  
  for (let i = 0; i < updates.length; i += batchSize) {
    const batch = updates.slice(i, i + batchSize);
    const updatePromises = [];
    const insertPromises = [];
    
    for (const update of batch) {
      if (existingMap.has(update.userId)) {
        // 只有天數改變時才更新
        if (existingMap.get(update.userId) !== update.days) {
          updatePromises.push(
            pool.query(
              'UPDATE employee_leave_balances SET total_days = ? WHERE user_id = ? AND year = ? AND leave_type = "特休"',
              [update.days, update.userId, currentYear]
            )
          );
        }
      } else if (update.days > 0) {
        insertPromises.push(
          pool.query(
            'INSERT INTO employee_leave_balances (user_id, year, leave_type, total_days, used_days) VALUES (?, ?, ?, ?, 0)',
            [update.userId, currentYear, '特休', update.days]
          )
        );
      }
    }
    
    // 並行執行批次操作
    await Promise.all([...updatePromises, ...insertPromises]);
  }
  
  console.log(`[${new Date().toISOString()}] 已更新 ${users.length} 位員工的特休天數`);
}

// 每年1/1重置曆年制假別（事假、病假等）
async function resetAnnualLeaveBalances() {
  const currentYear = new Date().getFullYear();
  const [users] = await pool.query('SELECT id FROM users WHERE status = "ACTIVE"');
  
  if (users.length === 0) {
    console.log(`[${new Date().toISOString()}] 無在職員工，跳過年度重置`);
    return;
  }
  
  // 批次查詢現有記錄
  const leaveTypes = LEAVE_RULES.filter(r => r.days > 0).map(r => r.type);
  const userIds = users.map(u => u.id);
  
  const [existingRecords] = await pool.query(
    'SELECT user_id, leave_type FROM employee_leave_balances WHERE year = ? AND leave_type IN (?) AND user_id IN (?)',
    [currentYear, leaveTypes, userIds]
  );
  
  // 建立已存在記錄的集合
  const existingSet = new Set();
  existingRecords.forEach(record => {
    existingSet.add(`${record.user_id}-${record.leave_type}`);
  });
  
  // 批次插入不存在的記錄
  const insertValues = [];
  const insertPlaceholders = [];
  
  for (const user of users) {
    for (const rule of LEAVE_RULES) {
      if (rule.days > 0) {
        const key = `${user.id}-${rule.type}`;
        if (!existingSet.has(key)) {
          insertPlaceholders.push('(?, ?, ?, ?, 0)');
          insertValues.push(user.id, currentYear, rule.type, rule.days);
        }
      }
    }
  }
  
  // 批次插入
  if (insertPlaceholders.length > 0) {
    const batchSize = 100;
    for (let i = 0; i < insertPlaceholders.length; i += batchSize) {
      const batchPlaceholders = insertPlaceholders.slice(i, i + batchSize);
      const batchValues = insertValues.slice(i * 5, (i + batchSize) * 5);
      
      await pool.query(
        `INSERT INTO employee_leave_balances (user_id, year, leave_type, total_days, used_days) VALUES ${batchPlaceholders.join(', ')}`,
        batchValues
      );
    }
  }
  
  console.log(`[${new Date().toISOString()}] 已重置 ${users.length} 位員工的曆年制假別`);
}

module.exports = { 
  LEAVE_RULES, 
  calculateSpecialLeave, 
  getCurrentAnniversarySpecialLeave,
  getLeaveBalance,
  updateDailySpecialLeave,
  resetAnnualLeaveBalances
};
