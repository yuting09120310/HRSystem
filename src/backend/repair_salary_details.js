const pool = require('./db');

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

const getMonthStartDate = (month) => `${month}-01`;

const getMonthEndDate = (month) => {
  const [year, monthNumber] = month.split('-').map(Number);
  return toLocalDateString(new Date(year, monthNumber, 0));
};

const getSalaryCutoffDate = (month, calculationDate) => {
  const monthStart = getMonthStartDate(month);
  const monthEnd = getMonthEndDate(month);
  const cutoff = calculationDate ? toLocalDateString(calculationDate) : monthEnd;
  if (cutoff < monthStart) return monthStart;
  if (cutoff > monthEnd) return monthEnd;
  return cutoff;
};

const timeToMinutes = (time) => {
  const [hours, minutes] = String(time || '00:00:00').split(':').map(Number);
  return (hours || 0) * 60 + (minutes || 0);
};

const combineDateTime = (date, time) => new Date(`${date}T${String(time || '00:00:00').slice(0, 8)}`);

const ensureColumns = async () => {
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
  const statements = [
    `ALTER TABLE users ADD COLUMN email VARCHAR(255) NULL AFTER full_name`,
    `ALTER TABLE salary_records ADD COLUMN calculation_date DATE NULL AFTER month`,
    `ALTER TABLE salary_records ADD COLUMN confirmed_at DATETIME NULL AFTER calculation_date`,
    `ALTER TABLE salary_records ADD COLUMN locked_at DATETIME NULL AFTER paid_date`,
    `ALTER TABLE salary_deduction_details MODIFY COLUMN days DECIMAL(8,2) NOT NULL`,
    `ALTER TABLE salary_deduction_details ADD COLUMN detail_date DATE NULL AFTER leave_type`,
    `ALTER TABLE salary_deduction_details ADD COLUMN start_time TIME NULL AFTER detail_date`,
    `ALTER TABLE salary_deduction_details ADD COLUMN end_time TIME NULL AFTER start_time`,
    `ALTER TABLE salary_deduction_details ADD COLUMN description TEXT NULL AFTER amount`
  ];
  for (const sql of statements) {
    try {
      await pool.query(sql);
    } catch (e) {
      if (!e.message.includes('Duplicate')) throw e;
    }
  }
};

const getExpectedWorkRows = async (startDate, endDate, userId) => {
  const [rows] = await pool.query(
    `SELECT u.id as user_id, u.full_name, u.employment_type, u.hourly_wage,
            u.base_salary, u.professional_allowance, u.meal_allowance,
            u.work_start_time, u.work_end_time, d.schedule_type,
            se.date, se.shift_id, se.custom_time_start, se.custom_time_end,
            s.start_time as shift_start_time, s.end_time as shift_end_time
     FROM users u
     LEFT JOIN departments d ON u.dept_id = d.id
     LEFT JOIN schedule_entries se ON se.user_id = u.id AND se.date BETWEEN ? AND ?
     LEFT JOIN shifts s ON se.shift_id = s.id
     WHERE u.status = 'ACTIVE' AND u.id = ?`,
    [startDate, endDate, userId]
  );

  const result = [];
  const fixedUserIds = new Set();
  for (const row of rows) {
    if (row.schedule_type === 'SHIFT') {
      if (!row.date) continue;
      result.push({
        ...row,
        date: toLocalDateString(row.date),
        start_time: row.custom_time_start || row.shift_start_time,
        end_time: row.custom_time_end || row.shift_end_time
      });
      continue;
    }

    if (fixedUserIds.has(row.user_id)) continue;
    fixedUserIds.add(row.user_id);
    for (let date = startDate; date <= endDate; date = addDays(date, 1)) {
      const day = new Date(`${date}T00:00:00`).getDay();
      if (day === 0 || day === 6) continue;
      result.push({
        ...row,
        date,
        start_time: row.work_start_time || '08:00:00',
        end_time: row.work_end_time || '17:00:00'
      });
    }
  }
  return result.filter(r => r.start_time && r.end_time);
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
    return { label: '曠職', minutes: Math.round((expectedEnd - expectedStart) / 60000) };
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
  return { label: issues.join('、'), minutes };
};

