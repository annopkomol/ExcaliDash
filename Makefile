.PHONY: canvas canvas-fresh canvas-ts deploy

# No-auth dev stack + blank drawing URL, auto-pulling origin/main while it runs.
canvas:
	node scripts/dev-canvas.mjs

# Same, with the local dev database wiped first.
canvas-fresh:
	rm -rf .dev-local
	node scripts/dev-canvas.mjs

# Same, but reachable from other tailnet devices (e.g. iPhone). Binds to the
# Tailscale IP only, since auth is disabled.
canvas-ts:
	node scripts/dev-canvas.mjs --tailscale --no-open

# Build amd64 images, ship them to finnomena-vm and restart the stack there.
# Pass flags with ARGS, e.g. make deploy ARGS="--prune".
deploy:
	scripts/deploy-vm.sh $(ARGS)
