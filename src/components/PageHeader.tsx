import type { ReactNode } from "react";

export default function PageHeader({
  num,
  title,
  subtitle,
  right,
}: {
  num: string;
  title: string;
  subtitle?: ReactNode;
  right?: ReactNode;
}) {
  return (
    <div className="page-head flex items-start justify-between gap-4">
      <div className="min-w-0">
        <div className="page-title">{title}</div>
        {subtitle && <div className="page-sub">{subtitle}</div>}
      </div>
      <div className="flex items-center gap-3 shrink-0 relative z-10">
        {right}
      </div>
      <span className="page-num" aria-hidden>
        {num}
      </span>
    </div>
  );
}
