const pool = require('./db');

async function runMigration() {
  try {
    // 1. 擴充 departments 表以支援門市
    try {
      await pool.query(`ALTER TABLE departments ADD COLUMN parent_id INT NULL AFTER id`);
    } catch (e) { if (!e.message.includes('Duplicate')) throw e; }
    
    try {
      await pool.query(`ALTER TABLE departments ADD COLUMN type ENUM('DEPARTMENT', 'STORE') DEFAULT 'DEPARTMENT'`);
    } catch (e) { if (!e.message.includes('Duplicate')) throw e; }
    console.log('✅ departments 表已更新');

    // 2. 建立班別定義表
    await pool.query(`CREATE TABLE IF NOT EXISTS shifts (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(50) NOT NULL,
      start_time TIME NOT NULL,
      end_time TIME NOT NULL,
      color VARCHAR(20) DEFAULT 'blue'
    )`);
    
    // 初始化預設班別
    await pool.query(`INSERT IGNORE INTO shifts (name, start_time, end_time, color) VALUES 
      ('早班', '08:00:00', '16:00:00', 'bg-yellow-100 text-yellow-800'),
      ('午班', '12:00:00', '20:00:00', 'bg-blue-100 text-blue-800'),
      ('晚班', '16:00:00', '00:00:00', 'bg-purple-100 text-purple-800')
    `);
    console.log('✅ shifts 表已建立並初始化');

    // 3. 建立排班紀錄表
    await pool.query(`CREATE TABLE IF NOT EXISTS schedule_entries (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      date DATE NOT NULL,
      shift_id INT NOT NULL,
      created_by INT,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (shift_id) REFERENCES shifts(id),
      UNIQUE KEY unique_user_date (user_id, date)
    )`);
    console.log('✅ schedule_entries 表已建立');

    // 4. 建立員工班別偏好/限制表
    await pool.query(`CREATE TABLE IF NOT EXISTS shift_preferences (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      date DATE NOT NULL,
      shift_id INT NULL,
      reason VARCHAR(255),
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (shift_id) REFERENCES shifts(id),
      UNIQUE KEY unique_user_date_shift (user_id, date, shift_id)
    )`);
    console.log('✅ shift_preferences 表已建立');

    console.log(' 所有遷移完成！');
  } catch (e) {
    console.error('❌ 遷移失敗:', e.message);
  } finally {
    pool.end();
  }
}

runMigration();
