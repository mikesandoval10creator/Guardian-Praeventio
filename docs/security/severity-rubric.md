# Severity Rubric — Praeventio Guard

This rubric defines how we triage reported vulnerabilities. It uses
CVSS 3.1 base scores as a starting point, but the **deciding factor** is
contextual: Praeventio Guard is a safety-critical application. A bug
that prevents an alarm from firing when a worker has fallen is treated
as life-threatening, regardless of what the CVSS calculator says.

When in doubt, escalate one level higher.

---

## CRITICAL — CVSS 9.0+ — Threat to worker life or limb

A vulnerability that could directly result in physical harm, death, or
mass exfiltration of sensitive data.

**Examples specific to Praeventio Guard:**
- "Hombre Caído" (man-down) alarm fails to fire under conditions an
  attacker can induce (e.g., a malicious input causes the detection
  service to crash silently).
- "Botón SOS" silently fails to deliver to dispatch / supervisor.
- Man-down detection bypass: attacker disables alerts for a target
  worker without their knowledge.
- Mass user data exfiltration (medical exams, biometrics, location
  history) via auth bypass, IDOR at scale, or RCE.
- Remote code execution on backend or in the mobile app.
- Authentication bypass on `/api/*` allowing tenant impersonation.

**SLA:**
- Triage: within 24 hours
- Patch: within 72 hours (production deploy)
- Disclosure: no negotiation — coordinated, but we publish promptly
  once the fix is live and validated.

---

## HIGH — CVSS 7.0–8.9 — Privacy or integrity breach without immediate physical risk

A vulnerability that compromises confidentiality or integrity of
sensitive data, but does not directly endanger a person.

**Examples specific to Praeventio Guard:**
- Medical exam data (`exams/` collection) leakage to non-authorized
  users in the same tenant or across tenants.
- OAuth / Firebase token compromise enabling account takeover.
- `audit_logs` tampering — write or delete access for an attacker who
  should be read-only.
- Privilege escalation from `worker` role to `supervisor` or `admin`.
- SQL injection / NoSQL injection in any tenant-scoped query.
- Stored XSS reachable by any authenticated user.

**SLA:**
- Triage: within 72 hours
- Patch: within 14 days
- Disclosure: coordinated, default 30 days post-fix.

---

## MEDIUM — CVSS 4.0–6.9 — Limited scope or significant friction to exploit

A vulnerability with a narrow attack surface, requiring privileged
access, user interaction, or specific preconditions.

**Examples specific to Praeventio Guard:**
- Stored or reflected XSS in an admin-only panel (requires admin
  account to exploit, limited blast radius).
- Rate-limit bypass on a non-critical endpoint (e.g., search).
- CSRF on a non-critical endpoint that doesn't change financial,
  safety, or authentication state.
- Sensitive information disclosure in error messages that requires
  authentication to trigger.
- Insecure direct object reference on a resource of low sensitivity.

**SLA:**
- Triage: within 1 week
- Patch: within 30 days
- Disclosure: coordinated, default 60 days post-fix.

---

## LOW — CVSS 0.1–3.9 — Best practices violations without exploit path

A finding that is technically a deviation from best practice but has
no demonstrated exploitability.

**Examples specific to Praeventio Guard:**
- Missing security headers (`Content-Security-Policy`,
  `X-Frame-Options`, `Strict-Transport-Security`) on non-sensitive
  pages.
- Verbose error messages in development / staging environments.
- Weak rate limits on public endpoints (e.g., `/api/health`).
- Outdated TLS cipher suites still negotiable (but with no current
  exploit).
- Information disclosure in HTTP response headers (server version, etc.).

**SLA:**
- Response: within 30 days
- No formal patch SLA — rolled into the next maintenance release.
- Disclosure: at our discretion, often bundled in changelog.

---

## Bug Bounty Payouts (when program launches)

Praeventio Guard does not yet operate a formal bug bounty program. We
plan to launch one (HackerOne / Intigriti / equivalent) once we reach
100+ Empresarial-tier customers. The table below is the **target
payout band** we will use at launch — it is provided here so reporters
understand how we value reports today and what to expect later.

| Severity | Target payout (USD, at launch) | Today's recognition |
|----------|-------------------------------:|---------------------|
| CRITICAL | $2,000 – $10,000               | Hall of Fame + case-by-case negotiated reward |
| HIGH     | $500 – $2,000                  | Hall of Fame + thank-you letter + LinkedIn endorsement |
| MEDIUM   | $100 – $500                    | Hall of Fame + thank-you letter |
| LOW      | $0 – $100 / swag               | Hall of Fame mention |

Bands are guidance, not contract. Final amount depends on quality of
report, exploitability, and impact.

---

*Documento actualizado: 2026-04-28*
