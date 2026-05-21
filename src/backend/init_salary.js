const mysql = require('mysql2/promise');

(async () => {
  try {
    const conn = await mysql.createConnection({ 
      host: 'db.neko-meow.com', 
      user: 'root', 
      password: 'alex0310', 
      database: 'HRDBN' 
    });
    
    const [users] = await conn.query('SELECT id, role, full_name FROM users WHERE status = "ACTIVE"');
    
    const months = ['2026-03', '2026-04'];
    const adminId = 1; // 系統管理員 ID
    
    let recordCount = 0;
    
    for (const user of users) {
      // 設定薪資標準
      const isManager = user.role === 'MANAGER' || user.role === 'ADMIN';
      const base = isManager ? 50000 : 40000;
      const prof = isManager ? 5000 : 3000;
      const meal = 2000;
      const total = base + prof + meal;
      
      console.log(`Processing ${user.full_name} (${user.role})...`);
      
      for (const month of months) {
        // 1. 寫入薪資紀錄表 (直接設為已計算，扣款為 0)
        await conn.query(
          `INSERT INTO salary_records (user_id, month, base_salary, professional_allowance, meal_allowance, total_deductions, net_salary, status) 
           VALUES (?, ?, ?, ?, ?, 0, ?, 'CALCULATED')`,
          [user.id, month, base, prof, meal, total]
        );
        
        // 2. 寫入調薪歷史表
        await conn.query(
          `INSERT INTO salary_history (user_id, month, base_salary, professional_allowance, meal_allowance, reason, updated_by) 
           VALUES (?, ?, ?, ?, ?, '系統初始化設定', ?)`,
          [user.id, month, base, prof, meal, adminId]
        );
        
        recordCount++;
      }
    }
    
    console.log(`\n✅ 成功初始化 ${users.length} 位員工的薪資，共 ${recordCount} 筆紀錄。`);
    await conn.end();
  } catch (err) {
    console.error('Error:', err);
  }
})();
