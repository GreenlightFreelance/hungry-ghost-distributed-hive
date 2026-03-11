import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { describe, it } from 'vitest';
import { FrontendStack } from '../lib/frontend-stack';

function createTestStack() {
  const app = new cdk.App();
  const stack = new FrontendStack(app, 'TestFrontend', {
    env: { account: '123456789012', region: 'af-south-1' },
  });
  return Template.fromStack(stack);
}

describe('FrontendStack', () => {
  const template = createTestStack();

  describe('S3 Bucket', () => {
    it('creates website bucket', () => {
      template.hasResourceProperties('AWS::S3::Bucket', {
        BucketName: 'distributed-hive-frontend-123456789012-af-south-1',
      });
    });

    it('blocks public access', () => {
      template.hasResourceProperties('AWS::S3::Bucket', {
        PublicAccessBlockConfiguration: {
          BlockPublicAcls: true,
          BlockPublicPolicy: true,
          IgnorePublicAcls: true,
          RestrictPublicBuckets: true,
        },
      });
    });
  });

  describe('CloudFront Distribution', () => {
    it('creates distribution', () => {
      template.resourceCountIs('AWS::CloudFront::Distribution', 1);
    });

    it('redirects to HTTPS', () => {
      template.hasResourceProperties('AWS::CloudFront::Distribution', {
        DistributionConfig: Match.objectLike({
          DefaultCacheBehavior: Match.objectLike({
            ViewerProtocolPolicy: 'redirect-to-https',
          }),
        }),
      });
    });

    it('sets default root object to index.html', () => {
      template.hasResourceProperties('AWS::CloudFront::Distribution', {
        DistributionConfig: Match.objectLike({
          DefaultRootObject: 'index.html',
        }),
      });
    });

    it('configures SPA error responses for 403 and 404', () => {
      template.hasResourceProperties('AWS::CloudFront::Distribution', {
        DistributionConfig: Match.objectLike({
          CustomErrorResponses: Match.arrayWith([
            Match.objectLike({
              ErrorCode: 403,
              ResponseCode: 200,
              ResponsePagePath: '/index.html',
            }),
            Match.objectLike({
              ErrorCode: 404,
              ResponseCode: 200,
              ResponsePagePath: '/index.html',
            }),
          ]),
        }),
      });
    });

    it('uses PRICE_CLASS_100', () => {
      template.hasResourceProperties('AWS::CloudFront::Distribution', {
        DistributionConfig: Match.objectLike({
          PriceClass: 'PriceClass_100',
        }),
      });
    });
  });

  describe('Origin Access Identity', () => {
    it('creates OAI', () => {
      template.hasResourceProperties('AWS::CloudFront::CloudFrontOriginAccessIdentity', {
        CloudFrontOriginAccessIdentityConfig: {
          Comment: 'OAI for distributed-hive frontend',
        },
      });
    });
  });

  describe('Outputs', () => {
    it('exports frontend info', () => {
      template.hasOutput('BucketName', {});
      template.hasOutput('DistributionId', {});
      template.hasOutput('DistributionDomainName', {});
    });
  });
});
