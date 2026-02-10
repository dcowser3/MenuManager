-- Menu Manager Database Schema
-- For Supabase PostgreSQL (free tier)
--
-- Copy and paste this into Supabase SQL Editor to create tables

-- Enable UUID extension (usually enabled by default in Supabase)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- 1. SUBMISSIONS
-- Stores all menu submissions (migrating from submissions.json)
-- ============================================================================
CREATE TABLE submissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    legacy_id VARCHAR(100),                          -- For migrating existing submissions

    -- Form fields
    project_name VARCHAR(255) NOT NULL,
    property VARCHAR(255) NOT NULL,
    size VARCHAR(100),
    orientation VARCHAR(50),
    menu_type VARCHAR(50) DEFAULT 'standard',        -- 'standard' or 'prix_fixe'
    template_type VARCHAR(50) DEFAULT 'food',        -- 'food' or 'beverage'
    date_needed DATE,

    -- Submitter info
    submitter_email VARCHAR(255) NOT NULL,
    submitter_name VARCHAR(255),
    submitter_job_title VARCHAR(255),

    -- Additional project details
    hotel_name VARCHAR(255),
    city_country VARCHAR(255),
    asset_type VARCHAR(50),  -- 'PRINT' or 'DIGITAL'

    -- Menu content (plain text for AI review)
    menu_content TEXT,

    -- File paths
    filename VARCHAR(255),
    original_path TEXT,
    ai_draft_path TEXT,
    final_path TEXT,

    -- Status tracking
    status VARCHAR(50) NOT NULL DEFAULT 'processing',
    -- Possible statuses:
    -- 'processing' - Initial state, being validated
    -- 'pending_ai_review' - Waiting for AI review
    -- 'pending_human_review' - AI done, waiting for human
    -- 'approved' - Fully approved
    -- 'rejected' - Rejected by reviewer

    -- Flags
    changes_made BOOLEAN DEFAULT false,              -- Did human make changes to AI draft?
    source VARCHAR(50) DEFAULT 'form',               -- 'form' (only option now)

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    reviewed_at TIMESTAMPTZ
);

-- Index for faster status queries
CREATE INDEX idx_submissions_status ON submissions(status);
CREATE INDEX idx_submissions_created_at ON submissions(created_at DESC);

-- ============================================================================
-- 2. APPROVED_DISHES
-- Running list of all approved dishes extracted from approved menus
-- ============================================================================
CREATE TABLE approved_dishes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Dish info
    dish_name VARCHAR(500) NOT NULL,
    dish_name_normalized VARCHAR(500) NOT NULL,      -- Lowercase, trimmed for deduplication
    property VARCHAR(255),                           -- Which property/restaurant
    menu_category VARCHAR(255),                      -- e.g., "Appetizers", "Entrees", "Desserts"
    description TEXT,
    price VARCHAR(50),                               -- Keep as string to handle various formats

    -- Allergens (array of codes like 'GF', 'V', 'VG', etc.)
    allergens VARCHAR(10)[],

    -- Source tracking
    source_submission_id UUID REFERENCES submissions(id) ON DELETE SET NULL,

    -- Status
    is_active BOOLEAN DEFAULT true,                  -- For soft delete

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for searching dishes
CREATE INDEX idx_approved_dishes_name ON approved_dishes(dish_name_normalized);
CREATE INDEX idx_approved_dishes_property ON approved_dishes(property);
CREATE INDEX idx_approved_dishes_active ON approved_dishes(is_active) WHERE is_active = true;

-- ============================================================================
-- 3. USERS
-- For reviewers and admins (structure for later, when Clerk auth is added)
-- ============================================================================
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Auth (will link to Clerk user ID later)
    clerk_user_id VARCHAR(255) UNIQUE,

    -- Profile
    email VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(255),

    -- Role: 'chef', 'reviewer', 'admin'
    role VARCHAR(50) DEFAULT 'chef',

    -- Status
    is_active BOOLEAN DEFAULT true,

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_role ON users(role);

-- ============================================================================
-- 4. APPROVAL_WORKFLOW
-- Multi-level approval chain for submissions
-- ============================================================================
CREATE TABLE approval_workflow (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Link to submission
    submission_id UUID REFERENCES submissions(id) ON DELETE CASCADE,

    -- Workflow step
    step_order INTEGER NOT NULL,                     -- 1, 2, 3, etc.

    -- Reviewer assignment
    reviewer_id UUID REFERENCES users(id) ON DELETE SET NULL,

    -- Status: 'pending', 'in_review', 'approved', 'rejected', 'skipped'
    status VARCHAR(50) DEFAULT 'pending',

    -- Notes from reviewer
    notes TEXT,

    -- Timestamps
    assigned_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

CREATE INDEX idx_approval_workflow_submission ON approval_workflow(submission_id);
CREATE INDEX idx_approval_workflow_reviewer ON approval_workflow(reviewer_id);
CREATE INDEX idx_approval_workflow_status ON approval_workflow(status);

-- ============================================================================
-- 5. SUBMITTER_PROFILES
-- Stores submitter info for autocomplete / autofill
-- ============================================================================
CREATE TABLE submitter_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    name_normalized VARCHAR(255) NOT NULL UNIQUE,
    email VARCHAR(255) NOT NULL,
    job_title VARCHAR(255) NOT NULL,
    last_used TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_submitter_profiles_name ON submitter_profiles(name_normalized);

-- ============================================================================
-- HELPER FUNCTIONS
-- ============================================================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger for submissions
CREATE TRIGGER update_submissions_updated_at
    BEFORE UPDATE ON submissions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Trigger for users
CREATE TRIGGER update_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- ROW LEVEL SECURITY (RLS) - Enable later when auth is added
-- ============================================================================
-- ALTER TABLE submissions ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE approved_dishes ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE users ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE approval_workflow ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- SAMPLE DATA (for testing - comment out in production)
-- ============================================================================
-- INSERT INTO users (email, name, role) VALUES
--     ('admin@example.com', 'Admin User', 'admin'),
--     ('reviewer@example.com', 'Reviewer User', 'reviewer');
