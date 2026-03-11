import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { describe, it } from 'vitest';
import { EcsStack } from '../lib/ecs-stack';
import { IamStack } from '../lib/iam-stack';
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
  const iamStack = new IamStack(app, 'TestIam', {
    tableName: storageStack.table.tableName,
    eventBusName: storageStack.eventBusName,
    clusterArn: ecsStack.clusterArn,
    taskDefinitionArn: ecsStack.taskDefinition.taskDefinitionArn,
  });
  return { app, vpcStack, storageStack, ecsStack, iamStack };
}

describe('IamStack', () => {
  const { iamStack } = createTestStacks();
  const template = Template.fromStack(iamStack);

  describe('API Lambda Role', () => {
    it('creates hive-api-role', () => {
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

    it('grants DynamoDB read/write to api role', () => {
      template.hasResourceProperties('AWS::IAM::Policy', {
        PolicyDocument: Match.objectLike({
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: Match.arrayWith([
                'dynamodb:PutItem',
                'dynamodb:GetItem',
                'dynamodb:Query',
                'dynamodb:Scan',
              ]),
            }),
          ]),
        }),
      });
    });

    it('grants SQS SendMessage to api role', () => {
      template.hasResourceProperties('AWS::IAM::Policy', {
        PolicyDocument: Match.objectLike({
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: Match.arrayWith(['sqs:SendMessage']),
            }),
          ]),
        }),
      });
    });

    it('grants ECS RunTask/StopTask/DescribeTasks to api role', () => {
      template.hasResourceProperties('AWS::IAM::Policy', {
        PolicyDocument: Match.objectLike({
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: Match.arrayWith([
                'ecs:RunTask',
                'ecs:StopTask',
                'ecs:DescribeTasks',
              ]),
            }),
          ]),
        }),
      });
    });

    it('grants execute-api ManageConnections to api role', () => {
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

    it('grants iam:PassRole for ECS task roles', () => {
      template.hasResourceProperties('AWS::IAM::Policy', {
        PolicyDocument: Match.objectLike({
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: 'iam:PassRole',
            }),
          ]),
        }),
      });
    });

    it('grants CloudWatch Logs to api role', () => {
      template.hasResourceProperties('AWS::IAM::Policy', {
        PolicyDocument: Match.objectLike({
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: Match.arrayWith([
                'logs:CreateLogGroup',
                'logs:CreateLogStream',
                'logs:PutLogEvents',
              ]),
            }),
          ]),
        }),
      });
    });
  });

  describe('Outputs', () => {
    it('exports api role ARN and name', () => {
      template.hasOutput('ApiRoleArn', {});
      template.hasOutput('ApiRoleName', {});
    });
  });
});

describe('EcsStack IAM hardening', () => {
  const { ecsStack } = createTestStacks();
  const template = Template.fromStack(ecsStack);

  it('execution role uses inline ECR and logs policy (no managed policy)', () => {
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: Match.arrayWith([
              'ecr:GetAuthorizationToken',
              'ecr:BatchGetImage',
              'logs:CreateLogStream',
              'logs:PutLogEvents',
            ]),
          }),
        ]),
      }),
    });
  });

  it('execution role inline policy includes secretsmanager:GetSecretValue', () => {
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: 'secretsmanager:GetSecretValue',
          }),
        ]),
      }),
    });
  });

  it('task role has DynamoDB permissions', () => {
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: Match.arrayWith(['dynamodb:PutItem', 'dynamodb:GetItem']),
          }),
        ]),
      }),
    });
  });

  it('task role has EventBridge PutEvents permission', () => {
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: 'events:PutEvents',
          }),
        ]),
      }),
    });
  });

  it('task role has S3 permissions scoped to distributed-hive-* buckets', () => {
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: Match.arrayWith(['s3:PutObject', 's3:GetObject']),
            Resource: Match.stringLikeRegexp('distributed-hive-\\*'),
          }),
        ]),
      }),
    });
  });
});
