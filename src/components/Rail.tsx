import { useStore } from "../lib/store";

type Tab = "generate" | "bulk" | "queue" | "gallery" | "keys" | "settings";

const ICON: Record<Tab, JSX.Element> = {
  generate: (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 2v3M10 15v3M2 10h3M15 10h3M4.6 4.6l2.1 2.1M13.3 13.3l2.1 2.1M4.6 15.4l2.1-2.1M13.3 6.7l2.1-2.1"/>
      <circle cx="10" cy="10" r="2.2" />
    </svg>
  ),
  bulk: (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
      <path d="M4 5h12M4 10h12M4 15h12"/>
      <circle cx="2.5" cy="5" r="0.9" fill="currentColor" stroke="none"/>
      <circle cx="2.5" cy="10" r="0.9" fill="currentColor" stroke="none"/>
      <circle cx="2.5" cy="15" r="0.9" fill="currentColor" stroke="none"/>
    </svg>
  ),
  queue: (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="10" cy="10" r="7" />
      <path d="M10 6v4l2.5 2.5" />
    </svg>
  ),
  gallery: (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4">
      <rect x="3" y="3" width="6" height="6" rx="1" />
      <rect x="11" y="3" width="6" height="6" rx="1" />
      <rect x="3" y="11" width="6" height="6" rx="1" />
      <rect x="11" y="11" width="6" height="6" rx="1" />
    </svg>
  ),
  keys: (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="6" cy="10" r="3" />
      <path d="M9 10h9M15 10v3M18 10v2.5" />
    </svg>
  ),
  settings: (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
      <path d="M3 6h7M14 6h3" />
      <circle cx="12" cy="6" r="2" />
      <path d="M3 14h3M10 14h7" />
      <circle cx="8" cy="14" r="2" />
    </svg>
  ),
};

const TABS: { id: Tab; label: string }[] = [
  { id: "generate", label: "Generate" },
  { id: "bulk", label: "Bulk" },
  { id: "queue", label: "Queue" },
  { id: "gallery", label: "Gallery" },
  { id: "keys", label: "Keys" },
  { id: "settings", label: "Settings" },
];

export default function Rail() {
  const { tab, setTab, queue } = useStore();
  const inFlight = queue.filter(
    (j) => j.status === "pending" || j.status === "running"
  ).length;
  return (
    <aside className="rail">
      <div className="rail-brand" aria-label="ImgPlayGround" />
      {TABS.map((t) => {
        const showBadge = t.id === "queue" && inFlight > 0;
        return (
          <button
            key={t.id}
            className="rail-btn"
            data-tip={t.label}
            aria-current={tab === t.id ? "page" : undefined}
            aria-label={
              showBadge ? `${t.label} (${inFlight} in flight)` : t.label
            }
            onClick={() => setTab(t.id)}
          >
            {ICON[t.id]}
            {showBadge && (
              <span className="rail-badge" aria-hidden>
                {inFlight > 99 ? "99+" : inFlight}
              </span>
            )}
          </button>
        );
      })}
    </aside>
  );
}
