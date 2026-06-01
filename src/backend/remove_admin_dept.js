const pool = require('./db');

async function removeAdminDepartment() {
  try {
    console.log('開始移除管理員的部門關聯...');
    
    // 將所有 ADMIN 角色的用戶的 dept_id 設為 NULL
    const [result] = await pool.query('UPDATE users SET dept_id = NULL WHERE role = ?', ['ADMIN']);
    
    console.log(`✅ 已更新 ${result.affectedRows} 位管理員的部門關聯`);
    
    // 查詢確認
    const [admins] = await pool.query('SELECT id, username, full_name, role, dept_id FROM users WHERE role = ?', ['ADMIN']);
    console.log('管理員列表:', admins);
    
    console.log('✅ 完成！');
  } catch (e) {
    console.error('❌ 失敗:', e.message);
  } finally {
    pool.end();
  }
}

removeAdminDepartment();
