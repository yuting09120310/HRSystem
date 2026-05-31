const pool = require('./db');

async function addCustomTimeColumns() {
  try {
    console.log('開始遷移：新增自訂時間欄位...');
    
    // 檢查欄位是否已存在
    const [columns] = await pool.query(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() 
        AND TABLE_NAME = 'schedule_entries' 
        AND COLUMN_NAME IN ('custom_time_start', 'custom_time_end')
    `);
    
    if (columns.length === 0) {
      // 新增自訂時間欄位
      await pool.query(`
        ALTER TABLE schedule_entries 
        ADD COLUMN custom_time_start TIME NULL,
        ADD COLUMN custom_time_end TIME NULL
      `);
      console.log('✅ 新增 custom_time_start 和 custom_time_end 欄位');
      
      // 修改 shift_id 為可空
      await pool.query(`
        ALTER TABLE schedule_entries 
        MODIFY COLUMN shift_id INT NULL
      `);
      console.log('✅ 修改 shift_id 為可空');
    } else {
      console.log('欄位已存在，跳過遷移');
    }
    
    console.log('遷移完成！');
  } catch (e) {
    console.error('遷移失敗:', e.message);
  } finally {
    pool.end();
  }
}

addCustomTimeColumns();
