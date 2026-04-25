import {
  PROVIDER_COLORS,
  PROVIDER_LABELS,
  type Provider,
} from "../lib/types";

type Size = "xs" | "sm";

export function ProviderDot({
  provider,
  size = "sm",
}: {
  provider: Provider;
  size?: Size;
}) {
  const s = size === "xs" ? "h-1.5 w-1.5" : "h-2 w-2";
  return (
    <span
      aria-hidden
      className={`inline-block ${s} rounded-full shrink-0`}
      style={{ background: `var(${PROVIDER_COLORS[provider]})` }}
    />
  );
}

export function ProviderChip({
  provider,
  size = "sm",
  className = "",
}: {
  provider: Provider;
  size?: Size;
  className?: string;
}) {
  const text = size === "xs" ? "text-[10px]" : "text-xs";
  return (
    <span className={`inline-flex items-center gap-1.5 ${text} ${className}`}>
      <ProviderDot provider={provider} size={size} />
      <span className="truncate">{PROVIDER_LABELS[provider]}</span>
    </span>
  );
}
