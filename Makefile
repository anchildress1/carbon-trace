.PHONY: install dev format format-check lint typecheck unit test build e2e perf secret-scan deploy clean ai-checks

# Install all dependencies
install:
	@echo "Installing dependencies..."
	pnpm install

# Start development server
dev:
	@echo "Starting development server..."
	pnpm dev

# Format code
format:
	@echo "Formatting code..."
	pnpm format

# Check formatting (non-destructive, for CI)
format-check:
	@echo "Checking formatting..."
	pnpm format:check

# Lint code
lint:
	@echo "Linting code..."
	pnpm lint

# Type check (no-op: vanilla JS project)
typecheck:
	@echo "Skipping type check (vanilla JS project)."

# Run unit tests only
unit:
	@echo "Running unit tests..."
	pnpm test

# Production build
build:
	@echo "Building project..."
	pnpm build

# Run Playwright E2E tests (builds first so preview server serves current source)
e2e: build
	@echo "Running E2E tests..."
	pnpm e2e

# Run performance / Lighthouse tests (builds first so preview server serves current source)
perf: build
	@echo "Running performance tests..."
	pnpm perf

# Run all tests: unit in parallel with e2e, then perf sequentially.
# Lighthouse and Playwright both use Chrome and contend for ports/profiles
# when run simultaneously, so perf must run after e2e finishes.
test: build
	@echo "Running unit + E2E tests, then performance tests..."
	@FAIL=0; \
		pnpm test & UNIT_PID=$$!; \
		pnpm e2e & E2E_PID=$$!; \
		wait $$UNIT_PID || { echo "FAIL: unit tests failed"; FAIL=1; }; \
		wait $$E2E_PID || { echo "FAIL: E2E tests failed"; FAIL=1; }; \
		if [ $$FAIL -ne 0 ]; then exit 1; fi; \
		pnpm perf || { echo "FAIL: performance tests failed"; exit 1; }

# Scan for secrets
secret-scan:
	@echo "Scanning for secrets..."
	@set -eu; \
	TMP_BASELINE=".secrets.baseline.tmp"; \
	TMP_BASELINE_CHECK=".secrets.baseline.check.tmp"; \
	PY_SCAN_ENV=""; \
	cleanup_scan_env() { \
		rm -f "$$TMP_BASELINE" "$$TMP_BASELINE_CHECK"; \
		if [ -n "$$PY_SCAN_ENV" ] && [ -d "$$PY_SCAN_ENV" ]; then rm -rf "$$PY_SCAN_ENV"; fi; \
	}; \
	trap cleanup_scan_env EXIT INT TERM; \
	run_detect_secrets() { \
		if command -v uvx >/dev/null; then \
			uvx --from detect-secrets==1.5.0 detect-secrets "$$@"; \
		elif command -v detect-secrets >/dev/null; then \
			detect-secrets "$$@"; \
		elif command -v python3 >/dev/null; then \
			if [ -z "$$PY_SCAN_ENV" ]; then \
				PY_SCAN_ENV="$$(mktemp -d "$${TMPDIR:-/tmp}/detect-secrets.XXXXXX")"; \
				python3 -m venv "$$PY_SCAN_ENV"; \
				"$$PY_SCAN_ENV/bin/pip" install --quiet --upgrade pip >/dev/null; \
				"$$PY_SCAN_ENV/bin/pip" install --quiet detect-secrets==1.5.0 >/dev/null; \
			fi; \
			"$$PY_SCAN_ENV/bin/detect-secrets" "$$@"; \
		else \
			echo "No supported detect-secrets runner found (requires uvx, detect-secrets, or python3)."; \
			return 127; \
		fi; \
	}; \
	SCAN_EXIT=0; \
	run_detect_secrets scan --exclude-files 'node_modules|dist|.secrets.baseline|.secrets.baseline.tmp|.secrets.baseline.check.tmp' > "$$TMP_BASELINE" 2>&1 || SCAN_EXIT=$$?; \
	if [ "$$SCAN_EXIT" -ne 0 ]; then \
		echo "detect-secrets scan failed with exit $$SCAN_EXIT." >&2; \
		cat "$$TMP_BASELINE" >&2; \
		exit "$$SCAN_EXIT"; \
	fi; \
	if [ ! -s "$$TMP_BASELINE" ]; then \
		echo "detect-secrets scan did not produce output." >&2; \
		exit 1; \
	fi; \
	if ! jq -e '.results != null' "$$TMP_BASELINE" >/dev/null 2>&1; then \
		echo "detect-secrets scan output is not valid JSON." >&2; \
		cat "$$TMP_BASELINE" >&2; \
		exit 1; \
	fi; \
	if [ -f .secrets.baseline ]; then \
		echo "Checking against baseline..."; \
		BASELINE_SCAN_EXIT=0; \
		run_detect_secrets scan --baseline .secrets.baseline --exclude-files 'node_modules|dist' > "$$TMP_BASELINE_CHECK" 2>&1 || BASELINE_SCAN_EXIT=$$?; \
		if [ "$$BASELINE_SCAN_EXIT" -ne 0 ]; then \
			echo "detect-secrets baseline diff scan failed with exit $$BASELINE_SCAN_EXIT." >&2; \
			cat "$$TMP_BASELINE_CHECK" >&2; \
			exit "$$BASELINE_SCAN_EXIT"; \
		fi; \
		if [ -s "$$TMP_BASELINE_CHECK" ]; then \
			if ! jq -e '.results != null' "$$TMP_BASELINE_CHECK" >/dev/null 2>&1; then \
				echo "detect-secrets baseline diff output is not valid JSON." >&2; \
				cat "$$TMP_BASELINE_CHECK" >&2; \
				exit 1; \
			fi; \
			NEW_SECRETS=$$(jq '[.results[]? | length] | add // 0' "$$TMP_BASELINE_CHECK"); \
			if [ "$${NEW_SECRETS:-0}" -gt 0 ]; then \
				echo "New secrets found! Run 'detect-secrets audit .secrets.baseline' to review."; \
				jq '.results' "$$TMP_BASELINE_CHECK"; \
				exit 1; \
			fi; \
		fi; \
		echo "No new secrets found. Updating baseline timestamp."; \
		mv "$$TMP_BASELINE" .secrets.baseline; \
	else \
		mv "$$TMP_BASELINE" .secrets.baseline; \
		echo "Secrets baseline created at .secrets.baseline"; \
	fi

# Deploy to Cloud Run
deploy:
	@echo "Deploying to Cloud Run..."
	./deploy.sh

# Remove build artifacts and dependencies
clean:
	@echo "Cleaning up..."
	rm -rf node_modules dist coverage playwright-report playwright-results .lighthouseci .secrets.baseline.tmp
	@echo "Clean complete."

# Run all AI required checks
ai-checks: secret-scan format-check lint
	@echo "AI checks passed!"
