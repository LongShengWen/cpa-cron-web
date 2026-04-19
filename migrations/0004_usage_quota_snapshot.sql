ALTER TABLE auth_accounts ADD COLUMN usage_total REAL;
ALTER TABLE auth_accounts ADD COLUMN usage_used REAL;
ALTER TABLE auth_accounts ADD COLUMN usage_remaining REAL;
ALTER TABLE auth_accounts ADD COLUMN usage_limit_window_seconds INTEGER;
ALTER TABLE auth_accounts ADD COLUMN usage_spark_total REAL;
ALTER TABLE auth_accounts ADD COLUMN usage_spark_used REAL;
ALTER TABLE auth_accounts ADD COLUMN usage_spark_remaining REAL;
ALTER TABLE auth_accounts ADD COLUMN usage_spark_limit_window_seconds INTEGER;
