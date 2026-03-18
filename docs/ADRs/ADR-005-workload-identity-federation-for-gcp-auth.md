# ADR-005: Workload Identity Federation for GCP Authentication in CI

**Status:** Accepted
**Date:** March 18 2026
**Deciders:** Ashley Childress (@anchildress1)

## Context

The CI deploy workflow authenticates to GCP to build container images via Cloud Build
and deploy to Cloud Run. The initial implementation used a long-lived service account
JSON key stored as a GitHub secret (`GCP_SA_KEY`). A Copilot review comment on PR #9
flagged this as a security risk.

Long-lived SA keys:
- Remain valid until manually rotated or explicitly revoked
- Have a large blast radius if the secret is exfiltrated from GitHub
- Require manual rotation procedures to stay secure over time

## Decision

Switch to Workload Identity Federation (WIF) for GCP authentication in the deploy
workflow.

WIF allows GitHub Actions to exchange its OIDC token (a short-lived, workflow-scoped
JWT) for a GCP access token via a trusted identity provider. No long-lived credentials
are stored anywhere.

**Workflow changes:**
- Add `id-token: write` permission so the runner can request an OIDC token
- Replace `credentials_json` with `workload_identity_provider` and `service_account`
  in the `google-github-actions/auth` step

**Required GCP infrastructure (one-time setup per project):**
```bash
# Create the Workload Identity Pool
gcloud iam workload-identity-pools create "github-actions" \
  --location="global" \
  --display-name="GitHub Actions"

# Create the OIDC provider
gcloud iam workload-identity-pools providers create-oidc "github" \
  --location="global" \
  --workload-identity-pool="github-actions" \
  --issuer-uri="https://token.actions.githubusercontent.com" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository" \
  --attribute-condition="assertion.repository=='anchildress1/carbon-trace'"

# Grant the SA access via WIF
gcloud iam service-accounts add-iam-policy-binding "${SA_EMAIL}" \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/github-actions/attribute.repository/anchildress1/carbon-trace"
```

**Required GitHub secrets:**
- `GCP_WORKLOAD_IDENTITY_PROVIDER`: full provider resource name
  (`projects/<number>/locations/global/workloadIdentityPools/github-actions/providers/github`)
- `GCP_SERVICE_ACCOUNT`: service account email used for deployment

## Consequences

**Benefits:**
- Credentials are short-lived (expire with the workflow run)
- No long-lived keys to rotate or leak
- Follows Google's recommended authentication pattern for GitHub Actions

**Costs:**
- One-time GCP infra setup required before the workflow can run
- Two new GitHub secrets replace one (`GCP_SA_KEY` can be removed after WIF is set up)
- If the Workload Identity Pool or provider is misconfigured, all CI deploys fail
