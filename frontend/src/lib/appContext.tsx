// アプリ全体で共有する設定・API クライアント・選択中フロア。

import { createContext, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { ApiClient } from './api';
import type { RuntimeConfig } from './config';

export interface AppContextValue {
  config: RuntimeConfig;
  api: ApiClient;
  floor: string;
  setFloor: (floor: string) => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ config, children }: { config: RuntimeConfig; children: ReactNode }) {
  const api = useMemo(() => new ApiClient(config.apiEndpoint), [config.apiEndpoint]);
  const [floor, setFloor] = useState<string>(config.floors[0] ?? '1');

  const value = useMemo<AppContextValue>(
    () => ({ config, api, floor, setFloor }),
    [config, api, floor],
  );

  return <AppContext value={value}>{children}</AppContext>;
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}

export function useApi(): ApiClient {
  return useApp().api;
}
