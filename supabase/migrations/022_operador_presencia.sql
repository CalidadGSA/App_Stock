-- Presencia / heartbeat de operadores autenticados (contador "usuarios conectados").
create table if not exists public.operador_presencia (
  idoperador integer primary key references public.operadores (idoperador) on delete cascade,
  nombrecompleto text,
  last_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_operador_presencia_last_seen
  on public.operador_presencia (last_seen_at desc);

comment on table public.operador_presencia is
  'Última actividad conocida por operador (heartbeat del cliente).';

comment on column public.operador_presencia.last_seen_at is
  'Timestamp del último ping; se considera conectado si es reciente (ej. < 3 min).';

comment on column public.operador_presencia.nombrecompleto is
  'Nombre completo del operador al momento del último ping (desde sesión).';
