import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import { EcsStack, SIZING_TIERS } from '../lib/ecs-stack';
import { StorageStack } from '../lib/storage-stack';
import { VpcStack } from '../lib/vpc-stack';

function createTestStacks(sizingTier?: 'small' | 'medium' | 'large') {
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
    sizingTier,
  });
  return { app, vpcStack, storageStack, ecsStack };
}

describe('EcsStack', () => {
  const { ecsStack } = createTestStacks();
  const template = Template.fromStack(ecsStack);

  describe('ECR Repository', () => {
    it('creates distributed-hive repository', () => {
      template.hasResourceProperties('AWS::ECR::Repository', {
        RepositoryName: 'distributed-hive',
      });
    });

    it('configures lifecycle rules to keep 10 images', () => {
      template.hasResourceProperties('AWS::ECR::Repository', {
        LifecyclePolicy: {
          LifecyclePolicyText: Match.stringLikeRegexp('"countNumber":10'),
        },
      });
    });
  });

  describe('ECS Cluster', () => {
    it('creates distributed-hive cluster', () => {
      template.hasResourceProperties('AWS::ECS::Cluster', {
        ClusterName: 'distributed-hive',
      });
    });

    it('enables container insights', () => {
      template.hasResourceProperties('AWS::ECS::Cluster', {
        ClusterSettings: [
          {
            Name: 'containerInsights',
            Value: 'enabled',
          },
        ],
      });
    });
  });

  describe('Task Definition', () => {
    it('creates task definition with medium sizing by default', () => {
      template.hasResourceProperties('AWS::ECS::TaskDefinition', {
        Family: 'distributed-hive',
        Cpu: '4096',
        Memory: '16384',
        NetworkMode: 'awsvpc',
        RequiresCompatibilities: ['FARGATE'],
      });
    });

    it('configures ephemeral storage', () => {
      template.hasResourceProperties('AWS::ECS::TaskDefinition', {
        EphemeralStorage: {
          SizeInGiB: 100,
        },
      });
    });

    it('mounts EFS volume', () => {
      template.hasResourceProperties('AWS::ECS::TaskDefinition', {
        Volumes: [
          {
            Name: 'hive-efs',
            EFSVolumeConfiguration: Match.objectLike({
              TransitEncryption: 'ENABLED',
            }),
          },
        ],
      });
    });

    it('configures container with environment variables', () => {
      template.hasResourceProperties('AWS::ECS::TaskDefinition', {
        ContainerDefinitions: [
          Match.objectLike({
            Name: 'distributed-hive',
            Environment: Match.arrayWith([
              { Name: 'DYNAMODB_TABLE', Value: 'distributed-hive-state' },
              { Name: 'EVENTBRIDGE_BUS', Value: 'distributed-hive-events' },
            ]),
            MountPoints: [
              {
                ContainerPath: '/workspace',
                SourceVolume: 'hive-efs',
                ReadOnly: false,
              },
            ],
          }),
        ],
      });
    });

    it('configures secrets from Secrets Manager', () => {
      template.hasResourceProperties('AWS::ECS::TaskDefinition', {
        ContainerDefinitions: [
          Match.objectLike({
            Secrets: Match.arrayWith([
              Match.objectLike({ Name: 'ANTHROPIC_API_KEY' }),
              Match.objectLike({ Name: 'GITHUB_TOKEN' }),
            ]),
          }),
        ],
      });
    });

    it('configures CloudWatch logging', () => {
      template.hasResourceProperties('AWS::ECS::TaskDefinition', {
        ContainerDefinitions: [
          Match.objectLike({
            LogConfiguration: {
              LogDriver: 'awslogs',
              Options: Match.objectLike({
                'awslogs-stream-prefix': 'hive',
              }),
            },
          }),
        ],
      });
    });
  });

  describe('IAM Roles', () => {
    it('creates execution role', () => {
      template.hasResourceProperties('AWS::IAM::Role', {
        RoleName: 'hive-execution-role',
        AssumeRolePolicyDocument: Match.objectLike({
          Statement: [
            Match.objectLike({
              Principal: { Service: 'ecs-tasks.amazonaws.com' },
            }),
          ],
        }),
      });
    });

    it('creates task role', () => {
      template.hasResourceProperties('AWS::IAM::Role', {
        RoleName: 'hive-task-role',
        AssumeRolePolicyDocument: Match.objectLike({
          Statement: [
            Match.objectLike({
              Principal: { Service: 'ecs-tasks.amazonaws.com' },
            }),
          ],
        }),
      });
    });

    it('grants DynamoDB access to task role', () => {
      template.hasResourceProperties('AWS::IAM::Policy', {
        PolicyDocument: Match.objectLike({
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: Match.arrayWith(['dynamodb:PutItem', 'dynamodb:GetItem', 'dynamodb:Query']),
            }),
          ]),
        }),
      });
    });

    it('grants EventBridge PutEvents to task role', () => {
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
  });

  describe('CloudWatch Logs', () => {
    it('creates log group with 2 week retention', () => {
      template.hasResourceProperties('AWS::Logs::LogGroup', {
        LogGroupName: '/ecs/distributed-hive',
        RetentionInDays: 14,
      });
    });
  });

  describe('Outputs', () => {
    it('exports cluster and task definition info', () => {
      template.hasOutput('ClusterName', {});
      template.hasOutput('ClusterArn', {});
      template.hasOutput('TaskDefinitionArn', {});
      template.hasOutput('RepositoryUri', {});
      template.hasOutput('SizingTier', {});
    });
  });
});

describe('Sizing Tiers', () => {
  it('configures small tier correctly', () => {
    const { ecsStack } = createTestStacks('small');
    const template = Template.fromStack(ecsStack);
    template.hasResourceProperties('AWS::ECS::TaskDefinition', {
      Cpu: '2048',
      Memory: '8192',
      EphemeralStorage: { SizeInGiB: 50 },
    });
  });

  it('configures large tier correctly', () => {
    const { ecsStack } = createTestStacks('large');
    const template = Template.fromStack(ecsStack);
    template.hasResourceProperties('AWS::ECS::TaskDefinition', {
      Cpu: '8192',
      Memory: '32768',
      EphemeralStorage: { SizeInGiB: 200 },
    });
  });

  it('exports correct SIZING_TIERS constants', () => {
    expect(SIZING_TIERS.small).toEqual({
      cpu: 2048,
      memoryLimitMiB: 8192,
      ephemeralStorageGiB: 50,
    });
    expect(SIZING_TIERS.medium).toEqual({
      cpu: 4096,
      memoryLimitMiB: 16384,
      ephemeralStorageGiB: 100,
    });
    expect(SIZING_TIERS.large).toEqual({
      cpu: 8192,
      memoryLimitMiB: 32768,
      ephemeralStorageGiB: 200,
    });
  });
});
