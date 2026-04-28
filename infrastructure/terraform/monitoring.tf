# =============================================================================
# Praeventio Guard — Cloud Monitoring (alert policies + channels + metrics)
# =============================================================================
#
# Codifies the SLOs declared in OBSERVABILITY.md §4-§5 as Terraform-managed
# alert policies, notification channels, and custom metric descriptors.
#
# Owned by agent C2. Sibling agent C1 owns every other *.tf file under this
# directory; do NOT add resources here that overlap with kms.tf / iam.tf /
# storage.tf / scheduler.tf / cloudrun.tf / secrets.tf.
#
# Provider docs:
#   https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/monitoring_alert_policy
#   https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/monitoring_notification_channel
#   https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/monitoring_metric_descriptor
#   https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/monitoring_dashboard
#
# CALIBRATION NOTICE
# ------------------
# Every threshold value in this file is a *first-week placeholder*. After 7
# days of production traffic, recalibrate using Cloud Monitoring's
# "recommended threshold" feature (Console → Monitoring → Alerting → policy
# → Edit → "Suggest threshold"). Resources flagged with `# CALIBRATE` are
# the most likely to need adjustment.
# =============================================================================

# -----------------------------------------------------------------------------
# Notification channels
# -----------------------------------------------------------------------------
# Two e-mail channels by default. PagerDuty and Slack are commented out
# until the on-call rotation actually exists; uncomment, set the relevant
# variables, and re-apply when ready.

resource "google_monitoring_notification_channel" "founder_email" {
  display_name = "Founder Email"
  type         = "email"
  description  = "Default channel for all P2/P3 alerts. Routes to the founder inbox."

  labels = {
    email_address = "soporte@praeventio.net"
  }

  user_labels = {
    severity = "default"
    owner    = "founder"
  }
}

resource "google_monitoring_notification_channel" "security_email" {
  display_name = "Security Email"
  type         = "email"
  description  = "Channel for security-sensitive alerts (KMS errors, backup gaps, auth anomalies)."

  labels = {
    email_address = "security@praeventio.net"
  }

  user_labels = {
    severity = "security"
    owner    = "security"
  }
}

# Optional: PagerDuty critical pager. Uncomment + set
# `var.pagerduty_service_key` (and add the variable in variables.tf) when an
# on-call rotation exists.
#
# resource "google_monitoring_notification_channel" "pagerduty" {
#   display_name = "PagerDuty Critical"
#   type         = "pagerduty"
#   description  = "P1 pager — wake someone up. Use sparingly."
#
#   sensitive_labels {
#     service_key = var.pagerduty_service_key
#   }
# }

# Optional: Slack channel. Requires the Slack OAuth token to live in Secret
# Manager + a separate `google_monitoring_notification_channel` of type
# `slack`. See:
# https://cloud.google.com/monitoring/support/notification-options#slack
#
# resource "google_monitoring_notification_channel" "slack_incidents" {
#   display_name = "Slack #incidents"
#   type         = "slack"
#   labels = {
#     channel_name = "#incidents"
#   }
#   sensitive_labels {
#     auth_token = var.slack_auth_token
#   }
# }

# -----------------------------------------------------------------------------
# Default channel set used by every alert. Centralised so we can rewire all
# alerts to PagerDuty by editing one list once it exists.
# -----------------------------------------------------------------------------
locals {
  default_notification_channels = [
    google_monitoring_notification_channel.founder_email.id,
  ]

  security_notification_channels = [
    google_monitoring_notification_channel.founder_email.id,
    google_monitoring_notification_channel.security_email.id,
  ]
}

# =============================================================================
# Custom metric descriptors
# =============================================================================
# Only the 4-6 highest-value app-emitted metrics are codified. Cloud
# Monitoring charges $0.30/MB/mo for custom metrics after the free tier;
# adding low-value metrics is a foot-gun.
#
# NEVER put high-cardinality fields (user IDs, RUTs, event IDs) in labels —
# every distinct combo creates a separate time series. See
# OBSERVABILITY.md §4 cardinality note.
# =============================================================================

resource "google_monitoring_metric_descriptor" "calendar_prediction_latency" {
  display_name = "Calendar prediction latency"
  type         = "custom.googleapis.com/praeventio/calendar/prediction_latency_ms"
  metric_kind  = "GAUGE"
  value_type   = "DISTRIBUTION"
  unit         = "ms"
  description  = "Latency of predictUpcomingActivities() per request. Powers SLO #4."

  labels {
    key         = "tier"
    value_type  = "STRING"
    description = "User pricing tier (gratis, comite-paritario, pyme, empresa)."
  }
}

