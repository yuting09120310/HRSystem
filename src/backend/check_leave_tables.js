const mysql = require('mysql2/promise');
require('dotenv').config({path:'./.env'});

(async()=>{
  const c = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT
  });
  
  const [tables] = await c.query('SHOW TABLES LIKE "%leave%"');
  console.log('Leave tables:', tables);
  
  const [balances] = await c.query('DESCRIBE employee_leave_balances');
  console.log('\nemployee_leave_balances structure:');
  console.log(balances);
  
  await c.end();
})();
