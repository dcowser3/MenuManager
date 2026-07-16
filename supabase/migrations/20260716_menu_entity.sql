-- Menu as an Entity (Phase 1 — ships dark, no behavior change).
-- Design: docs/design-docs/menu-entity-and-identity.md
-- Spec:   docs/menu-entity-and-identity-implementation-spec.md
--
-- A menu is a first-class thing that evolves over time; each approved submission
-- is a *version* of exactly one menu. current_submission_id points at the live
-- version. No FK constraints on current_submission_id / menu_id in v1 —
-- historical rows and the JSON fallback can't satisfy them; validated in code.

CREATE TABLE IF NOT EXISTS menus (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    property VARCHAR(200) NOT NULL,
    service_period VARCHAR(120) NOT NULL,
    name VARCHAR(200) NOT NULL,            -- e.g. "Lunch", "Brunch Bebidas"
    current_submission_id UUID,
    status VARCHAR(24) NOT NULL DEFAULT 'active',  -- active | retired
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_menus_property_service ON menus(property, service_period);
CREATE INDEX IF NOT EXISTS idx_menus_status ON menus(status);

ALTER TABLE submissions ADD COLUMN IF NOT EXISTS menu_id UUID;
CREATE INDEX IF NOT EXISTS idx_submissions_menu ON submissions(menu_id);

ALTER TABLE draft_sessions ADD COLUMN IF NOT EXISTS menu_id UUID;  -- populated Phase 3
CREATE INDEX IF NOT EXISTS idx_draft_sessions_menu ON draft_sessions(menu_id);
