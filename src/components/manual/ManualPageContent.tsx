import type { ManualBlock, ManualCoverMeta, ManualPageDef } from '@/lib/manual/types';
import { cn } from '@/lib/utils';

function Callout({
  title,
  text,
  variant = 'info',
}: {
  title: string;
  text: string;
  variant?: 'info' | 'warning' | 'tip';
}) {
  const styles = {
    info: 'border-blue-200 bg-blue-50 text-blue-900 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-100',
    warning:
      'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100',
    tip: 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-100',
  }[variant];

  return (
    <div className={cn('rounded-xl border px-4 py-3', styles)}>
      <p className="mb-1 text-sm font-semibold">{title}</p>
      <p className="m-0 text-sm leading-relaxed opacity-90">{text}</p>
    </div>
  );
}

function BlockRenderer({ block }: { block: ManualBlock }) {
  switch (block.type) {
    case 'paragraph':
      return (
        <p className="m-0 text-sm leading-relaxed text-gray-600 dark:text-gray-300 md:text-[15px] md:leading-7">
          {block.text}
        </p>
      );
    case 'list':
      if (block.ordered) {
        return (
          <ol className="m-0 list-decimal space-y-2 pl-5 text-sm leading-relaxed text-gray-600 dark:text-gray-300 md:text-[15px]">
            {block.items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ol>
        );
      }
      return (
        <ul className="m-0 list-disc space-y-2 pl-5 text-sm leading-relaxed text-gray-600 dark:text-gray-300 md:text-[15px]">
          {block.items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      );
    case 'steps':
      return (
        <div className="grid gap-3">
          {block.steps.map((step, i) => (
            <div
              key={step.title}
              className="grid grid-cols-[auto_1fr] gap-3 rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-slate-900/50"
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-lg font-bold text-white shadow-sm">
                {i + 1}
              </div>
              <div>
                <p className="m-0 font-semibold text-gray-900 dark:text-gray-100">{step.title}</p>
                <p className="mt-1 mb-0 text-sm leading-relaxed text-gray-600 dark:text-gray-300">
                  {step.text}
                </p>
              </div>
            </div>
          ))}
        </div>
      );
    case 'callout':
      return <Callout title={block.title} text={block.text} variant={block.variant} />;
    case 'faq':
      return (
        <div className="grid gap-3">
          {block.items.map((item) => (
            <div
              key={item.q}
              className="rounded-xl border border-gray-200 bg-gray-50/80 p-4 dark:border-gray-700 dark:bg-slate-900/40"
            >
              <p className="m-0 font-semibold text-gray-900 dark:text-gray-100">{item.q}</p>
              <p className="mt-2 mb-0 text-sm leading-relaxed text-gray-600 dark:text-gray-300">
                {item.a}
              </p>
            </div>
          ))}
        </div>
      );
    default:
      return null;
  }
}

export function ManualCoverPage({ cover }: { cover: ManualCoverMeta }) {
  return (
    <div className="relative flex min-h-full flex-col justify-between gap-6 p-1 text-white">
      <div className="pointer-events-none absolute -right-12 -top-12 h-48 w-48 rounded-full bg-white/10 blur-2xl" />
      <div>
        <span className="inline-flex rounded-full border border-white/20 bg-white/10 px-3 py-1 text-[10px] font-bold uppercase tracking-widest">
          Manual de usuario
        </span>
        <p className="mt-4 text-sm font-semibold uppercase tracking-[0.2em] text-blue-100/90">
          Gestión Stock
        </p>
        <h1 className="mt-3 text-3xl font-bold leading-tight tracking-tight md:text-4xl lg:text-5xl">
          Guía para {cover.rolLabel}
        </h1>
        <p className="mt-4 max-w-lg text-sm leading-relaxed text-blue-50/95 md:text-base">
          Instrucciones de uso de inventarios, vencimientos y herramientas administrativas según
          los permisos de tu perfil.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <span className="rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-xs font-semibold">
          Edición {cover.edition}
        </span>
        <span className="rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-xs font-semibold">
          {cover.modules.length} módulos
        </span>
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        {cover.modules.slice(0, 3).map((mod) => (
          <div
            key={mod}
            className="rounded-xl border border-white/10 bg-white/10 px-3 py-3 text-center text-sm font-semibold backdrop-blur-sm"
          >
            {mod}
          </div>
        ))}
      </div>
    </div>
  );
}

export function ManualPageBody({
  page,
  cover,
}: {
  page: ManualPageDef;
  cover: ManualCoverMeta;
}) {
  if (page.isCover) {
    return <ManualCoverPage cover={cover} />;
  }

  return (
    <div className="grid gap-4">
      {page.blocks.map((block, i) => (
        <BlockRenderer key={`${page.id}-block-${i}`} block={block} />
      ))}
    </div>
  );
}

/** Versión simplificada para exportación PDF. */
export function ManualPageBodyExport({
  page,
  cover,
}: {
  page: ManualPageDef;
  cover: ManualCoverMeta;
}) {
  if (page.isCover) {
    return (
      <div
        style={{
          minHeight: 1067,
          padding: '72px 56px',
          background: 'linear-gradient(160deg, #1e3a5f 0%, #2563eb 55%, #3b82f6 100%)',
          color: '#f8fafc',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
        }}
      >
        <div>
          <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.18em', textTransform: 'uppercase', opacity: 0.9 }}>
            Manual de usuario
          </div>
          <div style={{ marginTop: 24, fontSize: 18, letterSpacing: '0.22em', textTransform: 'uppercase' }}>
            Gestión Stock
          </div>
          <h1 style={{ margin: '16px 0 0', fontSize: 48, lineHeight: 1.05 }}>
            Guía para {cover.rolLabel}
          </h1>
          <p style={{ marginTop: 20, maxWidth: 480, fontSize: 16, lineHeight: 1.7, opacity: 0.95 }}>
            Instrucciones según los permisos de tu perfil.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {cover.modules.map((m) => (
            <span
              key={m}
              style={{
                padding: '8px 14px',
                borderRadius: 999,
                background: 'rgba(255,255,255,0.12)',
                fontSize: 13,
                fontWeight: 700,
              }}
            >
              {m}
            </span>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      {page.blocks.map((block, i) => (
        <div key={i}>
          {block.type === 'paragraph' && (
            <p style={{ margin: 0, fontSize: 14, lineHeight: 1.75, color: '#334155' }}>{block.text}</p>
          )}
          {block.type === 'list' && (
            <ul style={{ margin: 0, paddingLeft: 20, fontSize: 14, lineHeight: 1.8, color: '#334155' }}>
              {block.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          )}
          {block.type === 'steps' &&
            block.steps.map((step, si) => (
              <div key={step.title} style={{ marginBottom: 12, padding: 14, border: '1px solid #e2e8f0', borderRadius: 12 }}>
                <strong>
                  {si + 1}. {step.title}
                </strong>
                <p style={{ margin: '6px 0 0', fontSize: 14, color: '#475569' }}>{step.text}</p>
              </div>
            ))}
          {block.type === 'callout' && (
            <div style={{ padding: 14, borderRadius: 12, background: '#eff6ff', border: '1px solid #bfdbfe' }}>
              <strong>{block.title}</strong>
              <p style={{ margin: '6px 0 0', fontSize: 14 }}>{block.text}</p>
            </div>
          )}
          {block.type === 'faq' &&
            block.items.map((item) => (
              <div key={item.q} style={{ marginBottom: 10, padding: 14, background: '#f8fafc', borderRadius: 12 }}>
                <strong>{item.q}</strong>
                <p style={{ margin: '6px 0 0', fontSize: 14, color: '#475569' }}>{item.a}</p>
              </div>
            ))}
        </div>
      ))}
    </div>
  );
}
