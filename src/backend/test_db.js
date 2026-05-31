const mysql = require('mysql2/promise');
require('dotenv').config({ path: './.env' });

async function testDB() {
  console.log('DB Config:', {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT
  });

  try {
    const conn = await mysql.createConnection({
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASS,
      database: process.env.DB_NAME,
      port: process.env.DB_PORT
    });
    console.log('Connected to DB');
    
    const [users] = await conn.query('SELECT id, username, full_name, role FROM users LIMIT 5');
    console.log('Users:', users);
    
    await conn.end();
  } catch (e) {
    console.error('DB Error:', e);
  }
}

testDB();
