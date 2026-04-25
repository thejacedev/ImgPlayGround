import { useEffect } from "react";
import { useStore } from "../lib/store";

const DURATION = {
  info: 4000,
  success: 4000,
  error: 7000,
} as const;

export default function Toasts() {
  const { toasts, dismissToast } = useStore();

  useEffect(() => {
    const timers = toasts.map((t) =>
      window.setTimeout(() => dismissToast(t.id), DURATION[t.kind])
    );
    return () => {
      timers.forEach(window.clearTimeout);
    };
  }, [toasts, dismissToast]);

  return (
    <div
      aria-live="polite"
      className="fixed bottom-4 right-4 space-y-2 z-50 pointer-events-none"
    >
      {toasts.map((t) => {
        const kind =
          t.kind === "error"
            ? "toast-error"
            : t.kind === "success"
            ? "toast-success"
            : "toast-info";
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => dismissToast(t.id)}
            aria-label={`${t.kind}: ${t.message}. Click to dismiss.`}
            className={`toast ${kind} pointer-events-auto text-left`}
          >
            {t.message}
          </button>
        );
      })}
    </div>
  );
}
