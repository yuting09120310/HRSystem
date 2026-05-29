const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const pool = require('./db');
const { LEAVE_RULES, getLeaveBalance } = require('./leave_service');
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
  try {
    const [[user]] = await pool.query('SELECT u.*, d.name as dept_name FROM users u JOIN departments d ON u.dept_id = d.id WHERE u.username = ?', [account]);
    if (!user) return res.status(401).json({ error: '帳號或密碼錯誤' });
    if (user.status !== 'ACTIVE') return res.status(403).json({ error: '帳號已停用' });

    const validPassword = user.password === password;
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

app.get('/api/admin/users', adminMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT u.id, u.username, u.full_name, u.role, u.status, u.dept_id, u.hire_date, d.name as dept_name FROM users u LEFT JOIN departments d ON u.dept_id = d.id ORDER BY u.id');
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/users', adminMiddleware, async (req, res) => {
  const { username, password, fullName, deptId, role, hireDate } = req.body;
  if (!username || !password || !fullName || !deptId) return res.status(400).json({ error: '請填寫所有必填欄位' });
  try {
    const [[existing]] = await pool.query('SELECT id FROM users WHERE username = ?', [username]);
    if (existing) return res.status(400).json({ error: '帳號已存在' });
    await pool.query('INSERT INTO users (username, password, full_name, dept_id, role, status, hire_date) VALUES (?, ?, ?, ?, ?, \'ACTIVE\', ?)', [username, password, fullName, deptId, role || 'EMPLOYEE', hireDate || new Date().toISOString().split('T')[0]]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/admin/users/:id', adminMiddleware, async (req, res) => {
  const { fullName, deptId, role, status, hireDate } = req.body;
  try {
    await pool.query('UPDATE users SET full_name = ?, dept_id = ?, role = ?, status = ?, hire_date = ? WHERE id = ?', [fullName, deptId, role, status, hireDate, req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/departments', adminMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT d.id, d.name, d.manager_id, u.full_name as manager_name FROM departments d LEFT JOIN users u ON d.manager_id = u.id ORDER BY d.id');
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/admin/departments/:id', adminMiddleware, async (req, res) => {
  const { managerId } = req.body;
  try {
    await pool.query('UPDATE departments SET manager_id = ? WHERE id = ?', [managerId || null, req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

const managerMiddleware = (req, res, next) => {
  if (req.user.role !== 'ADMIN' && req.user.role !== 'MANAGER') return res.status(403).json({ error: '權限不足' });
  next();
};

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
      result.push({ ...r, deductions: details });
    }
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/salary/employees', managerMiddleware, async (req, res) => {
  try {
    let query = 'SELECT u.id, u.username, u.full_name, u.role, u.dept_id, d.name as dept_name, d.manager_id FROM users u LEFT JOIN departments d ON u.dept_id = d.id WHERE u.status = \'ACTIVE\'';
    const params = [];
    if (req.user.role === 'MANAGER') {
      query += ' AND (u.dept_id = ? OR u.id = ?)';
      params.push(req.user.dept_id, req.user.id);
    }
    const [users] = await pool.query(query, params);
    
    const result = [];
    for (const u of users) {
      const [records] = await pool.query('SELECT * FROM salary_records WHERE user_id = ? ORDER BY month DESC LIMIT 1', [u.id]);
      result.push({ ...u, currentSalary: records[0] || null });
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
    const [[user]] = await pool.query('SELECT dept_id FROM users WHERE id = ?', [userId]);
    if (req.user.role === 'MANAGER' && user.dept_id !== req.user.dept_id) {
      return res.status(403).json({ error: '僅能計算所屬部門員工薪資' });
    }

    const [[record]] = await pool.query('SELECT * FROM salary_records WHERE user_id = ? AND month = ?', [userId, month]);
    if (!record) return res.status(404).json({ error: '找不到該月薪資紀錄，請先設定薪資結構' });

    const base = parseFloat(record.base_salary);
    const prof = parseFloat(record.professional_allowance);
    const meal = parseFloat(record.meal_allowance);
    const totalSalary = base + prof + meal;

    const personalRate = totalSalary / 30;
    const sickRate = personalRate / 2;

    const [leaveRows] = await pool.query('SELECT leave_type, COUNT(*) as days FROM leave_requests WHERE user_id = ? AND status = \'APPROVED\' AND DATE_FORMAT(start_date, \'%Y-%m\') = ? GROUP BY leave_type', [userId, month]);
    
    let totalDeductions = 0;
    const deductionDetails = [];
    for (const lr of leaveRows) {
      let rate = 0;
      if (lr.leave_type === '事假') rate = personalRate;
      else if (lr.leave_type === '病假') rate = sickRate;
      
      const amount = rate * lr.days;
      totalDeductions += amount;
      deductionDetails.push({ leave_type: lr.leave_type, days: lr.days, amount: Math.round(amount) });
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

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log('Server running on port ' + PORT);
});
