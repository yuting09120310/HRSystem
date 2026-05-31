const pool = require('./db');

async function seedDepartments() {
  const depts = [
    '資訊部', '會計部', '營業部', '企劃部', '人資部', '管理部', '總務部', '法務部'
  ];
  try {
    for (const name of depts) {
      await pool.query('INSERT IGNORE INTO departments (name) VALUES (?)', [name]);
    }
    console.log('✅ Departments seeded successfully');
    const [rows] = await pool.query('SELECT * FROM departments');
    console.log('Current departments:', rows);
  } catch (e) {
    console.error('❌ Error:', e.message);
  } finally {
    pool.end();
  }
}

seedDepartments();