const recalculateSalaryRecord = async (record) => {
  const startDate = getMonthStartDate(record.month);
  const cutoffDate = getSalaryCutoffDate(record.month, record.calculation_date);
  const [[user]] = await pool.query(
    'SELECT employment_type, hourly_wage, base_salary, professional_allowance, meal_allowance FROM users WHERE id = ?',
    [record.user_id]
  );
  if (!user) return { skipped: true, reason: '找不到員工' };

  let totalSalary = 0;
  let totalDeductions = 0;
  const details = [];

  if (user.employment_type === 'PART_TIME') {
    const hourlyWage = parseFloat(user.hourly_wage || 0);
    const [attendance] = await pool.query(
      'SELECT date, clock_in, clock_out FROM attendance WHERE user_id = ? AND date BETWEEN ? AND ? AND clock_in IS NOT NULL AND clock_out IS NOT NULL',
      [record.user_id, startDate, cutoffDate]
    );
    let totalWorkingHours = 0;
    attendance.forEach(a => {
      const clockIn = new Date(a.clock_in);
      const clockOut = new Date(a.clock_out);
      const hours = (clockOut - clockIn) / 3600000;
      totalWorkingHours += hours;
      details.push({
        leave_type: '工作時數',
        detail_date: toLocalDateString(a.date),
        start_time: clockIn.toTimeString().slice(0, 8),
        end_time: clockOut.toTimeString().slice(0, 8),
        days: Math.round(hours * 10) / 10,
        amount: 0,
        description: `工讀出勤 ${clockIn.toLocaleString('zh-TW')} 至 ${clockOut.toLocaleString('zh-TW')}，共 ${Math.round(hours * 10) / 10} 小時`
      });
    });
    totalSalary = hourlyWage * totalWorkingHours;
  } else {
    const base = parseFloat(record.base_salary || user.base_salary || 0);
    const prof = parseFloat(record.professional_allowance || user.professional_allowance || 0);
    const meal = parseFloat(record.meal_allowance || user.meal_allowance || 0);
    totalSalary = base + prof + meal;
    const personalRate = totalSalary / 30;
    const sickRate = personalRate / 2;
    const minuteRate = totalSalary / 30 / 8 / 60;
    const workRows = await getExpectedWorkRows(startDate, cutoffDate, record.user_id);
    const leaveDates = await getApprovedLeaveDates(record.user_id, startDate, cutoffDate);
    const attendanceMap = await getAttendanceMap(record.user_id, startDate, cutoffDate);

    for (const workRow of workRows) {
      const leave = leaveDates.get(workRow.date);
      if (leave) {
        let rate = 0;
        if (leave.leaveType === '事假') rate = personalRate;
        else if (leave.leaveType === '病假') rate = sickRate;
        const amount = Math.round(rate);
        totalDeductions += amount;
        details.push({
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
      totalDeductions += amount;
      const actualClockIn = attendance?.clock_in ? new Date(attendance.clock_in).toLocaleString('zh-TW') : '未打卡';
      const actualClockOut = attendance?.clock_out ? new Date(attendance.clock_out).toLocaleString('zh-TW') : '未打卡';
      details.push({
        leave_type: '考勤扣款',
        detail_date: workRow.date,
        start_time: workRow.start_time,
        end_time: workRow.end_time,
        days: issue.minutes,
        amount,
        description: `${workRow.date} 應出勤 ${String(workRow.start_time).slice(0, 5)}-${String(workRow.end_time).slice(0, 5)}，實際上班：${actualClockIn}，實際下班：${actualClockOut}，異常：${issue.label}，缺勤 ${issue.minutes} 分鐘`
      });
    }
  }

  const net = Math.round(totalSalary - totalDeductions);
  await pool.query('UPDATE salary_records SET calculation_date = ?, total_deductions = ?, net_salary = ?, status = \'CALCULATED\' WHERE id = ?', [cutoffDate, Math.round(totalDeductions), net, record.id]);
  await pool.query('DELETE FROM salary_deduction_details WHERE record_id = ?', [record.id]);
  for (const d of details) {
    await pool.query(
      'INSERT INTO salary_deduction_details (record_id, leave_type, detail_date, start_time, end_time, days, amount, description) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [record.id, d.leave_type, d.detail_date || null, d.start_time || null, d.end_time || null, d.days, d.amount, d.description || null]
    );
  }
  return { details: details.length, netSalary: net, totalDeductions: Math.round(totalDeductions) };
};

const main = async () => {
  await ensureColumns();
  const [records] = await pool.query(
    `SELECT DISTINCT sr.*
     FROM salary_records sr
     JOIN salary_deduction_details sdd ON sdd.record_id = sr.id
     WHERE sr.status = 'CALCULATED' AND sdd.detail_date IS NULL AND sdd.description IS NULL
     ORDER BY sr.month, sr.user_id`
  );

  console.log(`Found ${records.length} legacy salary records to repair.`);
  let repaired = 0;
  for (const record of records) {
    const result = await recalculateSalaryRecord(record);
    if (!result.skipped) repaired += 1;
    console.log(`record=${record.id} user=${record.user_id} month=${record.month} repaired=${!result.skipped} details=${result.details || 0} deductions=${result.totalDeductions ?? '-'} net=${result.netSalary ?? '-'}${result.reason ? ` reason=${result.reason}` : ''}`);
  }

  const [[remaining]] = await pool.query(
    `SELECT COUNT(*) as count
     FROM salary_deduction_details
     WHERE detail_date IS NULL AND description IS NULL`
  );
  console.log(`Repaired ${repaired} records. Remaining legacy detail rows: ${remaining.count}`);
};

main().catch(e => {
  console.error('Repair failed:', e);
  process.exitCode = 1;
}).finally(() => pool.end());
