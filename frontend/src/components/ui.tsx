// Tailwind ベースの UI プリミティブ群 (shadcn/ui 相当を軽量に自前実装)。
// 色は index.css の @theme セマンティックトークン経由でのみ参照する。

import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';
import type { SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { cn } from '../lib/cn';

// 上品なホバー = 塗りの微変化のみ。hover で transform や大きな影は使わない。
const MOTION =
  'transition-[background-color,border-color,color,box-shadow,opacity,filter] duration-150 ease-spring';
// 押下時だけ transform を許す (:active の scale)。
const MOTION_PRESSABLE =
  'transition-[background-color,border-color,color,box-shadow,opacity,filter,transform] duration-150 ease-spring';

// focus-visible リングは必須 (outline-none の単独指定は禁止)。
const FOCUS = 'outline-none focus-visible:ring-3 focus-visible:ring-accent/30';
const FOCUS_DANGER = 'outline-none focus-visible:ring-3 focus-visible:ring-danger/30';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';
type Size = 'sm' | 'md';

// 面の質感 (グラデーション・内側ハイライト・落ち影) は index.css の mat-* が持つ。
// ここでは文字色と disabled のフォールバック色だけを指定する。
const variantClass: Record<Variant, string> = {
  primary: 'mat-primary bg-accent text-white disabled:bg-accent/35 disabled:text-white/80',
  secondary: 'mat-secondary text-label disabled:opacity-45',
  danger: `mat-danger bg-danger text-white disabled:bg-danger/35 disabled:text-white/80 ${FOCUS_DANGER}`,
  ghost: 'bg-transparent text-label-2 hover:bg-fill hover:text-label disabled:opacity-45',
};

const sizeClass: Record<Size, string> = {
  sm: 'h-8 px-3 text-sub',
  md: 'h-10 px-4 text-[14px]',
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
        'inline-flex shrink-0 items-center justify-center gap-1.5 rounded-control font-medium',
        'active:scale-[0.98] disabled:pointer-events-none',
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

// 影は使わない (Deference)。面の区別は 1px の hairline のみで行う。
const toneClass: Record<Tone, string> = {
  default: 'mat-surface border-separator bg-surface',
  warn: 'border-warn-muted bg-warn-tint',
  accent: 'border-accent-muted bg-accent-tint',
  sunken: 'border-separator bg-sunken',
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
    <div className={cn('rounded-card border p-4', toneClass[tone], className)}>{children}</div>
  );
}

// フォーカスリングは mat-field:focus-visible が box-shadow で描く
// (ring ユーティリティを併用すると utilities レイヤーが勝って内側の凹みが消えるため)。
const FIELD = cn(
  'mat-field w-full rounded-control border border-separator bg-surface px-3 py-2 text-[14px] text-label',
  'placeholder:text-label-3 outline-none focus-visible:border-accent disabled:opacity-50',
  MOTION,
);

export function Input({ className = '', ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(FIELD, 'h-10', className)} {...rest} />;
}

export function Textarea({ className = '', ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(FIELD, 'leading-relaxed', className)} {...rest} />;
}

export function Select({ className = '', ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn(FIELD, 'h-10 cursor-pointer', className)} {...rest} />;
}

export function Label({ children, htmlFor }: { children: ReactNode; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 block text-sub font-medium text-label-2">
      {children}
    </label>
  );
}

export function ErrorText({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="text-sub text-danger">
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
        className="size-3.5 animate-spin rounded-full border-2 border-current/25 border-t-current"
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
      <Skeleton className="h-4 w-32" />
      <Skeleton className="mt-3 h-3 w-full" />
      <Skeleton className="mt-2 h-3 w-2/3" />
    </Card>
  );
}

export function EmptyState({ message, action }: { message: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-card border border-dashed border-separator px-4 py-10 text-center">
      <p className="text-sub text-label-2">{message}</p>
      {action}
    </div>
  );
}
