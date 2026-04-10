# Spec: Two-factor authentication for admin accounts

**Author:** Elena — **Status:** draft, ready for review

## Summary

Add mandatory TOTP-based two-factor authentication for all admin-role accounts on Nimbus. End users (non-admin) are out of scope for this phase.

## Why

Two incidents this quarter involved admin credentials being phished. Both were contained quickly but they exposed a real gap: our admin console has full tenant-switching capability and relies only on passwords. Mandating 2FA on admin accounts is a cheap mitigation that closes the biggest attack surface we have today.

## Who this affects

- **Admin users (~40 people):** must enroll a TOTP authenticator before their next login after rollout.
- **Support team:** will field enrollment questions and recovery requests.
- **Engineering on-call:** new recovery workflow documented below.

## Requirements

1. Admin accounts cannot log in without completing 2FA.
2. TOTP is the only supported second factor in this phase. SMS and email codes are explicitly excluded (phishable, and our threat model cares about phishing). WebAuthn is deferred to v2 because the rollout cost is higher and we want to ship something this quarter.
3. Enrollment happens on first login after rollout. Users get a QR code and a set of 10 backup codes.
4. Backup codes are single-use, stored hashed (bcrypt), and can be regenerated from settings.
5. Recovery (lost device): support opens a ticket, a second support team member approves, and the user is issued new backup codes via email. This two-person rule is to prevent a single compromised support account from bypassing 2FA.
6. After 5 failed TOTP attempts in 15 minutes, the account is locked for 30 minutes and the security team is notified.

## Flow

### Enrollment
1. Admin logs in with password as usual.
2. If 2FA not enrolled → redirect to `/setup-2fa`.
3. Show QR code + secret (for manual entry).
4. User scans, enters a code to confirm pairing.
5. System generates 10 backup codes, shows them once, requires user to confirm they've saved them.
6. Redirect to the original destination.

### Login
1. Admin enters email + password.
2. If credentials valid and 2FA enrolled → show TOTP challenge.
3. On success → session started.
4. On 5 failures → lockout.

### Recovery
1. User contacts support via the internal support portal.
2. Support verifies identity (name, employee ID, manager callback — existing process).
3. Support agent A opens a recovery request.
4. Support agent B approves it.
5. User receives a time-limited recovery link by email.
6. Link lets them re-enroll a new device and regenerates backup codes.

## Data model

Add `admin_2fa` table:

```
admin_2fa (
  user_id UUID PRIMARY KEY REFERENCES users(id),
  secret BYTEA NOT NULL,          -- encrypted with KMS data key
  enrolled_at TIMESTAMPTZ NOT NULL,
  last_used_at TIMESTAMPTZ,
  backup_codes JSONB NOT NULL     -- array of {hash, used_at}
)
```

Secret is encrypted at rest using our existing KMS envelope encryption pattern. Backup codes are stored as bcrypt hashes; the plaintext is only shown once at generation time.

## Rollout plan

1. **Week 1:** deploy code, feature-flag off.
2. **Week 2:** enable for the security team only (5 people). They're the most forgiving beta users and they'll catch issues.
3. **Week 3:** enable for engineering admins (~15 people). Gather feedback.
4. **Week 4:** enable for the remaining admins (~20 people). Send advance notice 5 days before.
5. **Week 5:** remove the feature flag.

## Open questions

- Do we want to enforce 2FA re-verification for "sensitive" admin actions (e.g., tenant deletion, billing refunds)? I lean yes but it's extra scope. Flagging for product input.
- What's the audit log format for 2FA events? I'll propose a schema in the implementation PR unless someone has a preference now.

## Risks

- **User lockout during rollout.** If the recovery flow is broken we'll find out the hard way. Mitigation: the security team (week 2) pressure-tests recovery before any wider rollout.
- **Support load spike.** Expect an uptick in "I lost my phone" tickets in the first two weeks. Support lead is aware.
- **Developer workflow friction.** Admins who use the API directly with personal tokens aren't affected (tokens bypass 2FA by design — they're stronger than passwords and are already audited). Dashboard users do get the extra step. This is the intended cost.
