const pool = require('./db');

const LEAVE_RULES = [
  { type: '事假', days: 14, paid: false, desc: '全年合計不得超過十四日' },
  { type: '病假', days: 30, paid: 'half', desc: '全年合計不得超過三十日' },
  { type: '婚假', days: 8, paid: true, desc: '勞工結婚者給婚假八日' },
  { type: '喪假', days: 10, paid: true, desc: '依民法親屬編之規定' },
  { type: '公假', days: 0, paid: true, desc: '依法令規定應給公假者' }
];

function calculateSpecialLeave(hireDateStr, year) {
  const hireDate = new Date(hireDateStr);
  const targetDate = new Date(year, 0, 1);
  
  let yearsOfService = year - hireDate.getFullYear();
  const anniversaryThisYear = new Date(year, hireDate.getMonth(), hireDate.getDate());
  
  if (targetDate < anniversaryThisYear) {
    yearsOfService -= 1;
  }
  
  if (yearsOfService < 1) return 0;
  
  let baseDays = 0;
  if (yearsOfService >= 20) baseDays = 30;
  else if (yearsOfService >= 15) baseDays = 21;
  else if (yearsOfService >= 10) baseDays = 15;
  else if (yearsOfService >= 5) baseDays = 14;
  else if (yearsOfService >= 3) baseDays = 10;
  else if (yearsOfService >= 1) baseDays = 7;
  
  // 依勞基法：未滿一年或週年制年度，依比例計算
  const monthsInYear = 12;
  const startMonth = hireDate.getMonth();
  const monthsRemaining = monthsInYear - startMonth;
  const proRatedDays = Math.round(baseDays * (monthsRemaining / 12));
  
  return proRatedDays > 0 ? proRatedDays : baseDays;
}

async function getLeaveBalance(userId, year) {
  const [rows] = await pool.query('SELECT * FROM employee_leave_balances WHERE user_id = ? AND year = ?', [userId, year]);
  if (rows.length > 0) return rows;
  
  const [[user]] = await pool.query('SELECT hire_date FROM users WHERE id = ?', [userId]);
  if (!user || !user.hire_date) return [];
  
  const balances = [];
  const specialDays = calculateSpecialLeave(user.hire_date, year);
  
  if (specialDays > 0) {
    await pool.query('INSERT INTO employee_leave_balances (user_id, year, leave_type, total_days, used_days) VALUES (?, ?, ?, ?, 0)', [userId, year, '特休', specialDays]);
    balances.push({ leave_type: '特休', total_days: specialDays, used_days: 0 });
  }
  
  for (const rule of LEAVE_RULES) {
    if (rule.days > 0) {
      await pool.query('INSERT IGNORE INTO employee_leave_balances (user_id, year, leave_type, total_days, used_days) VALUES (?, ?, ?, ?, 0)', [userId, year, rule.type, rule.days]);
      balances.push({ leave_type: rule.type, total_days: rule.days, used_days: 0 });
    }
  }
  
  return balances.length ? balances : await getLeaveBalance(userId, year);
}

module.exports = { LEAVE_RULES, calculateSpecialLeave, getLeaveBalance };
