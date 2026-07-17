import * as path from 'node:path';
import * as cdk from 'aws-cdk-lib';
import { HttpApi, HttpMethod } from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { RustFunction } from 'cargo-lambda-cdk';
import { Construct } from 'constructs';

const BACKEND_DIR = path.join(__dirname, '..', '..', 'backend');

export class HandoverStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // --- DynamoDB 単一テーブル ---
    // PK=FLOOR#{floor}, SK=RECORD#{ts}#{id} | RESIDENT#{id} | SUMMARY#{date}#{shift}
    const table = new dynamodb.Table(this, 'HandoverTable', {
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      // ハッカソン用の使い捨て環境のため DESTROY(本番なら RETAIN にする)
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // GSI1: 利用者別時系列 (PK=RESIDENT#{id}, SK=RECORD#{ts})
    table.addGlobalSecondaryIndex({
      indexName: 'GSI1',
      partitionKey: { name: 'GSI1PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'GSI1SK', type: dynamodb.AttributeType.STRING },
    });

    // --- API Lambda (Rust / arm64) ---
    const apiFn = new RustFunction(this, 'ApiFunction', {
      manifestPath: path.join(BACKEND_DIR, 'api', 'Cargo.toml'),
      architecture: lambda.Architecture.ARM_64,
      memorySize: 256,
      timeout: cdk.Duration.seconds(29),
      environment: {
        TABLE_NAME: table.tableName,
      },
    });
    table.grantReadWriteData(apiFn);

    // --- 要約 Lambda (Rust / arm64) ---
    const summarizerFn = new RustFunction(this, 'SummarizerFunction', {
      manifestPath: path.join(BACKEND_DIR, 'summarizer', 'Cargo.toml'),
      architecture: lambda.Architecture.ARM_64,
      memorySize: 512,
      timeout: cdk.Duration.minutes(5),
      environment: {
        TABLE_NAME: table.tableName,
      },
    });
    table.grantReadWriteData(summarizerFn);

    // --- HTTP API ---
    // スケルトン段階は /health のみ。JWTオーソライザは Cognito 追加時に導入し、
    // 以後 /health 以外の全ルートに必須とする。
    const httpApi = new HttpApi(this, 'HttpApi');
    httpApi.addRoutes({
      path: '/health',
      methods: [HttpMethod.GET],
      integration: new HttpLambdaIntegration('HealthIntegration', apiFn),
    });

    // --- Outputs (README記載の名前と一致させること) ---
    new cdk.CfnOutput(this, 'ApiEndpoint', { value: httpApi.apiEndpoint });
    new cdk.CfnOutput(this, 'TableName', { value: table.tableName });
  }
}
