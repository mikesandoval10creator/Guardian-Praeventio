# =============================================================================
# Praeventio Guard — Secret Manager
# =============================================================================
#
# Declares secret RESOURCES only. Values are NOT in Terraform — that would put
# plaintext secrets in state. Operators add versions out-of-band:
#
#   echo -n "my-secret-value" | gcloud secrets versions add session-secret \
#     --project=praeventio-prod --data-file=-
#
# The app-runtime SA receives roles/secretmanager.secretAccessor on each
# secret (granted at the secret level, not the project, for least privilege).
#
# Docs: https://cloud.google.com/secret-manager/docs
# =============================================================================

resource "google_secret_manager_secret" "app_secrets" {
  for_each = toset(var.secret_ids)

  secret_id = each.value

  replication {
    auto {}
  }

  labels = var.labels

  lifecycle {
    # Don't accidentally delete a secret that has live versions in use.
    prevent_destroy = true
  }
}

# Grant read access to the application runtime SA on every secret.
resource "google_secret_manager_secret_iam_member" "app_runtime_accessor" {
  for_each = google_secret_manager_secret.app_secrets

  secret_id = each.value.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.app_runtime.email}"
}
