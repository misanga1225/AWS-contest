// サービスロゴのマーク。侘助(椿)を抽象化した花弁5枚 + 蕊。
// public/favicon.svg と同じ図形を、ブランドグリーンの円形バッジとして描く。

export function WabisukeMark({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} role="img" aria-hidden="true" focusable="false">
      <circle cx="16" cy="16" r="16" fill="var(--color-accent)" />
      <g fill="#ffffff" fillOpacity=".92">
        <circle cx="16" cy="9.4" r="5.3" />
        <circle cx="22.3" cy="13.9" r="5.3" />
        <circle cx="19.9" cy="21.4" r="5.3" />
        <circle cx="12.1" cy="21.4" r="5.3" />
        <circle cx="9.7" cy="13.9" r="5.3" />
      </g>
      <circle cx="16" cy="16" r="3.4" fill="var(--color-accent)" />
    </svg>
  );
}
