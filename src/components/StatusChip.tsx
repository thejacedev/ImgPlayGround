import type { ReactNode } from "react";

type Status = "success" | "danger" | "neutral";

export function StatusChip({
  status,
  children,
}: {
  status: Status;
  children: ReactNode;
}) {
  const cls =
    status === "success"
      ? "chip-success"
      : status === "danger"
      ? "chip-danger"
      : "chip-neutral";
  return <span className={`chip ${cls}`}>{children}</span>;
}
