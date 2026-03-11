import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { describe, it } from 'vitest';
import { ApiStack } from '../lib/api-stack';
import { EcsStack } from '../lib/ecs-stack';
import { SqsStack } from '../lib/sqs-stack';
import { StorageStack } from '../lib/storage-stack';
import { VpcStack } from '../lib/vpc-stack';

function createTestStacks() {
  const app = new cdk.App();
  const vpcStack = new VpcStack(app, 'TestVpc');
  const storageStack = new StorageStack(app, 'TestStorage', {
    vpc: vpcStack.vpc,
    fargateSecurityGroup: vpcStack.fargateSecurityGroup,
  });
  const ecsStack = new EcsStack(app, 'TestEcs', {
    vpc: vpcStack.vpc,
    fargateSecurityGroup: vpcStack.fargateSecurityGroup,
    fileSystem: storageStack.fileSystem,
    accessPoint: storageStack.accessPoint,
    table: storageStack.table,
    eventBusName: storageStack.eventBusName,
  });
  const sqsStack = new SqsStack(app, 'TestSqs');
  const apiStack = new ApiStack(app, 'TestApi', {
    table: storageStack.table,
    queue: sqsStack.queue,
    cluster: ecsStack.cluster,
    taskDefinition: ecsStack.taskDefinition,
    vpc: vpcStack.vpc,
    lambdaSecurityGroup: vpcStack.lambdaSecurityGroup,
    fargateSecurityGroup: vpcStack.fargateSecurityGroup,
    eventBusName: storageStack.eventBusName,
  });
  return { app, apiStack };
}

