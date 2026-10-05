// Tarjetas KPI del Panel de inicio.
// valor y tendencia son placeholders hasta conectar la fuente real.
// sparklineEjemplo: datos de muestra para la mini línea de tendencia (decorativa).

export const metricas = [
  {
    id: 'plantel-activo',
    titulo: 'Plantel Activo',
    // TODO: conectar a tabla Supabase o hoja Sheets con total de empleados activos
    valor: '—',
    descripcion: 'empleados',
    tendencia: null,
    color: '#1a4a7a',
    icono: 'personas',
    sparklineEjemplo: null,
  },
  {
    id: 'ausentismo',
    titulo: 'Ausentismo',
    proximamente: true,
    descripcion: 'del período actual',
    color: '#e67e22',
    icono: 'calendario',
  },
  {
    id: 'solicitudes-pendientes',
    titulo: 'Solicitudes Pend.',
    proximamente: true,
    descripcion: 'permisos y licencias',
    color: '#8e44ad',
    icono: 'documento',
  },
  {
    id: 'ingresos-mes',
    titulo: 'Ingresos este mes',
    valor: '—',
    descripcion: 'altas del mes en curso',
    color: '#27ae60',
    icono: 'ingreso',
  },
];