resource "google_monitoring_metric_descriptor" "climate_risk_coupling_latency" {
  display_name = "Climate risk coupling latency"
  type         = "custom.googleapis.com/praeventio/climate/risk_coupling_latency_ms"
  metric_kind  = "GAUGE"
  value_type   = "DISTRIBUTION"
  unit         = "ms"
  description  = "Latency of the OpenWeather + IPER coupling job."
}

resource "google_monitoring_metric_descriptor" "webpay_outcome" {
  display_name = "Webpay return outcome"
  type         = "custom.googleapis.com/praeventio/webpay/return_outcome"
  metric_kind  = "CUMULATIVE"
  value_type   = "INT64"
  unit         = "1"
  description  = "Counter of Webpay return-endpoint outcomes by result code."

  labels {
    key         = "outcome"
    value_type  = "STRING"
    description = "AUTHORIZED | REJECTED | TIMEOUT | INTEGRITY_FAILED."
  }
}

resource "google_monitoring_metric_descriptor" "kms_operations" {
  display_name = "KMS operations"
  type         = "custom.googleapis.com/praeventio/kms/operations"
  metric_kind  = "CUMULATIVE"
  value_type   = "INT64"
  unit         = "1"
  description  = "Counter of KMS encrypt/decrypt operations and their outcome. Powers SLO #6."

  labels {
    key         = "operation"
    value_type  = "STRING"
    description = "encrypt | decrypt | rewrap."
  }

  labels {
    key         = "outcome"
    value_type  = "STRING"
    description = "ok | error."
  }
}

resource "google_monitoring_metric_descriptor" "health_connect_sync" {
  display_name = "Health Connect sync"
  type         = "custom.googleapis.com/praeventio/health_connect/sync"
  metric_kind  = "CUMULATIVE"
  value_type   = "INT64"
  unit         = "1"
  description  = "Counter of Health Connect / HealthKit sync attempts. Powers SLO #3."

  labels {
    key         = "provider"
    value_type  = "STRING"
    description = "health_connect (Android) | healthkit (iOS)."
  }

  labels {
    key         = "outcome"
    value_type  = "STRING"
    description = "success | failure | partial."
  }
}

resource "google_monitoring_metric_descriptor" "billing_signups" {
  display_name = "Sign-ups by tier"
  type         = "custom.googleapis.com/praeventio/billing/signups"
  metric_kind  = "CUMULATIVE"
  value_type   = "INT64"
  unit         = "1"
  description  = "Daily sign-up counter per pricing tier (business KPI)."

  labels {
    key         = "tier"
    value_type  = "STRING"
    description = "User pricing tier (gratis, comite-paritario, pyme, empresa)."
  }
}

# =============================================================================
# Alert policies — one per SLO declared in OBSERVABILITY.md
# =============================================================================

# -----------------------------------------------------------------------------
# SLO #1 — /api/health 200 rate ≥ 99.9% over rolling 7-day window
# -----------------------------------------------------------------------------
# Implementation note: Cloud Monitoring alert policies cannot directly model
# a 7-day rolling SLO; they're tied to alignment-period buckets. This policy
# fires on a *short-window proxy*: 5xx rate > 0.1% over 1h, sustained 5min.
# A second hourly batch job (out of scope) computes the actual 7d burn rate
# and writes it as a custom metric for compliance reporting.
resource "google_monitoring_alert_policy" "api_health_uptime" {
  display_name = "SLO#1 — /api/health 5xx rate exceeds 0.1% (1h proxy for 7d 99.9% SLO)"
  combiner     = "OR"
  enabled      = true

  conditions {
    display_name = "Health endpoint 5xx ratio over 1h"

    condition_threshold {
      filter          = "metric.type=\"loadbalancing.googleapis.com/https/request_count\" AND resource.type=\"https_lb_rule\" AND metric.label.\"response_code_class\"=\"500\""
      comparison      = "COMPARISON_GT"
      duration        = "300s"
      threshold_value = 0.001 # 0.1% — CALIBRATE after first week of prod

      aggregations {
        alignment_period     = "60s"
        per_series_aligner   = "ALIGN_RATE"
        cross_series_reducer = "REDUCE_SUM"
      }
    }
  }

  notification_channels = local.default_notification_channels

  alert_strategy {
    auto_close = "1800s" # 30 min
  }

  documentation {
    content = <<-EOT
      ## SLO #1 — /api/health uptime

      **Target:** 99.9% 2xx over rolling 7-day window. Alert fires on a
      short-window proxy (5xx > 0.1% over 1h) so we catch sustained
      regressions ~6h before the 7d SLO actually burns.

      **Likely causes:**
      - Firestore quota exhausted (read or write).
      - Cloud Run container unhealthy / cold-start storm after a deploy.
      - Upstream Google service outage.

      **Runbook:**
      1. `gcloud run services logs read praeventio-app --limit=50 --region=southamerica-west1`
      2. GCP Console → Firestore → Usage. Confirm read/write quota headroom.
      3. https://status.cloud.google.com/ — check Cloud Run + Firestore + LB regions.
      4. If LB is fan-out failing across regions → see DR_RUNBOOK.md §4.3 (failover).
      5. If error budget already spent for 7d → freeze deploys, page founder.
    EOT
    mime_type = "text/markdown"
  }

  user_labels = {
    slo      = "api-health-uptime"
    severity = "p1"
  }
}

