#!/usr/bin/env bash
# Deploy from the dev machine: ./deploy.sh [deploy|status|rollback]
# Settings: deploy/deploy.conf. Process: ~/work/deploy_kit (README.md).
exec "${DEPLOY_KIT:-$HOME/work/deploy_kit}/deploy.sh" "$(dirname "$0")" "$@"
