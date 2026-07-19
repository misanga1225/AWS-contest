// Amplify v6 の Auth モジュールのみを使い、Cognito User Pool 認証を構成する。

import { Amplify } from 'aws-amplify';
import type { RuntimeConfig } from './config';

export function configureAmplify(config: RuntimeConfig): void {
  Amplify.configure({
    Auth: {
      Cognito: {
        userPoolId: config.userPoolId,
        userPoolClientId: config.userPoolClientId,
      },
    },
  });
}
