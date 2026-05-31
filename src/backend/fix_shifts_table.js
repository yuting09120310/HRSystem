const pool = require('./db');

async function fixShiftsTable() {
  try {
    await pool.query(`ALTER TABLE shifts MODIFY COLUMN color VARCHAR(100) DEFAULT 'blue'`);
    console.log('✅ Updated color column length');
    
    // Now try inserting 休假 again
    const [rows] = await pool.query("SELECT * FROM shifts WHERE name = '休假'");
    if (rows.length === 0) {
      await pool.query(`INSERT INTO shifts (name, start_time, end_time, color) VALUES ('休假', '00:00:00', '00:00:00', 'bg-gray-100 text-gray-500')`);
      console.log('✅ Added 休假 shift');
    }
  } catch (e) {
    console.error('❌ Error:', e.message);
  } finally {
    pool.end();
  }
}

fixShiftsTable();
