import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';

export class VpcStack extends cdk.Stack {
  public readonly vpc: ec2.Vpc;
  public readonly fargateSecurityGroup: ec2.SecurityGroup;
  public readonly efsSecurityGroup: ec2.SecurityGroup;
  public readonly lambdaSecurityGroup: ec2.SecurityGroup;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    this.vpc = new ec2.Vpc(this, 'Vpc', {
      vpcName: 'distributed-hive-vpc',
      ipAddresses: ec2.IpAddresses.cidr('10.0.0.0/16'),
      maxAzs: 2,
      natGateways: 1,
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: 'Public',
          subnetType: ec2.SubnetType.PUBLIC,
        },
        {
          cidrMask: 24,
          name: 'Private',
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        },
      ],
    });

    // sg-fargate: Outbound 443 (HTTPS) and 22 (git SSH)
    this.fargateSecurityGroup = new ec2.SecurityGroup(this, 'FargateSecurityGroup', {
      vpc: this.vpc,
      securityGroupName: 'sg-fargate',
      description: 'Security group for Fargate tasks',
      allowAllOutbound: false,
    });

    this.fargateSecurityGroup.addEgressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(443),
      'Allow HTTPS outbound'
    );

    this.fargateSecurityGroup.addEgressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(22),
      'Allow git SSH outbound'
    );

    // sg-efs: Inbound 2049 (NFS) from sg-fargate
    // Note: the EFS SG allows inbound from Fargate, but Fargate also needs
    // egress to EFS on port 2049 since allowAllOutbound is false
    this.efsSecurityGroup = new ec2.SecurityGroup(this, 'EfsSecurityGroup', {
      vpc: this.vpc,
      securityGroupName: 'sg-efs',
      description: 'Security group for EFS mount targets',
      allowAllOutbound: false,
    });

    this.efsSecurityGroup.addIngressRule(
      this.fargateSecurityGroup,
      ec2.Port.tcp(2049),
      'Allow NFS from Fargate tasks'
    );

    this.fargateSecurityGroup.addEgressRule(
      this.efsSecurityGroup,
      ec2.Port.tcp(2049),
      'Allow NFS to EFS'
    );

    // sg-lambda: Outbound 443 (DynamoDB, API Gateway)
    this.lambdaSecurityGroup = new ec2.SecurityGroup(this, 'LambdaSecurityGroup', {
      vpc: this.vpc,
      securityGroupName: 'sg-lambda',
      description: 'Security group for Lambda functions',
      allowAllOutbound: false,
    });

    this.lambdaSecurityGroup.addEgressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(443),
      'Allow HTTPS outbound for DynamoDB and API Gateway'
    );

    // Outputs
    new cdk.CfnOutput(this, 'VpcId', { value: this.vpc.vpcId });
    new cdk.CfnOutput(this, 'FargateSecurityGroupId', {
      value: this.fargateSecurityGroup.securityGroupId,
    });
    new cdk.CfnOutput(this, 'EfsSecurityGroupId', {
      value: this.efsSecurityGroup.securityGroupId,
    });
    new cdk.CfnOutput(this, 'LambdaSecurityGroupId', {
      value: this.lambdaSecurityGroup.securityGroupId,
    });
  }
}
