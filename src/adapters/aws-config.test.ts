// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getAWSConfig, isLocalMode } from './aws-config.js';

describe('aws-config', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.LOCAL_MODE;
    delete process.env.AWS_REGION;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('isLocalMode', () => {
    it('returns false when LOCAL_MODE is not set', () => {
      expect(isLocalMode()).toBe(false);
    });

    it('returns false when LOCAL_MODE is not "true"', () => {
      process.env.LOCAL_MODE = 'false';
      expect(isLocalMode()).toBe(false);
    });

    it('returns true when LOCAL_MODE is "true"', () => {
      process.env.LOCAL_MODE = 'true';
      expect(isLocalMode()).toBe(true);
    });
  });

  describe('getAWSConfig', () => {
    it('returns default region when no env var or override', () => {
      const config = getAWSConfig();
      expect(config.region).toBe('us-east-1');
      expect(config.endpoint).toBeUndefined();
      expect(config.credentials).toBeUndefined();
    });

    it('uses AWS_REGION env var', () => {
      process.env.AWS_REGION = 'eu-west-1';
      const config = getAWSConfig();
      expect(config.region).toBe('eu-west-1');
    });

    it('uses region override over env var', () => {
      process.env.AWS_REGION = 'eu-west-1';
      const config = getAWSConfig('ap-southeast-1');
      expect(config.region).toBe('ap-southeast-1');
    });

    it('returns LocalStack config when LOCAL_MODE=true', () => {
      process.env.LOCAL_MODE = 'true';
      const config = getAWSConfig();
      expect(config.region).toBe('us-east-1');
      expect(config.endpoint).toBe('http://localhost:4566');
      expect(config.credentials).toEqual({
        accessKeyId: 'test',
        secretAccessKey: 'test',
      });
    });

    it('respects region override in LOCAL_MODE', () => {
      process.env.LOCAL_MODE = 'true';
      const config = getAWSConfig('eu-west-1');
      expect(config.region).toBe('eu-west-1');
      expect(config.endpoint).toBe('http://localhost:4566');
    });
  });
});
