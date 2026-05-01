# =============================================================================
# Praeventio Guard — Outputs
# =============================================================================
#
# Values consumed by the Cloud Run service env vars + the founder's
# .env.local for development against prod GCP. Retrieve with:
#
#   terraform output -raw kms_key_resource_name
#
# =============================================================================

output "kms_key_resource_name" {
  value       = google_kms_crypto_key.oauth_tokens_kek.id
  description = "Fully-qualified KMS key resource name. Set as KMS_KEY_RESOURCE_NAME env in Cloud Run."
}

output "kms_key_ring" {
  value       = google_kms_key_ring.praeventio.id
  description = "Fully-qualified KeyRing resource name."
}

output "backups_bucket" {
  value       = google_storage_bucket.backups.url
  description = "gs:// URL of the Firestore backups bucket. Set as GCS_BACKUP_BUCKET env."
}

output "backups_bucket_name" {
  value       = google_storage_bucket.backups.name
  description = "Bucket name without the gs:// prefix."
}

output "app_runtime_sa" {
  value       = google_service_account.app_runtime.email
  description = "Email of the app-runtime service account. Bind to your Cloud Run service."
}

output "firestore_backup_sa" {
  value       = google_service_account.firestore_backup.email
  description = "Email of the firestore-backup service account. Used by Cloud Run jobs + Cloud Scheduler."
}

output "kms_encrypter_sa" {
  value       = google_service_account.kms_encrypter.email
  description = "Email of the kms-encrypter service account. Used by one-off migration scripts."
}

output "secret_ids" {
  value       = [for s in google_secret_manager_secret.app_secrets : s.secret_id]
  description = "List of Secret Manager secret IDs that were provisioned. Add values with `gcloud secrets versions add ...`."
}

output "cloud_run_job_nightly_backup" {
  value       = google_cloud_run_v2_job.firestore_nightly_backup.name
  description = "Cloud Run job name for the nightly Firestore export."
}

output "cloud_run_job_integrity_check" {
  value       = google_cloud_run_v2_job.firestore_backup_integrity_check.name
  description = "Cloud Run job name for the weekly backup integrity check."
}
