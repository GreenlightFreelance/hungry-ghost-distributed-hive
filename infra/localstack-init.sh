#!/bin/bash
set -euo pipefail

ENDPOINT="http://localhost:4566"
REGION="us-east-1"

echo "=== Initializing LocalStack resources ==="

# -------------------------------------------------------
# DynamoDB: distributed-hive-state table with GSIs
# -------------------------------------------------------
echo "Creating DynamoDB table: distributed-hive-state"
awslocal dynamodb create-table \
  --table-name distributed-hive-state \
  --attribute-definitions \
    AttributeName=PK,AttributeType=S \
    AttributeName=SK,AttributeType=S \
    AttributeName=GSI1PK,AttributeType=S \
    AttributeName=GSI1SK,AttributeType=S \
    AttributeName=GSI2PK,AttributeType=S \
    AttributeName=GSI2SK,AttributeType=S \
  --key-schema \
    AttributeName=PK,KeyType=HASH \
    AttributeName=SK,KeyType=RANGE \
  --global-secondary-indexes \
    '[
      {
        "IndexName": "userId-index",
        "KeySchema": [
          {"AttributeName": "GSI1PK", "KeyType": "HASH"},
          {"AttributeName": "GSI1SK", "KeyType": "RANGE"}
        ],
        "Projection": {"ProjectionType": "ALL"}
      },
      {
        "IndexName": "status-index",
        "KeySchema": [
          {"AttributeName": "GSI2PK", "KeyType": "HASH"},
          {"AttributeName": "GSI2SK", "KeyType": "RANGE"}
        ],
        "Projection": {"ProjectionType": "ALL"}
      }
    ]' \
  --billing-mode PAY_PER_REQUEST \
  --region "$REGION"

# Enable TTL on the table
awslocal dynamodb update-time-to-live \
  --table-name distributed-hive-state \
  --time-to-live-specification "Enabled=true,AttributeName=ttl" \
  --region "$REGION"

echo "DynamoDB table created successfully"

# -------------------------------------------------------
# SQS: Dead Letter Queue
# -------------------------------------------------------
echo "Creating SQS DLQ: distributed-hive-runs-dlq"
DLQ_URL=$(awslocal sqs create-queue \
  --queue-name distributed-hive-runs-dlq \
  --attributes '{"MessageRetentionPeriod": "1209600"}' \
  --region "$REGION" \
  --query 'QueueUrl' --output text)

DLQ_ARN=$(awslocal sqs get-queue-attributes \
  --queue-url "$DLQ_URL" \
  --attribute-names QueueArn \
  --region "$REGION" \
  --query 'Attributes.QueueArn' --output text)

echo "DLQ created: $DLQ_URL"

# -------------------------------------------------------
# SQS: Main queue with DLQ redrive policy
# -------------------------------------------------------
echo "Creating SQS queue: distributed-hive-runs"
awslocal sqs create-queue \
  --queue-name distributed-hive-runs \
  --attributes "{
    \"VisibilityTimeout\": \"900\",
    \"MessageRetentionPeriod\": \"1209600\",
    \"RedrivePolicy\": \"{\\\"deadLetterTargetArn\\\":\\\"${DLQ_ARN}\\\",\\\"maxReceiveCount\\\":\\\"3\\\"}\"
  }" \
  --region "$REGION"

echo "SQS queues created successfully"

# -------------------------------------------------------
# EventBridge: Event bus
# -------------------------------------------------------
echo "Creating EventBridge bus: distributed-hive-events"
awslocal events create-event-bus \
  --name distributed-hive-events \
  --region "$REGION"

echo "EventBridge bus created successfully"

# -------------------------------------------------------
# S3: Frontend bucket
# -------------------------------------------------------
echo "Creating S3 bucket: distributed-hive-frontend"
awslocal s3 mb s3://distributed-hive-frontend \
  --region "$REGION"

echo "S3 bucket created successfully"

# -------------------------------------------------------
# Secrets Manager: Placeholder secrets
# -------------------------------------------------------
echo "Creating placeholder secrets"
awslocal secretsmanager create-secret \
  --name hive/anthropic-api-key \
  --secret-string "sk-ant-local-test-key" \
  --region "$REGION" || true

awslocal secretsmanager create-secret \
  --name hive/github-token \
  --secret-string "ghp-local-test-token" \
  --region "$REGION" || true

echo "Secrets created successfully"

echo "=== LocalStack initialization complete ==="
echo ""
echo "Resources created:"
echo "  - DynamoDB table: distributed-hive-state (with userId-index, status-index GSIs)"
echo "  - SQS queue:      distributed-hive-runs (with DLQ, maxReceiveCount=3)"
echo "  - SQS DLQ:        distributed-hive-runs-dlq"
echo "  - EventBridge:    distributed-hive-events"
echo "  - S3 bucket:      distributed-hive-frontend"
echo "  - Secrets:        hive/anthropic-api-key, hive/github-token"
echo ""
echo "All services accessible at: $ENDPOINT"
