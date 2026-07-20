// ログイン画面。Cognito のユーザー名・パスワードで認証する。

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../lib/auth';
import { AppName } from '../components/AppName';
import { WabisukeMark } from '../components/WabisukeMark';
import { Button, Card, ErrorText, Input, Label } from '../components/ui';

export function LoginPage() {
  const { t } = useTranslation();
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // 両方入力されるまで押せない。入力が揃った時点でボタンが濃くなり、送信可能だと分かる
  const canSubmit = username.trim() !== '' && password !== '';

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);
    setBusy(true);
    try {
      await login(username, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('auth.failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-6 py-10">
      <div className="w-full max-w-sm">
        <h1 className="mb-8 flex flex-col items-center gap-3 text-center">
          <WabisukeMark className="size-12" />
          <AppName className="text-title font-bold text-label" />
        </h1>
        <Card className="shadow-md">
          <form onSubmit={(e) => void onSubmit(e)} className="space-y-4">
            <div>
              <Label htmlFor="username">{t('auth.username')}</Label>
              <Input
                id="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                required
              />
            </div>
            <div>
              <Label htmlFor="password">{t('auth.password')}</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            </div>
            {error && <ErrorText>{error}</ErrorText>}
            <Button type="submit" disabled={busy || !canSubmit} className="w-full">
              {busy ? t('auth.signingIn') : t('auth.signIn')}
            </Button>
          </form>
        </Card>
      </div>
    </div>
  );
}
