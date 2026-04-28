# =============================================================================
# Praeventio Guard — Service accounts + project-level IAM
# =============================================================================
#
# Three SAs:
#   - firestore-backup   used by the nightly export Cloud Run job
#   - app-runtime        bound to the Cloud Run app at request time
#   - kms-encrypter      one-off migration scripts (envelope re-wrap, etc.)
#
# Round 2 will add:
#   - vertex-ai-runtime  for the upcoming Vertex AI integration (deferred)
#
# IAM doc reference: https://cloud.google.com/iam/docs/service-accounts
# =============================================================================

# -----------------------------------------------------------------------------
# firestore-backup
# -----------------------------------------------------------------------------
resource "google_service_account" "firestore_backup" {
  account_id   = "firestore-backup"
  display_name = "Firestore nightly backup"
  description  = "Used by backup-firestore.cjs and test-backup-integrity.cjs Cloud Run jobs"
}

# Required to call FirestoreAdminClient.exportDocuments / importDocuments.
resource "google_project_iam_member" "firestore_backup_export_admin" {
  project = var.project_id
  role    = "roles/datastore.importExportAdmin"
  member  = "serviceAccount:${google_service_account.firestore_backup.email}"
}

# Read-only Firestore access for the collection-count manifest step.
resource "google_project_iam_member" "firestore_backup_viewer" {
  project = var.project_id
  role    = "roles/datastore.viewer"
  member  = "serviceAccount:${google_service_account.firestore_backup.email}"
}

# Allows Cloud Scheduler (running as this same SA) to invoke the Cloud Run job.
resource "google_project_iam_member" "firestore_backup_run_invoker" {
  project = var.project_id
  role    = "roles/run.invoker"
  member  = "serviceAccount:${google_service_account.firestore_backup.email}"
}

# -----------------------------------------------------------------------------
# app-runtime
# -----------------------------------------------------------------------------
resource "google_service_account" "app_runtime" {
  account_id   = "app-runtime"
  display_name = "Praeventio app runtime"
  description  = "Bound to Cloud Run app service. Reads Firestore + KMS + Secret Manager at request time."
}

resource "google_project_iam_member" "app_runtime_datastore_user" {
  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.app_runtime.email}"
}

# Note: KMS encrypter/decrypter is granted at the KEY level in kms.tf, not
# here at the project level. Secret Manager accessor is granted per-secret in
# secrets.tf for the same reason (least privilege).

# -----------------------------------------------------------------------------
# kms-encrypter (one-off migration / re-wrap operations)
# -----------------------------------------------------------------------------
resource "google_service_account" "kms_encrypter" {
  account_id   = "kms-encrypter"
  display_name = "KMS migration runner"
  description  = "Used by one-off scripts that re-wrap envelope-encrypted material (e.g. migrate-oauth-tokens-to-envelope.cjs)."
}
