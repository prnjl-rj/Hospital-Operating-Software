-- =============================================================================
-- HOSPITAL OPERATING SOFTWARE (HOS) — POSTGRESQL MULTI-SCHEMA & LEAST-PRIVILEGE ROLE INIT
-- Executed automatically by PostgreSQL container on first boot (/docker-entrypoint-initdb.d)
-- Enforces Rule 15 & Rule 16: Strict per-service schema ownership & separate credentials
-- =============================================================================

-- Enable UUID & cryptographic extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. Create the 5 isolated domain schemas
CREATE SCHEMA IF NOT EXISTS identity;
CREATE SCHEMA IF NOT EXISTS hospital_core;
CREATE SCHEMA IF NOT EXISTS clinical;
CREATE SCHEMA IF NOT EXISTS diagnostics_pharmacy;
CREATE SCHEMA IF NOT EXISTS operations_billing;

-- 2. Create dedicated per-service database roles (Least-Privilege)
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'hos_identity_user') THEN
    CREATE ROLE hos_identity_user WITH LOGIN PASSWORD 'hos_identity_local_pwd';
  END IF;
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'hos_core_user') THEN
    CREATE ROLE hos_core_user WITH LOGIN PASSWORD 'hos_core_local_pwd';
  END IF;
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'hos_clinical_user') THEN
    CREATE ROLE hos_clinical_user WITH LOGIN PASSWORD 'hos_clinical_local_pwd';
  END IF;
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'hos_diag_user') THEN
    CREATE ROLE hos_diag_user WITH LOGIN PASSWORD 'hos_diag_local_pwd';
  END IF;
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'hos_ops_user') THEN
    CREATE ROLE hos_ops_user WITH LOGIN PASSWORD 'hos_ops_local_pwd';
  END IF;
END
$$;

-- 3. Grant schema ownership and strictly isolate cross-schema access
ALTER SCHEMA identity OWNER TO hos_identity_user;
GRANT USAGE, CREATE ON SCHEMA identity TO hos_identity_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA identity GRANT ALL ON TABLES TO hos_identity_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA identity GRANT ALL ON SEQUENCES TO hos_identity_user;

ALTER SCHEMA hospital_core OWNER TO hos_core_user;
GRANT USAGE, CREATE ON SCHEMA hospital_core TO hos_core_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA hospital_core GRANT ALL ON TABLES TO hos_core_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA hospital_core GRANT ALL ON SEQUENCES TO hos_core_user;

ALTER SCHEMA clinical OWNER TO hos_clinical_user;
GRANT USAGE, CREATE ON SCHEMA clinical TO hos_clinical_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA clinical GRANT ALL ON TABLES TO hos_clinical_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA clinical GRANT ALL ON SEQUENCES TO hos_clinical_user;

ALTER SCHEMA diagnostics_pharmacy OWNER TO hos_diag_user;
GRANT USAGE, CREATE ON SCHEMA diagnostics_pharmacy TO hos_diag_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA diagnostics_pharmacy GRANT ALL ON TABLES TO hos_diag_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA diagnostics_pharmacy GRANT ALL ON SEQUENCES TO hos_diag_user;

ALTER SCHEMA operations_billing OWNER TO hos_ops_user;
GRANT USAGE, CREATE ON SCHEMA operations_billing TO hos_ops_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA operations_billing GRANT ALL ON TABLES TO hos_ops_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA operations_billing GRANT ALL ON SEQUENCES TO hos_ops_user;

-- 4. Revoke public schema creation to prevent accidental unowned tables
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

