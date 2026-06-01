const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const pool = require('./db');
const { LEAVE_RULES, getLeaveBalance, getCurrentAnniversarySpecialLeave, updateDailySpecialLeave, resetAnnualLeaveBalances } = require('./leave_service');
require('dotenv').config({ path: './src/backend/.env' });

const app = express();
app.use(cors());
app.use(express.json());

const JWT_SECRET = process.env.JWT_SECRET || 'hr-system-secret-key-2026';

const authMiddleware = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: '未登入' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (e) {
    res.status(401).json({ error: 'Token 無效' });
  }
};

app.post('/api/auth/login', async (req, res) => {
  const { account, password } = req.body;
  console.log('Login attempt:', { account, password });
  try {
    const [[user]] = await pool.query('SELECT u.*, d.name as dept_name FROM users u JOIN departments d ON u.dept_id = d.id WHERE u.username = ?', [account]);
    console.log('User found:', user ? { id: user.id, username: user.username, role: user.role } : 'null');
    if (!user) return res.status(401).json({ error: '帳號或密碼錯誤' });
    if (user.status !== 'ACTIVE') return res.status(403).json({ error: '帳號已停用' });

    const validPassword = user.password === password;
    console.log('Password valid:', validPassword);
    if (!validPassword) {
      return res.status(401).json({ error: '帳號或密碼錯誤' });
    }

    const token = jwt.sign(
      { id: user.id, account: user.username, role: user.role, dept_id: user.dept_id },
      JWT_SECRET,
      { expiresIn: '8h' }
    );

    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        full_name: user.full_name,
        account: user.username,
        role: user.role,
        dept_name: user.dept_name,
        dept_id: user.dept_id
      }
    });
  } catch (e) {
    console.error('Login error:', e);
    res.status(500).json({ error: e.message });
  }
});

app.use(authMiddleware);

