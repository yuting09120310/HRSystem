const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');
const pool = require('./db');
const { LEAVE_RULES, getLeaveBalance, getCurrentAnniversarySpecialLeave, updateDailySpecialLeave, resetAnnualLeaveBalances } = require('./leave_service');
require('dotenv').config({ path: './src/backend/.env' });

const app = express();
app.use(cors());
app.use(express.json());

const JWT_SECRET = process.env.JWT_SECRET || 'hr-system-secret-key-2026';

const toLocalDateString = (date = new Date()) => {
  const d = new Date(date);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
};

const addDays = (dateString, days) => {
  const d = new Date(`${dateString}T00:00:00`);
  d.setDate(d.getDate() + days);
  return toLocalDateString(d);
};

const getMonthEndDate = (month) => {
  const [year, monthNumber] = month.split('-').map(Number);
  return toLocalDateString(new Date(year, monthNumber, 0));
};

const getMonthStartDate = (month) => `${month}-01`;

const getSalaryCutoffDate = (month, calculationDate) => {
  const monthStart = getMonthStartDate(month);
  const monthEnd = getMonthEndDate(month);
  const cutoff = calculationDate || monthEnd;
  if (cutoff < monthStart) return monthStart;
  if (cutoff > monthEnd) return monthEnd;
  return cutoff;
};

const FINAL_SALARY_STATUSES = ['PAID', 'LOCKED'];

const canModifySalaryRecord = (record) => !record || !FINAL_SALARY_STATUSES.includes(record.status);

const buildAttendanceDateTime = (date, time) => {
  if (!time) return null;
  return new Date(`${date}T${String(time).slice(0, 8)}`);
};

const combineDateTime = (date, time) => new Date(`${date}T${String(time || '00:00:00').slice(0, 8)}`);

const timeToMinutes = (time) => {
  const [hours, minutes] = String(time || '00:00:00').split(':').map(Number);
  return (hours || 0) * 60 + (minutes || 0);
};

const ensureRuntimeSchema = async () => {
  await pool.query(`CREATE TABLE IF NOT EXISTS attendance_anomaly_notifications (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    date DATE NOT NULL,
    anomaly_type VARCHAR(50) NOT NULL,
    details TEXT,
    sent_to VARCHAR(255),
    sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY unique_user_date_type (user_id, date, anomaly_type),
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS salary_adjustments (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    month VARCHAR(7) NOT NULL,
    adjustment_type VARCHAR(50) NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    description TEXT,
    created_by INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (created_by) REFERENCES users(id)
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS attendance_exception_requests (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    exception_type VARCHAR(50) NOT NULL,
    date DATE NOT NULL,
    requested_clock_in TIME NULL,
    requested_clock_out TIME NULL,
    reason TEXT NOT NULL,
    status VARCHAR(20) DEFAULT 'PENDING',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    processed_at DATETIME NULL,
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS attendance_exception_approvals (
    id INT AUTO_INCREMENT PRIMARY KEY,
    request_id INT NOT NULL,
    approver_id INT NOT NULL,
    status VARCHAR(20) DEFAULT 'PENDING',
    comment TEXT NULL,
    processed_at DATETIME NULL,
    FOREIGN KEY (request_id) REFERENCES attendance_exception_requests(id),
    FOREIGN KEY (approver_id) REFERENCES users(id)
  )`);
  try {
    await pool.query(`ALTER TABLE salary_records ADD COLUMN calculation_date DATE NULL AFTER month`);
  } catch (e) { if (!e.message.includes('Duplicate')) throw e; }
  for (const sql of [
    `ALTER TABLE users ADD COLUMN email VARCHAR(255) NULL AFTER full_name`,
    `ALTER TABLE salary_records ADD COLUMN confirmed_at DATETIME NULL AFTER calculation_date`,
    `ALTER TABLE salary_records ADD COLUMN locked_at DATETIME NULL AFTER paid_date`,
    `ALTER TABLE salary_deduction_details MODIFY COLUMN days DECIMAL(8,2) NOT NULL`,
    `ALTER TABLE salary_deduction_details ADD COLUMN detail_date DATE NULL AFTER leave_type`,
    `ALTER TABLE salary_deduction_details ADD COLUMN start_time TIME NULL AFTER detail_date`,
    `ALTER TABLE salary_deduction_details ADD COLUMN end_time TIME NULL AFTER start_time`,
    `ALTER TABLE salary_deduction_details ADD COLUMN description TEXT NULL AFTER amount`
  ]) {
    try {
      await pool.query(sql);
    } catch (e) { if (!e.message.includes('Duplicate')) throw e; }
  }
};

const createMailTransport = () => {
  if (!process.env.SMTP_HOST) return null;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined
  });
};

const sendAttendanceEmail = async (subject, text, recipients = []) => {
  const toList = [...new Set([
    ...recipients.filter(Boolean),
    process.env.ATTENDANCE_ALERT_EMAIL,
    process.env.HR_NOTIFICATION_EMAIL
  ].filter(Boolean))];
  if (!toList.length) {
    console.warn('[attendance-email] skipped: no recipient email configured');
    return null;
  }
  const transporter = createMailTransport();
  if (!transporter) {
    console.warn('[attendance-email] skipped: SMTP_HOST is not configured', { to: toList.join(', '), subject, text });
    return toList.join(', ');
  }
  await transporter.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: toList.join(', '),
    subject,
    text
  });
  return toList.join(', ');
};

