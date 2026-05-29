const pool = require('./db');

async function fixHireDates() {
  try {
    const [users] = await pool.query('SELECT id, full_name, hire_date FROM users WHERE hire_date IS NULL');
    console.log(`找到 ${users.length} 位沒有入職日的員工:`, users);
    
    if (users.length > 0) {
      await pool.query('UPDATE users SET hire_date = ? WHERE hire_date IS NULL', ['2020-01-01']);
      console.log('已將這些員工的入職日設定為 2020-01-01');
      
      // 觸發假別餘額重新計算
      for (const user of users) {
        const year = new Date().getFullYear();
        await pool.query('DELETE FROM employee_leave_balances WHERE user_id = ? AND year = ?', [user.id, year]);
        console.log(`已清除使用者 ID ${user.id} (${user.full_name}) 的舊假別資料，下次查詢將自動重建`);
      }
    } else {
      console.log('所有員工都已設定入職日');
    }
  } catch (e) {
    console.error('發生錯誤:', e.message);
  } finally {
    pool.end();
  }
}

fixHireDates();