app.get('/api/auth/me', async (req, res) => {
  try {
    const [[user]] = await pool.query('SELECT u.*, d.name as dept_name FROM users u JOIN departments d ON u.dept_id = d.id WHERE u.id = ?', [req.user.id]);
    if (!user) return res.status(404).json({ error: '使用者不存在' });
    res.json({
      id: user.id,
      full_name: user.full_name,
      account: user.username,
      role: user.role,
      dept_name: user.dept_name,
      dept_id: user.dept_id
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/profile', async (req, res) => {
  try {
    const [[user]] = await pool.query('SELECT u.id, u.username, u.full_name, u.dept_id, u.role, d.name as dept_name FROM users u JOIN departments d ON u.dept_id = d.id WHERE u.id = ?', [req.user.id]);
    if (!user) return res.status(404).json({ error: '使用者不存在' });
    res.json(user);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/profile', async (req, res) => {
  const { fullName } = req.body;
  if (!fullName) return res.status(400).json({ error: '姓名不能為空' });
  try {
    await pool.query('UPDATE users SET full_name = ? WHERE id = ?', [fullName, req.user.id]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/password', async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) return res.status(400).json({ error: '請填寫所有欄位' });
  if (newPassword.length < 4) return res.status(400).json({ error: '新密碼至少需要 4 個字元' });
  try {
    const [[user]] = await pool.query('SELECT password FROM users WHERE id = ?', [req.user.id]);
    if (user.password !== currentPassword) return res.status(401).json({ error: '目前密碼不正確' });
    await pool.query('UPDATE users SET password = ? WHERE id = ?', [newPassword, req.user.id]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/attendance/clock-in', async (req, res) => {
  const userId = req.user.id;
  const now = new Date();
  const date = now.toISOString().split('T')[0];
  try {
    await pool.query('INSERT INTO attendance (user_id, clock_in, date) VALUES (?, ?, ?)', [userId, now, date]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/attendance/clock-out', async (req, res) => {
  const userId = req.user.id;
  const now = new Date();
  try {
    await pool.query('UPDATE attendance SET clock_out = ? WHERE user_id = ? AND clock_out IS NULL AND date = CURDATE()', [now, userId]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/attendance/history', async (req, res) => {
  const userId = req.user.id;
  try {
    const [rows] = await pool.query('SELECT * FROM attendance WHERE user_id = ? ORDER BY date DESC', [userId]);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/users/:id', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT u.*, d.name as dept_name FROM users u JOIN departments d ON u.dept_id = d.id WHERE u.id = ?', [req.params.id]);
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/leave', async (req, res) => {
  const userId = req.user.id;
  const { leaveType, startDate, endDate, reason } = req.body;
  try {
    const [reqResult] = await pool.query('INSERT INTO leave_requests (user_id, leave_type, start_date, end_date, reason) VALUES (?, ?, ?, ?, ?)', [userId, leaveType, startDate, endDate, reason]);
    const requestId = reqResult.insertId;

    const [[user]] = await pool.query('SELECT u.*, d.name as dept_name, d.manager_id FROM users u JOIN departments d ON u.dept_id = d.id WHERE u.id = ?', [userId]);
    let approverId = null;

    if (user.role === 'MANAGER' || user.role === 'ADMIN') {
      if (user.dept_name === '資訊部' || user.dept_name === '會計部') {
        const [[boss]] = await pool.query('SELECT id FROM users WHERE role = \'MANAGER\' AND dept_id = 5 LIMIT 1');
        approverId = boss?.id;
      } else if (user.dept_name === '企劃部' || user.dept_name === '營業部') {
        const [[chairman]] = await pool.query('SELECT id FROM users WHERE role = \'ADMIN\' LIMIT 1');
        approverId = chairman?.id;
      }
    } else {
      if (user.manager_id) {
        approverId = user.manager_id;
      } else {
        const [[deptMgr]] = await pool.query('SELECT id FROM users WHERE role = \'MANAGER\' AND dept_id = ? LIMIT 1', [user.dept_id]);
        approverId = deptMgr?.id;
      }
    }

    if (approverId) {
      await pool.query('INSERT INTO leave_approvals (request_id, approver_id, status) VALUES (?, ?, \'PENDING\')', [requestId, approverId]);
    }
    res.json({ success: true, requestId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/leave/my', async (req, res) => {
  const userId = req.user.id;
  try {
    const [rows] = await pool.query('SELECT * FROM leave_requests WHERE user_id = ? ORDER BY created_at DESC', [userId]);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/leave/pending', async (req, res) => {
  const userId = req.user.id;
  try {
    const [rows] = await pool.query('SELECT lr.*, u.full_name as requester_name FROM leave_requests lr JOIN leave_approvals la ON lr.id = la.request_id JOIN users u ON lr.user_id = u.id WHERE la.approver_id = ? AND la.status = \'PENDING\'', [userId]);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/leave/approve', async (req, res) => {
  const { requestId, status, comment } = req.body;
  const approverId = req.user.id;
  try {
    await pool.query('UPDATE leave_approvals SET status = ?, comment = ?, processed_at = NOW() WHERE request_id = ? AND approver_id = ?', [status, comment, requestId, approverId]);
    await pool.query('UPDATE leave_requests SET status = ? WHERE id = ?', [status, requestId]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

const adminMiddleware = (req, res, next) => {
  if (req.user.role !== 'ADMIN') return res.status(403).json({ error: '權限不足' });
  next();
};

const managerMiddleware = (req, res, next) => {
  if (req.user.role !== 'ADMIN' && req.user.role !== 'MANAGER') return res.status(403).json({ error: '權限不足' });
  next();
};

app.get('/api/admin/users', adminMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT u.id, u.username, u.full_name, u.role, u.status, u.dept_id, u.hire_date, u.employment_type, u.position, u.hourly_wage, u.base_salary, u.professional_allowance, u.meal_allowance, u.education_level, u.university_name, u.department, d.name as dept_name FROM users u LEFT JOIN departments d ON u.dept_id = d.id ORDER BY u.id');
    
    // 為每個用戶加入 currentSalary（從 salary_records 讀取）
    const result = [];
    for (const u of rows) {
      const [records] = await pool.query('SELECT * FROM salary_records WHERE user_id = ? ORDER BY month DESC LIMIT 1', [u.id]);
      
      // 如果沒有 salary_records，使用 users 表的薪資結構
      let currentSalary = records[0] || null;
      if (!currentSalary && u.employment_type === 'FULL_TIME' && u.base_salary) {
        currentSalary = {
          base_salary: u.base_salary,
          professional_allowance: u.professional_allowance || 0,
          meal_allowance: u.meal_allowance || 0
        };
      }
      
      result.push({ ...u, currentSalary });
    }
    
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/users', adminMiddleware, async (req, res) => {
  const { username, password, fullName, deptId, role, hireDate, employmentType, position, hourlyWage, baseSalary, professionalAllowance, mealAllowance, educationLevel, universityName, department } = req.body;
  if (!username || !password || !fullName) return res.status(400).json({ error: '請填寫所有必填欄位' });
  // ADMIN 角色不需要部門，其他角色需要
  if (role !== 'ADMIN' && !deptId) return res.status(400).json({ error: '請選擇部門' });
  try {
    const [[existing]] = await pool.query('SELECT id FROM users WHERE username = ?', [username]);
    if (existing) return res.status(400).json({ error: '帳號已存在' });
    
    const finalHireDate = hireDate || new Date().toISOString().split('T')[0];
    const [result] = await pool.query('INSERT INTO users (username, password, full_name, dept_id, role, status, hire_date, employment_type, position, hourly_wage, base_salary, professional_allowance, meal_allowance, education_level, university_name, department) VALUES (?, ?, ?, ?, ?, \'ACTIVE\', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [username, password, fullName, deptId || null, role || 'EMPLOYEE', finalHireDate, employmentType || 'FULL_TIME', position || null, hourlyWage || null, baseSalary || null, professionalAllowance || null, mealAllowance || null, educationLevel || null, universityName || null, department || null]);
    
    const newUserId = result.insertId;
    
    // 如果是正職員工且有設定薪資結構，自動建立當月薪資紀錄
    if (employmentType === 'FULL_TIME' && baseSalary) {
      const month = new Date().toISOString().slice(0, 7);
      await pool.query('INSERT INTO salary_records (user_id, month, base_salary, professional_allowance, meal_allowance, status) VALUES (?, ?, ?, ?, ?, \'DRAFT\') ON DUPLICATE KEY UPDATE base_salary = ?, professional_allowance = ?, meal_allowance = ?', [newUserId, month, baseSalary, professionalAllowance || 0, mealAllowance || 0, baseSalary, professionalAllowance || 0, mealAllowance || 0]);
    }
    
    // 自動建立休假餘額記錄
    const currentYear = new Date().getFullYear();
    
    // 特休：週年制（依照到職日計算）
    const specialDays = getCurrentAnniversarySpecialLeave(finalHireDate, new Date());
    if (specialDays > 0) {
      await pool.query(
        'INSERT INTO employee_leave_balances (user_id, year, leave_type, total_days, used_days) VALUES (?, ?, ?, ?, 0)',
        [newUserId, currentYear, '特休', specialDays]
      );
    }
    
    // 其他假別：曆年制（每年1/1重置）
    for (const rule of LEAVE_RULES) {
      if (rule.days > 0) {
        await pool.query(
          'INSERT INTO employee_leave_balances (user_id, year, leave_type, total_days, used_days) VALUES (?, ?, ?, ?, 0)',
          [newUserId, currentYear, rule.type, rule.days]
        );
      }
    }
    
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/admin/users/:id', adminMiddleware, async (req, res) => {
  const { fullName, deptId, role, status, hireDate, employmentType, position, educationLevel, universityName, department } = req.body;
  try {
    // ADMIN 角色可以不選擇部門
    const finalDeptId = role === 'ADMIN' ? null : deptId;
    await pool.query('UPDATE users SET full_name = ?, dept_id = ?, role = ?, status = ?, hire_date = ?, employment_type = ?, position = ?, education_level = ?, university_name = ?, department = ? WHERE id = ?', [fullName, finalDeptId, role, status, hireDate, employmentType, position, educationLevel, universityName, department, req.params.id]);
    
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/departments', managerMiddleware, async (req, res) => {
  const { type } = req.query;
  try {
    let query = 'SELECT d.id, d.name, d.manager_id, d.type, d.schedule_type, u.full_name as manager_name FROM departments d LEFT JOIN users u ON d.manager_id = u.id';
    const params = [];
    
    // 主管只能看到自己管理的部門
    if (req.user.role === 'MANAGER') {
      query += ' WHERE d.id = ?';
      params.push(req.user.dept_id);
      if (type) {
        query += ' AND d.type = ?';
        params.push(type);
      }
    } else if (type) {
      query += ' WHERE d.type = ?';
      params.push(type);
    }
    
    query += ' ORDER BY d.id';
    const [rows] = await pool.query(query, params);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/departments', adminMiddleware, async (req, res) => {
  const { name, scheduleType, type } = req.body;
  if (!name) return res.status(400).json({ error: '請填寫部門名稱' });
  try {
    await pool.query('INSERT INTO departments (name, schedule_type, type) VALUES (?, ?, ?)', [name, scheduleType || 'FIXED', type || 'DEPARTMENT']);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/admin/departments/:id', adminMiddleware, async (req, res) => {
  const { managerId, scheduleType } = req.body;
  try {
    await pool.query('UPDATE departments SET manager_id = ?, schedule_type = ? WHERE id = ?', [managerId || null, scheduleType, req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/salary/config', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM salary_configs');
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/salary/config', adminMiddleware, async (req, res) => {
  const { configs } = req.body;
  try {
    for (const cfg of configs) {
      await pool.query('INSERT INTO salary_configs (leave_type, deduction_per_day) VALUES (?, ?) ON DUPLICATE KEY UPDATE deduction_per_day = ?', [cfg.leave_type, cfg.deduction_per_day, cfg.deduction_per_day]);
    }
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/salary/my', async (req, res) => {
  try {
    const [records] = await pool.query('SELECT * FROM salary_records WHERE user_id = ? ORDER BY month DESC', [req.user.id]);
    const result = [];
    for (const r of records) {
      const [details] = await pool.query('SELECT * FROM salary_deduction_details WHERE record_id = ?', [r.id]);
      
      // 判斷是否已過發放日
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const paymentDate = r.payment_date ? new Date(r.payment_date) : null;
      if (paymentDate) {
        paymentDate.setHours(0, 0, 0, 0);
      }
      
      // 如果已到發放日且狀態為 UNPAID，自動改為已發放
      let paidStatus = r.paid_status || 'UNPAID';
      if (paymentDate && today >= paymentDate && paidStatus === 'UNPAID' && r.status === 'CALCULATED') {
        await pool.query('UPDATE salary_records SET paid_status = \'PAID\', paid_date = NOW() WHERE id = ?', [r.id]);
        paidStatus = 'PAID';
      }
      
      result.push({ 
        ...r, 
        deductions: details,
        paid_status: paidStatus,
        payment_date: r.payment_date
      });
    }
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/salary/employees', managerMiddleware, async (req, res) => {
  try {
    let query = 'SELECT u.id, u.username, u.full_name, u.role, u.dept_id, u.employment_type, u.base_salary, u.professional_allowance, u.meal_allowance, u.hourly_wage, d.name as dept_name, d.manager_id FROM users u LEFT JOIN departments d ON u.dept_id = d.id WHERE u.status = \'ACTIVE\'';
    const params = [];
    if (req.user.role === 'MANAGER') {
      query += ' AND (u.dept_id = ? OR u.id = ?)';
      params.push(req.user.dept_id, req.user.id);
    }
    const [users] = await pool.query(query, params);
    
    const result = [];
    for (const u of users) {
      const [records] = await pool.query('SELECT * FROM salary_records WHERE user_id = ? ORDER BY month DESC LIMIT 1', [u.id]);
      
      // 如果沒有 salary_records，使用 users 表的薪資結構
      let currentSalary = records[0] || null;
      if (!currentSalary && u.employment_type === 'FULL_TIME' && u.base_salary) {
        currentSalary = {
          base_salary: u.base_salary,
          professional_allowance: u.professional_allowance || 0,
          meal_allowance: u.meal_allowance || 0
        };
      }
      
      result.push({ ...u, currentSalary });
    }
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/salary/structure', managerMiddleware, async (req, res) => {
  const { userId, baseSalary, professionalAllowance, mealAllowance, reason } = req.body;
  if (!reason) return res.status(400).json({ error: '請填寫調薪理由' });
  try {
    const [[user]] = await pool.query('SELECT dept_id FROM users WHERE id = ?', [userId]);
    if (req.user.role === 'MANAGER' && user.dept_id !== req.user.dept_id && req.user.id !== userId) {
      return res.status(403).json({ error: '僅能調整所屬部門員工薪資' });
    }
    
    const month = new Date().toISOString().slice(0, 7);
    await pool.query('INSERT INTO salary_records (user_id, month, base_salary, professional_allowance, meal_allowance, status) VALUES (?, ?, ?, ?, ?, \'DRAFT\') ON DUPLICATE KEY UPDATE base_salary = ?, professional_allowance = ?, meal_allowance = ?', [userId, month, baseSalary, professionalAllowance, mealAllowance, baseSalary, professionalAllowance, mealAllowance]);
    
    await pool.query('INSERT INTO salary_history (user_id, month, base_salary, professional_allowance, meal_allowance, reason, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?)', [userId, month, baseSalary, professionalAllowance, mealAllowance, reason, req.user.id]);
    
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/salary/history/:userId', async (req, res) => {
  try {
    const [records] = await pool.query('SELECT sh.*, u.full_name as updated_by_name FROM salary_history sh JOIN users u ON sh.updated_by = u.id WHERE sh.user_id = ? ORDER BY sh.created_at DESC', [req.params.userId]);
    res.json(records);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/salary/history/me', async (req, res) => {
  try {
    console.log('Fetching history for user ID:', req.user.id);
    const [records] = await pool.query('SELECT sh.*, u.full_name as updated_by_name FROM salary_history sh JOIN users u ON sh.updated_by = u.id WHERE sh.user_id = ? ORDER BY sh.created_at DESC', [req.user.id]);
    console.log('History records found:', records.length);
    res.json(records);
  } catch (e) { 
    console.error('History fetch error:', e);
    res.status(500).json({ error: e.message }); 
  }
});

app.post('/api/salary/calculate', managerMiddleware, async (req, res) => {
  const { userId, month } = req.body;
  try {
    const [[user]] = await pool.query('SELECT dept_id, employment_type, hourly_wage, base_salary, professional_allowance, meal_allowance FROM users WHERE id = ?', [userId]);
    if (req.user.role === 'MANAGER' && user.dept_id !== req.user.dept_id) {
      return res.status(403).json({ error: '僅能計算所屬部門員工薪資' });
    }

    let [[record]] = await pool.query('SELECT * FROM salary_records WHERE user_id = ? AND month = ?', [userId, month]);
    
    // 如果沒有該月的薪資紀錄，嘗試從 users 表建立
    if (!record) {
      if (user.employment_type === 'FULL_TIME' && user.base_salary) {
        await pool.query('INSERT INTO salary_records (user_id, month, base_salary, professional_allowance, meal_allowance, status) VALUES (?, ?, ?, ?, ?, \'DRAFT\')', [userId, month, user.base_salary, user.professional_allowance || 0, user.meal_allowance || 0]);
        [[record]] = await pool.query('SELECT * FROM salary_records WHERE user_id = ? AND month = ?', [userId, month]);
      } else {
        return res.status(404).json({ error: '找不到該月薪資紀錄，請先設定薪資結構' });
      }
    }

    // 取得員工排班時間
    const [[schedule]] = await pool.query('SELECT work_start_time, work_end_time FROM users WHERE id = ?', [userId]);
    const workStartTime = schedule?.work_start_time || '08:00:00';
    const workEndTime = schedule?.work_end_time || '17:00:00';

    let totalSalary = 0;
    let totalDeductions = 0;
    const deductionDetails = [];

    // 根據僱用類型計算薪資
    if (user.employment_type === 'PART_TIME') {
      // 工讀生：時薪制
      const hourlyWage = parseFloat(user.hourly_wage || 0);
      if (hourlyWage === 0) {
        return res.status(400).json({ error: '請先設定時薪' });
      }

      // 計算實際工作時數（從打卡紀錄）
      const [attendance] = await pool.query('SELECT clock_in, clock_out FROM attendance WHERE user_id = ? AND DATE_FORMAT(date, \'%Y-%m\') = ? AND clock_in IS NOT NULL AND clock_out IS NOT NULL', [userId, month]);
      
      let totalWorkingHours = 0;
      attendance.forEach(a => {
        const clockIn = new Date(a.clock_in);
        const clockOut = new Date(a.clock_out);
        const hours = (clockOut - clockIn) / 3600000; // 轉換為小時
        totalWorkingHours += hours;
      });

      totalSalary = hourlyWage * totalWorkingHours;
      
      // 工讀生不計算請假扣款（因為是時薪制，沒來就沒薪水）
      // 但可以記錄工作時數
      deductionDetails.push({ leave_type: '工作時數', days: Math.round(totalWorkingHours * 10) / 10, amount: 0 });
      
    } else {
      // 正職員工：月薪制
      const base = parseFloat(record.base_salary);
      const prof = parseFloat(record.professional_allowance);
      const meal = parseFloat(record.meal_allowance);
      totalSalary = base + prof + meal;

      const personalRate = totalSalary / 30;
      const sickRate = personalRate / 2;
      const minuteRate = totalSalary / 30 / 8 / 60; // 每分鐘扣款金額

      // 計算請假扣款
      const [leaveRows] = await pool.query('SELECT leave_type, COUNT(*) as days FROM leave_requests WHERE user_id = ? AND status = \'APPROVED\' AND DATE_FORMAT(start_date, \'%Y-%m\') = ? GROUP BY leave_type', [userId, month]);
      
      for (const lr of leaveRows) {
        let rate = 0;
        if (lr.leave_type === '事假') rate = personalRate;
        else if (lr.leave_type === '病假') rate = sickRate;
        
        const amount = rate * lr.days;
        totalDeductions += amount;
        deductionDetails.push({ leave_type: lr.leave_type, days: lr.days, amount: Math.round(amount) });
      }

      // 計算考勤扣款 (遲到/早退)
      const [attendance] = await pool.query('SELECT clock_in, clock_out FROM attendance WHERE user_id = ? AND DATE_FORMAT(date, \'%Y-%m\') = ?', [userId, month]);
      let lateMinutes = 0;
      let earlyMinutes = 0;

      attendance.forEach(a => {
        if (a.clock_in) {
          const clockInDate = new Date(a.clock_in);
          const startDateTime = new Date(`${clockInDate.toISOString().split('T')[0]} ${workStartTime}`);
          if (clockInDate > startDateTime) {
            lateMinutes += (clockInDate - startDateTime) / 60000;
          }
        }
        if (a.clock_out) {
          const clockOutDate = new Date(a.clock_out);
          const endDateTime = new Date(`${clockOutDate.toISOString().split('T')[0]} ${workEndTime}`);
          if (clockOutDate < endDateTime) {
            earlyMinutes += (endDateTime - clockOutDate) / 60000;
          }
        }
      });

      const totalAttendanceMinutes = Math.round(lateMinutes + earlyMinutes);
      if (totalAttendanceMinutes > 0) {
        const attendanceDeduction = Math.round(totalAttendanceMinutes * minuteRate);
        totalDeductions += attendanceDeduction;
        deductionDetails.push({ leave_type: '考勤扣款', days: totalAttendanceMinutes, amount: attendanceDeduction });
      }
    }

    const net = totalSalary - totalDeductions;

    await pool.query('UPDATE salary_records SET total_deductions = ?, net_salary = ?, status = \'CALCULATED\' WHERE id = ?', [totalDeductions, net, record.id]);
    await pool.query('DELETE FROM salary_deduction_details WHERE record_id = ?', [record.id]);
    for (const d of deductionDetails) {
      await pool.query('INSERT INTO salary_deduction_details (record_id, leave_type, days, amount) VALUES (?, ?, ?, ?)', [record.id, d.leave_type, d.days, d.amount]);
    }

    res.json({ success: true, netSalary: Math.round(net), deductions: deductionDetails });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 請假規範與特休計算
app.get('/api/leave/rules', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM leave_rules ORDER BY id');
    res.json(rows.length ? rows : LEAVE_RULES.map(r => ({ leave_type: r.type, days_per_year: r.days, description: r.desc })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/leave/balance', async (req, res) => {
  const userId = req.query.userId || req.user.id;
  const year = req.query.year || new Date().getFullYear();
  try {
    const balances = await getLeaveBalance(userId, parseInt(year));
    res.json(balances);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/leave/balance/recalculate', adminMiddleware, async (req, res) => {
  const { userId, year } = req.body;
  const targetYear = year || new Date().getFullYear();
  try {
    await pool.query('DELETE FROM employee_leave_balances WHERE user_id = ? AND year = ?', [userId, targetYear]);
    const balances = await getLeaveBalance(userId, targetYear);
    res.json({ success: true, balances });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 工作排班 API
app.get('/api/work-schedule', async (req, res) => {
  try {
    const [[user]] = await pool.query('SELECT work_start_time, work_end_time FROM users WHERE id = ?', [req.user.id]);
    res.json(user || { work_start_time: '08:00:00', work_end_time: '17:00:00' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/work-schedules', managerMiddleware, async (req, res) => {
  try {
    let query = 'SELECT u.id, u.full_name, u.dept_id, d.name as dept_name, u.work_start_time, u.work_end_time FROM users u JOIN departments d ON u.dept_id = d.id WHERE u.status = \'ACTIVE\'';
    const params = [];
    if (req.user.role === 'MANAGER') {
      query += ' AND u.dept_id = ?';
      params.push(req.user.dept_id);
    }
    const [rows] = await pool.query(query, params);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/admin/work-schedules/:id', managerMiddleware, async (req, res) => {
  const { workStartTime, workEndTime } = req.body;
  const targetId = req.params.id;
  
  try {
    if (req.user.role === 'MANAGER') {
      const [[target]] = await pool.query('SELECT dept_id FROM users WHERE id = ?', [targetId]);
      if (!target || target.dept_id !== req.user.dept_id) {
        return res.status(403).json({ error: '權限不足或目標員工不屬於所屬部門' });
      }
    }
    
    await pool.query('UPDATE users SET work_start_time = ?, work_end_time = ? WHERE id = ?', [workStartTime, workEndTime, targetId]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 門市管理 API
app.get('/api/stores', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM departments WHERE type = \'STORE\' ORDER BY id');
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/stores', adminMiddleware, async (req, res) => {
  const { name, parentId } = req.body;
  if (!name) return res.status(400).json({ error: '請填寫門市名稱' });
  try {
    await pool.query('INSERT INTO departments (name, type, parent_id) VALUES (?, \'STORE\', ?)', [name, parentId || null]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/stores/:id/employees', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT id, full_name, role FROM users WHERE dept_id = ? AND status = \'ACTIVE\'', [req.params.id]);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 班別定義 API
app.get('/api/shifts', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM shifts ORDER BY id');
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/shifts/:id', adminMiddleware, async (req, res) => {
  const { name, start_time, end_time, color } = req.body;
  try {
    await pool.query('UPDATE shifts SET name = ?, start_time = ?, end_time = ?, color = ? WHERE id = ?', [name, start_time, end_time, color, req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/shifts', adminMiddleware, async (req, res) => {
  const { name, start_time, end_time, color } = req.body;
  try {
    const [result] = await pool.query('INSERT INTO shifts (name, start_time, end_time, color) VALUES (?, ?, ?, ?)', [name, start_time, end_time, color]);
    res.json({ success: true, id: result.insertId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/shifts', adminMiddleware, async (req, res) => {
  const { name, start_time, end_time, color } = req.body;
  try {
    const [result] = await pool.query('INSERT INTO shifts (name, start_time, end_time, color) VALUES (?, ?, ?, ?)', [name, start_time, end_time, color]);
    res.json({ success: true, id: result.insertId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/shifts', adminMiddleware, async (req, res) => {
  const { name, start_time, end_time, color } = req.body;
  try {
    const [result] = await pool.query('INSERT INTO shifts (name, start_time, end_time, color) VALUES (?, ?, ?, ?)', [name, start_time, end_time, color]);
    res.json({ success: true, id: result.insertId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/shifts', adminMiddleware, async (req, res) => {
  const { name, start_time, end_time, color } = req.body;
  try {
    const [result] = await pool.query('INSERT INTO shifts (name, start_time, end_time, color) VALUES (?, ?, ?, ?)', [name, start_time, end_time, color]);
    res.json({ success: true, id: result.insertId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/shifts', adminMiddleware, async (req, res) => {
  const { name, start_time, end_time, color } = req.body;
  try {
    const [result] = await pool.query('INSERT INTO shifts (name, start_time, end_time, color) VALUES (?, ?, ?, ?)', [name, start_time, end_time, color]);
    res.json({ success: true, id: result.insertId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/shifts', adminMiddleware, async (req, res) => {
  const { name, start_time, end_time, color } = req.body;
  try {
    const [result] = await pool.query('INSERT INTO shifts (name, start_time, end_time, color) VALUES (?, ?, ?, ?)', [name, start_time, end_time, color]);
    res.json({ success: true, id: result.insertId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/shifts', adminMiddleware, async (req, res) => {
  const { name, start_time, end_time, color } = req.body;
  try {
    const [result] = await pool.query('INSERT INTO shifts (name, start_time, end_time, color) VALUES (?, ?, ?, ?)', [name, start_time, end_time, color]);
    res.json({ success: true, id: result.insertId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/shifts', adminMiddleware, async (req, res) => {
  const { name, start_time, end_time, color } = req.body;
  try {
    const [result] = await pool.query('INSERT INTO shifts (name, start_time, end_time, color) VALUES (?, ?, ?, ?)', [name, start_time, end_time, color]);
    res.json({ success: true, id: result.insertId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/shifts', adminMiddleware, async (req, res) => {
  const { name, start_time, end_time, color } = req.body;
  try {
    const [result] = await pool.query('INSERT INTO shifts (name, start_time, end_time, color) VALUES (?, ?, ?, ?)', [name, start_time, end_time, color]);
    res.json({ success: true, id: result.insertId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/shifts', adminMiddleware, async (req, res) => {
  const { name, start_time, end_time, color } = req.body;
  try {
    const [result] = await pool.query('INSERT INTO shifts (name, start_time, end_time, color) VALUES (?, ?, ?, ?)', [name, start_time, end_time, color]);
    res.json({ success: true, id: result.insertId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/shifts', adminMiddleware, async (req, res) => {
  const { name, start_time, end_time, color } = req.body;
  try {
    const [result] = await pool.query('INSERT INTO shifts (name, start_time, end_time, color) VALUES (?, ?, ?, ?)', [name, start_time, end_time, color]);
    res.json({ success: true, id: result.insertId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/shifts', adminMiddleware, async (req, res) => {
  const { name, start_time, end_time, color } = req.body;
  try {
    const [result] = await pool.query('INSERT INTO shifts (name, start_time, end_time, color) VALUES (?, ?, ?, ?)', [name, start_time, end_time, color]);
    res.json({ success: true, id: result.insertId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/shifts', adminMiddleware, async (req, res) => {
  const { name, start_time, end_time, color } = req.body;
  try {
    const [result] = await pool.query('INSERT INTO shifts (name, start_time, end_time, color) VALUES (?, ?, ?, ?)', [name, start_time, end_time, color]);
    res.json({ success: true, id: result.insertId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/shifts', adminMiddleware, async (req, res) => {
  const { name, start_time, end_time, color } = req.body;
  try {
    const [result] = await pool.query('INSERT INTO shifts (name, start_time, end_time, color) VALUES (?, ?, ?, ?)', [name, start_time, end_time, color]);
    res.json({ success: true, id: result.insertId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/shifts', adminMiddleware, async (req, res) => {
  const { name, start_time, end_time, color } = req.body;
  try {
    const [result] = await pool.query('INSERT INTO shifts (name, start_time, end_time, color) VALUES (?, ?, ?, ?)', [name, start_time, end_time, color]);
    res.json({ success: true, id: result.insertId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/shifts', adminMiddleware, async (req, res) => {
  const { name, start_time, end_time, color } = req.body;
  try {
    const [result] = await pool.query('INSERT INTO shifts (name, start_time, end_time, color) VALUES (?, ?, ?, ?)', [name, start_time, end_time, color]);
    res.json({ success: true, id: result.insertId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/shifts', adminMiddleware, async (req, res) => {
  const { name, start_time, end_time, color } = req.body;
  try {
    const [result] = await pool.query('INSERT INTO shifts (name, start_time, end_time, color) VALUES (?, ?, ?, ?)', [name, start_time, end_time, color]);
    res.json({ success: true, id: result.insertId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/shifts', adminMiddleware, async (req, res) => {
  const { name, start_time, end_time, color } = req.body;
  try {
    const [result] = await pool.query('INSERT INTO shifts (name, start_time, end_time, color) VALUES (?, ?, ?, ?)', [name, start_time, end_time, color]);
    res.json({ success: true, id: result.insertId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/shifts', adminMiddleware, async (req, res) => {
  const { name, start_time, end_time, color } = req.body;
  try {
    const [result] = await pool.query('INSERT INTO shifts (name, start_time, end_time, color) VALUES (?, ?, ?, ?)', [name, start_time, end_time, color]);
    res.json({ success: true, id: result.insertId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/shifts', adminMiddleware, async (req, res) => {
  const { name, start_time, end_time, color } = req.body;
  try {
    const [result] = await pool.query('INSERT INTO shifts (name, start_time, end_time, color) VALUES (?, ?, ?, ?)', [name, start_time, end_time, color]);
    res.json({ success: true, id: result.insertId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/shifts', adminMiddleware, async (req, res) => {
  const { name, start_time, end_time, color } = req.body;
  try {
    const [result] = await pool.query('INSERT INTO shifts (name, start_time, end_time, color) VALUES (?, ?, ?, ?)', [name, start_time, end_time, color]);
    res.json({ success: true, id: result.insertId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/shifts', adminMiddleware, async (req, res) => {
  const { name, start_time, end_time, color } = req.body;
  try {
    const [result] = await pool.query('INSERT INTO shifts (name, start_time, end_time, color) VALUES (?, ?, ?, ?)', [name, start_time, end_time, color]);
    res.json({ success: true, id: result.insertId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/shifts', adminMiddleware, async (req, res) => {
  const { name, start_time, end_time, color } = req.body;
  try {
    const [result] = await pool.query('INSERT INTO shifts (name, start_time, end_time, color) VALUES (?, ?, ?, ?)', [name, start_time, end_time, color]);
    res.json({ success: true, id: result.insertId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/shifts', adminMiddleware, async (req, res) => {
  const { name, start_time, end_time, color } = req.body;
  try {
    const [result] = await pool.query('INSERT INTO shifts (name, start_time, end_time, color) VALUES (?, ?, ?, ?)', [name, start_time, end_time, color]);
    res.json({ success: true, id: result.insertId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/shifts', adminMiddleware, async (req, res) => {
  const { name, start_time, end_time, color } = req.body;
  try {
    const [result] = await pool.query('INSERT INTO shifts (name, start_time, end_time, color) VALUES (?, ?, ?, ?)', [name, start_time, end_time, color]);
    res.json({ success: true, id: result.insertId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/shifts', adminMiddleware, async (req, res) => {
  const { name, start_time, end_time, color } = req.body;
  try {
    const [result] = await pool.query('INSERT INTO shifts (name, start_time, end_time, color) VALUES (?, ?, ?, ?)', [name, start_time, end_time, color]);
    res.json({ success: true, id: result.insertId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/shifts', adminMiddleware, async (req, res) => {
  const { name, start_time, end_time, color } = req.body;
  try {
    const [result] = await pool.query('INSERT INTO shifts (name, start_time, end_time, color) VALUES (?, ?, ?, ?)', [name, start_time, end_time, color]);
    res.json({ success: true, id: result.insertId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/shifts', adminMiddleware, async (req, res) => {
  const { name, start_time, end_time, color } = req.body;
  try {
    const [result] = await pool.query('INSERT INTO shifts (name, start_time, end_time, color) VALUES (?, ?, ?, ?)', [name, start_time, end_time, color]);
    res.json({ success: true, id: result.insertId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/shifts', adminMiddleware, async (req, res) => {
  const { name, start_time, end_time, color } = req.body;
  try {
    const [result] = await pool.query('INSERT INTO shifts (name, start_time, end_time, color) VALUES (?, ?, ?, ?)', [name, start_time, end_time, color]);
    res.json({ success: true, id: result.insertId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/shifts', adminMiddleware, async (req, res) => {
  const { name, start_time, end_time, color } = req.body;
  try {
    const [result] = await pool.query('INSERT INTO shifts (name, start_time, end_time, color) VALUES (?, ?, ?, ?)', [name, start_time, end_time, color]);
    res.json({ success: true, id: result.insertId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/shifts', adminMiddleware, async (req, res) => {
  const { name, start_time, end_time, color } = req.body;
  try {
    const [result] = await pool.query('INSERT INTO shifts (name, start_time, end_time, color) VALUES (?, ?, ?, ?)', [name, start_time, end_time, color]);
    res.json({ success: true, id: result.insertId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/shifts', adminMiddleware, async (req, res) => {
  const { name, start_time, end_time, color } = req.body;
  try {
    const [result] = await pool.query('INSERT INTO shifts (name, start_time, end_time, color) VALUES (?, ?, ?, ?)', [name, start_time, end_time, color]);
    res.json({ success: true, id: result.insertId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/shifts', adminMiddleware, async (req, res) => {
  const { name, start_time, end_time, color } = req.body;
  try {
    const [result] = await pool.query('INSERT INTO shifts (name, start_time, end_time, color) VALUES (?, ?, ?, ?)', [name, start_time, end_time, color]);
    res.json({ success: true, id: result.insertId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/shifts', adminMiddleware, async (req, res) => {
  const { name, start_time, end_time, color } = req.body;
  try {
    const [result] = await pool.query('INSERT INTO shifts (name, start_time, end_time, color) VALUES (?, ?, ?, ?)', [name, start_time, end_time, color]);
    res.json({ success: true, id: result.insertId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/shifts', adminMiddleware, async (req, res) => {
  const { name, start_time, end_time, color } = req.body;
  try {
    const [result] = await pool.query('INSERT INTO shifts (name, start_time, end_time, color) VALUES (?, ?, ?, ?)', [name, start_time, end_time, color]);
    res.json({ success: true, id: result.insertId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/shifts', adminMiddleware, async (req, res) => {
  const { name, start_time, end_time, color } = req.body;
  try {
    const [result] = await pool.query('INSERT INTO shifts (name, start_time, end_time, color) VALUES (?, ?, ?, ?)', [name, start_time, end_time, color]);
    res.json({ success: true, id: result.insertId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/shifts', adminMiddleware, async (req, res) => {
  const { name, start_time, end_time, color } = req.body;
  try {
    const [result] = await pool.query('INSERT INTO shifts (name, start_time, end_time, color) VALUES (?, ?, ?, ?)', [name, start_time, end_time, color]);
    res.json({ success: true, id: result.insertId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/shifts', adminMiddleware, async (req, res) => {
  const { name, start_time, end_time, color } = req.body;
  try {
    const [result] = await pool.query('INSERT INTO shifts (name, start_time, end_time, color) VALUES (?, ?, ?, ?)', [name, start_time, end_time, color]);
    res.json({ success: true, id: result.insertId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/shifts', adminMiddleware, async (req, res) => {
  const { name, start_time, end_time, color } = req.body;
  try {
    const [result] = await pool.query('INSERT INTO shifts (name, start_time, end_time, color) VALUES (?, ?, ?, ?)', [name, start_time, end_time, color]);
    res.json({ success: true, id: result.insertId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/shifts', adminMiddleware, async (req, res) => {
  const { name, start_time, end_time, color } = req.body;
  try {
    const [result] = await pool.query('INSERT INTO shifts (name, start_time, end_time, color) VALUES (?, ?, ?, ?)', [name, start_time, end_time, color]);
    res.json({ success: true, id: result.insertId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/shifts', adminMiddleware, async (req, res) => {
  const { name, start_time, end_time, color } = req.body;
  try {
    const [result] = await pool.query('INSERT INTO shifts (name, start_time, end_time, color) VALUES (?, ?, ?, ?)', [name, start_time, end_time, color]);
    res.json({ success: true, id: result.insertId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/shifts', adminMiddleware, async (req, res) => {
  const { name, start_time, end_time, color } = req.body;
  try {
    const [result] = await pool.query('INSERT INTO shifts (name, start_time, end_time, color) VALUES (?, ?, ?, ?)', [name, start_time, end_time, color]);
    res.json({ success: true, id: result.insertId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/shifts', adminMiddleware, async (req, res) => {
  const { name, start_time, end_time, color } = req.body;
  try {
    const [result] = await pool.query('INSERT INTO shifts (name, start_time, end_time, color) VALUES (?, ?, ?, ?)', [name, start_time, end_time, color]);
    res.json({ success: true, id: result.insertId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/shifts', adminMiddleware, async (req, res) => {
  const { name, start_time, end_time, color } = req.body;
  try {
    const [result] = await pool.query('INSERT INTO shifts (name, start_time, end_time, color) VALUES (?, ?, ?, ?)', [name, start_time, end_time, color]);
    res.json({ success: true, id: result.insertId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/shifts', adminMiddleware, async (req, res) => {
  const { name, start_time, end_time, color } = req.body;
  try {
    const [result] = await pool.query('INSERT INTO shifts (name, start_time, end_time, color) VALUES (?, ?, ?, ?)', [name, start_time, end_time, color]);
    res.json({ success: true, id: result.insertId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/shifts', adminMiddleware, async (req, res) => {
  const { name, start_time, end_time, color } = req.body;
  try {
    const [result] = await pool.query('INSERT INTO shifts (name, start_time, end_time, color) VALUES (?, ?, ?, ?)', [name, start_time, end_time, color]);
    res.json({ success: true, id: result.insertId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/shifts', adminMiddleware, async (req, res) => {
  const { name, start_time, end_time, color } = req.body;
  try {
    const [result] = await pool.query('INSERT INTO shifts (name, start_time, end_time, color) VALUES (?, ?, ?, ?)', [name, start_time, end_time, color]);
    res.json({ success: true, id: result.insertId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/shifts', adminMiddleware, async (req, res) => {
  const { name, start_time, end_time, color } = req.body;
  try {
    const [result] = await pool.query('INSERT INTO shifts (name, start_time, end_time, color) VALUES (?, ?, ?, ?)', [name, start_time, end_time, color]);
    res.json({ success: true, id: result.insertId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/shifts', adminMiddleware, async (req, res) => {
  const { name, start_time, end_time, color } = req.body;
  try {
    const [result] = await pool.query('INSERT INTO shifts (name, start_time, end_time, color) VALUES (?, ?, ?, ?)', [name, start_time, end_time, color]);
    res.json({ success: true, id: result.insertId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/shifts', adminMiddleware, async (req, res) => {
  const { name, start_time, end_time, color } = req.body;
  try {
    const [result] = await pool.query('INSERT INTO shifts (name, start_time, end_time, color) VALUES (?, ?, ?, ?)', [name, start_time, end_time, color]);
    res.json({ success: true, id: result.insertId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/shifts', adminMiddleware, async (req, res) => {
  const { name, start_time, end_time, color } = req.body;
  try {
    const [result] = await pool.query('INSERT INTO shifts (name, start_time, end_time, color) VALUES (?, ?, ?, ?)', [name, start_time, end_time, color]);
    res.json({ success: true, id: result.insertId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/shifts', adminMiddleware, async (req, res) => {
  const { name, start_time, end_time, color } = req.body;
  try {
    const [result] = await pool.query('INSERT INTO shifts (name, start_time, end_time, color) VALUES (?, ?, ?, ?)', [name, start_time, end_time, color]);
    res.json({ success: true, id: result.insertId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/shifts', adminMiddleware, async (req, res) => {
  const { name, start_time, end_time, color } = req.body;
  try {
    const [result] = await pool.query('INSERT INTO shifts (name, start_time, end_time, color) VALUES (?, ?, ?, ?)', [name, start_time, end_time, color]);
    res.json({ success: true, id: result.insertId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/shifts', adminMiddleware, async (req, res) => {
  const { name, start_time, end_time, color } = req.body;
  try {
    const [result] = await pool.query('INSERT INTO shifts (name, start_time, end_time, color) VALUES (?, ?, ?, ?)', [name, start_time, end_time, color]);
    res.json({ success: true, id: result.insertId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/shifts', adminMiddleware, async (req, res) => {
  const { name, start_time, end_time, color } = req.body;
  try {
    const [result] = await pool.query('INSERT INTO shifts (name, start_time, end_time, color) VALUES (?, ?, ?, ?)', [name, start_time, end_time, color]);
    res.json({ success: true, id: result.insertId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/shifts', adminMiddleware, async (req, res) => {
  const { name, start_time, end_time, color } = req.body;
  try {
    const [result] = await pool.query('INSERT INTO shifts (name, start_time, end_time, color) VALUES (?, ?, ?, ?)', [name, start_time, end_time, color]);
    res.json({ success: true, id: result.insertId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/shifts', adminMiddleware, async (req, res) => {
  const { name, start_time, end_time, color } = req.body;
  try {
    const [result] = await pool.query('INSERT INTO shifts (name, start_time, end_time, color) VALUES (?, ?, ?, ?)', [name, start_time, end_time, color]);
    res.json({ success: true, id: result.insertId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/shifts', adminMiddleware, async (req, res) => {
  const { name, start_time, end_time, color } = req.body;
  try {
    const [result] = await pool.query('INSERT INTO shifts (name, start_time, end_time, color) VALUES (?, ?, ?, ?)', [name, start_time, end_time, color]);
    res.json({ success: true, id: result.insertId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/shifts', adminMiddleware, async (req, res) => {
  const { name, start_time, end_time, color } = req.body;
  try {
    const [result] = await pool.query('INSERT INTO shifts (name, start_time, end_time, color) VALUES (?, ?, ?, ?)', [name, start_time, end_time, color]);
    res.json({ success: true, id: result.insertId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/shifts', adminMiddleware, async (req, res) => {
  const { name, start_time, end_time, color } = req.body;
  try {
    const [result] = await pool.query('INSERT INTO shifts (name, start_time, end_time, color) VALUES (?, ?, ?, ?)', [name, start_time, end_time, color]);
    res.json({ success: true, id: result.insertId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/shifts', adminMiddleware, async (req, res) => {
  const { name, start_time, end_time, color } = req.body;
  try {
    const [result] = await pool.query('INSERT INTO shifts (name, start_time, end_time, color) VALUES (?, ?, ?, ?)', [name, start_time, end_time, color]);
    res.json({ success: true, id: result.insertId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/shifts', adminMiddleware, async (req, res) => {
  const { name, start_time, end_time, color } = req.body;
  try {
    const [result] = await pool.query('INSERT INTO shifts (name, start_time, end_time, color) VALUES (?, ?, ?, ?)', [name, start_time, end_time, color]);
    res.json({ success: true, id: result.insertId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/shifts', adminMiddleware, async (req, res) => {
  const { name, start_time, end_time, color } = req.body;
  try {
    const [result] = await pool.query('INSERT INTO shifts (name, start_time, end_time, color) VALUES (?, ?, ?, ?)', [name, start_time, end_time, color]);
    res.json({ success: true, id: result.insertId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/shifts', adminMiddleware, async (req, res) => {
  const { name, start_time, end_time, color } = req.body;
  try {
    const [result] = await pool.query('INSERT INTO shifts (name, start_time, end_time, color) VALUES (?, ?, ?, ?)', [name, start_time, end_time, color]);
    res.json({ success: true, id: result.insertId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/shifts', adminMiddleware, async (req, res) => {
  const { name, start_time, end_time, color } = req.body;
  try {
    const [result] = await pool.query('INSERT INTO shifts (name, start_time, end_time, color) VALUES (?, ?, ?, ?)', [name, start_time, end_time, color]);
    res.json({ success: true, id: result.insertId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/shifts', adminMiddleware, async (req, res) => {
  const { name, start_time, end_time, color } = req.body;
  try {
    const [result] = await pool.query('INSERT INTO shifts (name, start_time, end_time, color) VALUES (?, ?, ?, ?)', [name, start_time, end_time, color]);
    res.json({ success: true, id: result.insertId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/shifts', adminMiddleware, async (req, res) => {
  const { name, start_time, end_time, color } = req.body;
  try {
    const [result] = await pool.query('INSERT INTO shifts (name, start_time, end_time, color) VALUES (?, ?, ?, ?)', [name, start_time, end_time, color]);
    res.json({ success: true, id: result.insertId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/shifts', adminMiddleware, async (req, res) => {
  const { name, start_time, end_time, color } = req.body;
  try {
    const [result] = await pool.query('INSERT INTO shifts (name, start_time, end_time, color) VALUES (?, ?, ?, ?)', [name, start_time, end_time, color]);
    res.json({ success: true, id: result.insertId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/shifts', adminMiddleware, async (req, res) => {
  const { name, start_time, end_time, color } = req.body;
  try {
    const [result] = await pool.query('INSERT INTO shifts (name, start_time, end_time, color) VALUES (?, ?, ?, ?)', [name, start_time, end_time, color]);
    res.json({ success: true, id: result.insertId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/shifts', adminMiddleware, async (req, res) => {
  const { name, start_time, end_time, color } = req.body;
  try {
    const [result] = await pool.query('INSERT INTO shifts (name, start_time, end_time, color) VALUES (?, ?, ?, ?)', [name, start_time, end_time, color]);
    res.json({ success: true, id: result.insertId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/shifts', adminMiddleware, async (req, res) => {
  const { name, start_time, end_time, color } = req.body;
  try {
    const [result] = await pool.query('INSERT INTO shifts (name, start_time, end_time, color) VALUES (?, ?, ?, ?)', [name, start_time, end_time, color]);
    res.json({ success: true, id: result.insertId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/shifts', adminMiddleware, async (req, res) => {
  const { name, start_time, end_time, color } = req.body;
  try {
    const [result] = await pool.query('INSERT INTO shifts (name, start_time, end_time, color) VALUES (?, ?, ?, ?)', [name, start_time, end_time, color]);
    res.json({ success: true, id: result.insertId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/shifts', adminMiddleware, async (req, res) => {
  const { name, start_time, end_time, color } = req.body;
  try {
    const [result] = await pool.query('INSERT INTO shifts (name, start_time, end_time, color) VALUES (?, ?, ?, ?)', [name, start_time, end_time, color]);
    res.json({ success: true, id: result.insertId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/shifts', adminMiddleware, async (req, res) => {
  const { name, start_time, end_time, color } = req.body;
  try {
    const [result] = await pool.query('INSERT INTO shifts (name, start_time, end_time, color) VALUES (?, ?, ?, ?)', [name, start_time, end_time, color]);
    res.json({ success: true, id: result.insertId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/shifts', adminMiddleware, async (req, res) => {
  const { name, start_time, end_time, color } = req.body;
  try {
    const [result] = await pool.query('INSERT INTO shifts (name, start_time, end_time, color) VALUES (?, ?, ?, ?)', [name, start_time, end_time, color]);
    res.json({ success: true, id: result.insertId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/shifts', adminMiddleware, async (req, res) => {
  const { name, start_time, end_time, color } = req.body;
  try {
    const [result] = await pool.query('INSERT INTO shifts (name, start_time, end_time, color) VALUES (?, ?, ?, ?)', [name, start_time, end_time, color]);
    res.json({ success: true, id: result.insertId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/shifts', adminMiddleware, async (req, res) => {
  const { name, start_time, end_time, color } = req.body;
  try {
    const [result] = await pool.query('INSERT INTO shifts (name, start_time, end_time, color) VALUES (?, ?, ?, ?)', [name, start_time, end_time, color]);
    res.json({ success: true, id: result.insertId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/shifts', adminMiddleware, async (req, res) => {
  const { name, start_time, end_time, color } = req.body;
  try {
    const [result] = await pool.query('INSERT INTO shifts (name, start_time, end_time, color) VALUES (?, ?, ?, ?)', [name, start_time, end_time, color]);
    res.json({ success: true, id: result.insertId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/shifts', adminMiddleware, async (req, res) => {
  const { name, start_time, end_time, color } = req.body;
  try {
    const [result] = await pool.query('INSERT INTO shifts (name, start_time, end_time, color) VALUES (?, ?, ?, ?)', [name, start_time, end_time, color]);
    res.json({ success: true, id: result.insertId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/shifts', adminMiddleware, async (req, res) => {
  const { name, start_time, end_time, color } = req.body;
  try {
    const [result] = await pool.query('INSERT INTO shifts (name, start_time, end_time, color) VALUES (?, ?, ?, ?)', [name, start_time, end_time, color]);
    res.json({ success: true, id: result.insertId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/shifts', adminMiddleware, async (req, res) => {
  const { name, start_time, end_time, color } = req.body;
  try {
    const [result] = await pool.query('INSERT INTO shifts (name, start_time, end_time, color) VALUES (?, ?, ?, ?)', [name, start_time, end_time, color]);
    res.json({ success: true, id: result.insertId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/shifts', adminMiddleware, async (req, res) => {
  const { name, start_time, end_time, color } = req.body;
  try {
    const [result] = await pool.query('INSERT INTO shifts (name, start_time, end_time, color) VALUES (?, ?, ?, ?)', [name, start_time, end_time, color]);
    res.json({ success: true, id: result.insertId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/shifts', adminMiddleware, async (req, res) => {
  const { name, start_time, end_time, color } = req.body;
  try {
    const [result] = await pool.query('INSERT INTO shifts (name, start_time, end_time, color) VALUES (?, ?, ?, ?)', [name, start_time, end_time, color]);
    res.json({ success: true, id: result.insertId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/shifts', adminMiddleware, async (req, res) => {
  const { name, start_time, end_time, color } = req.body;
  try {
    const [result] = await pool.query('INSERT INTO shifts (name, start_time, end_time, color) VALUES (?, ?, ?, ?)', [name, start_time, end_time, color]);
    res.json({ success: true, id: result.insertId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/shifts', adminMiddleware, async (req, res) => {
  const { name, start_time, end_time, color } = req.body;
  try {
    const [result] = await pool.query('INSERT INTO shifts (name, start_time, end_time, color) VALUES (?, ?, ?, ?)', [name, start_time, end_time, color]);
    res.json({ success: true, id: result.insertId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/shifts', adminMiddleware, async (req, res) => {
  const { name, start_time, end_time, color } = req.body;
  try {
    const [result] = await pool.query('INSERT INTO shifts (name, start_time, end_time, color) VALUES (?, ?, ?, ?)', [name, start_time, end_time, color]);
    res.json({ success: true, id: result.insertId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/shifts', adminMiddleware, async (req, res) => {
  const { name, start_time, end_time, color } = req.body;
  try {
    const [result] = await pool.query('INSERT INTO shifts (name, start_time, end_time, color) VALUES (?, ?, ?, ?)', [name, start_time, end_time, color]);
    res.json({ success: true, id: result.insertId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/shifts', adminMiddleware, async (req, res) => {
  const { name, start_time, end_time, color } = req.body;
  try {
    const [result] = await pool.query('INSERT INTO shifts (name, start_time, end_time, color) VALUES (?, ?, ?, ?)', [name, start_time, end_time, color]);
    res.json({ success: true, id: result.insertId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/shifts', adminMiddleware, async (req, res) => {
  const { name, start_time, end_time, color } = req.body;
  try {
    const [result] = await pool.query('INSERT INTO shifts (name, start_time, end_time, color) VALUES (?, ?, ?, ?)', [name, start_time, end_time, color]);
    res.json({ success: true, id: result.insertId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/shifts', adminMiddleware, async (req, res) => {
  const { name, start_time, end_time, color } = req.body;
  try {
    const [result] = await pool.query('INSERT INTO shifts (name, start_time, end_time, color) VALUES (?, ?, ?, ?)', [name, start_time, end_time, color]);
    res.json({ success: true, id: result.insertId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/shifts', adminMiddleware, async (req, res) => {
  const { name, start_time, end_time, color } = req.body;
  try {
    const [result] = await pool.query('INSERT INTO shifts (name, start_time, end_time, color) VALUES (?, ?, ?, ?)', [name, start_time, end_time, color]);
    res.json({ success: true, id: result.insertId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/shifts', adminMiddleware, async (req, res) => {
  const { name, start_time, end_time, color } = req.body;
  try {
    const [result] = await pool.query('INSERT INTO shifts (name, start_time, end_time, color) VALUES (?, ?, ?, ?)', [name, start_time, end_time, color]);
    res.json({ success: true, id: result.insertId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/shifts', adminMiddleware, async (req, res) => {
  const { name, start_time, end_time, color } = req.body;
  try {
    const [result] = await pool.query('INSERT INTO shifts (name, start_time, end_time, color) VALUES (?, ?, ?, ?)', [name, start_time, end_time, color]);
    res.json({ success: true, id: result.insertId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/shifts', adminMiddleware, async (req, res) => {
  const { name, start_time, end_time, color } = req.body;
  try {
    const [result] = await pool.query('INSERT INTO shifts (name, start_time, end_time, color) VALUES (?, ?, ?, ?)', [name, start_time, end_time, color]);
    res.json({ success: true, id: result.insertId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/shifts', adminMiddleware, async (req, res) => {
  const { name, start_time, end_time, color } = req.body;
  try {
    const [result] = await pool.query('INSERT INTO shifts (name, start_time, end_time, color) VALUES (?, ?, ?, ?)', [name, start_time, end_time, color]);
    res.json({ success: true, id: result.insertId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/shifts', adminMiddleware, async (req, res) => {
  const { name, start_time, end_time, color } = req.body;
  try {
    const [result] = await pool.query('INSERT INTO shifts (name, start_time, end_time, color) VALUES (?, ?, ?, ?)', [name, start_time, end_time, color]);
    res.json({ success: true, id: result.insertId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/shifts', adminMiddleware, async (req, res) => {
  const { name, start_time, end_time, color } = req.body;
  try {
    const [result] = await pool.query('INSERT INTO shifts (name, start_time, end_time, color) VALUES (?, ?, ?, ?)', [name, start_time, end_time, color]);
    res.json({ success: true, id: result.insertId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/shifts', adminMiddleware, async (req, res) => {
  const { name, start_time, end_time, color } = req.body;
  try {
    const [result] = await pool.query('INSERT INTO shifts (name, start_time, end_time, color) VALUES (?, ?, ?, ?)', [name, start_time, end_time, color]);
    res.json({ success: true, id: result.insertId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/shifts', adminMiddleware, async (req, res) => {
  const { name, start_time, end_time, color } = req.body;
  try {
    const [result] = await pool.query('INSERT INTO shifts (name, start_time, end_time, color) VALUES (?, ?, ?, ?)', [name, start_time, end_time, color]);
    res.json({ success: true, id: result.insertId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/shifts', adminMiddleware, async (req, res) => {
  const { name, start_time, end_time, color } = req.body;
  try {
    const [result] = await pool.query('INSERT INTO shifts (name, start_time, end_time, color) VALUES (?, ?, ?, ?)', [name, start_time, end_time, color]);
    res.json({ success: true, id: result.insertId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/shifts', adminMiddleware, async (req, res) => {
  const { name, start_time, end_time, color } = req.body;
  try {
    const [result] = await pool.query('INSERT INTO shifts (name, start_time, end_time, color) VALUES (?, ?, ?, ?)', [name, start_time, end_time, color]);
    res.json({ success: true, id: result.insertId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/shifts', adminMiddleware, async (req, res) => {
  const { name, start_time, end_time, color } = req.body;
  try {
    const [result] = await pool.query('INSERT INTO shifts (name, start_time, end_time, color) VALUES (?, ?, ?, ?)', [name, start_time, end_time, color]);
    res.json({ success: true, id: result.insertId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/shifts', adminMiddleware, async (req, res) => {
  const { name, start_time, end_time, color } = req.body;
  try {
    const [result] = await pool.query('INSERT INTO shifts (name, start_time, end_time, color) VALUES (?, ?, ?, ?)', [name, start_time, end_time, color]);
    res.json({ success: true, id: result.insertId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/shifts', adminMiddleware, async (req, res) => {
  const { name, start_time, end_time, color } = req.body;
  try {
    const [result] = await pool.query('INSERT INTO shifts (name, start_time, end_time, color) VALUES (?, ?, ?, ?)', [name, start_time, end_time, color]);
    res.json({ success: true, id: result.insertId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/shifts', adminMiddleware, async (req, res) => {
  const { name, start_time, end_time, color } = req.body;
  try {
    const [result] = await pool.query('INSERT INTO shifts (name, start_time, end_time, color) VALUES (?, ?, ?, ?)', [name, start_time, end_time, color]);
    res.json({ success: true, id: result.insertId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/shifts', adminMiddleware, async (req, res) => {
  const { name, start_time, end_time, color } = req.body;
  try {
    const [result] = await pool.query('INSERT INTO shifts (name, start_time, end_time, color) VALUES (?, ?, ?, ?)', [name, start_time, end_time, color]);
    res.json({ success: true, id: result.insertId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/shifts', adminMiddleware, async (req, res) => {
  const { name, start_time, end_time, color } = req.body;
  try {
    const [result] = await pool.query('INSERT INTO shifts (name, start_time, end_time, color) VALUES (?, ?, ?, ?)', [name, start_time, end_time, color]);
    res.json({ success: true, id: result.insertId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/shifts', adminMiddleware, async (req, res) => {
  const { name, start_time, end_time, color } = req.body;
  try {
    const [result] = await pool.query('INSERT INTO shifts (name, start_time, end_time, color) VALUES (?, ?, ?, ?)', [name, start_time, end_time, color]);
    res.json({ success: true, id: result.insertId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/shifts', adminMiddleware, async (req, res) => {
  const { name, start_time, end_time, color } = req.body;
  try {
    const [result] = await pool.query('INSERT INTO shifts (name, start_time, end_time, color) VALUES (?, ?, ?, ?)', [name, start_time, end_time, color]);
    res.json({ success: true, id: result.insertId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 排班 API
app.get('/api/schedule', async (req, res) => {
  const { storeId, month } = req.query;
  try {
    let query = `SELECT se.id, se.user_id, se.date, se.shift_id, se.custom_time_start, se.custom_time_end,
                        u.full_name, s.name as shift_name, s.color 
                 FROM schedule_entries se 
                 JOIN users u ON se.user_id = u.id 
                 LEFT JOIN shifts s ON se.shift_id = s.id 
                 WHERE u.dept_id = ? AND DATE_FORMAT(se.date, '%Y-%m') = ?`;
    const [rows] = await pool.query(query, [storeId, month]);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/schedule', managerMiddleware, async (req, res) => {
  const { userId, date, shiftId } = req.body;
  try {
    // 檢查權限：主管只能排所屬門市
    if (req.user.role === 'MANAGER') {
      const [[user]] = await pool.query('SELECT dept_id FROM users WHERE id = ?', [userId]);
      if (user.dept_id !== req.user.dept_id) return res.status(403).json({ error: '權限不足' });
    }
    
    await pool.query('INSERT INTO schedule_entries (user_id, date, shift_id, created_by, custom_time_start, custom_time_end) VALUES (?, ?, ?, ?, NULL, NULL) ON DUPLICATE KEY UPDATE shift_id = ?, custom_time_start = NULL, custom_time_end = NULL', [userId, date, shiftId, req.user.id, shiftId]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/schedule/custom', managerMiddleware, async (req, res) => {
  const { userId, date, startTime, endTime } = req.body;
  try {
    // 檢查權限：主管只能排所屬門市
    if (req.user.role === 'MANAGER') {
      const [[user]] = await pool.query('SELECT dept_id FROM users WHERE id = ?', [userId]);
      if (user.dept_id !== req.user.dept_id) return res.status(403).json({ error: '權限不足' });
    }
    
    await pool.query('INSERT INTO schedule_entries (user_id, date, shift_id, custom_time_start, custom_time_end, created_by) VALUES (?, ?, NULL, ?, ?, ?) ON DUPLICATE KEY UPDATE shift_id = NULL, custom_time_start = ?, custom_time_end = ?', [userId, date, startTime, endTime, req.user.id, startTime, endTime]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/schedule/:id', managerMiddleware, async (req, res) => {
  try {
    await pool.query('DELETE FROM schedule_entries WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 班別偏好 API
app.get('/api/schedule/preferences', async (req, res) => {
  const { userId, month } = req.query;
  try {
    const [rows] = await pool.query('SELECT * FROM shift_preferences WHERE user_id = ? AND DATE_FORMAT(date, \'%Y-%m\') = ?', [userId, month]);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/schedule/preferences', async (req, res) => {
  const { userId, date, shiftId, reason } = req.body;
  try {
    await pool.query('INSERT INTO shift_preferences (user_id, date, shift_id, reason) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE reason = ?', [userId, date, shiftId || null, reason, reason]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 查詢特休到期通知
app.get('/api/leave/expiry-notice', adminMiddleware, async (req, res) => {
  const { warningDays = 30 } = req.query;
  try {
    const [results] = await pool.query('CALL sp_get_special_leave_expiry_notice(CURDATE(), ?)', [parseInt(warningDays)]);
    res.json(results[0] || []);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 手動執行特休更新（管理員專用）
app.post('/api/leave/update-special-leave', adminMiddleware, async (req, res) => {
  try {
    const [results] = await pool.query('CALL sp_update_daily_special_leave()');
    res.json({ success: true, message: results[0] || {} });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 手動執行年度重置（管理員專用）
app.post('/api/leave/reset-annual-leave', adminMiddleware, async (req, res) => {
  try {
    const [results] = await pool.query('CALL sp_reset_annual_leave()');
    res.json({ success: true, message: results[0] || {} });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log('Server running on port ' + PORT);
  console.log('✅ 休假計算已移至資料庫層 (Stored Procedures + Events)');
  console.log('✅ 每日 00:10 自動更新特休 (MySQL Event Scheduler)');
  console.log('✅ 每年 1/1 00:10 自動重置曆年制假別');
});
