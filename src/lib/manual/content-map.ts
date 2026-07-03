import type { ManualBlock, ManualPageDef } from '@/lib/manual/types';

/** Contenido por ítem del menú lateral (id en app-nav). */
export const MANUAL_NAV_CONTENT: Record<string, ManualPageDef> = {
  dashboard: {
    id: 'dashboard',
    label: 'Dashboard',
    eyebrow: 'Panel principal',
    title: 'Dashboard',
    blocks: [
      {
        type: 'paragraph',
        text: 'El dashboard es el punto de entrada después del login. Resume el estado de la sucursal con indicadores y accesos rápidos.',
      },
      {
        type: 'list',
        items: [
          'Controles de inventario en progreso y pendientes de revisión.',
          'Productos por vencer y alertas de vencimientos.',
          'Progreso del trimestre de inventario, expandible por macro categoría.',
          'Accesos directos a las secciones más usadas.',
        ],
      },
      {
        type: 'callout',
        title: 'Modo mantenimiento',
        text: 'Si la base de datos de Plex está desactualizada, la app puede entrar en mantenimiento. Los operadores de sucursal no podrán iniciar inventarios diarios hasta que finalice la sincronización.',
        variant: 'warning',
      },
    ],
  },
  'inventario-nuevo': {
    id: 'inventario-nuevo',
    label: 'Inventario diario',
    eyebrow: 'Inventario',
    title: 'Inventario diario',
    blocks: [
      {
        type: 'paragraph',
        text: 'El inventario diario trabaja con una lista precargada de productos según la categoría macro elegida (FARMA, BIENESTAR o PSICOTROPICOS). No se pueden agregar líneas nuevas: solo se cuentan los productos asignados.',
      },
      {
        type: 'steps',
        steps: [
          {
            title: 'Crear el control',
            text: 'En «Inventario diario», elegí la categoría macro y confirmá. Se generan automáticamente todas las líneas del padrón para esa macro categoría.',
          },
          {
            title: 'Escanear o seleccionar',
            text: 'Usá el lector de código de barras o hacé clic en un producto de la tabla.',
          },
          {
            title: 'Cargar stock real',
            text: 'Ingresá cajas y unidades contadas. Enter o «Confirmar» guarda la línea. Los productos ya inventariados pasan al final de la lista.',
          },
          {
            title: 'Revisar y cerrar',
            text: 'Usá «Revisar diferencias» para verificar faltantes/sobrantes. Al cerrar el control queda registrado para el progreso trimestral.',
          },
        ],
      },
      {
        type: 'callout',
        title: 'Lupa de imágenes',
        text: 'En la ficha del producto, el ícono de lupa abre Google Imágenes con código de barras, nombre y presentación para identificar el producto.',
        variant: 'tip',
      },
    ],
  },
  'inventario-ocasional': {
    id: 'inventario-ocasional',
    label: 'Inventario ocasional',
    eyebrow: 'Inventario',
    title: 'Inventario ocasional',
    blocks: [
      {
        type: 'paragraph',
        text: 'Permite contar productos libremente, sin lista precargada. Útil para revisiones puntuales o productos fuera del inventario diario.',
      },
      {
        type: 'steps',
        steps: [
          { title: 'Iniciar', text: 'Creá un control ocasional desde el menú correspondiente.' },
          {
            title: 'Agregar productos',
            text: 'Escaneá códigos de barras o buscá por nombre/troquel en el padrón. Cada producto se agrega como línea nueva.',
          },
          {
            title: 'Contar y cerrar',
            text: 'Completá el stock real de cada línea y cerrá el control cuando termines.',
          },
        ],
      },
    ],
  },
  'inventario-auditoria': {
    id: 'inventario-auditoria',
    label: 'Auditoría de stock',
    eyebrow: 'Inventario',
    title: 'Auditoría de stock',
    blocks: [
      {
        type: 'paragraph',
        text: 'Los controles de auditoría los realiza el equipo de administración en sucursales. El escaneo es libre y el stock de sistema se consulta al momento del conteo.',
      },
      {
        type: 'list',
        items: [
          'Al cerrar, las líneas quedan en estado auditado.',
          'Las diferencias se revisan en «Diferencias de auditoría».',
          'No está disponible para operadores de sucursal en el menú habitual.',
        ],
      },
    ],
  },
  'inventario-auditoria-sorpresa': {
    id: 'inventario-auditoria-sorpresa',
    label: 'Auditoría integral',
    eyebrow: 'Inventario',
    title: 'Auditoría integral',
    blocks: [
      {
        type: 'paragraph',
        text: 'Carga masiva de productos desde un archivo CSV. Genera un inventario con lista precargada similar al diario, pero con el definido por el archivo de auditoría.',
      },
      {
        type: 'steps',
        steps: [
          { title: 'Subir CSV', text: 'Seleccioná el archivo con los productos a auditar.' },
          { title: 'Contar', text: 'Los productos pendientes quedan arriba; los ya contados, abajo.' },
          { title: 'Cerrar', text: 'Revisá diferencias antes de dar por finalizada la auditoría.' },
        ],
      },
    ],
  },
  'inventario-diferencias-auditoria': {
    id: 'inventario-diferencias-auditoria',
    label: 'Dif. auditoría',
    eyebrow: 'Inventario',
    title: 'Diferencias de auditoría',
    blocks: [
      {
        type: 'paragraph',
        text: 'Listado consolidado de diferencias detectadas en controles de auditoría. Permite filtrar por sucursal, período y estado del control.',
      },
    ],
  },
  'inventario-lista': {
    id: 'inventario-lista',
    label: 'Controles',
    eyebrow: 'Inventario',
    title: 'Controles de inventario',
    blocks: [
      {
        type: 'paragraph',
        text: 'Historial de todos los controles de la sucursal. Desde aquí podés reabrir un control en progreso o consultar uno cerrado.',
      },
      {
        type: 'list',
        items: [
          'Estado: en progreso, cerrado, etc.',
          'Tipo: diario, ocasional, auditoría.',
          'Acceso al detalle con el listado de productos contados.',
          'Se puede filtrar por fecha, tipo y estado del control.',
        ],
      },
    ],
  },
  'inventario-diferencias': {
    id: 'inventario-diferencias',
    label: 'Diferencias',
    eyebrow: 'Inventario',
    title: 'Resumen de diferencias',
    blocks: [
      {
        type: 'paragraph',
        text: 'Muestra productos con diferencia entre stock de sistema y stock contado en inventarios de la sucursal. Sirve para priorizar ajustes y seguimiento.',
      },
      {
        type: 'list',
        items: [
          'Se puede filtrar por fecha, operador y tipo de inventario de origen.',
          'Se pueden exportar las diferencias en un PDF.',
        ],
      },
    ],
  },
  'inventario-diferencias-consolidado': {
    id: 'inventario-diferencias-consolidado',
    label: 'Consolidado',
    eyebrow: 'Inventario',
    title: 'Diferencias consolidado',
    blocks: [
      {
        type: 'paragraph',
        text: 'Vista multi-sucursal de diferencias de inventario. Solo para perfiles con acceso administrativo.',
      },
      {
        type: 'list',
        items: [
          'Se puede filtrar por fecha, periodo, macro categoría y tipo de inventario de origen.',
          'Se pueden exportar las diferencias en un PDF.',
        ],
      },
    ],
  },
  'vencimientos-nuevo': {
    id: 'vencimientos-nuevo',
    label: 'Nuevo control',
    eyebrow: 'Vencimientos',
    title: 'Control de vencimientos',
    blocks: [
      {
        type: 'paragraph',
        text: 'Iniciá un control escaneando los productos con fecha de vencimiento en góndola o depósito. Cada lectura registra cantidad y vencimiento.',
      },
      {
        type: 'steps',
        steps: [
          { title: 'Crear control', text: 'Desde «Control de vencimientos» iniciá un nuevo control.' },
          { title: 'Escanear', text: 'Leé el código de barras e ingresá cantidad y fecha de vencimiento.' },
          { title: 'Cerrar', text: 'Al finalizar, cerrá el control para que los datos se reflejen en los listados.' },
        ],
      },
    ],
  },
  'vencimientos-lista': {
    id: 'vencimientos-lista',
    label: 'Controles venc.',
    eyebrow: 'Vencimientos',
    title: 'Controles de vencimientos',
    blocks: [
      {
        type: 'paragraph',
        text: 'Historial de controles de vencimientos realizados.',
      },
      {
        type: 'list',
        items: [
          'Podés consultar detalles o continuar un control abierto.',
          'Podés filtrar por fecha y estado del control.',
        ],
      },
    ],
  },
  'vencimientos-por-vencer': {
    id: 'vencimientos-por-vencer',
    label: 'Por vencer',
    eyebrow: 'Vencimientos',
    title: 'Productos por vencer',
    blocks: [
      {
        type: 'paragraph',
        text: 'Listado de líneas cargadas en controles que están próximas a vencer. Podés usar múltiples filtros y ordenar por columnas.',
      },
      {
        type: 'callout',
        title: 'Verificación de ventas',
        text: 'Si se vendió un producto después de la carga, el sistema emite un aviso para que se marque como vendido si corresponde.',
        variant: 'info',
      },
    ],
  },
  'vencimientos-consolidado': {
    id: 'vencimientos-consolidado',
    label: 'Consolidado',
    eyebrow: 'Vencimientos',
    title: 'Por vencer consolidado',
    blocks: [
      {
        type: 'paragraph',
        text: 'Listado de productos por vencer en todas las sucursales. Útil para planificación centralizada.',
      },
      {
        type: 'list',
        items: [
          'Se puede filtrar por sucursal, periodo, categoría',
          'Se pueden exportar los productos por vencer en un PDF.',
          'Se puede ordenar por columnas.',
        ],
      },
    ],
  },
  'vencimientos-para-devolver': {
    id: 'vencimientos-para-devolver',
    label: 'Para devolver',
    eyebrow: 'Vencimientos',
    title: 'Productos para devolver',
    blocks: [
      {
        type: 'paragraph',
        text: 'Productos que cumplen criterios de devolución a droguería según proximidad al vencimiento (BIENESTAR: menos de 10 días; FARMA/PSICO: mes anterior al vencimiento).',
      },
      {
        type: 'steps',
        steps: [
          { title: 'Revisar listado', text: 'Filtrá por bulto/droguería si corresponde.' },
          {
            title: 'Marcar vendido',
            text: 'Si ya se vendió todo o parte, registrá la cantidad vendida.',
          },
          {
            title: 'Devolver',
            text: 'Usá «Devolver todos» por sucursal. Si se vendió menos del 50 % de la carga original, la observación es obligatoria.',
          },
        ],
      },
    ],
  },
  'vencimientos-devoluciones': {
    id: 'vencimientos-devoluciones',
    label: 'Devoluciones',
    eyebrow: 'Vencimientos',
    title: 'Historial de devoluciones',
    blocks: [
      {
        type: 'paragraph',
        text: 'Registro de devoluciones realizadas. Permite auditar qué se devolvió, cuándo y con qué observaciones.',
      },
    ],
  },
  'vencimientos-descuentos': {
    id: 'vencimientos-descuentos',
    label: 'Descuentos',
    eyebrow: 'Vencimientos',
    title: 'Descuentos por vencimiento',
    blocks: [
      {
        type: 'paragraph',
        text: 'Configuración de reglas de descuento según días al vencimiento y categoría. Incluye asignación de productos específicos cuando aplica.',
      },
    ],
  },
  'resumen-trimestral': {
    id: 'resumen-trimestral',
    label: 'Resumen trimestral',
    eyebrow: 'Administración',
    title: 'Resumen trimestral',
    blocks: [
      {
        type: 'paragraph',
        text: 'Seguimiento del cumplimiento de inventarios diarios por trimestre y sucursal, con desglose por macro categoría y estado de cierre.',
      },
    ],
  },
  'informe-mensual': {
    id: 'informe-mensual',
    label: 'Informe mensual',
    eyebrow: 'Administración',
    title: 'Informe mensual',
    blocks: [
      {
        type: 'paragraph',
        text: 'Métricas mensuales por sucursal: vencidos cargados y vendidos, costos, productos inventariados y diferencias en cajas.',
      },
    ],
  },
  'diferencias-psico-ocasional': {
    id: 'diferencias-psico-ocasional',
    label: 'Dif. psico',
    eyebrow: 'Administración',
    title: 'Diferencias psico / estupefacientes',
    blocks: [
      {
        type: 'paragraph',
        text: 'Reporte focalizado en controlados y estupefacientes con diferencias en inventarios ocasionales o auditorías.',
      },
    ],
  },
  ajustes: {
    id: 'ajustes',
    label: 'Ajustes',
    eyebrow: 'Administración',
    title: 'Ajustes de stock',
    blocks: [
      {
        type: 'paragraph',
        text: 'Exportá diferencias de inventario para aplicar ajustes en el sistema. Podés filtrar por repetidos (mismas diferencias en varios controles).',
      },
      {
        type: 'list',
        items: [
          'Revisá cada línea antes de exportar.',
          'El historial de ajustes queda en «Historial de ajustes».',
        ],
      },
    ],
  },
  'ajustes-historial': {
    id: 'ajustes-historial',
    label: 'Historial ajustes',
    eyebrow: 'Administración',
    title: 'Historial de ajustes',
    blocks: [
      {
        type: 'paragraph',
        text: 'Consulta de exportaciones y ajustes realizados anteriormente, con fecha, operador y alcance.',
      },
    ],
  },
  'roles-permisos': {
    id: 'roles-permisos',
    label: 'Roles',
    eyebrow: 'Administración',
    title: 'Roles y permisos',
    blocks: [
      {
        type: 'paragraph',
        text: 'Administrá roles personalizados y asigná permisos a operadores. Cada permiso habilita ítems del menú y APIs asociadas.',
      },
      {
        type: 'list',
        items: [
          'Operador sucursal: inventario y vencimientos de su sucursal.',
          'Admin: reportes, ajustes, auditorías, sin modo mantenimiento ni inventario diario forzado en todos los casos.',
          'Superadmin: acceso total incl. mantenimiento y sincronización.',
        ],
      },
    ],
  },
  'padron-productos': {
    id: 'padron-productos',
    label: 'Padrón',
    eyebrow: 'Administración',
    title: 'Padrón de productos',
    blocks: [
      {
        type: 'paragraph',
        text: 'Mantenimiento del padrón final: códigos, descripciones, macro, fraccionable y datos de búsqueda.',
      },
      {
        type: 'list',
        items: [
          'Se pueden seleccionar columnas especificas o todas.',
          'Se puede exportar el padron completo o segun las columnas seleccionadas en un archivo Excel.',
          'Se puede buscar un productopor código de barras, troquel o descripción.',
        ],
      },
    ],
  },
};