# -----------------------------------------------------------------------------
# SLO #2 — Webpay return endpoint p95 latency < 5s over rolling 1-hour window
# -----------------------------------------------------------------------------
resource "google_monitoring_alert_policy" "webpay_latency_p95" {
  display_name = "SLO#2 — Webpay return p95 latency exceeds 5s"
  combiner     = "OR"
  enabled      = true

  conditions {
    display_name = "Webpay return p95 over 1h"

    condition_threshold {
      filter          = "metric.type=\"custom.googleapis.com/praeventio/webpay/return_outcome\" AND resource.type=\"global\""
      comparison      = "COMPARISON_GT"
      duration        = "600s"
      threshold_value = 5000 # ms; CALIBRATE — replace with histogram-backed metric once webpay/return latency histogram is live

      aggregations {
        alignment_period     = "60s"
        per_series_aligner   = "ALIGN_PERCENTILE_95"
        cross_series_reducer = "REDUCE_MAX"
      }
    }
  }

  notification_channels = local.default_notification_channels

  alert_strategy {
    auto_close = "1800s"
  }

  documentation {
    content = <<-EOT
      ## SLO #2 — Webpay return endpoint p95 latency

      **Target:** p95 < 5s rolling 1h. Above 5s users abandon checkout and
      revenue stops flowing.

      **Likely causes:**
      - Transbank Webpay slowness (their staging env can be glacial).
      - Our webpay return handler doing too much synchronous Firestore I/O.
      - Cold start on the Cloud Run instance handling the callback.

      **Runbook:**
      1. Check Webpay status: https://www.transbankdevelopers.cl/status
      2. Inspect recent traces: Console → Trace → filter `service=praeventio-app /webpay/return`.
      3. If our handler is slow → look for unbounded Firestore queries.
      4. Confirm minInstances ≥ 1 on Cloud Run (no cold starts on the revenue path).
      5. If sustained > 1h, post a status banner on the checkout page.

      **Note:** The threshold is currently bound to the
      `webpay/return_outcome` counter — once we emit a real histogram metric
      `praeventio/webpay/return_latency_ms`, switch the filter and drop the
      ms-vs-count caveat. Tracked as TODO in MONITORING.md.
    EOT
    mime_type = "text/markdown"
  }

  user_labels = {
    slo      = "webpay-latency-p95"
    severity = "p2"
  }
}

