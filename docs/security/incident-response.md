# Incident Response Runbook

This is the internal runbook for the Praeventio team when a security
vulnerability is reported. It complements the public-facing
[SECURITY.md](../../SECURITY.md) and the
[severity rubric](./severity-rubric.md).

## Triage (within 72h of report)

1. Acknowledge receipt to reporter
2. Assign severity per docs/security/severity-rubric.md
3. Assign owner (founder for CRITICAL/HIGH; engineer for MED/LOW)
4. Create private issue in repo (label: `security`, visibility: private)
5. If CRITICAL: notify on-call + initiate war room

## Patching

1. Reproduce in isolated environment
2. Identify root cause (don't just patch symptom)
3. Write regression test FIRST (TDD discipline)
4. Patch + verify regression test passes
5. Code review by 2nd engineer
6. Stage deploy to test tenant
7. Validate fix in staging
8. Production deploy
9. Verify in production logs that exploit is no longer possible
10. Notify reporter that fix is live

## Disclosure

- Coordinated disclosure timing: agree with reporter, default 30 days post-fix
- CVE assignment: file via NVD if vulnerability has wide impact
- Postmortem: public blog post + repo CHANGELOG entry
- Update Hall of Fame in SECURITY.md

## Communication

- To affected customers: email within 24h of patch deployment
- To Workspace admins (if Marketplace install): per their incident notification preferences
- Public disclosure: blog post + tweet from @praeventio

## Compliance

- Ley 21.719 art. 50 (Chile): reporting deadline 72h to ANPD when personal data breach
- ISO 27001 A.5.24: incident management process — log this incident in ISMS
