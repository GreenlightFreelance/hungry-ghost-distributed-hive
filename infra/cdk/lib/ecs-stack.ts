import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as efs from 'aws-cdk-lib/aws-efs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';

export type SizingTier = 'small' | 'medium' | 'large';

export interface SizingConfig {
  cpu: number;
  memoryLimitMiB: number;
  ephemeralStorageGiB: number;
}

export const SIZING_TIERS: Record<SizingTier, SizingConfig> = {
  small: { cpu: 2048, memoryLimitMiB: 8192, ephemeralStorageGiB: 50 },
  medium: { cpu: 4096, memoryLimitMiB: 16384, ephemeralStorageGiB: 100 },
  large: { cpu: 8192, memoryLimitMiB: 32768, ephemeralStorageGiB: 200 },
};

export interface EcsStackProps extends cdk.StackProps {
  vpc: ec2.IVpc;
  fargateSecurityGroup: ec2.ISecurityGroup;
  fileSystem: efs.IFileSystem;
  accessPoint: efs.IAccessPoint;
  table: dynamodb.ITable;
  eventBusName: string;
  sizingTier?: SizingTier;
}

export class EcsStack extends cdk.Stack {
  public readonly cluster: ecs.Cluster;
  public readonly taskDefinition: ecs.FargateTaskDefinition;
  public readonly repository: ecr.Repository;
  public readonly clusterArn: string;

  constructor(scope: Construct, id: string, props: EcsStackProps) {
    super(scope, id, props);

    const tier = props.sizingTier ?? 'medium';
    const sizing = SIZING_TIERS[tier];
    this.clusterArn = cdk.Arn.format(
      { service: 'ecs', resource: 'cluster', resourceName: 'distributed-hive' },
      this
    );

    // ECR repository
    this.repository = new ecr.Repository(this, 'Repository', {
      repositoryName: 'distributed-hive',
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      lifecycleRules: [
        {
          maxImageCount: 10,
          description: 'Keep last 10 images',
        },
      ],
    });

    // ECS Fargate cluster with Spot + On-Demand capacity providers
    this.cluster = new ecs.Cluster(this, 'Cluster', {
      vpc: props.vpc,
      clusterName: 'distributed-hive',
      containerInsights: true,
      enableFargateCapacityProviders: true,
    });

    // Default capacity provider strategy: prefer Spot (70% savings), fallback to on-demand
    this.cluster.addDefaultCapacityProviderStrategy([
      { capacityProvider: 'FARGATE_SPOT', weight: 3, base: 0 },
      { capacityProvider: 'FARGATE', weight: 1, base: 1 },
    ]);

    // Execution role — least-privilege inline policy (no managed policy)
    const executionRole = new iam.Role(this, 'ExecutionRole', {
      roleName: 'hive-execution-role',
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
    });

    executionRole.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          'ecr:GetAuthorizationToken',
          'ecr:BatchGetImage',
          'ecr:GetDownloadUrlForLayer',
          'ecr:BatchCheckLayerAvailability',
          'logs:CreateLogStream',
          'logs:PutLogEvents',
        ],
        resources: ['*'],
      })
    );

    executionRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['secretsmanager:GetSecretValue'],
        resources: [
          cdk.Arn.format(
            { service: 'secretsmanager', resource: 'secret', resourceName: 'hive/*' },
            this
          ),
        ],
      })
    );

    // Task role
    const taskRole = new iam.Role(this, 'TaskRole', {
      roleName: 'hive-task-role',
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
    });

    // DynamoDB: scoped to distributed-hive-* tables
    taskRole.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          'dynamodb:PutItem',
          'dynamodb:UpdateItem',
          'dynamodb:GetItem',
          'dynamodb:Query',
          'dynamodb:DeleteItem',
        ],
        resources: [
          cdk.Arn.format(
            { service: 'dynamodb', resource: 'table', resourceName: 'distributed-hive-*' },
            this
          ),
        ],
      })
    );

    // EventBridge: scoped to distributed-hive-* event buses
    taskRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['events:PutEvents'],
        resources: [
          cdk.Arn.format(
            { service: 'events', resource: 'event-bus', resourceName: 'distributed-hive-*' },
            this
          ),
        ],
      })
    );

    // S3: scoped to distributed-hive-* buckets
    taskRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['s3:PutObject', 's3:GetObject'],
        resources: ['arn:aws:s3:::distributed-hive-*'],
      })
    );

    // Secrets references
    const anthropicKeySecret = secretsmanager.Secret.fromSecretNameV2(
      this,
      'AnthropicKey',
      'hive/anthropic-api-key'
    );
    const githubTokenSecret = secretsmanager.Secret.fromSecretNameV2(
      this,
      'GithubToken',
      'hive/github-token'
    );

    // Task definition
    this.taskDefinition = new ecs.FargateTaskDefinition(this, 'TaskDefinition', {
      family: 'distributed-hive',
      cpu: sizing.cpu,
      memoryLimitMiB: sizing.memoryLimitMiB,
      ephemeralStorageGiB: sizing.ephemeralStorageGiB,
      executionRole,
      taskRole,
    });

    // Add EFS volume
    this.taskDefinition.addVolume({
      name: 'hive-efs',
      efsVolumeConfiguration: {
        fileSystemId: props.fileSystem.fileSystemId,
        transitEncryption: 'ENABLED',
        authorizationConfig: {
          accessPointId: props.accessPoint.accessPointId,
          iam: 'ENABLED',
        },
      },
    });

    // Grant EFS access to task role
    props.fileSystem.grant(
      taskRole,
      'elasticfilesystem:ClientMount',
      'elasticfilesystem:ClientWrite'
    );

    // Log group
    const logGroup = new logs.LogGroup(this, 'LogGroup', {
      logGroupName: '/ecs/distributed-hive',
      retention: logs.RetentionDays.TWO_WEEKS,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Container definition
    const container = this.taskDefinition.addContainer('HiveContainer', {
      containerName: 'distributed-hive',
      image: ecs.ContainerImage.fromEcrRepository(this.repository, 'latest'),
      logging: ecs.LogDrivers.awsLogs({
        logGroup,
        streamPrefix: 'hive',
      }),
      environment: {
        DYNAMODB_TABLE: 'distributed-hive-state',
        EVENTBRIDGE_BUS: props.eventBusName,
      },
      secrets: {
        ANTHROPIC_API_KEY: ecs.Secret.fromSecretsManager(anthropicKeySecret),
        GITHUB_TOKEN: ecs.Secret.fromSecretsManager(githubTokenSecret),
      },
      stopTimeout: cdk.Duration.seconds(120),
    });

    // Mount EFS
    container.addMountPoints({
      containerPath: '/workspace',
      sourceVolume: 'hive-efs',
      readOnly: false,
    });

    // Outputs
    new cdk.CfnOutput(this, 'ClusterName', { value: this.cluster.clusterName });
    new cdk.CfnOutput(this, 'ClusterArn', { value: this.cluster.clusterArn });
    new cdk.CfnOutput(this, 'TaskDefinitionArn', {
      value: this.taskDefinition.taskDefinitionArn,
    });
    new cdk.CfnOutput(this, 'RepositoryUri', { value: this.repository.repositoryUri });
    new cdk.CfnOutput(this, 'SizingTier', { value: tier });
  }
}
