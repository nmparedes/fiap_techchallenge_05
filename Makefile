PROFILE ?=

.PHONY: require-profile k8s-check k8s-validate-static k8s-validate k8s-images k8s-secrets k8s-start k8s-status k8s-smoke k8s-stop

require-profile:
	@test -n "$(PROFILE)" || { echo "PROFILE is required, for example: make k8s-start PROFILE=fiap-x" >&2; exit 1; }

k8s-check: require-profile
	./scripts/k8s/prerequisites.sh --profile "$(PROFILE)"

k8s-validate-static:
	./scripts/k8s/static-validate.sh

k8s-validate: require-profile
	./scripts/k8s/validate.sh --profile "$(PROFILE)"

k8s-images: require-profile
	./scripts/k8s/images.sh --profile "$(PROFILE)"

k8s-secrets: require-profile
	./scripts/k8s/secrets.sh --profile "$(PROFILE)"

k8s-start: require-profile
	./scripts/k8s/start.sh --profile "$(PROFILE)"

k8s-status: require-profile
	./scripts/k8s/status.sh --profile "$(PROFILE)"

k8s-smoke: require-profile
	./scripts/k8s/smoke.sh --profile "$(PROFILE)"

k8s-stop: require-profile
	./scripts/k8s/stop.sh --profile "$(PROFILE)"
