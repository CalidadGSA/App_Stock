import { NextResponse } from 'next/server';
import { getAppMaintenanceStatus } from '@/lib/maintenance';

export async function GET() {
  try {
    const status = await getAppMaintenanceStatus();
    return NextResponse.json({
      maintenance: status.isActive,
      updated_at: status.updatedAt,
    });
  } catch (error) {
    console.error('Error consultando modo_mantenimiento:', error);
    return NextResponse.json(
      {
        maintenance: false,
        updated_at: null,
        error: 'No se pudo consultar el estado de mantenimiento',
      },
      { status: 500 }
    );
  }
}
