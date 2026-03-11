import * as cdk from 'aws-cdk-lib';
import * as apigatewayv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as efs from 'aws-cdk-lib/aws-efs';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import { Construct } from 'constructs';

export interface ApiStackProps extends cdk.StackProps {
  table: dynamodb.ITable;
  queue: sqs.IQueue;
  cluster: ecs.ICluster;
  taskDefinition: ecs.FargateTaskDefinition;
  vpc: ec2.IVpc;
  lambdaSecurityGroup: ec2.ISecurityGroup;
  fargateSecurityGroup: ec2.ISecurityGroup;
  eventBusName: string;
  fileSystem?: efs.IFileSystem;
  accessPoint?: efs.IAccessPoint;
}

interface RouteConfig {
  method: apigatewayv2.HttpMethod;
  path: string;
  handler: string;
}

const REST_ROUTES: RouteConfig[] = [
  { method: apigatewayv2.HttpMethod.POST, path: '/api/runs', handler: 'createRun' },
  { method: apigatewayv2.HttpMethod.GET, path: '/api/runs', handler: 'listRuns' },
  { method: apigatewayv2.HttpMethod.GET, path: '/api/runs/{id}', handler: 'getRun' },
  { method: apigatewayv2.HttpMethod.DELETE, path: '/api/runs/{id}', handler: 'cancelRun' },
  { method: apigatewayv2.HttpMethod.GET, path: '/api/runs/{id}/stories', handler: 'getStories' },
  { method: apigatewayv2.HttpMethod.GET, path: '/api/runs/{id}/agents', handler: 'getAgents' },
  { method: apigatewayv2.HttpMethod.GET, path: '/api/runs/{id}/logs', handler: 'getLogs' },
  { method: apigatewayv2.HttpMethod.GET, path: '/api/runs/{id}/prs', handler: 'getPRs' },
  { method: apigatewayv2.HttpMethod.POST, path: '/api/runs/{id}/message', handler: 'sendMessage' },
  { method: apigatewayv2.HttpMethod.PUT, path: '/api/settings', handler: 'updateSettings' },
  { method: apigatewayv2.HttpMethod.GET, path: '/api/settings', handler: 'getSettings' },
];

