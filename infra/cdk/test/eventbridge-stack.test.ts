import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { describe, it } from 'vitest';
import { EventBridgeStack } from '../lib/eventbridge-stack';

function createTestStack() {
  const app = new cdk.App();

  // Create a mock broadcaster function in a separate stack
  const mockStack = new cdk.Stack(app, 'MockStack');
  const mockBroadcaster = new lambda.Function(mockStack, 'MockBroadcaster', {
    functionName: 'mock-broadcaster',
    runtime: lambda.Runtime.NODEJS_20_X,
    handler: 'index.handler',
    code: lambda.Code.fromInline('exports.handler = async () => {}'),
  });

  const eventBridgeStack = new EventBridgeStack(app, 'TestEventBridge', {
    eventBusName: 'distributed-hive-events',
    broadcasterFunction: mockBroadcaster,
  });

  return Template.fromStack(eventBridgeStack);
}

describe('EventBridgeStack', () => {
  const template = createTestStack();

  describe('Event Bus', () => {
    it('creates distributed-hive-events bus', () => {
      template.hasResourceProperties('AWS::Events::EventBus', {
        Name: 'distributed-hive-events',
      });
    });
  });

  describe('Broadcast Rule', () => {
    it('creates broadcast rule', () => {
      template.hasResourceProperties('AWS::Events::Rule', {
        Name: 'distributed-hive-broadcast',
      });
    });

    it('matches distributed-hive source events', () => {
      template.hasResourceProperties('AWS::Events::Rule', {
        EventPattern: {
          source: ['distributed-hive'],
        },
      });
    });

    it('targets the broadcaster Lambda', () => {
      template.hasResourceProperties('AWS::Events::Rule', {
        Targets: Match.arrayWith([
          Match.objectLike({
            Arn: Match.anyValue(),
          }),
        ]),
      });
    });
  });

  describe('Outputs', () => {
    it('exports event bus info', () => {
      template.hasOutput('EventBusName', {});
      template.hasOutput('EventBusArn', {});
    });
  });
});