describe('ApiStack', () => {
  const { apiStack } = createTestStacks();
  const template = Template.fromStack(apiStack);

  describe('HTTP API', () => {
    it('creates distributed-hive-api HTTP API', () => {
      template.hasResourceProperties('AWS::ApiGatewayV2::Api', {
        Name: 'distributed-hive-api',
        ProtocolType: 'HTTP',
      });
    });

    it('configures CORS', () => {
      template.hasResourceProperties('AWS::ApiGatewayV2::Api', {
        CorsConfiguration: Match.objectLike({
          AllowMethods: Match.arrayWith(['GET', 'POST', 'PUT', 'DELETE']),
          AllowHeaders: Match.arrayWith(['Content-Type', 'Authorization', 'X-Api-Key']),
        }),
      });
    });
  });

  describe('REST Lambda Functions', () => {
    it('creates 11 REST handler functions', () => {
      template.resourceCountIs('AWS::Lambda::Function', 13); // 11 REST + ws-handler + broadcaster
    });

    it('creates createRun handler', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        FunctionName: 'distributed-hive-createRun',
        Runtime: 'nodejs20.x',
        Timeout: 30,
        MemorySize: 256,
      });
    });

    it('creates listRuns handler', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        FunctionName: 'distributed-hive-listRuns',
      });
    });

    it('creates getRun handler', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        FunctionName: 'distributed-hive-getRun',
      });
    });

    it('creates cancelRun handler', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        FunctionName: 'distributed-hive-cancelRun',
      });
    });

    it('creates getStories handler', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        FunctionName: 'distributed-hive-getStories',
      });
    });

    it('creates getAgents handler', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        FunctionName: 'distributed-hive-getAgents',
      });
    });

    it('creates getLogs handler', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        FunctionName: 'distributed-hive-getLogs',
      });
    });

    it('creates getPRs handler', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        FunctionName: 'distributed-hive-getPRs',
      });
    });

    it('creates sendMessage handler', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        FunctionName: 'distributed-hive-sendMessage',
      });
    });

    it('creates updateSettings handler', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        FunctionName: 'distributed-hive-updateSettings',
      });
    });

    it('creates getSettings handler', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        FunctionName: 'distributed-hive-getSettings',
      });
    });

    it('configures REST handlers with required environment variables', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        FunctionName: 'distributed-hive-createRun',
        Environment: {
          Variables: Match.objectLike({
            DYNAMODB_TABLE: Match.anyValue(),
            SQS_QUEUE_URL: Match.anyValue(),
            ECS_CLUSTER_ARN: Match.anyValue(),
            EVENTBRIDGE_BUS: 'distributed-hive-events',
          }),
        },
      });
    });
  });

  describe('HTTP API Routes', () => {
    it('creates routes for all 11 endpoints', () => {
      // Each route creates an AWS::ApiGatewayV2::Route
      template.resourceCountIs('AWS::ApiGatewayV2::Route', 14); // 11 REST + 3 WebSocket ($connect, $disconnect, subscribe)
    });

    it('creates POST /api/runs route', () => {
      template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
        RouteKey: 'POST /api/runs',
      });
    });

    it('creates GET /api/runs route', () => {
      template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
        RouteKey: 'GET /api/runs',
      });
    });

    it('creates GET /api/runs/{id} route', () => {
      template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
        RouteKey: 'GET /api/runs/{id}',
      });
    });

    it('creates DELETE /api/runs/{id} route', () => {
      template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
        RouteKey: 'DELETE /api/runs/{id}',
      });
    });

    it('creates GET /api/settings route', () => {
      template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
        RouteKey: 'GET /api/settings',
      });
    });

    it('creates PUT /api/settings route', () => {
      template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
        RouteKey: 'PUT /api/settings',
      });
    });
  });

  describe('WebSocket API', () => {
    it('creates distributed-hive-ws WebSocket API', () => {
      template.hasResourceProperties('AWS::ApiGatewayV2::Api', {
        Name: 'distributed-hive-ws',
        ProtocolType: 'WEBSOCKET',
      });
    });

    it('creates v1 stage with auto-deploy', () => {
      template.hasResourceProperties('AWS::ApiGatewayV2::Stage', {
        StageName: 'v1',
        AutoDeploy: true,
      });
    });

    it('creates $connect route', () => {
      template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
        RouteKey: '$connect',
      });
    });

    it('creates $disconnect route', () => {
      template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
        RouteKey: '$disconnect',
      });
    });

    it('creates subscribe route', () => {
      template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
        RouteKey: 'subscribe',
      });
    });

    it('creates ws-handler function', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        FunctionName: 'distributed-hive-ws-handler',
        Runtime: 'nodejs20.x',
        Timeout: 10,
        MemorySize: 128,
      });
    });
  });

  describe('WebSocket Broadcaster', () => {
    it('creates broadcaster function', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        FunctionName: 'distributed-hive-ws-broadcaster',
        Runtime: 'nodejs20.x',
        Timeout: 30,
        MemorySize: 256,
      });
    });

    it('configures broadcaster with WebSocket endpoint', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        FunctionName: 'distributed-hive-ws-broadcaster',
        Environment: {
          Variables: Match.objectLike({
            DYNAMODB_TABLE: Match.anyValue(),
            WEBSOCKET_ENDPOINT: Match.anyValue(),
          }),
        },
      });
    });
  });

  describe('IAM Roles', () => {
    it('creates API Lambda role', () => {
      template.hasResourceProperties('AWS::IAM::Role', {
        RoleName: 'hive-api-role',
        AssumeRolePolicyDocument: Match.objectLike({
          Statement: [
            Match.objectLike({
              Principal: { Service: 'lambda.amazonaws.com' },
            }),
          ],
        }),
      });
    });

    it('grants ECS RunTask permission', () => {
      template.hasResourceProperties('AWS::IAM::Policy', {
        PolicyDocument: Match.objectLike({
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: 'ecs:RunTask',
            }),
          ]),
        }),
      });
    });

    it('grants ECS StopTask permission', () => {
      template.hasResourceProperties('AWS::IAM::Policy', {
        PolicyDocument: Match.objectLike({
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: 'ecs:StopTask',
            }),
          ]),
        }),
      });
    });

    it('grants execute-api:ManageConnections to broadcaster', () => {
      template.hasResourceProperties('AWS::IAM::Policy', {
        PolicyDocument: Match.objectLike({
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: 'execute-api:ManageConnections',
            }),
          ]),
        }),
      });
    });
  });

  describe('CloudWatch Logs', () => {
    it('creates REST handler log group', () => {
      template.hasResourceProperties('AWS::Logs::LogGroup', {
        LogGroupName: '/lambda/distributed-hive-api',
        RetentionInDays: 14,
      });
    });

    it('creates WebSocket handler log group', () => {
      template.hasResourceProperties('AWS::Logs::LogGroup', {
        LogGroupName: '/lambda/distributed-hive-ws',
        RetentionInDays: 14,
      });
    });

    it('creates broadcaster log group', () => {
      template.hasResourceProperties('AWS::Logs::LogGroup', {
        LogGroupName: '/lambda/distributed-hive-broadcaster',
        RetentionInDays: 14,
      });
    });
  });

  describe('Outputs', () => {
    it('exports API URLs', () => {
      template.hasOutput('HttpApiUrl', {});
      template.hasOutput('WebSocketApiUrl', {});
      template.hasOutput('WebSocketCallbackUrl', {});
    });
  });
});
