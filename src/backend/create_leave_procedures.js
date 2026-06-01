const pool = require('./db');

async function createLeaveProcedures() {
  try {
    console.log('開始建立休假計算 Stored Procedures...');

    // 1. 建立特休計算函數（依照到職日週年制計算）
    await pool.query(`
      CREATE FUNCTION IF NOT EXISTS func_calculate_special_leave(
        p_hire_date DATE,
        p_check_date DATE
      ) RETURNS INT
      DETERMINISTIC
      BEGIN
        DECLARE v_years INT DEFAULT 0;
        DECLARE v_days INT DEFAULT 0;
        DECLARE v_diff_days INT DEFAULT 0;
        DECLARE v_anniversary DATE;
        
        SET v_diff_days = DATEDIFF(p_check_date, p_hire_date);
        
        -- 未滿半年無特休
        IF v_diff_days < 180 THEN
          RETURN 0;
        END IF;
        
        -- 計算年資（週年）
        SET v_anniversary = p_hire_date;
        WHILE DATE_ADD(v_anniversary, INTERVAL 1 YEAR) <= p_check_date DO
          SET v_anniversary = DATE_ADD(v_anniversary, INTERVAL 1 YEAR);
          SET v_years = v_years + 1;
        END WHILE;
        
        -- 滿半年未滿一年：3 天
        IF v_years = 0 AND v_diff_days >= 180 THEN
          RETURN 3;
        END IF;
        
        -- 依照勞基法特休天數表
        IF v_years >= 25 THEN SET v_days = 30;
        ELSEIF v_years >= 20 THEN SET v_days = 30;
        ELSEIF v_years >= 15 THEN SET v_days = 21;
        ELSEIF v_years >= 10 THEN SET v_days = 15;
        ELSEIF v_years >= 5 THEN SET v_days = 14;
        ELSEIF v_years >= 3 THEN SET v_days = 10;
        ELSEIF v_years >= 2 THEN SET v_days = 7;
        ELSEIF v_years >= 1 THEN SET v_days = 7;
        ELSE SET v_days = 0;
        END IF;
        
        RETURN v_days;
      END
    `);
    console.log('✅ 建立 func_calculate_special_leave 函數');

    // 2. 建立特休到期日計算函數
    await pool.query(`
      CREATE FUNCTION IF NOT EXISTS func_get_special_leave_expiry(
        p_user_id INT,
        p_check_date DATE
      ) RETURNS VARCHAR(50)
      READS SQL DATA
      BEGIN
        DECLARE v_hire_date DATE;
        DECLARE v_anniversary_start DATE;
        DECLARE v_anniversary_end DATE;
        
        SELECT hire_date INTO v_hire_date 
        FROM users 
        WHERE id = p_user_id 
        AND status = 'ACTIVE';
        
        IF v_hire_date IS NULL THEN
          RETURN 'N/A';
        END IF;
        
        -- 找到當前週年制年度開始日
        SET v_anniversary_start = v_hire_date;
        WHILE DATE_ADD(v_anniversary_start, INTERVAL 1 YEAR) <= p_check_date DO
          SET v_anniversary_start = DATE_ADD(v_anniversary_start, INTERVAL 1 YEAR);
        END WHILE;
        
        -- 到期日是下一個週年日的前一天
        SET v_anniversary_end = DATE_SUB(DATE_ADD(v_anniversary_start, INTERVAL 1 YEAR), INTERVAL 1 DAY);
        
        RETURN CONCAT('到期日：', DATE_FORMAT(v_anniversary_end, '%Y/%m/%d'), 
                     '（剩餘 ', DATEDIFF(v_anniversary_end, p_check_date), ' 天）');
      END
    `);
    console.log('✅ 建立 func_get_special_leave_expiry 函數');

    // 3. 建立每日更新特休的 Stored Procedure
    await pool.query(`
      CREATE PROCEDURE IF NOT EXISTS sp_update_daily_special_leave()
      BEGIN
        DECLARE v_current_date DATE;
        DECLARE v_current_year INT;
        DECLARE v_user_id INT;
        DECLARE v_hire_date DATE;
        DECLARE v_special_days INT;
        DECLARE v_done INT DEFAULT FALSE;
        
        DECLARE cur CURSOR FOR 
          SELECT id, hire_date 
          FROM users 
          WHERE status = 'ACTIVE';
        
        DECLARE CONTINUE HANDLER FOR NOT FOUND SET v_done = TRUE;
        
        SET v_current_date = CURDATE();
        SET v_current_year = YEAR(v_current_date);
        
        OPEN cur;
        
        read_loop: LOOP
          FETCH cur INTO v_user_id, v_hire_date;
          IF v_done THEN
            LEAVE read_loop;
          END IF;
          
          -- 計算特休天數
          SET v_special_days = func_calculate_special_leave(v_hire_date, v_current_date);
          
          -- 更新或插入特休記錄
          INSERT INTO employee_leave_balances (user_id, year, leave_type, total_days, used_days)
          VALUES (v_user_id, v_current_year, '特休', v_special_days, 0)
          ON DUPLICATE KEY UPDATE total_days = v_special_days;
        END LOOP;
        
        CLOSE cur;
        
        SELECT CONCAT('已更新 ', COUNT(*), ' 位員工的特休天數') as message
        FROM users WHERE status = 'ACTIVE';
      END
    `);
    console.log('✅ 建立 sp_update_daily_special_leave 預存程序');

    // 4. 建立年度重置曆年制假別的 Stored Procedure
    await pool.query(`
      CREATE PROCEDURE IF NOT EXISTS sp_reset_annual_leave()
      BEGIN
        DECLARE v_current_year INT;
        DECLARE v_user_id INT;
        DECLARE v_leave_type VARCHAR(50);
        DECLARE v_days INT;
        DECLARE v_done_user INT DEFAULT FALSE;
        DECLARE v_done_rule INT DEFAULT FALSE;
        
        DECLARE cur_user CURSOR FOR 
          SELECT id FROM users WHERE status = 'ACTIVE';
        
        DECLARE cur_rule CURSOR FOR 
          SELECT leave_type, days_per_year FROM leave_rules WHERE days_per_year > 0;
        
        DECLARE CONTINUE HANDLER FOR NOT FOUND 
          BEGIN
            IF v_done_rule THEN
              SET v_done_rule = FALSE;
            ELSE
              SET v_done_user = TRUE;
            END IF;
          END;
        
        SET v_current_year = YEAR(CURDATE());
        
        -- 先刪除舊的曆年制記錄（保留特休）
        DELETE FROM employee_leave_balances 
        WHERE year = v_current_year 
        AND leave_type != '特休';
        
        OPEN cur_user;
        OPEN cur_rule;
        
        user_loop: LOOP
          FETCH cur_user INTO v_user_id;
          IF v_done_user THEN
            LEAVE user_loop;
          END IF;
          
          -- 重置游標
          CLOSE cur_rule;
          OPEN cur_rule;
          SET v_done_rule = FALSE;
          
          rule_loop: LOOP
            FETCH cur_rule INTO v_leave_type, v_days;
            IF v_done_rule THEN
              LEAVE rule_loop;
            END IF;
            
            INSERT IGNORE INTO employee_leave_balances 
              (user_id, year, leave_type, total_days, used_days)
            VALUES (v_user_id, v_current_year, v_leave_type, v_days, 0);
          END LOOP;
        END LOOP;
        
        CLOSE cur_user;
        CLOSE cur_rule;
        
        SELECT CONCAT('已重置 ', COUNT(DISTINCT user_id), ' 位員工的曆年制假別') as message
        FROM employee_leave_balances 
        WHERE year = v_current_year AND leave_type != '特休';
      END
    `);
    console.log('✅ 建立 sp_reset_annual_leave 預存程序');

    // 5. 建立特休即將到期通知的 Stored Procedure
    await pool.query(`
      CREATE PROCEDURE IF NOT EXISTS sp_get_special_leave_expiry_notice(
        IN p_check_date DATE,
        IN p_warning_days INT
      )
      BEGIN
        DECLARE v_current_year INT;
        
        SET v_current_year = YEAR(p_check_date);
        
        SELECT 
          u.id,
          u.username,
          u.full_name,
          u.hire_date,
          elb.total_days,
          elb.used_days,
          (elb.total_days - elb.used_days) as remaining_days,
          func_get_special_leave_expiry(u.id, p_check_date) as expiry_info,
          DATEDIFF(
            DATE_SUB(DATE_ADD(
              (SELECT MIN(date) FROM (
                SELECT DATE_ADD(u.hire_date, INTERVAL YEAR(p_check_date) - YEAR(u.hire_date) YEAR) as date
                UNION
                SELECT DATE_ADD(u.hire_date, INTERVAL YEAR(p_check_date) - YEAR(u.hire_date) - 1 YEAR)
              ) as anniversary WHERE anniversary <= p_check_date), 
              INTERVAL 1 YEAR), 
            INTERVAL 1 DAY),
            p_check_date
          ) as days_until_expiry
        FROM users u
        JOIN employee_leave_balances elb ON u.id = elb.user_id 
          AND elb.year = v_current_year 
          AND elb.leave_type = '特休'
        WHERE u.status = 'ACTIVE'
          AND (elb.total_days - elb.used_days) > 0
          AND DATEDIFF(
            DATE_SUB(DATE_ADD(
              (SELECT MIN(date) FROM (
                SELECT DATE_ADD(u.hire_date, INTERVAL YEAR(p_check_date) - YEAR(u.hire_date) YEAR) as date
                UNION
                SELECT DATE_ADD(u.hire_date, INTERVAL YEAR(p_check_date) - YEAR(u.hire_date) - 1 YEAR)
              ) as anniversary WHERE anniversary <= p_check_date), 
              INTERVAL 1 YEAR), 
            INTERVAL 1 DAY),
            p_check_date
          ) <= p_warning_days
        ORDER BY days_until_expiry ASC;
      END
    `);
    console.log('✅ 建立 sp_get_special_leave_expiry_notice 預存程序');

    // 6. 啟用 MySQL Event Scheduler
    await pool.query('SET GLOBAL event_scheduler = ON');
    console.log('✅ 啟用 MySQL Event Scheduler');

    // 7. 建立每日排程事件（每天早上 00:05 執行）
    await pool.query(`
      CREATE EVENT IF NOT EXISTS event_daily_special_leave_update
      ON SCHEDULE EVERY 1 DAY
      STARTS CURDATE() + INTERVAL 1 DAY + INTERVAL 5 MINUTE
      DO
        CALL sp_update_daily_special_leave()
    `);
    console.log('✅ 建立每日特休更新事件 event_daily_special_leave_update');

    // 8. 建立每年重置事件（每年 1/1 00:10 執行）
    await pool.query(`
      CREATE EVENT IF NOT EXISTS event_annual_leave_reset
      ON SCHEDULE EVERY 1 YEAR
      STARTS DATE_FORMAT(CURDATE(), '%Y-12-31') + INTERVAL 10 MINUTE
      DO
        CALL sp_reset_annual_leave()
    `);
    console.log('✅ 建立年度重置事件 event_annual_leave_reset');

    // 9. 立即執行一次特休更新
    console.log('執行初次特休更新...');
    await pool.query('CALL sp_update_daily_special_leave()');

    console.log('✅ 所有 Stored Procedures 和 Events 建立完成！');

  } catch (e) {
    console.error('❌ 建立失敗:', e.message);
    console.error(e);
  } finally {
    pool.end();
  }
}

createLeaveProcedures();