import * as cdk from 'aws-cdk-lib';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import { Construct } from 'constructs';

export class SqsStack extends cdk.Stack {
  public readonly queue: sqs.Queue;
  public readonly deadLetterQueue: sqs.Queue;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Dead letter queue
    this.deadLetterQueue = new sqs.Queue(this, 'DeadLetterQueue', {
      queueName: 'distributed-hive-runs-dlq',
      retentionPeriod: cdk.Duration.days(14),
    });

    // Main job queue
    this.queue = new sqs.Queue(this, 'JobQueue', {
      queueName: 'distributed-hive-runs',
      visibilityTimeout: cdk.Duration.seconds(900),
      retentionPeriod: cdk.Duration.days(14),
      deadLetterQueue: {
        queue: this.deadLetterQueue,
        maxReceiveCount: 3,
      },
    });

    // Outputs
    new cdk.CfnOutput(this, 'QueueUrl', { value: this.queue.queueUrl });
    new cdk.CfnOutput(this, 'QueueArn', { value: this.queue.queueArn });
    new cdk.CfnOutput(this, 'DlqUrl', { value: this.deadLetterQueue.queueUrl });
    new cdk.CfnOutput(this, 'DlqArn', { value: this.deadLetterQueue.queueArn });
  }
}
