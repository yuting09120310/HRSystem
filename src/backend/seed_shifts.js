const pool = require('./db');

async function seedShifts() {
  try {
    // Check if '休假' exists
    const [rows] = await pool.query("SELECT * FROM shifts WHERE name = '休假'");
    if (rows.length === 0) {
      await pool.query(`INSERT INTO shifts (name, start_time, end_time, color) VALUES ('休假', '00:00:00', '00:00:00', 'bg-gray-100 text-gray-500')`);
      console.log('✅ Added 休假 shift');
    } else {
      console.log('ℹ️ 休假 shift already exists');
    }
  } catch (e) {
    console.error('❌ Error:', e.message);
  } finally {
    pool.end();
  }
}

seedShifts();
