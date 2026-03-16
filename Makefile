.PHONY: install dev format format-check lint typecheck unit test build e2e perf secret-scan clean

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

# Run all tests: build first, then unit + e2e + perf in parallel
test: build
	@echo "Running unit, E2E, and performance tests in parallel..."
	@FAIL=0; \
		pnpm test & UNIT_PID=$$!; \
		pnpm e2e & E2E_PID=$$!; \
		pnpm perf & PERF_PID=$$!; \
		wait $$UNIT_PID || FAIL=1; \
		wait $$E2E_PID || FAIL=1; \
		wait $$PERF_PID || FAIL=1; \
		if [ $$FAIL -ne 0 ]; then echo "Tests failed."; exit 1; fi

# Scan for secrets
secret-scan:
	@echo "Scanning for secrets..."
	@_run_scan() { \
		SCANNER="$$1"; \
		$$SCANNER scan --exclude-files 'node_modules|dist|.secrets.baseline|.secrets.baseline.tmp' > .secrets.baseline.tmp 2>&1 || true; \
		if [ ! -f .secrets.baseline.tmp ]; then \
			echo "detect-secrets scan did not produce output. Skipping."; \
			return 0; \
		fi; \
		if [ -f .secrets.baseline ]; then \
			echo "Checking against baseline..."; \
			NEW_SECRETS=$$($$SCANNER scan --baseline .secrets.baseline --exclude-files 'node_modules|dist' | jq '.results | length' 2>/dev/null || echo 0); \
			if [ "$${NEW_SECRETS:-0}" -gt 0 ]; then \
				echo "New secrets found! Run 'detect-secrets audit .secrets.baseline' to review."; \
				$$SCANNER scan --baseline .secrets.baseline --exclude-files 'node_modules|dist' | jq '.results'; \
				rm -f .secrets.baseline.tmp; \
				return 1; \
			else \
				echo "No new secrets found. Updating baseline timestamp."; \
				[ -f .secrets.baseline.tmp ] && mv .secrets.baseline.tmp .secrets.baseline || true; \
			fi; \
		else \
			[ -f .secrets.baseline.tmp ] && mv .secrets.baseline.tmp .secrets.baseline && echo "Secrets baseline created at .secrets.baseline" || echo "Could not create baseline."; \
		fi; \
	}; \
	if command -v uvx > /dev/null; then \
		_run_scan "uvx --from detect-secrets==1.5.0 detect-secrets" || exit 1; \
	elif command -v detect-secrets > /dev/null; then \
		_run_scan "detect-secrets" || exit 1; \
	else \
		echo "detect-secrets not found. Install via 'uv tool install detect-secrets' or 'pipx install detect-secrets'."; \
		exit 1; \
	fi

# Remove build artifacts and dependencies
clean:
	@echo "Cleaning up..."
	rm -rf node_modules dist coverage playwright-report playwright-results .lighthouseci .secrets.baseline.tmp
	@echo "Clean complete."
