# =============================================================================
# Praeventio Guard — Typed input variables
# =============================================================================

variable "project_id" {
  type        = string
  description = "GCP project ID that owns the application resources (e.g. \"praeventio-prod\")."
}

variable "region" {
  type        = string
  default     = "southamerica-west1"
  description = "Default GCP region. Must match Firestore region for cheap intra-region backup transfers."
}

variable "environment" {
  type        = string
  default     = "prod"
  description = "Deployment environment. One of: prod | staging | dev."

  validation {
    condition     = contains(["prod", "staging", "dev"], var.environment)
    error_message = "environment must be one of: prod, staging, dev."
  }
}

variable "app_domain" {
  type        = string
  default     = "praeventio.net"
  description = "Primary application domain. Used in OAuth redirect URIs and notification templates."
}

variable "labels" {
  type        = map(string)
  description = "Labels applied to every resource that supports them."
  default = {
    app         = "praeventio-guard"
    environment = "prod"
    managed_by  = "terraform"
  }
}

# -----------------------------------------------------------------------------
# KMS
# -----------------------------------------------------------------------------
variable "kms_key_rotation_period" {
  type        = string
  default     = "7776000s" # 90 days
  description = "Crypto key automatic rotation period. Format: <int>s. 90d is the recommended default for symmetric KEKs."
}

# -----------------------------------------------------------------------------
# Storage
# -----------------------------------------------------------------------------
variable "backups_bucket_name_override" {
  type        = string
  default     = ""
  description = "Optional override for the backups bucket name. Defaults to \"<project_id>-backups\" when empty."
}

variable "backups_retention_days" {
  type        = number
  default     = 365
  description = "Days to retain Firestore backup objects before lifecycle delete."
}

variable "backups_nearline_after_days" {
  type        = number
  default     = 30
  description = "Days after which backup objects transition from STANDARD to NEARLINE."
}

variable "backups_min_retention_seconds" {
  type        = number
  default     = 86400 # 1 day
  description = "Bucket retention policy floor. Regulatory ankle that prevents accidental delete-within-the-hour."
}

# -----------------------------------------------------------------------------
# Cloud Run jobs
# -----------------------------------------------------------------------------
variable "backup_image" {
  type        = string
  default     = ""
  description = "Container image for backup + integrity check Cloud Run jobs. Defaults to \"gcr.io/<project_id>/firestore-backup:latest\" when empty."
}

variable "backup_job_timeout_seconds" {
  type        = number
  default     = 3600
  description = "Cloud Run job task timeout for the nightly backup. The script polls a long-running export op for up to ~50 min."
}

variable "integrity_job_timeout_seconds" {
  type        = number
  default     = 600
  description = "Cloud Run job task timeout for the weekly integrity check."
}

# -----------------------------------------------------------------------------
# Cloud Scheduler
# -----------------------------------------------------------------------------
variable "nightly_backup_schedule" {
  type        = string
  default     = "0 3 * * *"
  description = "Cron expression (UTC) for the nightly Firestore export. 03:00 UTC ≈ 23:00 CLT (off-peak)."
}

variable "integrity_check_schedule" {
  type        = string
  default     = "0 4 * * 0"
  description = "Cron expression (UTC) for the weekly backup integrity check. Sunday 04:00 UTC, after Saturday's backup."
}

variable "scheduler_time_zone" {
  type        = string
  default     = "Etc/UTC"
  description = "IANA timezone name used by Cloud Scheduler. Cron expressions are interpreted in this zone."
}

# -----------------------------------------------------------------------------
# Secret Manager
# -----------------------------------------------------------------------------
variable "secret_ids" {
  type        = list(string)
  description = "Secret Manager secret IDs to provision. Values are NOT managed by Terraform; add them with `gcloud secrets versions add ...`."
  default = [
    "session-secret",
    "iot-webhook-secret",
    "webpay-api-key",
    "openweather-api-key",
    "sentry-dsn",
    "resend-api-key",
    "gemini-api-key",
    "oauth-client-secret",
  ]
}
