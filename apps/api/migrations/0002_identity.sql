-- Accounts, sessions, and the single-use refresh token chain.

CREATE TABLE app_user (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  email           text        NOT NULL,
  -- Absent for accounts that only ever signed in through Google.
  password_hash   text,
  role            user_role   NOT NULL DEFAULT 'customer',
  -- Present once 2FA setup begins; only confirmed when totp_enabled_at is set.
  totp_secret     text,
  totp_enabled_at timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT app_user_email_lowercase CHECK (email = lower(email)),
  CONSTRAINT app_user_email_shape CHECK (email LIKE '%_@_%'),
  -- 2FA cannot be switched on without a secret to check codes against.
  CONSTRAINT app_user_totp_needs_secret
    CHECK (totp_enabled_at IS NULL OR totp_secret IS NOT NULL)
);

CREATE UNIQUE INDEX app_user_email_key ON app_user (email);

CREATE TABLE oauth_identity (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid        NOT NULL REFERENCES app_user (id) ON DELETE CASCADE,
  provider   text        NOT NULL,
  -- The provider's immutable identifier for the user, never their email:
  -- email addresses get reassigned, subjects do not.
  subject    text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX oauth_identity_provider_subject_key
  ON oauth_identity (provider, subject);
CREATE INDEX oauth_identity_user_idx ON oauth_identity (user_id);

-- A session is the revocation unit AND the refresh-token family. The access
-- token carries this row's id as `sid`, so setting revoked_at kills the access
-- token and every refresh token descended from it in the same instant.
CREATE TABLE session (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid        NOT NULL REFERENCES app_user (id) ON DELETE CASCADE,
  created_at     timestamptz NOT NULL DEFAULT now(),
  expires_at     timestamptz NOT NULL,
  revoked_at     timestamptz,
  -- 'logout' | 'token_reuse' | 'password_reset'
  revoked_reason text,
  user_agent     text        NOT NULL DEFAULT '',
  ip_address     text        NOT NULL DEFAULT '',

  CONSTRAINT session_revocation_has_reason
    CHECK ((revoked_at IS NULL) = (revoked_reason IS NULL))
);

CREATE INDEX session_user_idx ON session (user_id);
-- Supports the guard's hot path: is this session live right now?
CREATE INDEX session_live_idx ON session (id) WHERE revoked_at IS NULL;

-- One row per issued refresh token. `used_at` is what makes rotation
-- single-use: presenting a token whose used_at is already set is a replay,
-- and a replay revokes the entire session.
CREATE TABLE refresh_token (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid        NOT NULL REFERENCES session (id) ON DELETE CASCADE,
  -- SHA-256 of the token. A database leak must not hand over usable tokens.
  token_hash text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at    timestamptz
);

CREATE UNIQUE INDEX refresh_token_hash_key ON refresh_token (token_hash);
CREATE INDEX refresh_token_session_idx ON refresh_token (session_id);

CREATE TABLE password_reset_token (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid        NOT NULL REFERENCES app_user (id) ON DELETE CASCADE,
  token_hash text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at    timestamptz
);

CREATE UNIQUE INDEX password_reset_token_hash_key ON password_reset_token (token_hash);
CREATE INDEX password_reset_token_user_idx ON password_reset_token (user_id);
