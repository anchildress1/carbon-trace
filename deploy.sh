#!/usr/bin/env bash
set -euo pipefail

# ─── Configuration ──────────────────────────────────────────────────────────────
SERVICE_NAME="carbon-trace-unstable"
REGION="us-east1"
PORT="8080"

# ─── Preflight checks ──────────────────────────────────────────────────────────
if ! command -v gcloud &> /dev/null; then
  echo "ERROR: gcloud CLI not found. Install from https://cloud.google.com/sdk/docs/install"
  exit 1
fi

PROJECT_ID=$(gcloud config get-value project 2>/dev/null)
if [ -z "$PROJECT_ID" ]; then
  echo "ERROR: No GCP project set. Run: gcloud config set project <PROJECT_ID>"
  exit 1
fi

echo "Deploying ${SERVICE_NAME} to project ${PROJECT_ID} in ${REGION}"
echo "──────────────────────────────────────────────────────────"

# ─── Enable required APIs ───────────────────────────────────────────────────────
echo "Enabling required GCP APIs..."
gcloud services enable \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  run.googleapis.com \
  --quiet

# ─── Artifact Registry ─────────────────────────────────────────────────────────
REPO_NAME="${SERVICE_NAME}"
REPO_PATH="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO_NAME}"

echo "Ensuring Artifact Registry repository exists..."
if ! gcloud artifacts repositories describe "${REPO_NAME}" \
  --location="${REGION}" --format="value(name)" &>/dev/null; then
  gcloud artifacts repositories create "${REPO_NAME}" \
    --repository-format=docker \
    --location="${REGION}" \
    --description="Docker images for ${SERVICE_NAME}" \
    --quiet
  echo "Created repository: ${REPO_NAME}"
else
  echo "Repository exists: ${REPO_NAME}"
fi

# ─── Build ──────────────────────────────────────────────────────────────────────
IMAGE="${REPO_PATH}/${SERVICE_NAME}:latest"
echo "Building image: ${IMAGE}"

gcloud builds submit \
  --tag "${IMAGE}" \
  --quiet

# ─── Deploy ─────────────────────────────────────────────────────────────────────
echo "Deploying to Cloud Run..."
gcloud run deploy "${SERVICE_NAME}" \
  --image "${IMAGE}" \
  --region "${REGION}" \
  --port "${PORT}" \
  --allow-unauthenticated \
  --cpu-boost \
  --quiet

# ─── Verify ─────────────────────────────────────────────────────────────────────
SERVICE_URL=$(gcloud run services describe "${SERVICE_NAME}" \
  --region="${REGION}" \
  --format="value(status.url)")

echo ""
echo "──────────────────────────────────────────────────────────"
echo "Deployed successfully!"
echo "  URL: ${SERVICE_URL}"
echo ""
echo "Smoke test:"
echo "  curl -s ${SERVICE_URL}/health"
echo "──────────────────────────────────────────────────────────"
