.PHONY: local-up local-down local-test local-logs local-restart local-status

COMPOSE_FILE := docker-compose.local.yml

## Start LocalStack, Hive container (LOCAL_MODE=true), and web dashboard
local-up:
	docker compose -f $(COMPOSE_FILE) up -d --build
	@echo ""
	@echo "Local stack is starting..."
	@echo "  LocalStack:  http://localhost:4566"
	@echo "  Dashboard:   http://localhost:3000"
	@echo ""
	@echo "Run 'make local-logs' to follow logs"
	@echo "Run 'make local-test' to submit a test requirement"

## Stop all local services and remove containers
local-down:
	docker compose -f $(COMPOSE_FILE) down -v

## Submit a test requirement and verify it processes
local-test:
	@echo "=== Checking LocalStack health ==="
	@curl -sf http://localhost:4566/_localstack/health | jq . || \
		(echo "ERROR: LocalStack is not running. Run 'make local-up' first." && exit 1)
	@echo ""
	@echo "=== Listing DynamoDB tables ==="
	@AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test \
		aws --endpoint-url=http://localhost:4566 --region us-east-1 \
		dynamodb list-tables
	@echo ""
	@echo "=== Sending test message to SQS ==="
	@AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test \
		aws --endpoint-url=http://localhost:4566 --region us-east-1 \
		sqs send-message \
		--queue-url http://localhost:4566/000000000000/distributed-hive-runs \
		--message-body '{"runId":"test-run-001","requirement":"Test requirement from make local-test","timestamp":"'"$$(date -u +%Y-%m-%dT%H:%M:%SZ)"'"}'
	@echo ""
	@echo "=== Verifying message in queue ==="
	@AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test \
		aws --endpoint-url=http://localhost:4566 --region us-east-1 \
		sqs get-queue-attributes \
		--queue-url http://localhost:4566/000000000000/distributed-hive-runs \
		--attribute-names ApproximateNumberOfMessages
	@echo ""
	@echo "=== Writing test item to DynamoDB ==="
	@AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test \
		aws --endpoint-url=http://localhost:4566 --region us-east-1 \
		dynamodb put-item \
		--table-name distributed-hive-state \
		--item '{"PK":{"S":"RUN#test-run-001"},"SK":{"S":"META"},"GSI1PK":{"S":"USER#local"},"GSI1SK":{"S":"RUN#test-run-001"},"GSI2PK":{"S":"STATUS#running"},"GSI2SK":{"S":"RUN#test-run-001"},"data":{"M":{"status":{"S":"running"},"title":{"S":"Local test"}}}}'
	@echo ""
	@echo "=== Scanning DynamoDB for run state ==="
	@AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test \
		aws --endpoint-url=http://localhost:4566 --region us-east-1 \
		dynamodb scan --table-name distributed-hive-state --max-items 5
	@echo ""
	@echo "=== Local test complete — all services operational ==="

## Follow logs from all local services
local-logs:
	docker compose -f $(COMPOSE_FILE) logs -f

## Restart all local services
local-restart: local-down local-up

## Show status of local services
local-status:
	docker compose -f $(COMPOSE_FILE) ps
