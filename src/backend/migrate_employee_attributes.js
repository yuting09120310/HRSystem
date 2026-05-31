const pool = require('./db');

async function migrateEmployeeAttributes() {
  try {
    console.log('開始遷移：新增員工屬性欄位...');
    
    // 檢查欄位是否已存在
    const [columns] = await pool.query(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() 
        AND TABLE_NAME = 'users' 
        AND COLUMN_NAME IN ('employment_type', 'position', 'hourly_wage')
    `);
    
    const existingColumns = columns.map(c => c.COLUMN_NAME);
    
    if (!existingColumns.includes('employment_type')) {
      await pool.query(`
        ALTER TABLE users 
        ADD COLUMN employment_type VARCHAR(20) DEFAULT 'FULL_TIME' COMMENT 'FULL_TIME:正職, PART_TIME:工讀'
      `);
      console.log('✅ 新增 employment_type 欄位');
    }
    
    if (!existingColumns.includes('position')) {
      await pool.query(`
        ALTER TABLE users 
        ADD COLUMN position VARCHAR(30) DEFAULT 'STAFF' COMMENT 'STAFF:一般職員, SUPERVISOR:主任, MANAGER:部門主管'
      `);
      console.log('✅ 新增 position 欄位');
    }
    
    if (!existingColumns.includes('hourly_wage')) {
      await pool.query(`
        ALTER TABLE users 
        ADD COLUMN hourly_wage DECIMAL(10,2) DEFAULT NULL COMMENT '時薪（僅工讀生使用）'
      `);
      console.log('✅ 新增 hourly_wage 欄位');
    }
    
    console.log('✅ 遷移完成！');
  } catch (e) {
    console.error('❌ 遷移失敗:', e.message);
  } finally {
    pool.end();
  }
}

migrateEmployeeAttributes();
