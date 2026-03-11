import * as cdk from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as actions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as efs from 'aws-cdk-lib/aws-efs';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as sns from 'aws-cdk-lib/aws-sns';
import { Construct } from 'constructs';

export interface OpsStackProps extends cdk.StackProps {
  table: dynamodb.ITable;
  cluster: ecs.ICluster;
  fileSystem: efs.IFileSystem;
  vpc: ec2.IVpc;
  lambdaSecurityGroup: ec2.ISecurityGroup;
  efsSecurityGroup: ec2.ISecurityGroup;
  accessPoint: efs.IAccessPoint;
}

export class OpsStack extends cdk.Stack {
  public readonly timeoutEnforcerFunction: lambda.Function;
  public readonly efsCleanupFunction: lambda.Function;
  public readonly alertTopic: sns.Topic;

  constructor(scope: Construct, id: string, props: OpsStackProps) {
    super(scope, id, props);

    // SNS topic for cost/operational alerts
    this.alertTopic = new sns.Topic(this, 'AlertTopic', {
      topicName: 'distributed-hive-alerts',
      displayName: 'Distributed Hive Alerts',
    });

    // --- Run timeout enforcement Lambda ---
    const timeoutRole = new iam.Role(this, 'TimeoutEnforcerRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaVPCAccessExecutionRole'),
      ],
    });

    props.table.grantReadWriteData(timeoutRole);

    timeoutRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['ecs:StopTask', 'ecs:ListTasks', 'ecs:DescribeTasks'],
        resources: ['*'],
        conditions: {
          ArnEquals: {
            'ecs:cluster': props.cluster.clusterArn,
          },
        },
      })
    );

    // Allow ListTasks without condition (required by API)
    timeoutRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['ecs:ListTasks'],
        resources: ['*'],
      })
    );

    const timeoutLogGroup = new logs.LogGroup(this, 'TimeoutEnforcerLogs', {
      logGroupName: '/lambda/distributed-hive-timeout-enforcer',
      retention: logs.RetentionDays.TWO_WEEKS,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    this.timeoutEnforcerFunction = new lambda.Function(this, 'TimeoutEnforcer', {
      functionName: 'distributed-hive-timeout-enforcer',
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lambda-placeholder', { exclude: ['**'] }),
      environment: {
        DYNAMODB_TABLE: props.table.tableName,
        ECS_CLUSTER_ARN: props.cluster.clusterArn,
        MAX_RUN_DURATION_HOURS: '24',
      },
      role: timeoutRole,
      timeout: cdk.Duration.seconds(60),
      memorySize: 256,
      vpc: props.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [props.lambdaSecurityGroup],
      logGroup: timeoutLogGroup,
    });

    // Run every 15 minutes
    new events.Rule(this, 'TimeoutSchedule', {
      ruleName: 'distributed-hive-timeout-check',
      schedule: events.Schedule.rate(cdk.Duration.minutes(15)),
      targets: [new targets.LambdaFunction(this.timeoutEnforcerFunction)],
    });

    // --- EFS cleanup Lambda ---
    const cleanupRole = new iam.Role(this, 'EfsCleanupRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaVPCAccessExecutionRole'),
      ],
    });

    props.fileSystem.grant(
      cleanupRole,
      'elasticfilesystem:ClientMount',
      'elasticfilesystem:ClientWrite'
    );

    const cleanupLogGroup = new logs.LogGroup(this, 'EfsCleanupLogs', {
      logGroupName: '/lambda/distributed-hive-efs-cleanup',
      retention: logs.RetentionDays.TWO_WEEKS,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    this.efsCleanupFunction = new lambda.Function(this, 'EfsCleanup', {
      functionName: 'distributed-hive-efs-cleanup',
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lambda-placeholder', { exclude: ['**'] }),
      environment: {
        EFS_MOUNT_PATH: '/mnt/efs',
        RETENTION_DAYS: '30',
      },
      role: cleanupRole,
      timeout: cdk.Duration.minutes(5),
      memorySize: 256,
      vpc: props.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [props.lambdaSecurityGroup, props.efsSecurityGroup],
      logGroup: cleanupLogGroup,
      filesystem: lambda.FileSystem.fromEfsAccessPoint(props.accessPoint, '/mnt/efs'),
    });

    // Run daily at 3:00 AM UTC
    new events.Rule(this, 'CleanupSchedule', {
      ruleName: 'distributed-hive-efs-cleanup',
      schedule: events.Schedule.cron({ hour: '3', minute: '0' }),
      targets: [new targets.LambdaFunction(this.efsCleanupFunction)],
    });

    // --- Cost budget CloudWatch alarm ---
    const costAlarm = new cloudwatch.Alarm(this, 'FargateCostAlarm', {
      alarmName: 'distributed-hive-fargate-cost',
      alarmDescription: 'Alert when Fargate CPU utilization is consistently high (cost proxy)',
      metric: new cloudwatch.Metric({
        namespace: 'AWS/ECS',
        metricName: 'CPUUtilization',
        dimensionsMap: {
          ClusterName: 'distributed-hive',
        },
        statistic: 'Average',
        period: cdk.Duration.hours(1),
      }),
      threshold: 80,
      evaluationPeriods: 6,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
    });

    costAlarm.addAlarmAction(new actions.SnsAction(this.alertTopic));

    // Outputs
    new cdk.CfnOutput(this, 'AlertTopicArn', { value: this.alertTopic.topicArn });
    new cdk.CfnOutput(this, 'TimeoutEnforcerArn', {
      value: this.timeoutEnforcerFunction.functionArn,
    });
    new cdk.CfnOutput(this, 'EfsCleanupArn', { value: this.efsCleanupFunction.functionArn });
  }
}
