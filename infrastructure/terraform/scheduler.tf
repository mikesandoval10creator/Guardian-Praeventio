# =============================================================================
# Praeventio Guard — Cloud Scheduler
# =============================================================================
#
# Two HTTP cron jobs, each POSTs to the Cloud Run jobs v2 :run endpoint with
# OIDC auth. The target SA (firestore-backup) has roles/run.invoker, granted
# in iam.tf.
#
# IMPORTANT: the URI uses the v2 API. The v1 namespaces API
# (run.googleapis.com/apis/run.googleapis.com/v1/namespaces/...) is deprecated
# and was flagged by the reviewer last round.
#
# We use `oidc_token` (NOT `oauth_token`) because Cloud Run jobs require an
# identity token whose audience equals the :run URL. With OIDC, Scheduler
# mints the ID token automatically; the run.invoker IAM check happens against
# the token's signed-in identity (firestore-backup SA).
#
# v2 docs:        https://cloud.google.com/run/docs/execute/jobs#api
# Scheduler+OIDC: https://cloud.google.com/scheduler/docs/http-target-auth
# =============================================================================

resource "google_cloud_scheduler_job" "firestore_nightly_backup" {
  name        = "firestore-nightly-backup"
  region      = var.region
  description = "Nightly Firestore export to gs://${google_storage_bucket.backups.name}"
  schedule    = var.nightly_backup_schedule
  time_zone   = var.scheduler_time_zone

  retry_config {
    retry_count          = 2
    max_retry_duration   = "3600s"
    min_backoff_duration = "60s"
    max_backoff_duration = "600s"
  }

  http_target {
    http_method = "POST"
    uri         = "${local.cloud_run_jobs_v2_base}/${google_cloud_run_v2_job.firestore_nightly_backup.name}:run"

    oidc_token {
      service_account_email = google_service_account.firestore_backup.email
      # Audience must match the request URI (no query string) for the ID token
      # to validate against the Cloud Run jobs v2 endpoint.
      audience = "${local.cloud_run_jobs_v2_base}/${google_cloud_run_v2_job.firestore_nightly_backup.name}:run"
    }
  }

  depends_on = [
    google_project_iam_member.firestore_backup_run_invoker,
  ]
}

resource "google_cloud_scheduler_job" "firestore_backup_integrity_weekly" {
  name        = "firestore-backup-integrity-weekly"
  region      = var.region
  description = "Weekly check that latest Firestore backup is fresh + valid"
  schedule    = var.integrity_check_schedule
  time_zone   = var.scheduler_time_zone

  retry_config {
    retry_count          = 1
    min_backoff_duration = "60s"
    max_backoff_duration = "600s"
  }

  http_target {
    http_method = "POST"
    uri         = "${local.cloud_run_jobs_v2_base}/${google_cloud_run_v2_job.firestore_backup_integrity_check.name}:run"

    oidc_token {
      service_account_email = google_service_account.firestore_backup.email
      audience              = "${local.cloud_run_jobs_v2_base}/${google_cloud_run_v2_job.firestore_backup_integrity_check.name}:run"
    }
  }

  depends_on = [
    google_project_iam_member.firestore_backup_run_invoker,
  ]
}
