// Licensed under the Hungry Ghost Hive License. See LICENSE.

export interface AWSClientConfig {
  region: string;
  endpoint?: string;
  credentials?: {
    accessKeyId: string;
    secretAccessKey: string;
  };
}

const DEFAULT_LOCALSTACK_ENDPOINT = 'http://localhost:4566';

export function isLocalMode(): boolean {
  return process.env.LOCAL_MODE === 'true';
}

export function getLocalStackEndpoint(): string {
  return process.env.LOCALSTACK_ENDPOINT || DEFAULT_LOCALSTACK_ENDPOINT;
}

export function getAWSConfig(regionOverride?: string): AWSClientConfig {
  const region = regionOverride || process.env.AWS_REGION || 'us-east-1';

  if (isLocalMode()) {
    return {
      region,
      endpoint: getLocalStackEndpoint(),
      credentials: {
        accessKeyId: 'test',
        secretAccessKey: 'test',
      },
    };
  }

  return { region };
}
