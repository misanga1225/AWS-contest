// 起動処理: 実行時設定を読み込み、Amplify を構成し、i18n を初期化してから描画する。

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import './lib/i18n';
import App from './App.tsx';
import { loadConfig } from './lib/config';
import { configureAmplify } from './lib/amplify';

async function bootstrap() {
  const config = await loadConfig();
  configureAmplify(config);

  const el = document.getElementById('root');
  if (!el) throw new Error('root element not found');

  createRoot(el).render(
    <StrictMode>
      <App config={config} />
    </StrictMode>,
  );
}

void bootstrap();
