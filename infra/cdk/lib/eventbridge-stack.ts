import * as cdk from 'aws-cdk-lib';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';

export interface EventBridgeStackProps extends cdk.StackProps {
  eventBusName: string;
  broadcasterFunction: lambda.IFunction;
}

export class EventBridgeStack extends cdk.Stack {
  public readonly eventBus: events.EventBus;

  constructor(scope: Construct, id: string, props: EventBridgeStackProps) {
    super(scope, id, props);

    // Event bus
    this.eventBus = new events.EventBus(this, 'EventBus', {
      eventBusName: props.eventBusName,
    });

    // Rule: route all distributed-hive events to the ws-broadcaster Lambda
    new events.Rule(this, 'BroadcastRule', {
      ruleName: 'distributed-hive-broadcast',
      eventBus: this.eventBus,
      eventPattern: {
        source: ['distributed-hive'],
      },
      targets: [new targets.LambdaFunction(props.broadcasterFunction)],
    });

    // Outputs
    new cdk.CfnOutput(this, 'EventBusName', { value: this.eventBus.eventBusName });
    new cdk.CfnOutput(this, 'EventBusArn', { value: this.eventBus.eventBusArn });
  }
}
