-- Invalidión de sesiones en otros dispositivos (cookie HMAC + versión).
alter table operadores
  add column if not exists session_version integer not null default 0;

comment on column operadores.session_version is
  'Se incrementa al cerrar sesión en otros dispositivos; la cookie debe coincidir.';
