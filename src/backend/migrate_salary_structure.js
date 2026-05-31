const pool = require('./db');

async function migrateSalaryStructure() {
  try {
    console.log('開始遷移：新增薪資結構欄位...');
    
    // 檢查欄位是否已存在
    const [columns] = await pool.query(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() 
        AND TABLE_NAME = 'users' 
        AND COLUMN_NAME IN ('base_salary', 'professional_allowance', 'meal_allowance')
    `);
    
    const existingColumns = columns.map(c => c.COLUMN_NAME);
    
    if (!existingColumns.includes('base_salary')) {
      await pool.query(`
        ALTER TABLE users 
        ADD COLUMN base_salary DECIMAL(10,2) DEFAULT NULL COMMENT '基本薪資（正職員工）'
      `);
      console.log('✅ 新增 base_salary 欄位');
    }
    
    if (!existingColumns.includes('professional_allowance')) {
      await pool.query(`
        ALTER TABLE users 
        ADD COLUMN professional_allowance DECIMAL(10,2) DEFAULT NULL COMMENT '專業加給（正職員工）'
      `);
      console.log('✅ 新增 professional_allowance 欄位');
    }
    
    if (!existingColumns.includes('meal_allowance')) {
      await pool.query(`
        ALTER TABLE users 
        ADD COLUMN meal_allowance DECIMAL(10,2) DEFAULT NULL COMMENT '伙食津貼（正職員工）'
      `);
      console.log('✅ 新增 meal_allowance 欄位');
    }
    
    // 重新定義 position 為純描述性欄位
    await pool.query(`
      ALTER TABLE users 
      MODIFY COLUMN position VARCHAR(50) DEFAULT NULL COMMENT '職位名稱（描述性，如：資深工程師、專案經理）'
    `);
    console.log('✅ 更新 position 欄位為描述性欄位');
    
    console.log('✅ 遷移完成！');
  } catch (e) {
    console.error('❌ 遷移失敗:', e.message);
  } finally {
    pool.end();
  }
}

migrateSalaryStructure();