export class ApiStack extends cdk.Stack {
  public readonly httpApi: apigatewayv2.HttpApi;
  public readonly webSocketApi: apigatewayv2.WebSocketApi;
  public readonly webSocketStage: apigatewayv2.WebSocketStage;
  public readonly broadcasterFunction: lambda.Function;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    // Shared Lambda role for REST handlers
    const lambdaRole = new iam.Role(this, 'ApiLambdaRole', {
      roleName: 'hive-api-role',
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaVPCAccessExecutionRole'),
      ],
    });

    // Grant DynamoDB access
    props.table.grantReadWriteData(lambdaRole);

    // Grant SQS send access
    props.queue.grantSendMessages(lambdaRole);

    // Grant ECS RunTask access
    lambdaRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['ecs:RunTask'],
        resources: [props.taskDefinition.taskDefinitionArn],
      })
    );

    // Grant ECS StopTask for cancel handler
    lambdaRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['ecs:StopTask'],
        resources: ['*'],
        conditions: {
          ArnEquals: {
            'ecs:cluster': props.cluster.clusterArn,
          },
        },
      })
    );

    // Grant PassRole for ECS task execution
    lambdaRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['iam:PassRole'],
        resources: [
          props.taskDefinition.executionRole!.roleArn,
          props.taskDefinition.taskRole.roleArn,
        ],
      })
    );

    // Shared environment variables for REST Lambda functions
    const sharedEnv: Record<string, string> = {
      DYNAMODB_TABLE: props.table.tableName,
      SQS_QUEUE_URL: props.queue.queueUrl,
      ECS_CLUSTER_ARN: props.cluster.clusterArn,
      ECS_TASK_DEFINITION: props.taskDefinition.family!,
      ECS_SUBNETS: props.vpc.privateSubnets.map(s => s.subnetId).join(','),
      ECS_SECURITY_GROUPS: props.fargateSecurityGroup.securityGroupId,
      EVENTBRIDGE_BUS: props.eventBusName,
    };

    // Shared log group for REST handlers
    const restLogGroup = new logs.LogGroup(this, 'RestHandlerLogs', {
      logGroupName: '/lambda/distributed-hive-api',
      retention: logs.RetentionDays.TWO_WEEKS,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Create Lambda functions for each REST endpoint
    const lambdaFunctions: Record<string, lambda.Function> = {};
    for (const route of REST_ROUTES) {
      const fn = new lambda.Function(this, `${route.handler}Handler`, {
        functionName: `distributed-hive-${route.handler}`,
        runtime: lambda.Runtime.NODEJS_20_X,
        handler: `index.handler`,
        code: lambda.Code.fromAsset('lambda-placeholder', {
          // Placeholder: real code bundled during CI/CD
          exclude: ['**'],
        }),
        environment: sharedEnv,
        role: lambdaRole,
        timeout: cdk.Duration.seconds(30),
        memorySize: 256,
        vpc: props.vpc,
        vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
        securityGroups: [props.lambdaSecurityGroup],
        logGroup: restLogGroup,
      });

      lambdaFunctions[route.handler] = fn;
    }

    // HTTP API (REST)
    this.httpApi = new apigatewayv2.HttpApi(this, 'HttpApi', {
      apiName: 'distributed-hive-api',
      corsPreflight: {
        allowOrigins: ['*'],
        allowMethods: [
          apigatewayv2.CorsHttpMethod.GET,
          apigatewayv2.CorsHttpMethod.POST,
          apigatewayv2.CorsHttpMethod.PUT,
          apigatewayv2.CorsHttpMethod.DELETE,
          apigatewayv2.CorsHttpMethod.OPTIONS,
        ],
        allowHeaders: ['Content-Type', 'Authorization', 'X-Api-Key'],
        maxAge: cdk.Duration.hours(1),
      },
    });

    // Add routes
    for (const route of REST_ROUTES) {
      this.httpApi.addRoutes({
        path: route.path,
        methods: [route.method],
        integration: new integrations.HttpLambdaIntegration(
          `${route.handler}Integration`,
          lambdaFunctions[route.handler]
        ),
      });
    }

    // WebSocket API
    this.webSocketApi = new apigatewayv2.WebSocketApi(this, 'WebSocketApi', {
      apiName: 'distributed-hive-ws',
    });

    this.webSocketStage = new apigatewayv2.WebSocketStage(this, 'WebSocketStage', {
      webSocketApi: this.webSocketApi,
      stageName: 'v1',
      autoDeploy: true,
    });

    // WebSocket handler Lambda (connect, disconnect, subscribe)
    const wsHandlerRole = new iam.Role(this, 'WsHandlerRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaVPCAccessExecutionRole'),
      ],
    });

    props.table.grantReadWriteData(wsHandlerRole);

    const wsLogGroup = new logs.LogGroup(this, 'WsHandlerLogs', {
      logGroupName: '/lambda/distributed-hive-ws',
      retention: logs.RetentionDays.TWO_WEEKS,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const wsHandler = new lambda.Function(this, 'WsHandler', {
      functionName: 'distributed-hive-ws-handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lambda-placeholder', {
        exclude: ['**'],
      }),
      environment: {
        DYNAMODB_TABLE: props.table.tableName,
      },
      role: wsHandlerRole,
      timeout: cdk.Duration.seconds(10),
      memorySize: 128,
      vpc: props.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [props.lambdaSecurityGroup],
      logGroup: wsLogGroup,
    });

    // WebSocket routes
    const wsIntegration = new integrations.WebSocketLambdaIntegration(
      'WsDefaultIntegration',
      wsHandler
    );

    this.webSocketApi.addRoute('$connect', { integration: wsIntegration });
    this.webSocketApi.addRoute('$disconnect', { integration: wsIntegration });
    this.webSocketApi.addRoute('subscribe', { integration: wsIntegration });

    // WebSocket broadcaster Lambda (EventBridge → WebSocket clients)
    const broadcasterRole = new iam.Role(this, 'BroadcasterRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaVPCAccessExecutionRole'),
      ],
    });

    props.table.grantReadData(broadcasterRole);

    // Grant permission to post to WebSocket connections
    broadcasterRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['execute-api:ManageConnections'],
        resources: [
          `arn:aws:execute-api:${this.region}:${this.account}:${this.webSocketApi.apiId}/${this.webSocketStage.stageName}/POST/@connections/*`,
        ],
      })
    );

    const broadcasterLogGroup = new logs.LogGroup(this, 'BroadcasterLogs', {
      logGroupName: '/lambda/distributed-hive-broadcaster',
      retention: logs.RetentionDays.TWO_WEEKS,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    this.broadcasterFunction = new lambda.Function(this, 'BroadcasterHandler', {
      functionName: 'distributed-hive-ws-broadcaster',
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lambda-placeholder', {
        exclude: ['**'],
      }),
      environment: {
        DYNAMODB_TABLE: props.table.tableName,
        WEBSOCKET_ENDPOINT: this.webSocketStage.callbackUrl,
      },
      role: broadcasterRole,
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      vpc: props.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [props.lambdaSecurityGroup],
      logGroup: broadcasterLogGroup,
    });

    // ── API Gateway throttling (rate limiting) ──
    const defaultStage = this.httpApi.defaultStage?.node.defaultChild as apigatewayv2.CfnStage;
    if (defaultStage) {
      defaultStage.addPropertyOverride('DefaultRouteSettings', {
        ThrottlingBurstLimit: 50,
        ThrottlingRateLimit: 100,
      });
    }

    // ── Run timeout enforcement Lambda (every 15 min) ──
    const timeoutLambdaRole = new iam.Role(this, 'RunTimeoutRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });

    props.table.grantReadWriteData(timeoutLambdaRole);

    timeoutLambdaRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['ecs:StopTask'],
        resources: ['*'],
        conditions: {
          ArnEquals: { 'ecs:cluster': props.cluster.clusterArn },
        },
      })
    );

    const timeoutLogGroup = new logs.LogGroup(this, 'RunTimeoutLogs', {
      logGroupName: '/lambda/distributed-hive-run-timeout',
      retention: logs.RetentionDays.TWO_WEEKS,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const runTimeoutFn = new lambda.Function(this, 'RunTimeoutHandler', {
      functionName: 'distributed-hive-run-timeout',
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lambda-placeholder', { exclude: ['**'] }),
      environment: {
        DYNAMODB_TABLE: props.table.tableName,
        ECS_CLUSTER_ARN: props.cluster.clusterArn,
        MAX_RUN_HOURS: '24',
      },
      role: timeoutLambdaRole,
      timeout: cdk.Duration.minutes(2),
      memorySize: 256,
      logGroup: timeoutLogGroup,
    });

    new events.Rule(this, 'RunTimeoutSchedule', {
      ruleName: 'distributed-hive-run-timeout',
      schedule: events.Schedule.rate(cdk.Duration.minutes(15)),
      targets: [new targets.LambdaFunction(runTimeoutFn)],
    });

    // ── EFS cleanup Lambda (daily cron) ──
    const efsCleanupRole = new iam.Role(this, 'EfsCleanupRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaVPCAccessExecutionRole'),
      ],
    });

    if (props.fileSystem) {
      props.fileSystem.grant(
        efsCleanupRole,
        'elasticfilesystem:ClientMount',
        'elasticfilesystem:ClientWrite'
      );
    }

    const efsCleanupLogGroup = new logs.LogGroup(this, 'EfsCleanupLogs', {
      logGroupName: '/lambda/distributed-hive-efs-cleanup',
      retention: logs.RetentionDays.TWO_WEEKS,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const efsCleanupFn = new lambda.Function(this, 'EfsCleanupHandler', {
      functionName: 'distributed-hive-efs-cleanup',
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lambda-placeholder', { exclude: ['**'] }),
      environment: {
        EFS_MOUNT_PATH: '/mnt/efs',
        EFS_MAX_AGE_DAYS: '30',
      },
      role: efsCleanupRole,
      timeout: cdk.Duration.minutes(5),
      memorySize: 256,
      vpc: props.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [props.lambdaSecurityGroup],
      logGroup: efsCleanupLogGroup,
      ...(props.fileSystem && props.accessPoint
        ? {
            filesystem: lambda.FileSystem.fromEfsAccessPoint(props.accessPoint, '/mnt/efs'),
          }
        : {}),
    });

    new events.Rule(this, 'EfsCleanupSchedule', {
      ruleName: 'distributed-hive-efs-cleanup',
      schedule: events.Schedule.rate(cdk.Duration.days(1)),
      targets: [new targets.LambdaFunction(efsCleanupFn)],
    });

    // Outputs
    new cdk.CfnOutput(this, 'HttpApiUrl', {
      value: this.httpApi.apiEndpoint,
    });
    new cdk.CfnOutput(this, 'WebSocketApiUrl', {
      value: this.webSocketStage.url,
    });
    new cdk.CfnOutput(this, 'WebSocketCallbackUrl', {
      value: this.webSocketStage.callbackUrl,
    });
  }
}