const getExpectedWorkRows = async (startDate, endDate, userId = null) => {
  const params = [startDate, endDate];
  let query = `
    SELECT u.id as user_id, u.full_name, u.email, u.employment_type, u.hourly_wage,
           u.base_salary, u.professional_allowance, u.meal_allowance,
           u.work_start_time, u.work_end_time, d.schedule_type,
           se.date, se.shift_id, se.custom_time_start, se.custom_time_end,
           s.start_time as shift_start_time, s.end_time as shift_end_time
    FROM users u
    LEFT JOIN departments d ON u.dept_id = d.id
    LEFT JOIN schedule_entries se ON se.user_id = u.id AND se.date BETWEEN ? AND ?
    LEFT JOIN shifts s ON se.shift_id = s.id
    WHERE u.status = 'ACTIVE'`;
  if (userId) {
    query += ' AND u.id = ?';
    params.push(userId);
  }
  const [users] = await pool.query(query, params);
  const rows = [];
  const fixedUserIds = new Set();
  for (const user of users) {
    if (user.schedule_type === 'SHIFT') {
      if (!user.date) continue;
      const date = toLocalDateString(user.date);
      rows.push({
        ...user,
        date,
        start_time: user.custom_time_start || user.shift_start_time,
        end_time: user.custom_time_end || user.shift_end_time
      });
      continue;
    }

    if (fixedUserIds.has(user.user_id)) continue;
    fixedUserIds.add(user.user_id);

    for (let date = startDate; date <= endDate; date = addDays(date, 1)) {
      const day = new Date(`${date}T00:00:00`).getDay();
      if (day === 0 || day === 6) continue;
      rows.push({
        ...user,
        date,
        start_time: user.work_start_time || '08:00:00',
        end_time: user.work_end_time || '17:00:00'
      });
    }
  }
  return rows.filter(r => r.start_time && r.end_time);
};

const getApprovedLeaveDates = async (userId, startDate, endDate) => {
  const [leaves] = await pool.query(
    `SELECT leave_type, start_date, end_date, reason FROM leave_requests
     WHERE user_id = ? AND status = 'APPROVED' AND start_date <= ? AND end_date >= ?`,
    [userId, endDate, startDate]
  );
  const map = new Map();
  for (const leave of leaves) {
    const leaveStart = toLocalDateString(leave.start_date) < startDate ? startDate : toLocalDateString(leave.start_date);
    const leaveEnd = toLocalDateString(leave.end_date) > endDate ? endDate : toLocalDateString(leave.end_date);
    for (let date = leaveStart; date <= leaveEnd; date = addDays(date, 1)) {
      map.set(date, { leaveType: leave.leave_type, reason: leave.reason });
    }
  }
  return map;
};

const getAttendanceMap = async (userId, startDate, endDate) => {
  const [attendance] = await pool.query(
    'SELECT date, clock_in, clock_out FROM attendance WHERE user_id = ? AND date BETWEEN ? AND ?',
    [userId, startDate, endDate]
  );
  const map = new Map();
  attendance.forEach(a => map.set(toLocalDateString(a.date), a));
  return map;
};

const getAttendanceIssue = (workRow, attendance) => {
  const expectedStart = combineDateTime(workRow.date, workRow.start_time);
  const expectedEnd = combineDateTime(workRow.date, workRow.end_time);
  if (timeToMinutes(workRow.end_time) <= timeToMinutes(workRow.start_time)) {
    expectedEnd.setDate(expectedEnd.getDate() + 1);
  }

  if (!attendance?.clock_in && !attendance?.clock_out) {
    return { type: 'ABSENCE', label: '曠職', minutes: Math.round((expectedEnd - expectedStart) / 60000) };
  }
  const issues = [];
  let minutes = 0;
  if (!attendance?.clock_in) {
    issues.push('未上班打卡');
    minutes += Math.round((expectedEnd - expectedStart) / 60000);
  } else {
    const clockIn = new Date(attendance.clock_in);
    if (clockIn > expectedStart) {
      const lateMinutes = Math.round((clockIn - expectedStart) / 60000);
      issues.push(`遲到 ${lateMinutes} 分鐘`);
      minutes += lateMinutes;
    }
  }
  if (!attendance?.clock_out) {
    issues.push('未下班打卡');
  } else {
    const clockOut = new Date(attendance.clock_out);
    if (clockOut < expectedEnd) {
      const earlyMinutes = Math.round((expectedEnd - clockOut) / 60000);
      issues.push(`早退 ${earlyMinutes} 分鐘`);
      minutes += earlyMinutes;
    }
  }
  if (!issues.length) return null;
  return { type: issues.some(i => i.includes('早退')) ? 'EARLY_LEAVE' : 'LATE_OR_MISSING_CLOCK', label: issues.join('、'), minutes };
};

