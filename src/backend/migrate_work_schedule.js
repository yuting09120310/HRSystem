const pool = require('./db');

async function runMigration() {
  try {
    await pool.query(`ALTER TABLE users ADD COLUMN work_start_time TIME DEFAULT '08:00:00' AFTER hire_date`);
    await pool.query(`ALTER TABLE users ADD COLUMN work_end_time TIME DEFAULT '17:00:00' AFTER work_start_time`);
    console.log('✅ Migration successful: Added work_start_time and work_end_time to users table');
  } catch (e) {
    console.error('❌ Migration failed:', e.message);
  } finally {
    pool.end();
  }
}

runMigration();
