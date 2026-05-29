const pool = require('./db');

async function runMigrations() {
  const queries = [
    `ALTER TABLE users ADD COLUMN hire_date DATE NULL AFTER dept_id`,
    `CREATE TABLE IF NOT EXISTS leave_rules (
      id INT AUTO_INCREMENT PRIMARY KEY,
      leave_type VARCHAR(50) NOT NULL UNIQUE,
      days_per_year INT NOT NULL,
      description VARCHAR(255)
    )`,
    `INSERT IGNORE INTO leave_rules (leave_type, days_per_year, description) VALUES
      ('事假', 14, '全年合計不得超過十四日'),
      ('病假', 30, '全年合計不得超過三十日'),
      ('婚假', 8, '勞工結婚者給婚假八日'),
      ('喪假', 10, '依民法親屬編之規定'),
      ('公假', 0, '依法令規定應給公假者')`,
    `CREATE TABLE IF NOT EXISTS employee_leave_balances (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      year INT NOT NULL,
      leave_type VARCHAR(50) NOT NULL,
      total_days DECIMAL(5,1) NOT NULL DEFAULT 0,
      used_days DECIMAL(5,1) NOT NULL DEFAULT 0,
      FOREIGN KEY (user_id) REFERENCES users(id),
      UNIQUE KEY unique_user_year_type (user_id, year, leave_type)
    )`
  ];

  for (const q of queries) {
    try {
      await pool.query(q);
      console.log('OK:', q.split('\n')[0].substring(0, 50));
    } catch (e) {
      console.error('FAIL:', q.split('\n')[0].substring(0, 50), e.message);
    }
  }
  pool.end();
}

runMigrations();