const checkAttendanceAnomalies = async (targetDate = addDays(toLocalDateString(), -1)) => {
  const workRows = await getExpectedWorkRows(targetDate, targetDate);
  const notified = [];
  for (const workRow of workRows) {
    const leaveDates = await getApprovedLeaveDates(workRow.user_id, targetDate, targetDate);
    if (leaveDates.has(targetDate)) continue;
    const attendanceMap = await getAttendanceMap(workRow.user_id, targetDate, targetDate);
    const issue = getAttendanceIssue(workRow, attendanceMap.get(targetDate));
    if (!issue) continue;

    const details = `${workRow.full_name} 於 ${targetDate} 應上班 ${String(workRow.start_time).slice(0, 5)}-${String(workRow.end_time).slice(0, 5)}，異常：${issue.label}`;
    const [result] = await pool.query(
      'INSERT IGNORE INTO attendance_anomaly_notifications (user_id, date, anomaly_type, details) VALUES (?, ?, ?, ?)',
      [workRow.user_id, targetDate, issue.type, details]
    );
    if (!result.affectedRows) continue;
    const sentTo = await sendAttendanceEmail(`[HR] 打卡異常通知 - ${workRow.full_name} ${targetDate}`, details, [workRow.email]);
    await pool.query('UPDATE attendance_anomaly_notifications SET sent_to = ? WHERE user_id = ? AND date = ? AND anomaly_type = ?', [sentTo, workRow.user_id, targetDate, issue.type]);
    notified.push({ userId: workRow.user_id, name: workRow.full_name, date: targetDate, type: issue.type, details });
  }
  return notified;
};

