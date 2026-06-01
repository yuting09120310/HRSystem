const mysql = require('mysql2/promise');

(async () => {
  try {
    const conn = await mysql.createConnection({ 
      host: 'db.neko-meow.com', 
      user: 'root', 
      password: 'alex0310', 
      database: 'HRDBN' 
    });
    
    console.log('正在添加薪資發放相關欄位...');
    
    // 添加 paid_status 和 paid_date 欄位
    await conn.query(`
      ALTER TABLE salary_records 
      ADD COLUMN IF NOT EXISTS paid_status VARCHAR(20) DEFAULT 'UNPAID' COMMENT '尚未發放=UNPAID, 已發放=PAID',
      ADD COLUMN IF NOT EXISTS paid_date DATETIME NULL COMMENT '實際發放時間',
      ADD COLUMN IF NOT EXISTS payment_date DATE NULL COMMENT '預計發放日期（次月 5 日）'
    `);
    
    // 為現有紀錄設置預設的 payment_date（次月5日）
    await conn.query(`
      UPDATE salary_records 
      SET payment_date = DATE_ADD(STR_TO_DATE(CONCAT(month, '-01'), '%Y-%m-%d'), INTERVAL 1 MONTH, INTERVAL 4 DAY)
      WHERE payment_date IS NULL
    `);
    
    // 更新現有已計算的紀錄為 UNPAID（尚未發放）
    await conn.query(`
      UPDATE salary_records 
      SET paid_status = 'UNPAID'
      WHERE status = 'CALCULATED' AND paid_status = 'UNPAID'
    `);
    
    console.log('✅ 資料庫欄位添加完成');
    
    await conn.end();
  } catch (err) {
    console.error('Error:', err);
  }
})();