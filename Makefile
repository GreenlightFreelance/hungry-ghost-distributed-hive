.PHONY: local-up local-down local-test local-logs local-status cdk-test

# Start the full local stack with LocalStack
local-up:
	docker compose -f docker-compose.localstack.yml up -d
	@echo "LocalStack available at http://localhost:4566"
	@echo "Run 'make local-logs' to view hive logs"

# Stop the local stack
local-down:
	docker compose -f docker-compose.localstack.yml down -v

# Run a local test: bring up stack, verify services, then tear down
local-test:
	docker compose -f docker-compose.localstack.yml up -d localstack setup
	@echo "Waiting for LocalStack setup..."
	docker compose -f docker-compose.localstack.yml wait setup
	@echo "Verifying DynamoDB table..."
	AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test \
		aws --endpoint-url=http://localhost:4566 --region af-south-1 \
		dynamodb describe-table --table-name distributed-hive-state --query 'Table.TableStatus' --output text
	@echo "Verifying SQS queue..."
	AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test \
		aws --endpoint-url=http://localhost:4566 --region af-south-1 \
		sqs get-queue-url --queue-name distributed-hive-runs --output text
	@echo "Verifying EventBridge bus..."
	AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test \
		aws --endpoint-url=http://localhost:4566 --region af-south-1 \
		events describe-event-bus --name distributed-hive-events --query 'Name' --output text
	@echo "All local services verified!"
	docker compose -f docker-compose.localstack.yml down -v

# View hive container logs
local-logs:
	docker compose -f docker-compose.localstack.yml logs -f hive

# Check status of local services
local-status:
	@docker compose -f docker-compose.localstack.yml ps
	@echo ""
	@echo "LocalStack health:"
	@curl -s http://localhost:4566/_localstack/health | python3 -m json.tool 2>/dev/null || echo "LocalStack not running"

# Run CDK infrastructure tests
cdk-test:
	cd infra/cdk && npm test
