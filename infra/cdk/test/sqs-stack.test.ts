import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { describe, it } from 'vitest';
import { SqsStack } from '../lib/sqs-stack';

function createTestStack() {
  const app = new cdk.App();
  const stack = new SqsStack(app, 'TestSqs');
  return Template.fromStack(stack);
}

describe('SqsStack', () => {
  const template = createTestStack();

  describe('Job Queue', () => {
    it('creates distributed-hive-runs queue', () => {
      template.hasResourceProperties('AWS::SQS::Queue', {
        QueueName: 'distributed-hive-runs',
      });
    });

    it('sets visibility timeout to 900 seconds', () => {
      template.hasResourceProperties('AWS::SQS::Queue', {
        QueueName: 'distributed-hive-runs',
        VisibilityTimeout: 900,
      });
    });

    it('sets message retention to 14 days', () => {
      template.hasResourceProperties('AWS::SQS::Queue', {
        QueueName: 'distributed-hive-runs',
        MessageRetentionPeriod: 1209600,
      });
    });

    it('configures dead letter queue with maxReceiveCount 3', () => {
      template.hasResourceProperties('AWS::SQS::Queue', {
        QueueName: 'distributed-hive-runs',
        RedrivePolicy: {
          maxReceiveCount: 3,
        },
      });
    });
  });

  describe('Dead Letter Queue', () => {
    it('creates DLQ', () => {
      template.hasResourceProperties('AWS::SQS::Queue', {
        QueueName: 'distributed-hive-runs-dlq',
      });
    });

    it('sets DLQ retention to 14 days', () => {
      template.hasResourceProperties('AWS::SQS::Queue', {
        QueueName: 'distributed-hive-runs-dlq',
        MessageRetentionPeriod: 1209600,
      });
    });
  });

  describe('Outputs', () => {
    it('exports queue and DLQ info', () => {
      template.hasOutput('QueueUrl', {});
      template.hasOutput('QueueArn', {});
      template.hasOutput('DlqUrl', {});
      template.hasOutput('DlqArn', {});
    });
  });
});
