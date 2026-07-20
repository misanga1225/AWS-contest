// アプリ名の表示。日本語 UI のときだけ「AI」に「ラブ」のルビを振る。
// en/vi はルビの概念がないためプレーン表記にフォールバックする。

import { useTranslation } from 'react-i18next';

export function AppName({ className = '' }: { className?: string }) {
  const { t, i18n } = useTranslation();
  const plain = t('appName');

  if (!i18n.language.startsWith('ja')) {
    return <span className={className}>{plain}</span>;
  }

  return (
    // aria-label でプレーン表記を読ませ、ルビが読み上げを壊さないようにする
    <span className={className} aria-label={plain}>
      <ruby aria-hidden="true">
        AI<rt>{t('appNameRuby')}</rt>
      </ruby>
      <span aria-hidden="true">ヘルパー わびすけ</span>
    </span>
  );
}
