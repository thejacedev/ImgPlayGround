export default function Spinner({
  className = "",
  label,
}: {
  className?: string;
  label?: string;
}) {
  return (
    <span
      role="status"
      aria-label={label || "loading"}
      className={`spinner ${className}`}
    />
  );
}