const calculateSalaryRecord = async (userId, month, calculationDate) => {
  const cutoffDate = getSalaryCutoffDate(month, calculationDate);
  const startDate = getMonthStartDate(month);
  const [[user]] = await pool.query('SELECT dept_id, employment_type, hourly_wage, base_salary, professional_allowance, meal_allowance FROM users WHERE id = ?', [userId]);
  if (!user) throw new Error('找不到員工');

  let [[record]] = await pool.query('SELECT * FROM salary_records WHERE user_id = ? AND month = ?', [userId, month]);
  if (!record) {
    if (user.employment_type === 'FULL_TIME' && user.base_salary) {
      await pool.query('INSERT INTO salary_records (user_id, month, calculation_date, base_salary, professional_allowance, meal_allowance, status) VALUES (?, ?, ?, ?, ?, ?, \'DRAFT\')', [userId, month, cutoffDate, user.base_salary, user.professional_allowance || 0, user.meal_allowance || 0]);
      [[record]] = await pool.query('SELECT * FROM salary_records WHERE user_id = ? AND month = ?', [userId, month]);
    } else if (user.employment_type === 'PART_TIME') {
      await pool.query('INSERT INTO salary_records (user_id, month, calculation_date, base_salary, professional_allowance, meal_allowance, status) VALUES (?, ?, ?, 0, 0, 0, \'DRAFT\')', [userId, month, cutoffDate]);
      [[record]] = await pool.query('SELECT * FROM salary_records WHERE user_id = ? AND month = ?', [userId, month]);
    } else {
      throw new Error('找不到該月薪資紀錄，請先設定薪資結構');
    }
  }

  if (!canModifySalaryRecord(record)) {
    throw new Error('該薪資表已發放或已鎖定，無法重新計算');
  }

  let totalSalary = 0;
  let totalDeductions = 0;
  let totalAdjustments = 0;
  const deductionDetails = [];

  if (user.employment_type === 'PART_TIME') {
    const hourlyWage = parseFloat(user.hourly_wage || 0);
    if (!hourlyWage) throw new Error('請先設定時薪');
    const [attendance] = await pool.query('SELECT date, clock_in, clock_out FROM attendance WHERE user_id = ? AND date BETWEEN ? AND ? AND clock_in IS NOT NULL AND clock_out IS NOT NULL', [userId, startDate, cutoffDate]);
    const totalWorkingHours = attendance.reduce((sum, a) => sum + ((new Date(a.clock_out) - new Date(a.clock_in)) / 3600000), 0);
    totalSalary = hourlyWage * totalWorkingHours;
    attendance.forEach(a => {
      const hours = (new Date(a.clock_out) - new Date(a.clock_in)) / 3600000;
      const clockIn = new Date(a.clock_in);
      const clockOut = new Date(a.clock_out);
      deductionDetails.push({
        leave_type: '工作時數',
        detail_date: toLocalDateString(a.date),
        start_time: clockIn.toTimeString().slice(0, 8),
        end_time: clockOut.toTimeString().slice(0, 8),
        days: Math.round(hours * 10) / 10,
        amount: 0,
        description: `工讀出勤 ${clockIn.toLocaleString('zh-TW')} 至 ${clockOut.toLocaleString('zh-TW')}，共 ${Math.round(hours * 10) / 10} 小時`
      });
    });
  } else {
    const base = parseFloat(record.base_salary || user.base_salary || 0);
    const prof = parseFloat(record.professional_allowance || user.professional_allowance || 0);
    const meal = parseFloat(record.meal_allowance || user.meal_allowance || 0);
    totalSalary = base + prof + meal;
    const personalRate = totalSalary / 30;
    const sickRate = personalRate / 2;
    const minuteRate = totalSalary / 30 / 8 / 60;

    const workRows = await getExpectedWorkRows(startDate, cutoffDate, userId);
    const leaveDates = await getApprovedLeaveDates(userId, startDate, cutoffDate);
    const attendanceMap = await getAttendanceMap(userId, startDate, cutoffDate);
    const detailRows = [];

    for (const workRow of workRows) {
      const leave = leaveDates.get(workRow.date);
      if (leave) {
        let rate = 0;
        if (leave.leaveType === '事假') rate = personalRate;
        else if (leave.leaveType === '病假') rate = sickRate;
        const amount = Math.round(rate);
        detailRows.push({
          leave_type: leave.leaveType,
          detail_date: workRow.date,
          start_time: workRow.start_time,
          end_time: workRow.end_time,
          days: 1,
          amount,
          description: `${workRow.date} ${leave.leaveType}，原應出勤 ${String(workRow.start_time).slice(0, 5)}-${String(workRow.end_time).slice(0, 5)}${leave.reason ? `，原因：${leave.reason}` : ''}`
        });
        continue;
      }
      const attendance = attendanceMap.get(workRow.date);
      const issue = getAttendanceIssue(workRow, attendance);
      if (!issue) continue;

      const amount = Math.round(issue.minutes * minuteRate);
      const actualClockIn = attendance?.clock_in ? new Date(attendance.clock_in).toLocaleString('zh-TW') : '未打卡';
      const actualClockOut = attendance?.clock_out ? new Date(attendance.clock_out).toLocaleString('zh-TW') : '未打卡';
      detailRows.push({
        leave_type: '考勤扣款',
        detail_date: workRow.date,
        start_time: workRow.start_time,
        end_time: workRow.end_time,
        days: issue.minutes,
        amount,
        description: `${workRow.date} 應出勤 ${String(workRow.start_time).slice(0, 5)}-${String(workRow.end_time).slice(0, 5)}，實際上班：${actualClockIn}，實際下班：${actualClockOut}，異常：${issue.label}，缺勤 ${issue.minutes} 分鐘`
      });
    }

    detailRows.forEach(d => {
      totalDeductions += d.amount;
      deductionDetails.push(d);
    });
  }

  const [adjustments] = await pool.query(
    `SELECT sa.*, u.full_name as created_by_name
     FROM salary_adjustments sa
     LEFT JOIN users u ON sa.created_by = u.id
     WHERE sa.user_id = ? AND sa.month = ?
     ORDER BY sa.created_at, sa.id`,
    [userId, month]
  );
  adjustments.forEach(adj => {
    const signedAmount = parseFloat(adj.amount || 0);
    totalAdjustments += signedAmount;
    deductionDetails.push({
      leave_type: adj.adjustment_type,
      detail_date: null,
      start_time: null,
      end_time: null,
      days: 1,
      amount: -signedAmount,
      description: `${adj.month} 人工調整：${adj.adjustment_type} ${signedAmount >= 0 ? '加發' : '扣款'} ${Math.abs(signedAmount).toLocaleString()} 元${adj.description ? `，原因：${adj.description}` : ''}${adj.created_by_name ? `，建立者：${adj.created_by_name}` : ''}`
    });
  });

  const netDeductions = Math.round(totalDeductions - totalAdjustments);
  const net = Math.round(totalSalary - totalDeductions + totalAdjustments);
  await pool.query('UPDATE salary_records SET calculation_date = ?, confirmed_at = NULL, total_deductions = ?, net_salary = ?, status = \'CALCULATED\' WHERE id = ?', [cutoffDate, netDeductions, net, record.id]);
  await pool.query('DELETE FROM salary_deduction_details WHERE record_id = ?', [record.id]);
  for (const d of deductionDetails) {
    await pool.query(
      'INSERT INTO salary_deduction_details (record_id, leave_type, detail_date, start_time, end_time, days, amount, description) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [record.id, d.leave_type, d.detail_date || null, d.start_time || null, d.end_time || null, d.days, d.amount, d.description || null]
    );
  }

  return { recordId: record.id, userId, month, calculationDate: cutoffDate, netSalary: net, deductions: deductionDetails };
};

const getSalaryRecordById = async (recordId) => {
  const [[record]] = await pool.query('SELECT * FROM salary_records WHERE id = ?', [recordId]);
  return record;
};

const getApproverIdForUser = async (userId) => {
  const [[user]] = await pool.query('SELECT u.*, d.name as dept_name, d.manager_id FROM users u JOIN departments d ON u.dept_id = d.id WHERE u.id = ?', [userId]);
  if (!user) return null;
  let approverId = null;
  if (user.role === 'MANAGER' || user.role === 'ADMIN') {
    if (user.dept_name === '資訊部' || user.dept_name === '會計部') {
      const [[boss]] = await pool.query('SELECT id FROM users WHERE role = \'MANAGER\' AND dept_id = 5 LIMIT 1');
      approverId = boss?.id;
    } else if (user.dept_name === '企劃部' || user.dept_name === '營業部') {
      const [[chairman]] = await pool.query('SELECT id FROM users WHERE role = \'ADMIN\' LIMIT 1');
      approverId = chairman?.id;
    }
  } else if (user.manager_id) {
    approverId = user.manager_id;
  } else {
    const [[deptMgr]] = await pool.query('SELECT id FROM users WHERE role = \'MANAGER\' AND dept_id = ? LIMIT 1', [user.dept_id]);
    approverId = deptMgr?.id;
  }
  return approverId;
};

