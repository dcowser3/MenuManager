// Test safety guard: the suite must NEVER send real email.
//
// Several tests import the real dashboard/db modules, which build their mail
// transport from environment variables at module load. If mail credentials are
// present in the environment — a shell with `.env` exported, or a non-mocked
// module that calls dotenv.config() — the submission/alert code paths would send
// live emails (to test addresses like chef@example.com), which bounce back as
// NDRs to the production mailbox.
//
// Force both transports off before any module loads. The disable flag wins
// regardless of other env, and dotenv.config() does not override already-set
// keys, so these stick even if a module later loads `.env`.
process.env.ALERT_MAIL_GRAPH_DISABLED = 'true';
process.env.SMTP_HOST = '';
process.env.SMTP_USER = '';
process.env.SMTP_PASS = '';
process.env.GRAPH_CLIENT_ID = '';
process.env.GRAPH_TENANT_ID = '';
process.env.GRAPH_CLIENT_SECRET = '';
process.env.GRAPH_MAILBOX_ADDRESS = '';
process.env.GRAPH_USER_EMAIL = '';
