const pool = require('./db');

async function checkUsers() {
  try {
    const [users] = await pool.query('SELECT id, username, full_name, role, password FROM users');
    console.log('Users in database:');
    console.table(users);
  } catch (e) {
    console.error('Error:', e.message);
  } finally {
    pool.end();
  }
}

checkUsers();
