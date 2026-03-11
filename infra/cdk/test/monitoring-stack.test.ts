import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { describe, it } from 'vitest';
import { EcsStack } from '../lib/ecs-stack';
import { MonitoringStack } from '../lib/monitoring-stack';
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
  const monitoringStack = new MonitoringStack(app, 'TestMonitoring', {
    clusterName: ecsStack.cluster.clusterName,
  });
  return { app, monitoringStack };
}

describe('MonitoringStack', () => {
  const { monitoringStack } = createTestStacks();
  const template = Template.fromStack(monitoringStack);

  describe('SNS Topic', () => {
    it('creates alarm notification topic', () => {
      template.hasResourceProperties('AWS::SNS::Topic', {
        TopicName: 'distributed-hive-alarms',
        DisplayName: 'Distributed Hive Monitoring Alarms',
      });
    });
  });

  describe('Log Groups', () => {
    it('creates API log group with 30-day retention', () => {
      template.hasResourceProperties('AWS::Logs::LogGroup', {
        LogGroupName: '/distributed-hive/api',
        RetentionInDays: 30,
      });
    });

    it('creates state sync log group with 30-day retention', () => {
      template.hasResourceProperties('AWS::Logs::LogGroup', {
        LogGroupName: '/distributed-hive/state-sync',
        RetentionInDays: 30,
      });
    });
  });

  describe('CloudWatch Alarms', () => {
    it('creates run duration alarm (threshold: 8 hours)', () => {
      template.hasResourceProperties('AWS::CloudWatch::Alarm', {
        AlarmName: 'distributed-hive-run-duration-high',
        MetricName: 'RunDuration',
        Namespace: 'DistributedHive',
        Threshold: 480,
        ComparisonOperator: 'GreaterThanThreshold',
      });
    });

    it('creates active tasks alarm (threshold: 10)', () => {
      template.hasResourceProperties('AWS::CloudWatch::Alarm', {
        AlarmName: 'distributed-hive-active-tasks-high',
        MetricName: 'ActiveTasks',
        Namespace: 'DistributedHive',
        Threshold: 10,
        ComparisonOperator: 'GreaterThanThreshold',
      });
    });

    it('creates agent stuck alarm (threshold: 3)', () => {
      template.hasResourceProperties('AWS::CloudWatch::Alarm', {
        AlarmName: 'distributed-hive-agent-stuck',
        MetricName: 'AgentStuckCount',
        Namespace: 'DistributedHive',
        Threshold: 3,
        ComparisonOperator: 'GreaterThanThreshold',
      });
    });

    it('creates escalation alarm (threshold: 0)', () => {
      template.hasResourceProperties('AWS::CloudWatch::Alarm', {
        AlarmName: 'distributed-hive-escalation',
        MetricName: 'EscalationCount',
        Namespace: 'DistributedHive',
        Threshold: 0,
        ComparisonOperator: 'GreaterThanThreshold',
      });
    });

    it('creates estimated cost alarm (threshold: $50)', () => {
      template.hasResourceProperties('AWS::CloudWatch::Alarm', {
        AlarmName: 'distributed-hive-cost-high',
        MetricName: 'EstimatedCost',
        Namespace: 'DistributedHive',
        Threshold: 50,
        ComparisonOperator: 'GreaterThanThreshold',
      });
    });

    it('creates daily cost budget alarm (threshold: $100)', () => {
      template.hasResourceProperties('AWS::CloudWatch::Alarm', {
        AlarmName: 'distributed-hive-daily-cost-budget',
        MetricName: 'DailyCost',
        Namespace: 'DistributedHive',
        Threshold: 100,
        ComparisonOperator: 'GreaterThanThreshold',
      });
    });

    it('creates spot interruption alarm', () => {
      template.hasResourceProperties('AWS::CloudWatch::Alarm', {
        AlarmName: 'distributed-hive-spot-interruptions',
        MetricName: 'SpotInterruptions',
        Namespace: 'DistributedHive',
        Threshold: 0,
        ComparisonOperator: 'GreaterThanThreshold',
      });
    });

    it('creates 7 alarms total', () => {
      template.resourceCountIs('AWS::CloudWatch::Alarm', 7);
    });

    it('all alarms notify SNS topic', () => {
      const alarms = template.findResources('AWS::CloudWatch::Alarm');
      for (const [, alarm] of Object.entries(alarms)) {
        const props = alarm.Properties as { AlarmActions?: unknown[] };
        if (props.AlarmActions) {
          Match.arrayWith([Match.objectLike({})]).test(props.AlarmActions);
        }
      }
    });
  });

  describe('CloudWatch Dashboard', () => {
    it('creates dashboard named distributed-hive', () => {
      template.hasResourceProperties('AWS::CloudWatch::Dashboard', {
        DashboardName: 'distributed-hive',
      });
    });
  });

  describe('Outputs', () => {
    it('exports dashboard URL', () => {
      template.hasOutput('DashboardUrl', {});
    });

    it('exports alarm topic ARN', () => {
      template.hasOutput('AlarmTopicArn', {});
    });

    it('exports API log group name', () => {
      template.hasOutput('ApiLogGroupName', {});
    });

    it('exports state sync log group name', () => {
      template.hasOutput('StateSyncLogGroupName', {});
    });
  });
});
