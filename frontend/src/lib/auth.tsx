// Cognito 認証状態を扱うコンテキスト。Amplify v6 の Auth モジュールのみを使う。

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { getCurrentUser, signIn, signOut } from 'aws-amplify/auth';
import { registerForceLogout } from './authEvents';

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

export interface AuthContextValue {
  status: AuthStatus;
  username: string | null;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [username, setUsername] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const user = await getCurrentUser();
      setUsername(user.username);
      setStatus('authenticated');
    } catch {
      setUsername(null);
      setStatus('unauthenticated');
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const login = useCallback(
    async (user: string, password: string) => {
      const { isSignedIn, nextStep } = await signIn({ username: user, password });
      if (!isSignedIn) {
        throw new Error(`追加のログイン手順が必要です: ${nextStep.signInStep}`);
      }
      await refresh();
    },
    [refresh],
  );

  const logout = useCallback(async () => {
    await signOut();
    setUsername(null);
    setStatus('unauthenticated');
  }, []);

  // API 応答が 401 を返したら (lib/authEvents 経由で) 強制的にログアウトする。
  // トークン失効後も画面上は「ログイン中」に見え続けるのを防ぐ。
  useEffect(() => {
    registerForceLogout(() => {
      void logout();
    });
    return () => registerForceLogout(null);
  }, [logout]);

  const value = useMemo<AuthContextValue>(
    () => ({ status, username, login, logout }),
    [status, username, login, logout],
  );

  return <AuthContext value={value}>{children}</AuthContext>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
