const pool = require('./db');

async function showEvents() {
  try {
    console.log('查詢 MySQL Events 設定...');

    const [events] = await pool.query(`
      SELECT EVENT_NAME, STARTS, STATUS, DEFINER 
      FROM information_schema.EVENTS 
      WHERE EVENT_SCHEMA = DATABASE()
    `);
    
    console.log('\n當前 MySQL Events:');
    console.table(events);

    console.log('\n✅ 查詢完成！');

  } catch (e) {
    console.error('❌ 查詢失敗:', e.message);
  } finally {
    pool.end();
  }
}

showEvents();