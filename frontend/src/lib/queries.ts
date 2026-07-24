// TanStack Query による API フック。タイムラインは refetchInterval で自動更新する。

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useApi } from './appContext';
import type {
  ApproveRecordInput,
  CreateRecordInput,
  ListRecordsParams,
  ResidentInput,
  TriggerSummaryInput,
} from './api';

// --- 利用者 ---
/**
 * フロアの利用者一覧。既定では在籍中のみ。
 * `includeDischarged` で退所者も含める (過去記録の氏名解決に使う)。
 */
export function useResidents(floor: string, includeDischarged = false) {
  const api = useApi();
  return useQuery({
    queryKey: ['residents', floor, includeDischarged],
    queryFn: () => api.listResidents(floor, includeDischarged),
  });
}

export function useSeedDemo() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (floors?: string[]) => api.seedDemo(floors),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['residents'] }),
  });
}

export function useCreateResident() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ResidentInput) => api.createResident(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['residents'] }),
  });
}

export function useUpdateResident() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: ResidentInput }) =>
      api.updateResident(id, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['residents'] }),
  });
}

export function useDeleteResident() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, floor }: { id: string; floor: string }) => api.deleteResident(id, floor),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['residents'] }),
  });
}

// --- 記録 ---
export function useRecords(params: ListRecordsParams) {
  const api = useApi();
  return useQuery({
    queryKey: ['records', params],
    queryFn: () => api.listRecords(params),
    refetchInterval: 30_000,
  });
}

export function useCreateRecord() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateRecordInput) => api.createRecord(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['records'] }),
  });
}

export function useApproveRecord() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: ApproveRecordInput }) =>
      api.approveRecord(id, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['records'] }),
  });
}

export function useDeleteRecord() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, floor, createdAt }: { id: string; floor: string; createdAt: string }) =>
      api.deleteRecord(id, floor, createdAt),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['records'] }),
  });
}

// --- サマリ ---
export function useSummaries(floor: string) {
  const api = useApi();
  return useQuery({
    queryKey: ['summaries', floor],
    queryFn: () => api.listSummaries(floor),
  });
}

export function useTriggerSummary() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: TriggerSummaryInput) => api.triggerSummary(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['summaries'] }),
  });
}
