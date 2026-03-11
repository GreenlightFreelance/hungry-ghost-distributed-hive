import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { describe, it } from 'vitest';
import { EcsStack } from '../lib/ecs-stack';
import { OpsStack } from '../lib/ops-stack';
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
  const opsStack = new OpsStack(app, 'TestOps', {
    table: storageStack.table,
    cluster: ecsStack.cluster,
    fileSystem: storageStack.fileSystem,
    vpc: vpcStack.vpc,
    lambdaSecurityGroup: vpcStack.lambdaSecurityGroup,
    efsSecurityGroup: vpcStack.efsSecurityGroup,
    accessPoint: storageStack.accessPoint,
  });
  return { app, opsStack };
}

describe('OpsStack', () => {
  const { opsStack } = createTestStacks();
  const template = Template.fromStack(opsStack);

  describe('Timeout Enforcer Lambda', () => {
    it('creates timeout enforcer function', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        FunctionName: 'distributed-hive-timeout-enforcer',
        Runtime: 'nodejs20.x',
        Timeout: 60,
        MemorySize: 256,
      });
    });

    it('configures timeout enforcer with environment variables', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        FunctionName: 'distributed-hive-timeout-enforcer',
        Environment: {
          Variables: Match.objectLike({
            DYNAMODB_TABLE: Match.anyValue(),
            ECS_CLUSTER_ARN: Match.anyValue(),
            MAX_RUN_DURATION_HOURS: '24',
          }),
        },
      });
    });

    it('schedules timeout check every 15 minutes', () => {
      template.hasResourceProperties('AWS::Events::Rule', {
        Name: 'distributed-hive-timeout-check',
        ScheduleExpression: 'rate(15 minutes)',
      });
    });

    it('grants ECS StopTask permission', () => {
      template.hasResourceProperties('AWS::IAM::Policy', {
        PolicyDocument: Match.objectLike({
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: Match.arrayWith(['ecs:StopTask']),
            }),
          ]),
        }),
      });
    });
  });

  describe('EFS Cleanup Lambda', () => {
    it('creates EFS cleanup function', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        FunctionName: 'distributed-hive-efs-cleanup',
        Runtime: 'nodejs20.x',
        Timeout: 300,
        MemorySize: 256,
      });
    });

    it('configures cleanup with retention days', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        FunctionName: 'distributed-hive-efs-cleanup',
        Environment: {
          Variables: Match.objectLike({
            EFS_MOUNT_PATH: '/mnt/efs',
            RETENTION_DAYS: '30',
          }),
        },
      });
    });

    it('mounts EFS filesystem', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        FunctionName: 'distributed-hive-efs-cleanup',
        FileSystemConfigs: Match.arrayWith([
          Match.objectLike({
            LocalMountPath: '/mnt/efs',
          }),
        ]),
      });
    });

    it('schedules cleanup daily at 3 AM', () => {
      template.hasResourceProperties('AWS::Events::Rule', {
        Name: 'distributed-hive-efs-cleanup',
        ScheduleExpression: 'cron(0 3 * * ? *)',
      });
    });
  });

  describe('Alerts', () => {
    it('creates SNS alert topic', () => {
      template.hasResourceProperties('AWS::SNS::Topic', {
        TopicName: 'distributed-hive-alerts',
        DisplayName: 'Distributed Hive Alerts',
      });
    });

    it('creates Fargate cost alarm', () => {
      template.hasResourceProperties('AWS::CloudWatch::Alarm', {
        AlarmName: 'distributed-hive-fargate-cost',
        Threshold: 80,
        EvaluationPeriods: 6,
        ComparisonOperator: 'GreaterThanThreshold',
      });
    });

    it('alarm targets the SNS topic', () => {
      template.hasResourceProperties('AWS::CloudWatch::Alarm', {
        AlarmName: 'distributed-hive-fargate-cost',
        AlarmActions: Match.anyValue(),
      });
    });
  });

  describe('CloudWatch Logs', () => {
    it('creates timeout enforcer log group', () => {
      template.hasResourceProperties('AWS::Logs::LogGroup', {
        LogGroupName: '/lambda/distributed-hive-timeout-enforcer',
        RetentionInDays: 14,
      });
    });

    it('creates EFS cleanup log group', () => {
      template.hasResourceProperties('AWS::Logs::LogGroup', {
        LogGroupName: '/lambda/distributed-hive-efs-cleanup',
        RetentionInDays: 14,
      });
    });
  });

  describe('Outputs', () => {
    it('exports stack outputs', () => {
      template.hasOutput('AlertTopicArn', {});
      template.hasOutput('TimeoutEnforcerArn', {});
      template.hasOutput('EfsCleanupArn', {});
    });
  });
});
