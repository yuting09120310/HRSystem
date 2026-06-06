CREATE TABLE IF NOT EXISTS salary_configs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  leave_type VARCHAR(50) NOT NULL UNIQUE,
  deduction_per_day DECIMAL(10, 2) NOT NULL
);

INSERT IGNORE INTO salary_configs (leave_type, deduction_per_day) VALUES 
('事假', 1333), 
('病假', 650);

CREATE TABLE IF NOT EXISTS salary_records (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  month VARCHAR(7) NOT NULL,
  calculation_date DATE NULL,
  confirmed_at DATETIME NULL,
  base_salary DECIMAL(10, 2) DEFAULT 0,
  professional_allowance DECIMAL(10, 2) DEFAULT 0,
  meal_allowance DECIMAL(10, 2) DEFAULT 0,
  total_deductions DECIMAL(10, 2) DEFAULT 0,
  net_salary DECIMAL(10, 2) DEFAULT 0,
  status VARCHAR(20) DEFAULT 'DRAFT',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  paid_status VARCHAR(20) DEFAULT 'UNPAID',
  paid_date DATETIME NULL,
  locked_at DATETIME NULL,
  payment_date DATE NULL,
  FOREIGN KEY (user_id) REFERENCES users(id),
  UNIQUE KEY unique_user_month (user_id, month)
);

CREATE TABLE IF NOT EXISTS salary_deduction_details (
  id INT AUTO_INCREMENT PRIMARY KEY,
  record_id INT NOT NULL,
  leave_type VARCHAR(50) NOT NULL,
  detail_date DATE NULL,
  start_time TIME NULL,
  end_time TIME NULL,
  days DECIMAL(8,2) NOT NULL,
  amount DECIMAL(10, 2) NOT NULL,
  description TEXT NULL,
  FOREIGN KEY (record_id) REFERENCES salary_records(id)
);

CREATE TABLE IF NOT EXISTS attendance_anomaly_notifications (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  date DATE NOT NULL,
  anomaly_type VARCHAR(50) NOT NULL,
  details TEXT,
  sent_to VARCHAR(255),
  sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id),
  UNIQUE KEY unique_user_date_type (user_id, date, anomaly_type)
);

CREATE TABLE IF NOT EXISTS salary_adjustments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  month VARCHAR(7) NOT NULL,
  adjustment_type VARCHAR(50) NOT NULL,
  amount DECIMAL(10, 2) NOT NULL,
  description TEXT,
  created_by INT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (created_by) REFERENCES users(id)
);

ALTER TABLE users ADD COLUMN hire_date DATE NULL AFTER dept_id;
ALTER TABLE users ADD COLUMN email VARCHAR(255) NULL AFTER full_name;

CREATE TABLE IF NOT EXISTS leave_rules (
  id INT AUTO_INCREMENT PRIMARY KEY,
  leave_type VARCHAR(50) NOT NULL UNIQUE,
  days_per_year INT NOT NULL,
  description VARCHAR(255)
);

INSERT IGNORE INTO leave_rules (leave_type, days_per_year, description) VALUES
('事假', 14, '全年合計不得超過十四日'),
('病假', 30, '全年合計不得超過三十日'),
('婚假', 8, '勞工結婚者給婚假八日'),
('喪假', 10, '依民法親屬編之規定'),
('公假', 0, '依法令規定應給公假者');

CREATE TABLE IF NOT EXISTS employee_leave_balances (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  year INT NOT NULL,
  leave_type VARCHAR(50) NOT NULL,
  total_days DECIMAL(5,1) NOT NULL DEFAULT 0,
  used_days DECIMAL(5,1) NOT NULL DEFAULT 0,
  FOREIGN KEY (user_id) REFERENCES users(id),
  UNIQUE KEY unique_user_year_type (user_id, year, leave_type)
);