const ensureCanManageSalaryRecord = async (reqUser, record) => {
  if (!record) throw new Error('找不到薪資表');
  if (reqUser.role === 'ADMIN') return;
  const [[target]] = await pool.query('SELECT dept_id FROM users WHERE id = ?', [record.user_id]);
  if (!target || target.dept_id !== reqUser.dept_id) {
    throw new Error('僅能操作所屬部門員工薪資');
  }
};

const getBatchSalaryActionConfig = (action) => {
  if (action === 'confirm') {
    return {
      fromStatus: 'CALCULATED',
      toStatus: 'CONFIRMED',
      updateSql: 'UPDATE salary_records SET status = \'CONFIRMED\', confirmed_at = NOW() WHERE id = ?',
      successLabel: '已確認'
    };
  }
  if (action === 'pay') {
    return {
      fromStatus: 'CONFIRMED',
      toStatus: 'PAID',
      updateSql: 'UPDATE salary_records SET status = \'PAID\', paid_status = \'PAID\', paid_date = NOW() WHERE id = ?',
      successLabel: '已發放'
    };
  }
  if (action === 'lock') {
    return {
      fromStatus: 'PAID',
      toStatus: 'LOCKED',
      updateSql: 'UPDATE salary_records SET status = \'LOCKED\', locked_at = NOW() WHERE id = ?',
      successLabel: '已鎖定'
    };
  }
  return null;
};

