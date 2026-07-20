// Tailwind ベースの UI プリミティブ群 (shadcn/ui 相当を軽量に自前実装)。
// 色は index.css の @theme セマンティックトークン経由でのみ参照する。
//
// フラットデザイン: グラデーション・内側ハイライトは使わない。
// 面の区別は「白背景 + 1px hairline + ごく弱い影」だけで行う。

import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';
import type { SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { cn } from '../lib/cn';

// アニメーションは 200ms ease-in-out。ホバーは色変更のみ。
const MOTION = 'transition-colors duration-200 ease-standard';
// 押下時だけ transform を許す (:active の scale)。
const MOTION_PRESSABLE =
  'transition-[background-color,border-color,color,box-shadow,opacity,transform] duration-200 ease-standard';

// focus-visible リングは必須 (outline-none の単独指定は禁止)。
const FOCUS = 'outline-none focus-visible:ring-3 focus-visible:ring-accent/40';
const FOCUS_DANGER = 'outline-none focus-visible:ring-3 focus-visible:ring-danger/40';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';
type Size = 'sm' | 'md';

/*
 * 状態の差をはっきり付ける。
 * 有効 = 濃い塗り + 白文字、無効 = 淡い塗り + カーソル不可。
 * hover は `enabled:` を付けて無効時に反応しないようにする
 * (無効なのにホバーで色が変わると「押せる」と誤解させるため)。
 */
const variantClass: Record<Variant, string> = {
  primary:
    'bg-accent-solid text-white enabled:hover:bg-accent-solid-hover disabled:bg-accent-solid/30 disabled:text-white/80',
  secondary:
    'border border-separator bg-surface text-label enabled:hover:bg-sunken disabled:opacity-45',
  danger: `bg-danger-solid text-white enabled:hover:bg-danger-solid-hover disabled:bg-danger-solid/30 disabled:text-white/80 ${FOCUS_DANGER}`,
  ghost:
    'bg-transparent text-label-2 enabled:hover:bg-fill enabled:hover:text-label disabled:opacity-45',
};

// 仕様: ボタン高さ48px / 左右padding24px / 文字16px Medium。
// sm は補助操作用（一覧内の「退所」等）で、タップターゲットは40px を確保する。
const sizeClass: Record<Size, string> = {
  sm: 'h-10 px-4 text-sub',
  md: 'h-12 px-6 text-body',
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export function Button({
  variant = 'primary',
  size = 'md',
  className = '',
  ...rest
}: ButtonProps) {
  return (
    <button
      className={cn(
        'inline-flex shrink-0 items-center justify-center gap-2 rounded-control font-medium',
        // アイコンは 20px に統一する
        '[&_svg]:size-5 [&_svg]:shrink-0',
        // pointer-events-none にしない: カーソル形状で「押せない」ことを伝えるため
        // (クリック自体は disabled 属性がネイティブに止める)
        'active:scale-[0.98] disabled:cursor-not-allowed',
        MOTION_PRESSABLE,
        variant === 'danger' ? '' : FOCUS,
        sizeClass[size],
        variantClass[variant],
        className,
      )}
      {...rest}
    />
  );
}

type Tone = 'default' | 'warn' | 'accent' | 'sunken';

// 共通カード: 白背景 / 16px角丸 / 1px hairline / ごく弱い影 / padding 24px。
const toneClass: Record<Tone, string> = {
  default: 'border-hairline bg-surface shadow-card',
  warn: 'border-warn-muted bg-warn-tint',
  accent: 'border-accent-muted bg-accent-tint',
  sunken: 'border-hairline bg-sunken',
};

export function Card({
  children,
  tone = 'default',
  className = '',
}: {
  children: ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <div className={cn('rounded-card border p-6', toneClass[tone], className)}>{children}</div>
  );
}

/** カード見出し（20px Semibold）。カード内の最初の要素として使う。 */
export function CardTitle({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <h2 className={cn('text-section text-label', className)}>{children}</h2>;
}

// 入力欄: 高さ48px / 角丸10px / border #D8DDE3 / フォーカスでブランドグリーン。
const FIELD = cn(
  'w-full rounded-control border border-[#d8dde3] bg-surface px-4 text-body text-label',
  'placeholder:text-label-3 disabled:opacity-50',
  'outline-none focus-visible:border-accent focus-visible:ring-3 focus-visible:ring-accent/40',
  MOTION,
);

export function Input({ className = '', ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(FIELD, 'h-12', className)} {...rest} />;
}

// textarea は最低160px。十分な余白を設ける。
export function Textarea({ className = '', ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(FIELD, 'min-h-40 py-3 leading-relaxed', className)} {...rest} />;
}

// ドロップダウンも入力欄と同じ高さに統一する。
export function Select({ className = '', ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn(FIELD, 'h-12 cursor-pointer', className)} {...rest} />;
}

// ラベルは入力欄の上に配置する。
export function Label({ children, htmlFor }: { children: ReactNode; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="mb-2 block text-sub font-medium text-label-2">
      {children}
    </label>
  );
}

export function ErrorText({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="text-sub text-danger-ink">
      {children}
    </p>
  );
}

// 色は親から継承する (ボタン内では白、単体では label-2 など)。
export function Spinner({ label, className = '' }: { label?: string; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <span
        aria-hidden="true"
        className="size-4 animate-spin rounded-full border-2 border-current/25 border-t-current"
      />
      {label}
    </span>
  );
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-control bg-fill-strong', className)} />;
}

// 読み込み中のカード占位。素の「読み込み中…」テキストの代替。
export function SkeletonCard() {
  return (
    <Card>
      <Skeleton className="h-5 w-32" />
      <Skeleton className="mt-4 h-4 w-full" />
      <Skeleton className="mt-2 h-4 w-2/3" />
    </Card>
  );
}

export function EmptyState({ message, action }: { message: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-card border border-dashed border-separator px-6 py-12 text-center">
      <p className="text-sub text-label-2">{message}</p>
      {action}
    </div>
  );
}
