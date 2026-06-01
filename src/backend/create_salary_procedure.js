const mysql = require('mysql2/promise');

(async () => {
  try {
    const conn = await mysql.createConnection({ 
      host: 'db.neko-meow.com', 
      user: 'root', 
      password: 'alex0310', 
      database: 'HRDBN' 
    });
    
    console.log('正在創建 Stored Procedure: generate_monthly_salary...');
    
    // 刪除現有的 procedure（如果存在）
    await conn.query('DROP PROCEDURE IF EXISTS generate_monthly_salary');
    
    // 創建新的 procedure
    await conn.query(`
      CREATE PROCEDURE generate_monthly_salary(IN target_month VARCHAR(7))
      BEGIN
        DECLARE done INT DEFAULT FALSE;
        DECLARE u_id, u_base, u_prof, u_meal, u_hourly INT;
        DECLARE u_emp_type, u_dept_name TEXT;
        DECLARE work_start, work_end TIME;
        
        -- 宣告 cursor
        DECLARE user_cursor CURSOR FOR 
          SELECT 
            u.id, u.employment_type, u.base_salary, u.professional_allowance, 
            u.meal_allowance, u.hourly_wage, u.work_start_time, u.work_end_time,
            d.name as dept_name
          FROM users u
          LEFT JOIN departments d ON u.dept_id = d.id
          WHERE u.status = 'ACTIVE';
        
        DECLARE CONTINUE HANDLER FOR NOT FOUND SET done = TRUE;
        
        OPEN user_cursor;
        
        read_loop: LOOP
          FETCH user_cursor INTO u_id, u_emp_type, u_base, u_prof, u_meal, u_hourly, work_start, work_end, u_dept_name;
          
          IF done THEN
            LEAVE read_loop;
          END IF;
          
          -- 檢查該員工是否已有該月薪資紀錄
          IF NOT EXISTS (SELECT 1 FROM salary_records WHERE user_id = u_id AND month = target_month) THEN
            
            IF u_emp_type = 'FULL_TIME' THEN
              -- 正職員工：使用薪資結構
              INSERT INTO salary_records (
                user_id, month, base_salary, professional_allowance, meal_allowance,
                total_deductions, net_salary, status, paid_status, payment_date
              ) VALUES (
                u_id, target_month, 
                COALESCE(u_base, 0), 
                COALESCE(u_prof, 0), 
                COALESCE(u_meal, 0),
                0, 
                COALESCE(u_base, 0) + COALESCE(u_prof, 0) + COALESCE(u_meal, 0),
                'DRAFT',
                'UNPAID',
                DATE_ADD(STR_TO_DATE(CONCAT(target_month, '-01'), '%Y-%m-%d'), INTERVAL 1 MONTH, INTERVAL 4 DAY)
              );
              
            ELSEIF u_emp_type = 'PART_TIME' THEN
              -- 工讀生：計算實際工作時數
              SET @total_hours = 0;
              
              -- 從打卡紀錄計算總工時
              SELECT IFNULL(SUM(
                TIMESTAMPDIFF(MINUTE, clock_in, clock_out) / 60.0
              ), 0) INTO @total_hours
              FROM attendance
              WHERE user_id = u_id 
                AND DATE_FORMAT(date, '%Y-%m') = target_month
                AND clock_in IS NOT NULL 
                AND clock_out IS NOT NULL;
              
              -- 計算薪資
              SET @salary = ROUND(u_hourly * @total_hours);
              
              INSERT INTO salary_records (
                user_id, month, base_salary, professional_allowance, meal_allowance,
                total_deductions, net_salary, status, paid_status, payment_date
              ) VALUES (
                u_id, target_month, 
                0, 0, @salary,
                0, @salary,
                'DRAFT',
                'UNPAID',
                DATE_ADD(STR_TO_DATE(CONCAT(target_month, '-01'), '%Y-%m-%d'), INTERVAL 1 MONTH, INTERVAL 4 DAY)
              );
              
              -- 記錄工時明細到 deduction_details
              IF @total_hours > 0 THEN
                INSERT INTO salary_deduction_details (record_id, leave_type, days, amount)
                SELECT LAST_INSERT_ID(), '工作時數', ROUND(@total_hours * 10) / 10, 0;
              END IF;
              
            END IF;
            
          END IF;
        END LOOP;
        
        CLOSE user_cursor;
        
        SELECT CONCAT('成功生成 ', target_month, ' 的薪資表') as message;
      END
    `);
    
    console.log('✅ Stored Procedure 創建完成');
    
    // 測試執行：生成 2026-05 的薪資表
    console.log('\n正在生成 2026-05 的薪資表...');
    const [result] = await conn.query('CALL generate_monthly_salary(?)', ['2026-05']);
    console.log('執行結果:', result[0]);
    
    await conn.end();
  } catch (err) {
    console.error('Error:', err);
  }
})();