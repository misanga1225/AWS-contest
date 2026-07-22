import * as path from 'node:path';
import * as cdk from 'aws-cdk-lib';
import { CfnStage, HttpApi, HttpMethod, CorsHttpMethod } from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpJwtAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as budgets from 'aws-cdk-lib/aws-budgets';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as scheduler from 'aws-cdk-lib/aws-scheduler';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { RustFunction } from 'cargo-lambda-cdk';
import { Construct } from 'constructs';

const BACKEND_DIR = path.join(__dirname, '..', '..', 'backend');
const FRONTEND_DIST = path.join(__dirname, '..', '..', 'frontend', 'dist');
/** 利用者別時系列 GSI の名前。Lambda には INDEX_NAME として注入する（backend 側でハードコードしない） */
const RESIDENT_INDEX_NAME = 'GSI1';

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
      // 誤操作・バグによる書き込みミスからの復旧手段(法定保存義務のある記録のため)
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      // 誤った delete-table を技術的に防ぐ。cdk destroy する際は先に
      // deletionProtection: false へ変更して再デプロイしてから実行すること。
      deletionProtection: true,
    });

    // GSI1: 利用者別時系列 (PK=RESIDENT#{id}, SK=RECORD#{ts}#{id})
    table.addGlobalSecondaryIndex({
      indexName: RESIDENT_INDEX_NAME,
      partitionKey: { name: 'GSI1PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'GSI1SK', type: dynamodb.AttributeType.STRING },
    });

    // ---------------------------------------------------------------------
    // Lambda 共通環境変数 (TABLE_NAME 等は env、値の源泉は SSM と一致させる)
    // ---------------------------------------------------------------------
    const commonEnv: Record<string, string> = {
      TABLE_NAME: table.tableName,
      INDEX_NAME: RESIDENT_INDEX_NAME,
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
    // grantReadWriteData ではなく実際に発行される DynamoDB アクションだけを許可する。
    // DeleteItem は residents::delete (記録0件の利用者のみ) のために必要
    // (DynamoDB の IAM は PK しか条件化できず SK prefix では絞れないため、
    // action 単位の最小化に留める)。Scan/UpdateItem/BatchWrite 等は一切使わない。
    apiFn.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:Query', 'dynamodb:DeleteItem'],
        resources: [table.tableArn],
      }),
    );
    apiFn.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['dynamodb:Query'],
        // has_records_for_resident (利用者削除判定) のみが GSI1 を引く。
        resources: [`${table.tableArn}/index/${RESIDENT_INDEX_NAME}`],
      }),
    );

    // --- 要約 Lambda (Rust / arm64) ---
    const summarizerFn = new RustFunction(this, 'SummarizerFunction', {
      manifestPath: path.join(BACKEND_DIR, 'summarizer', 'Cargo.toml'),
      architecture: lambda.Architecture.ARM_64,
      memorySize: 512,
      timeout: cdk.Duration.minutes(5),
      // 予約同時実行はアカウント総枠(最小10)の制約により設定しない(ApiFunction 参照)。
      environment: commonEnv,
    });
    // summarizer はサマリ生成のみ。記録・利用者は読むだけで削除は一切しない。GSI1 も使わない。
    summarizerFn.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:Query'],
        resources: [table.tableArn],
      }),
    );

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
    // 音声入力用 S3 バケット。ブラウザ録音をプリサインド URL で直 PUT し、
    // バッチ Transcribe が文字起こしする。PII 音声・文字起こしとも 1 日で失効削除する
    // (残さない + ストレージ実質ゼロ)。公開は禁止 (BLOCK_ALL)。
    // ---------------------------------------------------------------------
    const audioBucket = new s3.Bucket(this, 'AudioBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY, // ハッカソン用
      autoDeleteObjects: true,
      // ブラウザからプリサインド URL で直 PUT するため、CloudFront 配信元のみ許可。
      cors: [
        {
          allowedMethods: [s3.HttpMethods.PUT],
          allowedOrigins: [appUrl],
          allowedHeaders: ['*'],
          maxAge: 3600,
        },
      ],
      // 音声 (audio/) も文字起こし結果 (transcripts/) も 1 日で自動削除。
      lifecycleRules: [{ expiration: cdk.Duration.days(1) }],
    });

    // api Lambda に音声バケットへの読み書きと Transcribe ジョブ操作を最小権限で付与する。
    // PutObject は音声アップロード(audio/*)に必要。GetObject も audio/* に必要
    // (HeadObject でアップロード済み音声のサイズを検証してから Transcribe を起動するため
    // — HeadObject は IAM 上 s3:GetObject 権限を要求する)。GetObject は文字起こし結果
    // (transcripts/*)の読み出しにも必要。
    apiFn.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['s3:PutObject', 's3:GetObject'],
        resources: [audioBucket.arnForObjects('audio/*')],
      }),
    );
    apiFn.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['s3:GetObject'],
        resources: [audioBucket.arnForObjects('transcripts/*')],
      }),
    );
    apiFn.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['transcribe:StartTranscriptionJob', 'transcribe:GetTranscriptionJob'],
        // ジョブ名は wabisuke-{ulid}。他のジョブに触れないよう prefix で絞る。
        resources: [`arn:aws:transcribe:*:${this.account}:transcription-job/wabisuke-*`],
      }),
    );
    // Amazon Transcribe サービス自身が音声(audio/*)を読み、結果(transcripts/*)を書き込む
    // ためのロール。BlockPublicAccess を張った同一アカウントのバケットでも、Transcribe が
    // 暗黙にアクセスできるとは限らない(実際に "S3 bucket can't be accessed" で失敗するのを
    // 確認した)ため、DataAccessRoleArn で明示的に権限を渡す。
    const transcribeDataAccessRole = new iam.Role(this, 'TranscribeDataAccessRole', {
      assumedBy: new iam.ServicePrincipal('transcribe.amazonaws.com'),
    });
    transcribeDataAccessRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['s3:GetObject'],
        resources: [audioBucket.arnForObjects('audio/*')],
      }),
    );
    transcribeDataAccessRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['s3:PutObject'],
        resources: [audioBucket.arnForObjects('transcripts/*')],
      }),
    );
    // StartTranscriptionJob で DataAccessRoleArn を渡すには、渡す側(apiFn)がその特定の
    // ロールに対する iam:PassRole 権限を持つ必要がある(AWSの特権昇格防止ガードレール)。
    transcribeDataAccessRole.grantPassRole(apiFn.grantPrincipal);

    // バケット名は CDK リソース参照で注入 (ハードコードしない)。summarizer は使わない。
    apiFn.addEnvironment('AUDIO_BUCKET', audioBucket.bucketName);
    apiFn.addEnvironment('TRANSCRIBE_DATA_ACCESS_ROLE_ARN', transcribeDataAccessRole.roleArn);

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

    // 既定ステージにスロットリング(rate/burst)とアクセスログを設定する。
    // HTTP API の L2 はステージ設定を直接公開しないため CfnStage にエスケープハッチで設定する。
    const accessLogGroup = new logs.LogGroup(this, 'HttpApiAccessLogs', {
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY, // ハッカソン用
    });
    accessLogGroup.grantWrite(new iam.ServicePrincipal('apigateway.amazonaws.com'));

    const defaultStage = httpApi.defaultStage?.node.defaultChild as CfnStage | undefined;
    if (defaultStage) {
      defaultStage.defaultRouteSettings = {
        throttlingRateLimit: 20, // 定常 20 req/s
        throttlingBurstLimit: 40, // バースト 40
      };
      defaultStage.accessLogSettings = {
        destinationArn: accessLogGroup.logGroupArn,
        format: JSON.stringify({
          requestId: '$context.requestId',
          ip: '$context.identity.sourceIp',
          requestTime: '$context.requestTime',
          httpMethod: '$context.httpMethod',
          routeKey: '$context.routeKey',
          status: '$context.status',
          responseLength: '$context.responseLength',
          integrationErrorMessage: '$context.integrationErrorMessage',
        }),
      };
    }

    // ---------------------------------------------------------------------
    // CloudFront セキュリティヘッダー。
    // 注意: CSP の connect-src に httpApi.apiEndpoint / audioBucket.bucketRegionalDomainName
    // を Fn::GetAtt で直接埋め込むと、httpApi/audioBucket 側が(CORSの allowOrigins に)
    // distribution のドメイン名を参照しているため、
    // distribution → SecurityHeadersPolicy → httpApi/audioBucket → distribution という
    // 循環参照になり cdk deploy が "Circular dependency" で失敗する(実際に検証済み)。
    // そのため具体的なリソース参照はせず、同リージョンのワイルドカードパターンで代用する。
    // frontend/index.html が Google Fonts を外部読み込みしているため style-src/font-src に許可を足す。
    // ---------------------------------------------------------------------
    const headersPolicy = new cloudfront.ResponseHeadersPolicy(this, 'SecurityHeadersPolicy', {
      securityHeadersBehavior: {
        contentSecurityPolicy: {
          contentSecurityPolicy: [
            `default-src 'self'`,
            `script-src 'self'`,
            `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com`,
            `font-src 'self' https://fonts.gstatic.com`,
            `img-src 'self' data:`,
            `connect-src 'self' https://*.execute-api.${this.region}.amazonaws.com https://cognito-idp.${this.region}.amazonaws.com https://*.s3.${this.region}.amazonaws.com`,
            `frame-ancestors 'none'`,
            `base-uri 'self'`,
            `object-src 'none'`,
          ].join('; '),
          override: true,
        },
        contentTypeOptions: { override: true },
        frameOptions: { frameOption: cloudfront.HeadersFrameOption.DENY, override: true },
        referrerPolicy: {
          referrerPolicy: cloudfront.HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN,
          override: true,
        },
        strictTransportSecurity: {
          accessControlMaxAge: cdk.Duration.days(365),
          includeSubdomains: true,
          override: true,
        },
      },
    });
    const cfnDistribution = distribution.node.defaultChild as cloudfront.CfnDistribution;
    cfnDistribution.addPropertyOverride(
      'DistributionConfig.DefaultCacheBehavior.ResponseHeadersPolicyId',
      headersPolicy.responseHeadersPolicyId,
    );

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
          // シフト帯 (UTC)。フロントは職員のローカル時刻へ変換して
          // 「いま日勤か夜勤か」を表示する。夜勤の開始 = 日勤の終了。
          shiftDayStart: settings.shiftDayStart,
          shiftNightStart: settings.shiftDayEnd,
        }),
      ],
    });

    // ---------------------------------------------------------------------
    // EventBridge Scheduler: シフト終了時にサマリを自動生成する。
    // 日勤終了(day_end)に day、夜勤終了(day_start)に night を生成する。
    // ---------------------------------------------------------------------
    this.addSummarySchedules(summarizerFn, settings);

    // ---------------------------------------------------------------------
    // CloudWatch Alarm: Lambda エラー率の監視。通知先(SNS等)は運用方針・宛先が
    // 未確定のため今回は付けない。コンソールで OK/ALARM 状態を確認できる状態まで作り、
    // 将来 addAlarmAction() を足すだけで通知を有効化できる疎結合な作りにしておく。
    // ---------------------------------------------------------------------
    this.addAlarms(apiFn, summarizerFn);

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

  /**
   * Lambda エラー率の CloudWatch Alarm(通知アクションなし)。
   *
   * SNS 等の通知先は運用方針(誰が受け取るか・エラー時の対応フロー)が未確定のため
   * 今回は付けない。アラーム自体はコンソール上で OK/ALARM 状態を確認できる。
   */
  private addAlarms(apiFn: lambda.IFunction, summarizerFn: lambda.IFunction): void {
    new cloudwatch.Alarm(this, 'ApiErrorsAlarm', {
      // 全 REST API の入り口。Bedrock 呼び出し失敗・DynamoDB エラー・不正リクエスト急増等を
      // まとめて検知できる代表的な健全性指標として選定。
      metric: apiFn.metricErrors({ period: cdk.Duration.minutes(5) }),
      threshold: 1,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    new cloudwatch.Alarm(this, 'SummarizerErrorsAlarm', {
      // シフト終業時の自動サマリ生成が失敗すると申し送り機能そのものが機能しなくなるため、
      // 放置しないための指標として選定。
      metric: summarizerFn.metricErrors({ period: cdk.Duration.minutes(5) }),
      threshold: 1,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
  }

  /** 月次コストの請求アラート (Budgets)。context にメールがあれば通知を付ける。 */
  private addBudget(): void {
    const email = this.node.tryGetContext('budgetEmail');
    const limitRaw = this.node.tryGetContext('budgetLimitUsd');
    const limit = typeof limitRaw === 'string' && limitRaw.length > 0 ? Number(limitRaw) : 5;

    // メール未指定なら閾値超過を通知できないため、通知は付けず budget のみ作る
    // (コンソールで金額は確認可能)。通知を有効化するには -c budgetEmail=... を渡す。
    if (!(typeof email === 'string' && email.length > 0)) {
      cdk.Annotations.of(this).addWarning(
        'budgetEmail context 未指定のため、コスト超過の通知メールは送信されません' +
          '(予算自体は作成され、金額はコンソールで確認できます)。' +
          '通知を有効にするには -c budgetEmail=... を指定してください。',
      );
    }
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
