CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE user_role AS ENUM ('SUPER_ADMIN', 'RECRUITER', 'INTERVIEWER');
CREATE TYPE user_status AS ENUM ('ACTIVE', 'INACTIVE');
CREATE TYPE candidate_status AS ENUM ('ACTIVE', 'ARCHIVED');
CREATE TYPE interview_mode AS ENUM ('ONLINE', 'OFFLINE', 'PHONE');
CREATE TYPE interview_result AS ENUM ('PENDING', 'PASS', 'FAIL', 'HOLD');
CREATE TYPE application_status AS ENUM ('IN_PIPELINE', 'SELECTED', 'REJECTED', 'JOINED', 'WITHDRAWN');

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name VARCHAR(120) NOT NULL,
  email VARCHAR(255) NOT NULL,
  phone VARCHAR(20),
  password_hash TEXT NOT NULL,
  role user_role NOT NULL,
  status user_status NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title VARCHAR(150) NOT NULL,
  department VARCHAR(120),
  location VARCHAR(120),
  employment_type VARCHAR(40),
  experience_min INT,
  experience_max INT,
  openings_count INT NOT NULL DEFAULT 1,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  storage_key TEXT NOT NULL UNIQUE,
  original_name VARCHAR(255) NOT NULL,
  mime_type VARCHAR(120) NOT NULL,
  size_bytes BIGINT NOT NULL,
  uploaded_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name VARCHAR(120) NOT NULL,
  email VARCHAR(255),
  phone VARCHAR(20),
  total_experience_years NUMERIC(4,1),
  current_company VARCHAR(150),
  current_ctc NUMERIC(12,2),
  expected_ctc NUMERIC(12,2),
  notice_period_days INT,
  source VARCHAR(80),
  status candidate_status NOT NULL DEFAULT 'ACTIVE',
  resume_file_id UUID REFERENCES files(id),
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE candidate_skills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  skill_name VARCHAR(80) NOT NULL,
  proficiency SMALLINT CHECK (proficiency BETWEEN 1 AND 5),
  years NUMERIC(4,1)
);

CREATE TABLE candidate_education (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  degree VARCHAR(120),
  institution VARCHAR(180),
  specialization VARCHAR(120),
  start_year INT,
  end_year INT,
  score VARCHAR(40)
);

CREATE TABLE pipeline_stages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID REFERENCES jobs(id) ON DELETE CASCADE,
  name VARCHAR(60) NOT NULL,
  sort_order INT NOT NULL,
  is_terminal BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(job_id, sort_order)
);

CREATE TABLE applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  status application_status NOT NULL DEFAULT 'IN_PIPELINE',
  current_stage_id UUID REFERENCES pipeline_stages(id),
  shortlisted BOOLEAN NOT NULL DEFAULT false,
  rejection_reason TEXT,
  joined_on DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(candidate_id, job_id)
);

CREATE TABLE pipeline_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  from_stage_id UUID REFERENCES pipeline_stages(id),
  to_stage_id UUID REFERENCES pipeline_stages(id),
  remark TEXT,
  feedback TEXT,
  moved_by UUID NOT NULL REFERENCES users(id),
  moved_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE interviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  round_no INT NOT NULL,
  interviewer_id UUID NOT NULL REFERENCES users(id),
  scheduled_start TIMESTAMPTZ NOT NULL,
  scheduled_end TIMESTAMPTZ,
  mode interview_mode NOT NULL,
  meeting_link TEXT,
  result interview_result NOT NULL DEFAULT 'PENDING',
  mandatory_feedback_submitted BOOLEAN NOT NULL DEFAULT false,
  voice_recording_file_id UUID REFERENCES files(id),
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE interview_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  interview_id UUID NOT NULL UNIQUE REFERENCES interviews(id) ON DELETE CASCADE,
  technical_rating SMALLINT NOT NULL CHECK (technical_rating BETWEEN 1 AND 5),
  communication_rating SMALLINT NOT NULL CHECK (communication_rating BETWEEN 1 AND 5),
  culture_fit_rating SMALLINT NOT NULL CHECK (culture_fit_rating BETWEEN 1 AND 5),
  strengths TEXT NOT NULL,
  concerns TEXT NOT NULL,
  recommendation interview_result NOT NULL,
  overall_comments TEXT NOT NULL,
  submitted_by UUID NOT NULL REFERENCES users(id),
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE custom_field_definitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type VARCHAR(40) NOT NULL,
  field_key VARCHAR(80) NOT NULL,
  field_label VARCHAR(120) NOT NULL,
  field_type VARCHAR(40) NOT NULL,
  is_required BOOLEAN NOT NULL DEFAULT false,
  options_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(entity_type, field_key)
);

CREATE TABLE custom_field_values (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  field_definition_id UUID NOT NULL REFERENCES custom_field_definitions(id) ON DELETE CASCADE,
  candidate_id UUID REFERENCES candidates(id) ON DELETE CASCADE,
  application_id UUID REFERENCES applications(id) ON DELETE CASCADE,
  value_text TEXT,
  value_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id UUID REFERENCES users(id),
  action VARCHAR(80) NOT NULL,
  entity_type VARCHAR(40) NOT NULL,
  entity_id UUID,
  old_data JSONB,
  new_data JSONB,
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX ux_users_email_lower ON users (LOWER(email));
CREATE INDEX ix_candidates_name ON candidates (full_name);
CREATE INDEX ix_candidates_email_lower ON candidates (LOWER(email));
CREATE INDEX ix_candidates_phone ON candidates (phone);
CREATE INDEX ix_candidate_skills_skill ON candidate_skills (LOWER(skill_name));
CREATE INDEX ix_applications_job_status ON applications (job_id, status);
CREATE INDEX ix_applications_stage ON applications (current_stage_id);
CREATE INDEX ix_pipeline_events_app_time ON pipeline_events (application_id, moved_at DESC);
CREATE INDEX ix_interviews_interviewer_time ON interviews (interviewer_id, scheduled_start);
CREATE INDEX ix_audit_actor_time ON audit_logs (actor_user_id, created_at DESC);
CREATE INDEX ix_audit_entity ON audit_logs (entity_type, entity_id);
