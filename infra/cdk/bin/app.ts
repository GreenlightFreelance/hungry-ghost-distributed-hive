#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { ApiStack } from '../lib/api-stack';
import { EcsStack } from '../lib/ecs-stack';
import { EventBridgeStack } from '../lib/eventbridge-stack';
import { FrontendStack } from '../lib/frontend-stack';
import { IamStack } from '../lib/iam-stack';
import { MonitoringStack } from '../lib/monitoring-stack';
import { SqsStack } from '../lib/sqs-stack';
import { StorageStack } from '../lib/storage-stack';
import { VpcStack } from '../lib/vpc-stack';

const app = new cdk.App();

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION ?? 'eu-west-1',
};

const vpcStack = new VpcStack(app, 'DistributedHiveVpc', { env });

const storageStack = new StorageStack(app, 'DistributedHiveStorage', {
  env,
  vpc: vpcStack.vpc,
  fargateSecurityGroup: vpcStack.fargateSecurityGroup,
});
storageStack.addDependency(vpcStack);

const ecsStack = new EcsStack(app, 'DistributedHiveEcs', {
  env,
  vpc: vpcStack.vpc,
  fargateSecurityGroup: vpcStack.fargateSecurityGroup,
  fileSystem: storageStack.fileSystem,
  accessPoint: storageStack.accessPoint,
  table: storageStack.table,
  eventBusName: storageStack.eventBusName,
});
ecsStack.addDependency(storageStack);

const iamStack = new IamStack(app, 'DistributedHiveIam', {
  env,
  tableName: storageStack.table.tableName,
  eventBusName: storageStack.eventBusName,
  clusterArn: ecsStack.clusterArn,
  taskDefinitionArn: ecsStack.taskDefinition.taskDefinitionArn,
});
iamStack.addDependency(ecsStack);

const sqsStack = new SqsStack(app, 'DistributedHiveSqs', { env });

const apiStack = new ApiStack(app, 'DistributedHiveApi', {
  env,
  table: storageStack.table,
  queue: sqsStack.queue,
  cluster: ecsStack.cluster,
  taskDefinition: ecsStack.taskDefinition,
  vpc: vpcStack.vpc,
  lambdaSecurityGroup: vpcStack.lambdaSecurityGroup,
  fargateSecurityGroup: vpcStack.fargateSecurityGroup,
  eventBusName: storageStack.eventBusName,
  fileSystem: storageStack.fileSystem,
  accessPoint: storageStack.accessPoint,
});
apiStack.addDependency(storageStack);
apiStack.addDependency(sqsStack);
apiStack.addDependency(ecsStack);

const eventBridgeStack = new EventBridgeStack(app, 'DistributedHiveEventBridge', {
  env,
  eventBusName: storageStack.eventBusName,
  broadcasterFunction: apiStack.broadcasterFunction,
});
eventBridgeStack.addDependency(apiStack);

const frontendStack = new FrontendStack(app, 'DistributedHiveFrontend', { env });

const monitoringStack = new MonitoringStack(app, 'DistributedHiveMonitoring', {
  env,
  clusterName: ecsStack.cluster.clusterName,
});
monitoringStack.addDependency(ecsStack);

app.synth();
