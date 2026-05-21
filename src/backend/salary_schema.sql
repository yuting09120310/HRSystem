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
  base_salary DECIMAL(10, 2) DEFAULT 0,
  professional_allowance DECIMAL(10, 2) DEFAULT 0,
  meal_allowance DECIMAL(10, 2) DEFAULT 0,
  total_deductions DECIMAL(10, 2) DEFAULT 0,
  net_salary DECIMAL(10, 2) DEFAULT 0,
  status VARCHAR(20) DEFAULT 'DRAFT',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id),
  UNIQUE KEY unique_user_month (user_id, month)
);

CREATE TABLE IF NOT EXISTS salary_deduction_details (
  id INT AUTO_INCREMENT PRIMARY KEY,
  record_id INT NOT NULL,
  leave_type VARCHAR(50) NOT NULL,
  days INT NOT NULL,
  amount DECIMAL(10, 2) NOT NULL,
  FOREIGN KEY (record_id) REFERENCES salary_records(id)
);
