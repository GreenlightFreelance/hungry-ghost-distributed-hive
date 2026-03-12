#!/usr/bin/env bash
set -euo pipefail

PROFILE="${AWS_PROFILE:-hive}"
CDK_DIR="$(cd "$(dirname "$0")/../infra/cdk" && pwd)"

cd "$CDK_DIR"

echo "Installing dependencies..."
npm ci

echo "Synthesizing CDK templates..."
npx cdk synth --profile "$PROFILE"

echo "Deploying all stacks with --profile $PROFILE..."
npx cdk deploy --all --profile "$PROFILE" --require-approval broadening

echo "Deploy complete."
