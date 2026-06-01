const pool = require('./db');

async function updateEventSchedule() {
  try {
    console.log('更新 MySQL Event 排程時間...');

    // 刪除舊的事件
    await pool.query('DROP EVENT IF EXISTS event_daily_special_leave_update');
    await pool.query('DROP EVENT IF EXISTS event_annual_leave_reset');

    // 建立每日排程事件（每天凌晨 00:10 執行）
    await pool.query(`
      CREATE EVENT event_daily_special_leave_update
      ON SCHEDULE EVERY 1 DAY
      STARTS CURDATE() + INTERVAL 1 DAY + INTERVAL 10 MINUTE
      DO
        CALL sp_update_daily_special_leave()
    `);
    console.log('✅ 每日特休更新事件已設定 (00:10)');

    // 建立每年重置事件（每年 1/1 00:10 執行）
    await pool.query(`
      CREATE EVENT event_annual_leave_reset
      ON SCHEDULE EVERY 1 YEAR
      STARTS DATE_FORMAT(CURDATE(), '%Y-12-31') + INTERVAL 10 MINUTE
      DO
        CALL sp_reset_annual_leave()
    `);
    console.log('✅ 年度重置事件已設定 (每年 1/1 00:10)');

    // 驗證事件設定
    const [events] = await pool.query(`
      SELECT EVENT_NAME, SCHEDULE_EXPRESSION, STARTS, LAST_EXECUTED, STATUS 
      FROM information_schema.EVENTS 
      WHERE EVENT_SCHEMA = DATABASE()
    `);
    
    console.log('\n當前 MySQL Events:');
    console.table(events);

    console.log('\n✅ Event 排程更新完成！');

  } catch (e) {
    console.error('❌ 更新失敗:', e.message);
    console.error(e);
  } finally {
    pool.end();
  }
}

updateEventSchedule();