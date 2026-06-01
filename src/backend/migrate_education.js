const pool = require('./db');

async function migrateEducation() {
  try {
    console.log('開始遷移：新增教育程度欄位...');
    
    const [columns] = await pool.query(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() 
        AND TABLE_NAME = 'users' 
        AND COLUMN_NAME IN ('education_level', 'university_name', 'department')
    `);
    
    const existingColumns = columns.map(c => c.COLUMN_NAME);
    
    if (!existingColumns.includes('education_level')) {
      await pool.query(`
        ALTER TABLE users 
        ADD COLUMN education_level VARCHAR(20) DEFAULT NULL COMMENT '教育程度：HIGH_SCHOOL, BACHELOR, MASTER, PHD'
      `);
      console.log('✅ 新增 education_level 欄位');
    }
    
    if (!existingColumns.includes('university_name')) {
      await pool.query(`
        ALTER TABLE users 
        ADD COLUMN university_name VARCHAR(100) DEFAULT NULL COMMENT '大學名稱'
      `);
      console.log('✅ 新增 university_name 欄位');
    }
    
    if (!existingColumns.includes('department')) {
      await pool.query(`
        ALTER TABLE users 
        ADD COLUMN department VARCHAR(100) DEFAULT NULL COMMENT '科系名稱'
      `);
      console.log('✅ 新增 department 欄位');
    }
    
    console.log('✅ 遷移完成！');
  } catch (e) {
    console.error('❌ 遷移失敗:', e.message);
  } finally {
    pool.end();
  }
}

migrateEducation();
