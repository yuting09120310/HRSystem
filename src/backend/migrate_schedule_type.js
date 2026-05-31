const pool = require('./db');

async function runMigration() {
  try {
    // 1. 檢查並新增 schedule_type 欄位
    const [cols] = await pool.query("SHOW COLUMNS FROM departments LIKE 'schedule_type'");
    if (cols.length === 0) {
      await pool.query(`ALTER TABLE departments ADD COLUMN schedule_type ENUM('FIXED', 'SHIFT') DEFAULT 'FIXED' AFTER type`);
      console.log('✅ Added schedule_type column');
    }

    // 2. 設定現有部門為 FIXED，新建立的門市預設為 SHIFT
    // 假設 ID 1-5, 10-13 是原本的固定部門
    await pool.query(`UPDATE departments SET schedule_type = 'FIXED' WHERE id IN (1, 2, 3, 4, 5, 10, 11, 12, 13)`);
    console.log('✅ Set existing departments to FIXED');

    console.log('✅ Migration complete');
  } catch (e) {
    console.error('❌ Migration failed:', e.message);
  } finally {
    pool.end();
  }
}

runMigration();
