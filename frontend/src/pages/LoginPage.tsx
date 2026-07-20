// ログイン画面。Cognito のユーザー名・パスワードで認証する。

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../lib/auth';
import { AppName } from '../components/AppName';
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
    <div className="mat-ambient flex min-h-screen items-center justify-center px-5 py-10">
      <div className="w-full max-w-sm">
        <h1 className="mb-6 text-center">
          <AppName className="text-display text-label" />
        </h1>
        <Card className="mat-raised p-6">
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
            <Button type="submit" disabled={busy} className="w-full">
              {busy ? t('auth.signingIn') : t('auth.signIn')}
            </Button>
          </form>
        </Card>
      </div>
    </div>
  );
}
