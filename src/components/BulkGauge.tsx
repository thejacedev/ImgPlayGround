import type { Provider } from "../lib/types";
import { PROVIDER_COLORS } from "../lib/types";

export type JobState = {
  provider: Provider;
  status: "pending" | "success" | "failed";
};

export default function BulkGauge({ jobs }: { jobs: JobState[] }) {
  if (jobs.length === 0) return null;
  return (
    <div
      className="gauge"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={jobs.length}
      aria-valuenow={
        jobs.filter((j) => j.status === "success" || j.status === "failed").length
      }
    >
      {jobs.map((j, i) => (
        <span
          key={i}
          className="gauge-tick"
          data-state={j.status}
          style={
            { ["--tc" as string]: `var(${PROVIDER_COLORS[j.provider]})` } as
              React.CSSProperties
          }
          title={`${j.provider} · ${j.status}`}
        />
      ))}
    </div>
  );
}
