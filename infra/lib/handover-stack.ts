import * as path from 'node:path';
import * as cdk from 'aws-cdk-lib';
import { CfnStage, HttpApi, HttpMethod, CorsHttpMethod } from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpJwtAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as budgets from 'aws-cdk-lib/aws-budgets';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as scheduler from 'aws-cdk-lib/aws-scheduler';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { RustFunction } from 'cargo-lambda-cdk';
import { Construct } from 'constructs';

const BACKEND_DIR = path.join(__dirname, '..', '..', 'backend');
const FRONTEND_DIST = path.join(__dirname, '..', '..', 'frontend', 'dist');

/**
 * 設定値は SSM Parameter Store を単一の情報源とする。CDK コード内に magic string を
 * 埋め込まず、cdk context (cdk.json / -c) の値、無ければ既定値を用いる。
 * 既定シフトは UTC 00:00-09:00 (= JST 日勤 09:00-18:00 相当)。
 */
interface AppSettings {
  bedrockModelId: string;
  shiftDayStart: string; // "HH:MM" (UTC)
  shiftDayEnd: string; // "HH:MM" (UTC)
  floors: string; // カンマ区切り
}

export class HandoverStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const settings = this.resolveSettings();

    // ---------------------------------------------------------------------
    // SSM Parameter Store: 設定の単一情報源。運用者はここを変更して再デプロイする。
    // ---------------------------------------------------------------------
    const paramPrefix = '/handover';
    new ssm.StringParameter(this, 'BedrockModelIdParam', {
      parameterName: `${paramPrefix}/bedrock-model-id`,
      stringValue: settings.bedrockModelId,
    });
    new ssm.StringParameter(this, 'ShiftDayStartParam', {
      parameterName: `${paramPrefix}/shift-day-start`,
      stringValue: settings.shiftDayStart,
    });
    new ssm.StringParameter(this, 'ShiftDayEndParam', {
      parameterName: `${paramPrefix}/shift-day-end`,
      stringValue: settings.shiftDayEnd,
    });
    new ssm.StringParameter(this, 'FloorsParam', {
      parameterName: `${paramPrefix}/floors`,
      stringValue: settings.floors,
    });

    // ---------------------------------------------------------------------
    // DynamoDB 単一テーブル
    // PK=FLOOR#{floor}, SK=RECORD#{ts}#{id} | RESIDENT#{id} | SUMMARY#{date}#{shift}
    // ---------------------------------------------------------------------
    const table = new dynamodb.Table(this, 'HandoverTable', {
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      // ハッカソン用の使い捨て環境のため DESTROY(本番なら RETAIN にする)
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // GSI1: 利用者別時系列 (PK=RESIDENT#{id}, SK=RECORD#{ts}#{id})
    table.addGlobalSecondaryIndex({
      indexName: 'GSI1',
      partitionKey: { name: 'GSI1PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'GSI1SK', type: dynamodb.AttributeType.STRING },
    });

    // ---------------------------------------------------------------------
    // Lambda 共通環境変数 (TABLE_NAME 等は env、値の源泉は SSM と一致させる)
    // ---------------------------------------------------------------------
    const commonEnv: Record<string, string> = {
      TABLE_NAME: table.tableName,
      BEDROCK_MODEL_ID: settings.bedrockModelId,
      SHIFT_DAY_START: settings.shiftDayStart,
      SHIFT_DAY_END: settings.shiftDayEnd,
      FLOORS: settings.floors,
    };

    // --- API Lambda (Rust / arm64) ---
    const apiFn = new RustFunction(this, 'ApiFunction', {
      manifestPath: path.join(BACKEND_DIR, 'api', 'Cargo.toml'),
      architecture: lambda.Architecture.ARM_64,
      memorySize: 256,
      timeout: cdk.Duration.seconds(29),
      // 注: 予約同時実行(reservedConcurrentExecutions)は設定しない。
      // このアカウントは Lambda 同時実行の総枠が最小(10)で、予約すると
      // 未予約枠が最低値(10)を割りデプロイが失敗するため。総枠自体が爆発半径の
      // キャップとして機能する。枠を引き上げた場合は予約を追加してよい。
      environment: commonEnv,
    });
    table.grantReadWriteData(apiFn);

    // --- 要約 Lambda (Rust / arm64) ---
    const summarizerFn = new RustFunction(this, 'SummarizerFunction', {
      manifestPath: path.join(BACKEND_DIR, 'summarizer', 'Cargo.toml'),
      architecture: lambda.Architecture.ARM_64,
      memorySize: 512,
      timeout: cdk.Duration.minutes(5),
      // 予約同時実行はアカウント総枠(最小10)の制約により設定しない(ApiFunction 参照)。
      environment: commonEnv,
    });
    table.grantReadWriteData(summarizerFn);

    // ---------------------------------------------------------------------
    // Bedrock 呼び出し権限: モデル ARN 単位で最小権限。ワイルドカードアクションは使わない。
    // APAC クロスリージョン推論プロファイル + 基盤モデルの双方に InvokeModel を許可する。
    // ---------------------------------------------------------------------
    const bedrockPolicy = this.bedrockInvokePolicy(settings.bedrockModelId);
    apiFn.addToRolePolicy(bedrockPolicy);
    summarizerFn.addToRolePolicy(bedrockPolicy);

    // ---------------------------------------------------------------------
    // Cognito (JWT 認証)。管理者がユーザーを作成する運用のため self sign-up は無効。
    // ---------------------------------------------------------------------
    const userPool = new cognito.UserPool(this, 'UserPool', {
      selfSignUpEnabled: false,
      signInAliases: { username: true, email: true },
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: false,
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy: cdk.RemovalPolicy.DESTROY, // ハッカソン用
    });

    const userPoolClient = userPool.addClient('SpaClient', {
      // SPA (公開クライアント) のためシークレットなし。Amplify は SRP 認証を使う。
      generateSecret: false,
      authFlows: { userSrp: true },
      preventUserExistenceErrors: true,
      accessTokenValidity: cdk.Duration.hours(1),
      idTokenValidity: cdk.Duration.hours(1),
      refreshTokenValidity: cdk.Duration.days(30),
    });

    // ---------------------------------------------------------------------
    // フロントエンド配信: S3 (非公開) + CloudFront (OAC)。バケット公開は禁止。
    // ---------------------------------------------------------------------
    const siteBucket = new s3.Bucket(this, 'SiteBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY, // ハッカソン用
      autoDeleteObjects: true,
    });

    const distribution = new cloudfront.Distribution(this, 'SiteDistribution', {
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(siteBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
      },
      defaultRootObject: 'index.html',
      // SPA: ルーティングは client 側。404/403 は index.html にフォールバック
      errorResponses: [
        { httpStatus: 403, responseHttpStatus: 200, responsePagePath: '/index.html' },
        { httpStatus: 404, responseHttpStatus: 200, responsePagePath: '/index.html' },
      ],
    });
    const appUrl = `https://${distribution.distributionDomainName}`;

    // ---------------------------------------------------------------------
    // HTTP API + JWT オーソライザ。/health を除く全ルートに認証必須。
    // 細かなルーティングは axum が担うため、catch-all をオーソライザ付きで通す。
    // ---------------------------------------------------------------------
    const authorizer = new HttpJwtAuthorizer(
      'JwtAuthorizer',
      `https://cognito-idp.${this.region}.amazonaws.com/${userPool.userPoolId}`,
      { jwtAudience: [userPoolClient.userPoolClientId] },
    );

    const httpApi = new HttpApi(this, 'HttpApi', {
      corsPreflight: {
        allowOrigins: [appUrl],
        allowMethods: [
          CorsHttpMethod.GET,
          CorsHttpMethod.POST,
          CorsHttpMethod.PUT,
          CorsHttpMethod.DELETE,
          CorsHttpMethod.OPTIONS,
        ],
        allowHeaders: ['authorization', 'content-type'],
        maxAge: cdk.Duration.hours(1),
      },
    });

    const apiIntegration = new HttpLambdaIntegration('ApiIntegration', apiFn);

    // /health のみオーソライザ不要 (疎通確認用)
    httpApi.addRoutes({
      path: '/health',
      methods: [HttpMethod.GET],
      integration: apiIntegration,
    });
    // それ以外の全ルートは JWT 必須。
    // 注意: ANY を使うと OPTIONS(CORSプリフライト)まで認証必須になり、
    // Authorization ヘッダを持たないプリフライトが 401 になって CORS が壊れる。
    // OPTIONS に一致するルートを作らなければ HTTP API が自動でプリフライトに応答するため、
    // 明示的に GET/POST/PUT/DELETE のみを登録する。
    httpApi.addRoutes({
      path: '/{proxy+}',
      methods: [HttpMethod.GET, HttpMethod.POST, HttpMethod.PUT, HttpMethod.DELETE],
      integration: apiIntegration,
      authorizer,
    });

    // 既定ステージにスロットリング(rate/burst)を設定し、瞬間的な大量リクエストを抑制する。
    // HTTP API の L2 はステージ設定を直接公開しないため CfnStage にエスケープハッチで設定する。
    const defaultStage = httpApi.defaultStage?.node.defaultChild as CfnStage | undefined;
    if (defaultStage) {
      defaultStage.defaultRouteSettings = {
        throttlingRateLimit: 20, // 定常 20 req/s
        throttlingBurstLimit: 40, // バースト 40
      };
    }

    // ---------------------------------------------------------------------
    // フロントエンドの静的資産 + ランタイム設定(config.json)を S3 へ配置。
    // config.json でビルド時結合を避け、API/Cognito 情報を実行時に注入する。
    // ---------------------------------------------------------------------
    new s3deploy.BucketDeployment(this, 'DeploySite', {
      destinationBucket: siteBucket,
      distribution,
      distributionPaths: ['/*'],
      sources: [
        s3deploy.Source.asset(FRONTEND_DIST),
        s3deploy.Source.jsonData('config.json', {
          apiEndpoint: httpApi.apiEndpoint,
          region: this.region,
          userPoolId: userPool.userPoolId,
          userPoolClientId: userPoolClient.userPoolClientId,
          floors: settings.floors,
        }),
      ],
    });

    // ---------------------------------------------------------------------
    // EventBridge Scheduler: シフト終了時にサマリを自動生成する。
    // 日勤終了(day_end)に day、夜勤終了(day_start)に night を生成する。
    // ---------------------------------------------------------------------
    this.addSummarySchedules(summarizerFn, settings);

    // ---------------------------------------------------------------------
    // AWS Budgets: 月次コストの請求アラート。想定外の課金 (特に Bedrock 乱用) の保険。
    // 通知先メールは context `budgetEmail`、上限は `budgetLimitUsd` (既定 $5)。
    // ---------------------------------------------------------------------
    this.addBudget();

    // ---------------------------------------------------------------------
    // Outputs (README 記載の名前と一致させること)
    // ---------------------------------------------------------------------
    new cdk.CfnOutput(this, 'ApiEndpoint', { value: httpApi.apiEndpoint });
    new cdk.CfnOutput(this, 'TableName', { value: table.tableName });
    new cdk.CfnOutput(this, 'CloudFrontUrl', { value: appUrl });
    new cdk.CfnOutput(this, 'UserPoolId', { value: userPool.userPoolId });
    new cdk.CfnOutput(this, 'UserPoolClientId', { value: userPoolClient.userPoolClientId });
  }

  /** cdk context から設定を解決する (無ければ既定値)。 */
  private resolveSettings(): AppSettings {
    const ctx = (key: string, fallback: string): string => {
      const v = this.node.tryGetContext(key);
      return typeof v === 'string' && v.length > 0 ? v : fallback;
    };
    return {
      // 現行の Claude Haiku 4.5 を日本ローカル(jp.)推論プロファイルで使う
      // (介護記録=個人情報のためデータを日本リージョンに留める。コストも安い)。
      bedrockModelId: ctx('bedrockModelId', 'jp.anthropic.claude-haiku-4-5-20251001-v1:0'),
      shiftDayStart: ctx('shiftDayStart', '00:00'),
      shiftDayEnd: ctx('shiftDayEnd', '09:00'),
      floors: ctx('floors', '1,2,3'),
    };
  }

  /** モデル ARN 単位に絞った bedrock:InvokeModel ポリシー文。 */
  private bedrockInvokePolicy(modelId: string): iam.PolicyStatement {
    // 推論プロファイル ID (例: jp.anthropic.claude-haiku-4-5-...) から
    // 基盤モデル ID (例: anthropic.claude-haiku-4-5-...) を導出する。
    const foundationModelId = modelId.replace(/^[a-z]+\./, '');
    // 特定モデルに絞りつつ、プロファイルのルーティング先リージョンを取りこぼさないよう
    // リージョンはワイルドカードにする(アクション・モデルは限定=最小権限の範囲内)。
    const resources = [
      // 推論プロファイル (jp./apac./global. などのリージョナル/クロスリージョン)
      `arn:aws:bedrock:*:${this.account}:inference-profile/${modelId}`,
      // プロファイルが呼び出す基盤モデル
      `arn:aws:bedrock:*::foundation-model/${foundationModelId}`,
    ];
    return new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['bedrock:InvokeModel'],
      resources,
    });
  }

  /** シフト終了時刻に summarizer を起動する 2 本のスケジュールを作る。 */
  private addSummarySchedules(summarizerFn: lambda.IFunction, settings: AppSettings): void {
    // Scheduler が Lambda を invoke するための最小権限ロール
    const schedulerRole = new iam.Role(this, 'SchedulerRole', {
      assumedBy: new iam.ServicePrincipal('scheduler.amazonaws.com'),
    });
    summarizerFn.grantInvoke(schedulerRole);

    const cronAt = (hhmm: string): string => {
      const [h, m] = hhmm.split(':');
      // 毎日 指定 UTC 時刻
      return `cron(${Number(m)} ${Number(h)} * * ? *)`;
    };

    const makeSchedule = (logicalId: string, hhmm: string, shift: 'day' | 'night'): void => {
      new scheduler.CfnSchedule(this, logicalId, {
        flexibleTimeWindow: { mode: 'OFF' },
        scheduleExpression: cronAt(hhmm),
        scheduleExpressionTimezone: 'UTC',
        target: {
          arn: summarizerFn.functionArn,
          roleArn: schedulerRole.roleArn,
          // floors は summarizer が env(FLOORS) から取得。shift のみ指定。
          input: JSON.stringify({ shift }),
        },
      });
    };

    // 日勤終了(day_end)で day サマリ、夜勤終了(=day_start)で night サマリ
    makeSchedule('DayShiftEndSchedule', settings.shiftDayEnd, 'day');
    makeSchedule('NightShiftEndSchedule', settings.shiftDayStart, 'night');
  }

  /** 月次コストの請求アラート (Budgets)。context にメールがあれば通知を付ける。 */
  private addBudget(): void {
    const email = this.node.tryGetContext('budgetEmail');
    const limitRaw = this.node.tryGetContext('budgetLimitUsd');
    const limit = typeof limitRaw === 'string' && limitRaw.length > 0 ? Number(limitRaw) : 5;

    // メール未指定なら閾値超過を通知できないため、通知は付けず budget のみ作る
    // (コンソールで金額は確認可能)。通知を有効化するには -c budgetEmail=... を渡す。
    const notificationsWithSubscribers =
      typeof email === 'string' && email.length > 0
        ? [
            {
              notification: {
                notificationType: 'ACTUAL',
                comparisonOperator: 'GREATER_THAN',
                threshold: 80, // 実績が上限の80%
                thresholdType: 'PERCENTAGE',
              },
              subscribers: [{ subscriptionType: 'EMAIL', address: email }],
            },
            {
              notification: {
                notificationType: 'FORECASTED',
                comparisonOperator: 'GREATER_THAN',
                threshold: 100, // 着地見込みが上限超過
                thresholdType: 'PERCENTAGE',
              },
              subscribers: [{ subscriptionType: 'EMAIL', address: email }],
            },
          ]
        : undefined;

    new budgets.CfnBudget(this, 'MonthlyCostBudget', {
      budget: {
        budgetType: 'COST',
        timeUnit: 'MONTHLY',
        budgetLimit: { amount: limit, unit: 'USD' },
      },
      notificationsWithSubscribers,
    });
  }
}
