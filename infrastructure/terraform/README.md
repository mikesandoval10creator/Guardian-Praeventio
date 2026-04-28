# Praeventio Guard — GCP Infrastructure (Terraform)

This module codifies the GCP infrastructure for Praeventio Guard so that
bootstrapping a new environment (or rebuilding prod after a meteor strike) is a
`terraform apply` instead of a 90-minute Console click-fest.

It complements the manual provisioning the founder is doing in parallel:

- KMS keyring + OAuth-tokens KEK (this module owns it)
- OAuth client (manual — Console, see below)
- Marketplace developer account (manual)
- Domain verification (manual)

## Bootstrap (one-time)

1. Install Terraform 1.6+:
   - macOS: `brew install terraform`
   - Windows: `choco install terraform`
   - Linux: see https://developer.hashicorp.com/terraform/install
2. Authenticate to GCP:
   ```sh
   gcloud auth application-default login
   ```
3. Set the active project:
   ```sh
   gcloud config set project praeventio-prod
   ```
4. Enable the APIs Terraform needs:
   ```sh
   gcloud services enable cloudkms.googleapis.com
   gcloud services enable iam.googleapis.com
   gcloud services enable storage.googleapis.com
   gcloud services enable cloudscheduler.googleapis.com
   gcloud services enable run.googleapis.com
   gcloud services enable secretmanager.googleapis.com
   gcloud services enable firestore.googleapis.com
   gcloud services enable cloudresourcemanager.googleapis.com
   ```

## Daily workflow

```sh
cd infrastructure/terraform
cp example.tfvars terraform.tfvars   # first time only; edit values
terraform init
terraform plan
terraform apply
```

Re-run `terraform plan` whenever you change a `.tf` file. `terraform apply`
will only mutate cloud state when the plan shows a non-empty diff.

## Outputs

After apply, retrieve outputs to wire into Cloud Run env vars:

```sh
terraform output kms_key_resource_name
terraform output backups_bucket
terraform output app_runtime_sa
terraform output firestore_backup_sa
```

Set these in your Cloud Run service env (or in `.env.local` for development).

## Manual provisioning steps

The following cannot be Terraform-ified cleanly — they require browser
interaction, KYC, or Apple/Google identity flows:

- **OAuth Consent Screen submission** — GCP Console → APIs & Services → OAuth
  Consent. App publishing requires a video walkthrough that Google reviews.
- **OAuth client credentials** — Console → APIs & Services → Credentials →
  Create OAuth Client ID. Download the JSON, store it in Secret Manager:
  ```sh
  gcloud secrets versions add oauth-client-secret --data-file=client.json
  ```
- **Marketplace SDK App configuration** — Console → APIs & Services →
  Marketplace SDK. Logos, screenshots, EULA, privacy policy.
- **Domain verification** — Search Console.
- **Apple Developer enrollment** — developer.apple.com (annual fee, KYC).
- **Webpay commerce code** — Transbank KYC (Chilean tax ID required).

## Secret values

This Terraform creates Secret Manager **secrets** but not their **versions**.
Add values manually after apply:

```sh
echo -n "$(openssl rand -base64 48)"     | gcloud secrets versions add session-secret      --data-file=-
echo -n "$(openssl rand -base64 32)"     | gcloud secrets versions add iot-webhook-secret  --data-file=-
echo -n "<webpay-key-from-transbank>"    | gcloud secrets versions add webpay-api-key      --data-file=-
echo -n "<openweather-key>"              | gcloud secrets versions add openweather-api-key --data-file=-
echo -n "<sentry-dsn>"                   | gcloud secrets versions add sentry-dsn          --data-file=-
echo -n "<resend-key>"                   | gcloud secrets versions add resend-api-key      --data-file=-
echo -n "<gemini-key>"                   | gcloud secrets versions add gemini-api-key      --data-file=-
```

## State management

- **Default**: local backend. State lives in
  `infrastructure/terraform/terraform.tfstate`. Fine for solo development.
- **Production**: uncomment the GCS backend block in `main.tf` and create the
  state bucket FIRST:
  ```sh
  gcloud storage buckets create gs://praeventio-tfstate \
    --uniform-bucket-level-access \
    --location=southamerica-west1 \
    --public-access-prevention
  gcloud storage buckets update gs://praeventio-tfstate --versioning
  ```
  Then `terraform init -migrate-state` to move local state to GCS.
- **Never commit `*.tfstate`** — handled by `.gitignore`. State may contain
  plaintext values that were pulled into state during apply.

## Rollback

```sh
terraform plan -destroy                     # preview
terraform destroy -target=resource.address  # surgical
```

KMS keys, the backups bucket, and Secret Manager secrets carry
`prevent_destroy = true`. To intentionally destroy them, edit the resource
block to remove the `lifecycle` constraint, run `terraform apply` to register
the change, then `terraform destroy -target=...`. This friction is intentional.

## Cost estimate

| Component            | Pricing                                     | Monthly @ small scale |
| -------------------- | ------------------------------------------- | --------------------- |
| Cloud KMS            | $0.06/key/month + $0.03/10k operations      | ~$1                   |
| GCS (Standard 30d → Nearline 365d) | ~$0.02/GB hot, ~$0.01/GB cold | ~$1 (single-digit GB) |
| Cloud Scheduler      | $0.10/job/month × 2 jobs                    | $0.20                 |
| Cloud Run jobs       | pay-per-invocation, ~$0.01/run              | ~$0.30 (30 nights)    |
| Secret Manager       | $0.06/secret/month × 8 secrets              | $0.48                 |
| **Total infra**      |                                             | **<$10/month**        |

Source: https://cloud.google.com/pricing — verify before committing to a
budget; pricing changes more than the GCP team's marketing copy admits.

## Related

- `../cloud-scheduler.yaml` — earlier YAML stub, now superseded by this module.
  Kept as documentation; the `.tf` files are the source of truth.
- `../../scripts/backup-firestore.cjs` — code that runs inside the nightly job.
- `../../scripts/test-backup-integrity.cjs` — code that runs inside the weekly
  integrity check.
- `../../docs/KMS_ROTATION.md` — what to do when the 90-day rotation fires.
- `../../docs/DR_RUNBOOK.md` — how to restore from one of these backups.
