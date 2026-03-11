import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

export interface IamStackProps extends cdk.StackProps {
  tableName: string;
  eventBusName: string;
  clusterArn: string;
  taskDefinitionArn: string;
}

export class IamStack extends cdk.Stack {
  public readonly apiRole: iam.Role;

  constructor(scope: Construct, id: string, props: IamStackProps) {
    super(scope, id, props);

    // API Lambda Role: hive-api-role
    this.apiRole = new iam.Role(this, 'ApiRole', {
      roleName: 'hive-api-role',
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
    });

    // CloudWatch Logs for Lambda execution
    this.apiRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['logs:CreateLogGroup', 'logs:CreateLogStream', 'logs:PutLogEvents'],
        resources: ['arn:aws:logs:*:*:log-group:/aws/lambda/distributed-hive-*'],
      })
    );

    // DynamoDB: read/write state table
    this.apiRole.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          'dynamodb:PutItem',
          'dynamodb:GetItem',
          'dynamodb:Query',
          'dynamodb:Scan',
          'dynamodb:UpdateItem',
          'dynamodb:DeleteItem',
        ],
        resources: [
          cdk.Arn.format(
            { service: 'dynamodb', resource: 'table', resourceName: props.tableName },
            this
          ),
          cdk.Arn.format(
            { service: 'dynamodb', resource: 'table', resourceName: `${props.tableName}/index/*` },
            this
          ),
        ],
      })
    );

    // SQS: send messages to distributed-hive work queues
    this.apiRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['sqs:SendMessage', 'sqs:GetQueueAttributes'],
        resources: [cdk.Arn.format({ service: 'sqs', resource: 'distributed-hive-*' }, this)],
      })
    );

    // ECS: run, stop, and describe tasks
    this.apiRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['ecs:RunTask', 'ecs:StopTask', 'ecs:DescribeTasks'],
        resources: [props.clusterArn, props.taskDefinitionArn],
      })
    );

    // iam:PassRole: allow Lambda to pass the ECS task roles
    this.apiRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['iam:PassRole'],
        resources: [
          cdk.Arn.format(
            { service: 'iam', region: '', resource: 'role', resourceName: 'hive-execution-role' },
            this
          ),
          cdk.Arn.format(
            { service: 'iam', region: '', resource: 'role', resourceName: 'hive-task-role' },
            this
          ),
        ],
      })
    );

    // API Gateway: manage WebSocket connections
    this.apiRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['execute-api:ManageConnections'],
        resources: ['arn:aws:execute-api:*:*:*/@connections/*'],
      })
    );

    // Outputs
    new cdk.CfnOutput(this, 'ApiRoleArn', { value: this.apiRole.roleArn });
    new cdk.CfnOutput(this, 'ApiRoleName', { value: this.apiRole.roleName });
  }
}