const getSalaryRecordWithDetails = async (record) => {
  let currentRecord = record;
  let [details] = await pool.query('SELECT * FROM salary_deduction_details WHERE record_id = ? ORDER BY detail_date IS NULL, detail_date, id', [currentRecord.id]);
  const hasLegacySummary = details.some(d => !d.detail_date && !d.description);
  if (currentRecord.status === 'CALCULATED' && hasLegacySummary) {
    await calculateSalaryRecord(currentRecord.user_id, currentRecord.month, currentRecord.calculation_date ? toLocalDateString(currentRecord.calculation_date) : null);
    [[currentRecord]] = await pool.query('SELECT * FROM salary_records WHERE id = ?', [currentRecord.id]);
    [details] = await pool.query('SELECT * FROM salary_deduction_details WHERE record_id = ? ORDER BY detail_date IS NULL, detail_date, id', [currentRecord.id]);
  }
  return { ...currentRecord, deductions: details };
};

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
    const approverId = await getApproverIdForUser(userId);

    if (approverId) {
      await pool.query('INSERT INTO leave_approvals (request_id, approver_id, status) VALUES (?, ?, \'PENDING\')', [requestId, approverId]);
    }
    res.json({ success: true, requestId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/attendance/exceptions', async (req, res) => {
  const userId = req.user.id;
  const { exceptionType, date, requestedClockIn, requestedClockOut, reason } = req.body;
  if (!exceptionType || !date || !reason) return res.status(400).json({ error: '請填寫例外類型、日期與原因' });
  if ((exceptionType === 'MISSING_CLOCK_IN' || exceptionType === 'BOTH') && !requestedClockIn) return res.status(400).json({ error: '請填寫補登上班時間' });
  if ((exceptionType === 'MISSING_CLOCK_OUT' || exceptionType === 'BOTH') && !requestedClockOut) return res.status(400).json({ error: '請填寫補登下班時間' });
  try {
    const [reqResult] = await pool.query(
      'INSERT INTO attendance_exception_requests (user_id, exception_type, date, requested_clock_in, requested_clock_out, reason) VALUES (?, ?, ?, ?, ?, ?)',
      [userId, exceptionType, date, requestedClockIn || null, requestedClockOut || null, reason]
    );
    const requestId = reqResult.insertId;
    const approverId = await getApproverIdForUser(userId);
    if (approverId) {
      await pool.query('INSERT INTO attendance_exception_approvals (request_id, approver_id, status) VALUES (?, ?, \'PENDING\')', [requestId, approverId]);
    }
    res.json({ success: true, requestId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/attendance/exceptions/my', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM attendance_exception_requests WHERE user_id = ? ORDER BY created_at DESC', [req.user.id]);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/attendance/exceptions/pending', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT aer.*, u.full_name as requester_name
       FROM attendance_exception_requests aer
       JOIN attendance_exception_approvals aea ON aer.id = aea.request_id
       JOIN users u ON aer.user_id = u.id
       WHERE aea.approver_id = ? AND aea.status = 'PENDING'
       ORDER BY aer.created_at DESC`,
      [req.user.id]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/attendance/exceptions/approve', async (req, res) => {
  const { requestId, status, comment } = req.body;
  if (!requestId || !status) return res.status(400).json({ error: '缺少申請單或審核狀態' });
  try {
    const [[request]] = await pool.query('SELECT * FROM attendance_exception_requests WHERE id = ?', [requestId]);
    if (!request) return res.status(404).json({ error: '找不到例外申請' });

    await pool.query('UPDATE attendance_exception_approvals SET status = ?, comment = ?, processed_at = NOW() WHERE request_id = ? AND approver_id = ?', [status, comment || null, requestId, req.user.id]);
    await pool.query('UPDATE attendance_exception_requests SET status = ?, processed_at = NOW() WHERE id = ?', [status, requestId]);

    if (status === 'APPROVED') {
      const [[existingAttendance]] = await pool.query('SELECT * FROM attendance WHERE user_id = ? AND date = ?', [request.user_id, request.date]);
      const requestedClockIn = buildAttendanceDateTime(toLocalDateString(request.date), request.requested_clock_in);
      const requestedClockOut = buildAttendanceDateTime(toLocalDateString(request.date), request.requested_clock_out);
      if (!existingAttendance) {
        await pool.query('INSERT INTO attendance (user_id, date, clock_in, clock_out) VALUES (?, ?, ?, ?)', [request.user_id, request.date, requestedClockIn, requestedClockOut]);
      } else {
        await pool.query(
          'UPDATE attendance SET clock_in = COALESCE(?, clock_in), clock_out = COALESCE(?, clock_out) WHERE id = ?',
          [requestedClockIn, requestedClockOut, existingAttendance.id]
        );
      }
    }

    res.json({ success: true });
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

app.post('/api/attendance/check-anomalies', adminMiddleware, async (req, res) => {
  const targetDate = req.body.date || addDays(toLocalDateString(), -1);
  try {
    const notified = await checkAttendanceAnomalies(targetDate);
    res.json({ success: true, date: targetDate, notified });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/users', adminMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT u.id, u.username, u.full_name, u.email, u.role, u.status, u.dept_id, u.hire_date, u.employment_type, u.position, u.hourly_wage, u.base_salary, u.professional_allowance, u.meal_allowance, u.education_level, u.university_name, u.department, d.name as dept_name FROM users u LEFT JOIN departments d ON u.dept_id = d.id ORDER BY u.id');
    
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
  const { username, password, fullName, email, deptId, role, hireDate, employmentType, position, hourlyWage, baseSalary, professionalAllowance, mealAllowance, educationLevel, universityName, department } = req.body;
  if (!username || !password || !fullName) return res.status(400).json({ error: '請填寫所有必填欄位' });
  // ADMIN 角色不需要部門，其他角色需要
  if (role !== 'ADMIN' && !deptId) return res.status(400).json({ error: '請選擇部門' });
  try {
    const [[existing]] = await pool.query('SELECT id FROM users WHERE username = ?', [username]);
    if (existing) return res.status(400).json({ error: '帳號已存在' });
    
    const finalHireDate = hireDate || new Date().toISOString().split('T')[0];
    const [result] = await pool.query('INSERT INTO users (username, password, full_name, email, dept_id, role, status, hire_date, employment_type, position, hourly_wage, base_salary, professional_allowance, meal_allowance, education_level, university_name, department) VALUES (?, ?, ?, ?, ?, ?, \'ACTIVE\', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [username, password, fullName, email || null, deptId || null, role || 'EMPLOYEE', finalHireDate, employmentType || 'FULL_TIME', position || null, hourlyWage || null, baseSalary || null, professionalAllowance || null, mealAllowance || null, educationLevel || null, universityName || null, department || null]);
    
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
  const { fullName, email, deptId, role, status, hireDate, employmentType, position, educationLevel, universityName, department } = req.body;
  try {
    // ADMIN 角色可以不選擇部門
    const finalDeptId = role === 'ADMIN' ? null : deptId;
    await pool.query('UPDATE users SET full_name = ?, email = ?, dept_id = ?, role = ?, status = ?, hire_date = ?, employment_type = ?, position = ?, education_level = ?, university_name = ?, department = ? WHERE id = ?', [fullName, email || null, finalDeptId, role, status, hireDate, employmentType, position, educationLevel, universityName, department, req.params.id]);
    
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
      const recordWithDetails = await getSalaryRecordWithDetails(r);
      result.push({ 
        ...recordWithDetails,
        paid_status: recordWithDetails.paid_status || 'UNPAID',
        payment_date: recordWithDetails.payment_date
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

app.get('/api/salary/employees/:userId/records', managerMiddleware, async (req, res) => {
  const targetUserId = req.params.userId;
  try {
    const [[target]] = await pool.query(
      `SELECT u.id, u.username, u.full_name, u.role, u.dept_id, u.employment_type,
              u.base_salary, u.professional_allowance, u.meal_allowance, u.hourly_wage,
              d.name as dept_name
       FROM users u LEFT JOIN departments d ON u.dept_id = d.id WHERE u.id = ?`,
      [targetUserId]
    );
    if (!target) return res.status(404).json({ error: '找不到員工' });
    if (req.user.role === 'MANAGER' && target.dept_id !== req.user.dept_id) {
      return res.status(403).json({ error: '僅能查看所屬部門員工薪資' });
    }

    const [records] = await pool.query('SELECT * FROM salary_records WHERE user_id = ? ORDER BY month DESC', [targetUserId]);
    const result = [];
    for (const record of records) {
      result.push(await getSalaryRecordWithDetails(record));
    }
    res.json({ employee: target, records: result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/salary/adjustments', managerMiddleware, async (req, res) => {
  const { userId, month, adjustmentType, amount, description } = req.body;
  const signedAmount = parseFloat(amount);
  if (!userId || !month || !adjustmentType || !signedAmount) {
    return res.status(400).json({ error: '請填寫員工、月份、調整項目與金額' });
  }
  try {
    const [[target]] = await pool.query('SELECT dept_id FROM users WHERE id = ?', [userId]);
    if (!target) return res.status(404).json({ error: '找不到員工' });
    if (req.user.role === 'MANAGER' && target.dept_id !== req.user.dept_id) {
      return res.status(403).json({ error: '僅能調整所屬部門員工薪資' });
    }

    const [[existingRecord]] = await pool.query('SELECT * FROM salary_records WHERE user_id = ? AND month = ?', [userId, month]);
    if (existingRecord && !canModifySalaryRecord(existingRecord)) {
      return res.status(400).json({ error: '該薪資表已發放或已鎖定，請改以下月補發/補扣處理' });
    }

    await pool.query(
      'INSERT INTO salary_adjustments (user_id, month, adjustment_type, amount, description, created_by) VALUES (?, ?, ?, ?, ?, ?)',
      [userId, month, adjustmentType, signedAmount, description || null, req.user.id]
    );
    const [[record]] = await pool.query('SELECT calculation_date FROM salary_records WHERE user_id = ? AND month = ?', [userId, month]);
    const result = await calculateSalaryRecord(userId, month, record?.calculation_date ? toLocalDateString(record.calculation_date) : null);
    res.json({ success: true, netSalary: result.netSalary, calculationDate: result.calculationDate, deductions: result.deductions });
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
  const { userId, month, calculationDate } = req.body;
  try {
    const [[target]] = await pool.query('SELECT dept_id FROM users WHERE id = ?', [userId]);
    if (!target) return res.status(404).json({ error: '找不到員工' });
    if (req.user.role === 'MANAGER' && target.dept_id !== req.user.dept_id) {
      return res.status(403).json({ error: '僅能計算所屬部門員工薪資' });
    }

    const result = await calculateSalaryRecord(userId, month, calculationDate);
    res.json({ success: true, netSalary: result.netSalary, calculationDate: result.calculationDate, deductions: result.deductions });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/salary/calculate-all', adminMiddleware, async (req, res) => {
  const { month, calculationDate } = req.body;
  try {
    const [users] = await pool.query('SELECT id FROM users WHERE status = \'ACTIVE\'');
    const results = [];
    const errors = [];
    for (const user of users) {
      try {
        results.push(await calculateSalaryRecord(user.id, month, calculationDate));
      } catch (e) {
        errors.push({ userId: user.id, error: e.message });
      }
    }
    res.json({ success: true, count: results.length, errors, results });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/salary/records/:id/confirm', managerMiddleware, async (req, res) => {
  try {
    const record = await getSalaryRecordById(req.params.id);
    if (!record) return res.status(404).json({ error: '找不到薪資表' });
    await ensureCanManageSalaryRecord(req.user, record);
    if (FINAL_SALARY_STATUSES.includes(record.status)) return res.status(400).json({ error: '已發放或已鎖定的薪資表不可再次確認' });
    if (record.status !== 'CALCULATED') return res.status(400).json({ error: '請先完成薪資計算後再確認' });
    await pool.query('UPDATE salary_records SET status = \'CONFIRMED\', confirmed_at = NOW() WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/salary/records/:id/pay', managerMiddleware, async (req, res) => {
  try {
    const record = await getSalaryRecordById(req.params.id);
    if (!record) return res.status(404).json({ error: '找不到薪資表' });
    await ensureCanManageSalaryRecord(req.user, record);
    if (record.status === 'LOCKED') return res.status(400).json({ error: '已鎖定薪資表不可再變更' });
    if (record.status !== 'CONFIRMED') return res.status(400).json({ error: '請先確認薪資表後再標記發放' });
    await pool.query('UPDATE salary_records SET status = \'PAID\', paid_status = \'PAID\', paid_date = NOW() WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/salary/records/:id/lock', managerMiddleware, async (req, res) => {
  try {
    const record = await getSalaryRecordById(req.params.id);
    if (!record) return res.status(404).json({ error: '找不到薪資表' });
    await ensureCanManageSalaryRecord(req.user, record);
    if (record.status !== 'PAID') return res.status(400).json({ error: '請先將薪資表標記為已發放後再鎖定' });
    await pool.query('UPDATE salary_records SET status = \'LOCKED\', locked_at = NOW() WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/salary/month-summary', managerMiddleware, async (req, res) => {
  const { month } = req.query;
  if (!month) return res.status(400).json({ error: '請提供月份' });
  try {
    let query = `
      SELECT sr.status, COUNT(*) as count
      FROM salary_records sr
      JOIN users u ON sr.user_id = u.id
      WHERE sr.month = ?`;
    const params = [month];
    if (req.user.role === 'MANAGER') {
      query += ' AND u.dept_id = ?';
      params.push(req.user.dept_id);
    }
    query += ' GROUP BY sr.status';
    const [rows] = await pool.query(query, params);
    const summary = { DRAFT: 0, CALCULATED: 0, CONFIRMED: 0, PAID: 0, LOCKED: 0 };
    rows.forEach(row => {
      summary[row.status] = Number(row.count);
    });
    res.json({ month, summary });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/salary/batch/:action/preview', managerMiddleware, async (req, res) => {
  const { month } = req.body;
  const config = getBatchSalaryActionConfig(req.params.action);
  if (!config) return res.status(400).json({ error: '不支援的批次操作' });
  if (!month) return res.status(400).json({ error: '請提供月份' });
  try {
    let query = `
      SELECT sr.id, sr.user_id, sr.month, sr.status, u.full_name, u.dept_id
      FROM salary_records sr
      JOIN users u ON sr.user_id = u.id
      WHERE sr.month = ?`;
    const params = [month];
    if (req.user.role === 'MANAGER') {
      query += ' AND u.dept_id = ?';
      params.push(req.user.dept_id);
    }
    query += ' ORDER BY sr.id';

    const [records] = await pool.query(query, params);
    const eligible = [];
    const skipped = [];
    for (const record of records) {
      if (record.status !== config.fromStatus) {
        skipped.push({ recordId: record.id, userId: record.user_id, name: record.full_name, status: record.status, reason: `目前狀態不是 ${config.fromStatus}` });
        continue;
      }
      eligible.push({ recordId: record.id, userId: record.user_id, name: record.full_name, fromStatus: config.fromStatus, toStatus: config.toStatus });
    }
    res.json({ success: true, action: req.params.action, month, eligibleCount: eligible.length, skippedCount: skipped.length, eligible, skipped });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/salary/batch/:action', managerMiddleware, async (req, res) => {
  const { month } = req.body;
  const config = getBatchSalaryActionConfig(req.params.action);
  if (!config) return res.status(400).json({ error: '不支援的批次操作' });
  if (!month) return res.status(400).json({ error: '請提供月份' });
  try {
    let query = `
      SELECT sr.id, sr.user_id, sr.month, sr.status, u.full_name, u.dept_id
      FROM salary_records sr
      JOIN users u ON sr.user_id = u.id
      WHERE sr.month = ?`;
    const params = [month];
    if (req.user.role === 'MANAGER') {
      query += ' AND u.dept_id = ?';
      params.push(req.user.dept_id);
    }
    query += ' ORDER BY sr.id';

    const [records] = await pool.query(query, params);
    const processed = [];
    const skipped = [];

    for (const record of records) {
      if (record.status !== config.fromStatus) {
        skipped.push({ recordId: record.id, userId: record.user_id, name: record.full_name, status: record.status, reason: `目前狀態不是 ${config.fromStatus}` });
        continue;
      }
      await pool.query(config.updateSql, [record.id]);
      processed.push({ recordId: record.id, userId: record.user_id, name: record.full_name, fromStatus: config.fromStatus, toStatus: config.toStatus });
    }

    res.json({ success: true, action: req.params.action, month, processedCount: processed.length, skippedCount: skipped.length, processed, skipped, message: `${month} 批次${config.successLabel}完成` });
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

const scheduleDailyAttendanceCheck = () => {
  const run = async () => {
    try {
      const targetDate = addDays(toLocalDateString(), -1);
      const notified = await checkAttendanceAnomalies(targetDate);
      console.log(`✅ ${targetDate} 打卡異常檢查完成，通知 ${notified.length} 筆`);
    } catch (e) {
      console.error('❌ 打卡異常檢查失敗:', e.message);
    }
  };

  const now = new Date();
  const nextRun = new Date(now);
  nextRun.setHours(8, 0, 0, 0);
  if (nextRun <= now) nextRun.setDate(nextRun.getDate() + 1);
  setTimeout(() => {
    run();
    setInterval(run, 24 * 60 * 60 * 1000);
  }, nextRun - now);
  console.log(`✅ 每日 08:00 自動檢查前一日打卡異常，下一次執行：${nextRun.toLocaleString()}`);
};

const PORT = process.env.PORT || 3001;
ensureRuntimeSchema().then(() => {
  app.listen(PORT, () => {
    console.log('Server running on port ' + PORT);
    console.log('✅ 休假計算已移至資料庫層 (Stored Procedures + Events)');
    console.log('✅ 每日 00:10 自動更新特休 (MySQL Event Scheduler)');
    console.log('✅ 每年 1/1 00:10 自動重置曆年制假別');
    scheduleDailyAttendanceCheck();
  });
}).catch(e => {
  console.error('❌ 啟動前資料表檢查失敗:', e.message);
  process.exit(1);
});
