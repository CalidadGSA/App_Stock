<#
.SYNOPSIS
  Registra en el Programador de tareas de Windows la corrida diaria de
  "cierre de inventarios + snapshot de stock valorizado (KPIs)".

  Solo hace falta si la app NO corre 24/7 con PM2 (en ese caso el cron ya vive dentro de la app).

.USO (PowerShell como administrador, desde la raíz del repo):
  powershell -ExecutionPolicy Bypass -File scripts\registrar-tarea-cierre-windows.ps1
  powershell -ExecutionPolicy Bypass -File scripts\registrar-tarea-cierre-windows.ps1 -Hora 00:05
  powershell -ExecutionPolicy Bypass -File scripts\registrar-tarea-cierre-windows.ps1 -Quitar

  Probar la tarea ya mismo:  schtasks /Run /TN "GestionStock - Cierre inventarios"
  Ver estado:                schtasks /Query /TN "GestionStock - Cierre inventarios" /V /FO LIST
  Log de cada corrida:       logs\cierre-inventarios.log
#>
param(
  [string]$Hora = '00:00',
  [switch]$Quitar
)

$ErrorActionPreference = 'Stop'
$TaskName = 'GestionStock - Cierre inventarios'
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path

if ($Quitar) {
  schtasks /Delete /TN "$TaskName" /F | Out-Null
  Write-Host "Tarea '$TaskName' eliminada."
  exit 0
}

$Npm = (Get-Command npm.cmd -ErrorAction SilentlyContinue).Source
if (-not $Npm) { throw 'No se encontró npm.cmd en el PATH. Instalá Node.js o agregalo al PATH del sistema.' }

$LogDir = Join-Path $Root 'logs'
if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir | Out-Null }
$Log = Join-Path $LogDir 'cierre-inventarios.log'

# cmd /c para poder redirigir la salida al log; la cwd es la raíz del repo (.env.local, node_modules).
$Comando = "cmd /c `"cd /d `"$Root`" && `"$Npm`" run inventario:cierre >> `"$Log`" 2>&1`""

schtasks /Create /F /SC DAILY /ST $Hora /TN "$TaskName" /TR $Comando /RU SYSTEM /RL HIGHEST | Out-Null

Write-Host "Tarea '$TaskName' registrada: todos los días a las $Hora (hora local del equipo)."
Write-Host "Comando: $Comando"
Write-Host "Probar ahora:  schtasks /Run /TN `"$TaskName`""
