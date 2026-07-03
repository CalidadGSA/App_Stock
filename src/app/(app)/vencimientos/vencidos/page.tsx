import { redirect } from 'next/navigation';

/** Ruta anterior; redirige a productos para devolver. */
export default function VencidosRedirectPage() {
  redirect('/vencimientos/para-devolver');
}
