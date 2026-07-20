// 破壊的操作の確認ダイアログ。ネイティブ <dialog> の showModal() を使い、
// フォーカストラップと Esc キャンセルはブラウザ実装に任せる。
// (window.confirm はスタイルが当たらず、アプリの見た目を大きく損なうため置き換えた)

import { useEffect, useRef } from 'react';
import { Button } from './ui';

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message?: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) {
      el.showModal();
    } else if (!open && el.open) {
      el.close();
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      // Esc / バックドロップクリックはキャンセル扱いにする
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onCancel();
      }}
      className={[
        'w-[min(22rem,calc(100vw-2rem))] rounded-sheet border border-separator bg-surface p-5',
        'text-label backdrop:bg-label/25 backdrop:backdrop-blur-sm',
        // 浮くものにだけ影を許す
        'shadow-[0_12px_32px_rgb(28_27_26/0.16)]',
        'm-auto open:animate-[dialog-in_180ms_cubic-bezier(0.32,0.72,0,1)]',
      ].join(' ')}
    >
      <h2 className="text-section text-label">{title}</h2>
      {message && <p className="mt-1.5 text-sub text-label-2">{message}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel}>
          {cancelLabel}
        </Button>
        <Button variant="danger" onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </div>
    </dialog>
  );
}
