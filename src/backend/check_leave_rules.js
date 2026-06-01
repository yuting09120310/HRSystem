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
  
  const [rules] = await c.query('SELECT * FROM leave_rules');
  console.log('Leave rules:');
  console.log(rules);
  
  await c.end();
})();
