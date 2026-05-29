const pool = require('./db');

async function createEmployee() {
  try {
    // 先查詢資訊部的部門 ID
    const [depts] = await pool.query('SELECT id, name FROM departments WHERE name = ?', ['資訊部']);
    if (depts.length === 0) {
      console.error('找不到資訊部');
      process.exit(1);
    }
    const deptId = depts[0].id;
    console.log(`資訊部 ID: ${deptId}`);

    // 檢查帳號是否已存在
    const [[existing]] = await pool.query('SELECT id FROM users WHERE username = ?', ['yuting09120310']);
    if (existing) {
      console.log('帳號已存在，無法重複建立');
      process.exit(1);
    }

    // 插入新員工
    await pool.query(
      'INSERT INTO users (username, password, full_name, dept_id, role, status, hire_date) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ['yuting09120310', 'Alice123', '蔡宇庭', deptId, 'EMPLOYEE', 'ACTIVE', '2024-07-01']
    );

    console.log('✅ 員工建立成功！');
    console.log('姓名: 蔡宇庭');
    console.log('部門: 資訊部');
    console.log('帳號: yuting09120310');
    console.log('密碼: Alice123');
    console.log('入職日: 2024-07-01');
    console.log('角色: EMPLOYEE');
  } catch (e) {
    console.error('發生錯誤:', e.message);
  } finally {
    pool.end();
  }
}

createEmployee();
