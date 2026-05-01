# =============================================================================
# Praeventio Guard — Example Terraform variables
# =============================================================================
# Copy to terraform.tfvars (gitignored) and edit:
#
#   cp example.tfvars terraform.tfvars
#
# DO NOT commit real values. The .gitignore in this directory ignores *.tfvars
# but allows example.tfvars through.
# =============================================================================

project_id  = "praeventio-prod"
region      = "southamerica-west1"
environment = "prod"
app_domain  = "praeventio.net"

labels = {
  app         = "praeventio-guard"
  environment = "prod"
  managed_by  = "terraform"
}

# Optional overrides (commented = use defaults from variables.tf)
# kms_key_rotation_period       = "7776000s"   # 90 days
# backups_retention_days        = 365
# backups_nearline_after_days   = 30
# backups_min_retention_seconds = 86400        # 1 day
# nightly_backup_schedule       = "0 3 * * *"
# integrity_check_schedule      = "0 4 * * 0"
# scheduler_time_zone           = "Etc/UTC"
# backup_image                  = "gcr.io/praeventio-prod/firestore-backup:latest"