export const MANUAL_STATIC_PAGES: Record<string, Omit<ManualPageDef, 'id'> & { id: string }> = {
  portada: {
    id: 'portada',
    label: 'Portada',
    eyebrow: '',
    title: 'Manual de usuario',
    isCover: true,
    blocks: [],
  },
  introduccion: {
    id: 'introduccion',
    label: 'Introducción',
    eyebrow: 'Comenzar',
    title: '¿Qué es Gestión Stock?',
    blocks: [
      {
        type: 'paragraph',
        text: 'Gestión Stock es la aplicación web para controlar inventarios de sucursal, auditorías de stock y vencimientos de productos farmacéuticos. Se integra con el padrón de productos de Plex y el stock de cada sucursal.',
      },
    ],
  },
  acceso: {
    id: 'acceso',
    label: 'Acceso',
    eyebrow: 'Comenzar',
    title: 'Ingreso a sucursal',
    blocks: [
      {
        type: 'steps',
        steps: [
          {
            title: 'Usuario y código',
            text: 'Ingresá tu nombre de operador y código personal en la pantalla de login.',
          },
          {
            title: 'Sucursal',
            text: 'Seleccioná la sucursal.',
          },
          {
            title: 'Contraseña de sucursal',
            text: 'Ingresá la contraseña de sucursal adicional.',
          },
          {
            title: 'Sesión',
            text: 'Si la sesión expira, volverás al login. Los datos guardados en controles no se pierden.',
          },
        ],
      },
      {
        type: 'callout',
        title: 'Administradores',
        text: 'Los perfiles admin y superadmin pueden operar sin sucursal fija o cambiar de sucursal según la función que estén ejecutando.',
        variant: 'info',
      },
    ],
  },
  navegacion: {
    id: 'navegacion',
    label: 'Navegación',
    eyebrow: 'Comenzar',
    title: 'Menú y pantallas',
    blocks: [
      {
        type: 'paragraph',
        text: 'El menú lateral agrupa las funciones por área: General, Inventario, Vencimientos y Administración. Solo verás las opciones habilitadas para tu rol.',
      },
      {
        type: 'list',
        items: [
          'En móvil, abrí el menú con el ícono de tres rayas.',
          'Durante un inventario o control de vencimientos activo, el menú se oculta para maximizar el espacio.',
          'El interruptor de tema claro/oscuro está en la barra superior.',
        ],
      },
    ],
  },
  faq: {
    id: 'faq',
    label: 'FAQ',
    eyebrow: 'Ayuda',
    title: 'Preguntas frecuentes',
    blocks: [
      {
        type: 'faq',
        items: [
          {
            q: '¿Por qué no puedo iniciar un inventario diario?',
            a: 'Puede estar activo el modo mantenimiento mientras se sincroniza la base de datos de Plex.',
          },
          {
            q: '¿El producto no aparece al escanear en inventario diario?',
            a: 'Solo están habilitados los productos de la macro del control. Verificá que el código corresponda a un ítem de la lista.',
          },
          {
            q: '¿Cuándo es obligatoria la observación en devoluciones?',
            a: 'Cuando se vendió menos del 50 % de la cantidad original cargada en el control de vencimientos.',
          },
        ],
      },
    ],
  },
};

export const ROL_LABELS: Record<string, string> = {
  operador_sucursal: 'Operador de sucursal',
  admin: 'Administrador',
  superadmin: 'Superadministrador',
};
