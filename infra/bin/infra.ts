#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { HandoverStack } from '../lib/handover-stack';

const app = new cdk.App();

new HandoverStack(app, 'HandoverStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? 'ap-northeast-1',
  },
});