# -----------------------------------------------------------------------------
# SLO #3 — Health Connect adapter success rate ≥ 95% over 1-day window
# -----------------------------------------------------------------------------
resource "google_monitoring_alert_policy" "health_connect_success_rate" {
  display_name = "SLO#3 — Health Connect sync success rate below 95% (1d)"
  combiner     = "OR"
  enabled      = true

  conditions {
    display_name = "Health Connect failure rate over 1d"

    condition_threshold {
      # Fail-rate proxy: alert if >5% of attempts fail in any 1h window. The
      # 1d SLO is computed separately as a burn-rate batch job.
      filter          = "metric.type=\"custom.googleapis.com/praeventio/health_connect/sync\" AND metric.label.\"outcome\"=\"failure\" AND resource.type=\"global\""
      comparison      = "COMPARISON_GT"
      duration        = "3600s" # 1h sustained
      threshold_value = 0.05    # 5% failure budget per hour — CALIBRATE

      aggregations {
        alignment_period     = "300s"
        per_series_aligner   = "ALIGN_RATE"
        cross_series_reducer = "REDUCE_SUM"
        group_by_fields      = ["metric.label.provider"]
      }
    }
  }

  notification_channels = local.default_notification_channels

  alert_strategy {
    auto_close = "3600s"
  }

  documentation {
    content = <<-EOT
      ## SLO #3 — Health Connect adapter success rate

      **Target:** ≥ 95% successful syncs over rolling 24h.

      **Likely causes:**
      - Google Health Connect API quota exhausted.
      - Apple HealthKit deprecation broke the iOS path.
      - Our adapter chose a stale OAuth token (refresh-token bug).
      - User revoked permissions en masse after a privacy news cycle.

      **Runbook:**
      1. Check both providers separately — group_by `provider` shows iOS vs
         Android failure rates. Diverging → platform-specific bug.
      2. See HEALTH_CONNECT_MIGRATION.md §6 for token refresh handling.
      3. If iOS-only spike → check for iOS app version regression.
      4. If both → check Google + Apple status pages.
    EOT
    mime_type = "text/markdown"
  }

  user_labels = {
    slo      = "health-connect-success-rate"
    severity = "p2"
  }
}

# -----------------------------------------------------------------------------
# SLO #4 — Calendar predictions p99 latency < 10s over 1-day window
# -----------------------------------------------------------------------------
resource "google_monitoring_alert_policy" "calendar_prediction_p99" {
  display_name = "SLO#4 — Calendar prediction p99 latency exceeds 10s"
  combiner     = "OR"
  enabled      = true

  conditions {
    display_name = "predictUpcomingActivities p99 over 1d"

    condition_threshold {
      filter          = "metric.type=\"custom.googleapis.com/praeventio/calendar/prediction_latency_ms\" AND resource.type=\"global\""
      comparison      = "COMPARISON_GT"
      duration        = "1800s" # 30 min sustained
      threshold_value = 10000   # 10s — CALIBRATE; cold-starts on Vertex push this up

      aggregations {
        alignment_period     = "300s"
        per_series_aligner   = "ALIGN_PERCENTILE_99"
        cross_series_reducer = "REDUCE_MAX"
      }
    }
  }

  notification_channels = local.default_notification_channels

  alert_strategy {
    auto_close = "3600s"
  }

  documentation {
    content = <<-EOT
      ## SLO #4 — Calendar prediction p99 latency

      **Target:** p99 < 10s rolling 24h. Users actively wait on this call.

      **Likely causes:**
      - Vertex AI cold start (first call after >5min idle is ~6-8s).
      - Vertex region outage.
      - Our prompt got too long after a refactor (token count creep).
      - Firestore lookups for IPER/calendar context exceeded 8s budget.

      **Runbook:**
      1. Console → Trace → filter `service=praeventio-app /api/calendar/predict`.
      2. Check Vertex AI region health.
      3. See VERTEX_MIGRATION.md §3 for prompt length budget.
      4. If sustained: degrade to cached-prediction mode (feature flag
         `CALENDAR_PREDICT_FALLBACK=cache`).
    EOT
    mime_type = "text/markdown"
  }

  user_labels = {
    slo      = "calendar-prediction-p99"
    severity = "p2"
  }
}

# -----------------------------------------------------------------------------
# SLO #5 (bonus) — Firestore backup age < 36h
# -----------------------------------------------------------------------------
# The nightly backup job (scheduler.tf) writes its success timestamp into a
# log entry; we use a log-based metric on that entry to measure freshness.
resource "google_logging_metric" "firestore_backup_completed" {
  name        = "firestore_backup_completed"
  description = "Increments each time the nightly Firestore backup Cloud Run job logs a SUCCESS entry."

  filter = <<-EOT
    resource.type="cloud_run_job"
    resource.labels.job_name=~"firestore-backup.*"
    severity>=NOTICE
    jsonPayload.event="backup.completed"
  EOT

  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "INT64"
    unit        = "1"
  }
}

