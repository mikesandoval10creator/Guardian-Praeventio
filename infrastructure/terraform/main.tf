# =============================================================================
# Praeventio Guard — Root Terraform module
# =============================================================================
#
# Codifies the GCP infrastructure that previously lived as manual Console clicks
# + the cloud-scheduler.yaml stub at infrastructure/cloud-scheduler.yaml.
#
# Resource layout (split across files for readability):
#   - kms.tf        KeyRing + OAuth-tokens KEK + IAM
#   - storage.tf    GCS backups bucket + lifecycle
#   - iam.tf        Service accounts + project-level IAM
#   - scheduler.tf  Cloud Scheduler triggers (nightly + weekly)
#   - cloudrun.tf   Cloud Run jobs (backup + integrity check)
#   - secrets.tf    Secret Manager declarations (no values committed)
#
# Provider docs:
#   https://registry.terraform.io/providers/hashicorp/google/latest/docs
# =============================================================================

provider "google" {
  project = var.project_id
  region  = var.region

  # Default labels applied to every resource that supports them. Individual
  # resources may merge additional labels on top of this map.
  default_labels = var.labels
}

provider "google-beta" {
  project = var.project_id
  region  = var.region

  default_labels = var.labels
}

# -----------------------------------------------------------------------------
# Backend stub. Local state is fine for solo development; flip to GCS for
# production so that `terraform apply` from CI does not race with the founder's
# laptop. Create the state bucket manually FIRST (see README §State management).
# -----------------------------------------------------------------------------
# terraform {
#   backend "gcs" {
#     bucket = "praeventio-tfstate"
#     prefix = "envs/prod"
#   }
# }

# -----------------------------------------------------------------------------
# Convenience local values used across modules.
# -----------------------------------------------------------------------------
locals {
  project_number_placeholder = "PROJECT_NUMBER" # filled by data source below

  # Cloud Run jobs v2 invocation URL. The v1 namespaces API is deprecated.
  # https://cloud.google.com/run/docs/execute/jobs#api
  cloud_run_jobs_v2_base = "https://run.googleapis.com/v2/projects/${var.project_id}/locations/${var.region}/jobs"
}

# Pull the current project so we can reference its numeric ID for default
# service-account bindings (e.g. the Compute Engine default SA).
data "google_project" "current" {}
