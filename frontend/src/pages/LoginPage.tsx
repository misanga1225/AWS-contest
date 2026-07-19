// ログイン画面。Cognito のユーザー名・パスワードで認証する。

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../lib/auth';
import { Button, Card, ErrorText, Input, Label } from '../components/ui';

export function LoginPage() {
  const { t } = useTranslation();
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
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
    <div className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-sm">
        <h1 className="mb-4 text-xl font-bold text-slate-800">{t('appName')}</h1>
        <form onSubmit={(e) => void onSubmit(e)} className="space-y-3">
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
          <Button type="submit" disabled={busy} className="w-full">
            {busy ? t('auth.signingIn') : t('auth.signIn')}
          </Button>
        </form>
      </Card>
    </div>
  );
}