resource "google_monitoring_alert_policy" "firestore_backup_age" {
  display_name = "SLO#5 — Firestore backup absent for > 36h"
  combiner     = "OR"
  enabled      = true

  conditions {
    display_name = "No backup-completed log entry in the last 36h"

    # Absence condition: zero events in a 36h window means the nightly
    # cron skipped two consecutive runs (24h spacing) — investigate.
    condition_absent {
      filter   = "metric.type=\"logging.googleapis.com/user/${google_logging_metric.firestore_backup_completed.name}\" AND resource.type=\"cloud_run_job\""
      duration = "129600s" # 36h

      aggregations {
        alignment_period     = "3600s"
        per_series_aligner   = "ALIGN_SUM"
        cross_series_reducer = "REDUCE_SUM"
      }
    }
  }

  notification_channels = local.security_notification_channels

  alert_strategy {
    auto_close = "86400s" # 24h
  }

  documentation {
    content = <<-EOT
      ## SLO #5 (bonus) — Firestore backup freshness

      **Target:** A successful backup must complete every 36h. The nightly
      cron runs every 24h (see scheduler.tf), so 36h gives one missed run
      of slack.

      **Likely causes:**
      - Cloud Scheduler invocation failed (auth, quota).
      - Cloud Run job ran but failed silently (out-of-memory, timeout).
      - Firestore export quota (default: 1 export/min, 50/day).
      - Backup bucket retention policy lock prevented the upload.

      **Runbook:**
      1. Console → Cloud Run → firestore-backup → Executions → most recent.
      2. Check Cloud Scheduler invocation history.
      3. Re-run manually: `gcloud run jobs execute firestore-backup --region=southamerica-west1`.
      4. See DR_RUNBOOK.md §2 for restore-from-backup procedure if a real
         outage requires one before this is fixed.
    EOT
    mime_type = "text/markdown"
  }

  user_labels = {
    slo      = "firestore-backup-age"
    severity = "p1"
  }
}

# -----------------------------------------------------------------------------
# SLO #6 (bonus) — KMS error rate < 1% over rolling 1-hour window
# -----------------------------------------------------------------------------
resource "google_monitoring_alert_policy" "kms_error_rate" {
  display_name = "SLO#6 — KMS error rate exceeds 1% (1h)"
  combiner     = "OR"
  enabled      = true

  conditions {
    display_name = "KMS error counter / total counter > 1%"

    condition_threshold {
      filter          = "metric.type=\"custom.googleapis.com/praeventio/kms/operations\" AND metric.label.\"outcome\"=\"error\" AND resource.type=\"global\""
      comparison      = "COMPARISON_GT"
      duration        = "600s" # 10 min sustained
      threshold_value = 0.01   # 1% — CALIBRATE; KMS is normally ~0% errors

      aggregations {
        alignment_period     = "60s"
        per_series_aligner   = "ALIGN_RATE"
        cross_series_reducer = "REDUCE_SUM"
      }
    }
  }

  notification_channels = local.security_notification_channels

  alert_strategy {
    auto_close = "1800s"
  }

  documentation {
    content = <<-EOT
      ## SLO #6 (bonus) — KMS error rate

      **Target:** < 1% errored encrypt/decrypt operations rolling 1h. KMS
      misconfig (wrong key resource, missing IAM, key disabled) is the
      single most common reason logins start 500-ing.

      **Likely causes:**
      - The `oauth-tokens-kek` key was rotated and the app cached a stale resource name.
      - Cloud Run service account lost `roles/cloudkms.cryptoKeyEncrypterDecrypter`.
      - Key disabled accidentally (panic-button used in incident response).
      - KMS regional outage (rare).

      **Runbook:**
      1. Check the alerted KMS resource: `gcloud kms keys describe oauth-tokens-kek --keyring=praeventio --location=southamerica-west1`.
      2. Verify SA binding: `gcloud kms keys get-iam-policy <key>`.
      3. See KMS_ROTATION.md §4 for the rotation race condition + cache-bust.
      4. If a key is disabled accidentally: re-enable + force a deploy to
         flush in-process cache.
      5. **Do not** silently downgrade to in-memory KEK. The KMS adapter
         intentionally refuses fall-back (see security_spec.md).
    EOT
    mime_type = "text/markdown"
  }

  user_labels = {
    slo      = "kms-error-rate"
    severity = "p1"
  }
}

# =============================================================================
# Dashboards
# =============================================================================
# JSON sources live in dashboards/*.json so they round-trip through the
# Cloud Console "Export JSON" / "Import JSON" tooling without modification.

resource "google_monitoring_dashboard" "operational" {
  dashboard_json = file("${path.module}/dashboards/operational.json")
}

resource "google_monitoring_dashboard" "business" {
  dashboard_json = file("${path.module}/dashboards/business.json")
}
