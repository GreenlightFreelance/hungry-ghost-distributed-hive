import * as cdk from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cloudwatch_actions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as sns from 'aws-cdk-lib/aws-sns';
import { Construct } from 'constructs';

export interface MonitoringStackProps extends cdk.StackProps {
  clusterName: string;
  ecsServiceName?: string;
}

export class MonitoringStack extends cdk.Stack {
  public readonly dashboard: cloudwatch.Dashboard;
  public readonly alarmTopic: sns.Topic;

  constructor(scope: Construct, id: string, props: MonitoringStackProps) {
    super(scope, id, props);

    // SNS topic for alarm notifications
    this.alarmTopic = new sns.Topic(this, 'AlarmTopic', {
      topicName: 'distributed-hive-alarms',
      displayName: 'Distributed Hive Monitoring Alarms',
    });

    // Log groups with 30-day retention
    const apiLogGroup = new logs.LogGroup(this, 'ApiLogGroup', {
      logGroupName: '/distributed-hive/api',
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const stateSyncLogGroup = new logs.LogGroup(this, 'StateSyncLogGroup', {
      logGroupName: '/distributed-hive/state-sync',
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Custom metrics namespace
    const namespace = 'DistributedHive';

    // Metric definitions
    const runDurationMetric = new cloudwatch.Metric({
      namespace,
      metricName: 'RunDuration',
      statistic: 'Maximum',
      period: cdk.Duration.minutes(5),
    });

    const activeTasksMetric = new cloudwatch.Metric({
      namespace,
      metricName: 'ActiveTasks',
      statistic: 'Maximum',
      period: cdk.Duration.minutes(5),
    });

    const agentStuckCountMetric = new cloudwatch.Metric({
      namespace,
      metricName: 'AgentStuckCount',
      statistic: 'Maximum',
      period: cdk.Duration.minutes(5),
    });

    const storiesCompletedMetric = new cloudwatch.Metric({
      namespace,
      metricName: 'StoriesCompleted',
      statistic: 'Sum',
      period: cdk.Duration.minutes(5),
    });

    const escalationCountMetric = new cloudwatch.Metric({
      namespace,
      metricName: 'EscalationCount',
      statistic: 'Sum',
      period: cdk.Duration.minutes(5),
    });

    const estimatedCostMetric = new cloudwatch.Metric({
      namespace,
      metricName: 'EstimatedCost',
      statistic: 'Maximum',
      period: cdk.Duration.minutes(5),
    });

    // Alarms
    const runDurationAlarm = new cloudwatch.Alarm(this, 'RunDurationAlarm', {
      alarmName: 'distributed-hive-run-duration-high',
      alarmDescription: 'Run duration exceeds 8 hours',
      metric: runDurationMetric,
      threshold: 8 * 60, // 8 hours in minutes
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    runDurationAlarm.addAlarmAction(new cloudwatch_actions.SnsAction(this.alarmTopic));

    const activeTasksAlarm = new cloudwatch.Alarm(this, 'ActiveTasksAlarm', {
      alarmName: 'distributed-hive-active-tasks-high',
      alarmDescription: 'Active tasks exceeds 10 (cost control)',
      metric: activeTasksMetric,
      threshold: 10,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    activeTasksAlarm.addAlarmAction(new cloudwatch_actions.SnsAction(this.alarmTopic));

    const agentStuckAlarm = new cloudwatch.Alarm(this, 'AgentStuckAlarm', {
      alarmName: 'distributed-hive-agent-stuck',
      alarmDescription: 'More than 3 agents are stuck',
      metric: agentStuckCountMetric,
      threshold: 3,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    agentStuckAlarm.addAlarmAction(new cloudwatch_actions.SnsAction(this.alarmTopic));

    const escalationAlarm = new cloudwatch.Alarm(this, 'EscalationAlarm', {
      alarmName: 'distributed-hive-escalation',
      alarmDescription: 'Escalation detected — notify user',
      metric: escalationCountMetric,
      threshold: 0,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    escalationAlarm.addAlarmAction(new cloudwatch_actions.SnsAction(this.alarmTopic));

    const estimatedCostAlarm = new cloudwatch.Alarm(this, 'EstimatedCostAlarm', {
      alarmName: 'distributed-hive-cost-high',
      alarmDescription: 'Estimated cost exceeds $50',
      metric: estimatedCostMetric,
      threshold: 50,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    estimatedCostAlarm.addAlarmAction(new cloudwatch_actions.SnsAction(this.alarmTopic));

    // Daily cost budget alarm — alerts if daily cost exceeds $100
    const dailyCostMetric = new cloudwatch.Metric({
      namespace,
      metricName: 'DailyCost',
      statistic: 'Sum',
      period: cdk.Duration.hours(24),
    });

    const dailyCostAlarm = new cloudwatch.Alarm(this, 'DailyCostBudgetAlarm', {
      alarmName: 'distributed-hive-daily-cost-budget',
      alarmDescription: 'Daily cost exceeds $100 budget',
      metric: dailyCostMetric,
      threshold: 100,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    dailyCostAlarm.addAlarmAction(new cloudwatch_actions.SnsAction(this.alarmTopic));

    // Spot interruption alarm
    const spotInterruptionMetric = new cloudwatch.Metric({
      namespace,
      metricName: 'SpotInterruptions',
      statistic: 'Sum',
      period: cdk.Duration.minutes(5),
    });

    const spotInterruptionAlarm = new cloudwatch.Alarm(this, 'SpotInterruptionAlarm', {
      alarmName: 'distributed-hive-spot-interruptions',
      alarmDescription: 'Spot interruptions detected',
      metric: spotInterruptionMetric,
      threshold: 0,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    spotInterruptionAlarm.addAlarmAction(new cloudwatch_actions.SnsAction(this.alarmTopic));

    // CloudWatch Dashboard
    this.dashboard = new cloudwatch.Dashboard(this, 'Dashboard', {
      dashboardName: 'distributed-hive',
    });

    this.dashboard.addWidgets(
      new cloudwatch.TextWidget({
        markdown: '# Distributed Hive Monitoring',
        width: 24,
        height: 1,
      })
    );

    this.dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'Run Duration (minutes)',
        left: [runDurationMetric],
        width: 12,
        height: 6,
      }),
      new cloudwatch.GraphWidget({
        title: 'Active Tasks',
        left: [activeTasksMetric],
        width: 12,
        height: 6,
      })
    );

    this.dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'Agent Stuck Count',
        left: [agentStuckCountMetric],
        width: 8,
        height: 6,
      }),
      new cloudwatch.GraphWidget({
        title: 'Stories Completed',
        left: [storiesCompletedMetric],
        width: 8,
        height: 6,
      }),
      new cloudwatch.GraphWidget({
        title: 'Estimated Cost ($)',
        left: [estimatedCostMetric],
        width: 8,
        height: 6,
      })
    );

    this.dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'Daily Cost ($)',
        left: [dailyCostMetric],
        width: 12,
        height: 6,
      }),
      new cloudwatch.GraphWidget({
        title: 'Spot Interruptions',
        left: [spotInterruptionMetric],
        width: 12,
        height: 6,
      })
    );

    this.dashboard.addWidgets(
      new cloudwatch.AlarmStatusWidget({
        title: 'Alarm Status',
        alarms: [
          runDurationAlarm,
          activeTasksAlarm,
          agentStuckAlarm,
          escalationAlarm,
          estimatedCostAlarm,
          dailyCostAlarm,
          spotInterruptionAlarm,
        ],
        width: 24,
        height: 4,
      })
    );

    // Outputs
    new cdk.CfnOutput(this, 'DashboardUrl', {
      value: `https://${this.region}.console.aws.amazon.com/cloudwatch/home?region=${this.region}#dashboards:name=distributed-hive`,
    });
    new cdk.CfnOutput(this, 'AlarmTopicArn', { value: this.alarmTopic.topicArn });
    new cdk.CfnOutput(this, 'ApiLogGroupName', { value: apiLogGroup.logGroupName });
    new cdk.CfnOutput(this, 'StateSyncLogGroupName', {
      value: stateSyncLogGroup.logGroupName,
    });
  }
}
