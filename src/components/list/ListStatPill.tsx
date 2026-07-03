export function ListStatPill({
  label,
  value,
  emphasize,
  valueClassName,
}: {
  label: string;
  value: string;
  emphasize?: boolean;
  valueClassName?: string;
}) {
  return (
    <div className="rounded-md border border-gray-200 bg-gray-50/80 px-1.5 py-1 dark:border-gray-700 dark:bg-slate-800/50">
      <p className="text-[9px] font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
        {label}
      </p>
      <p
        className={`mt-0 text-xs tabular-nums sm:text-sm ${
          emphasize ? 'font-semibold text-gray-900 dark:text-gray-100' : 'text-gray-800 dark:text-gray-200'
        } ${valueClassName ?? ''}`}
      >
        {value}
      </p>
    </div>
  );
}
