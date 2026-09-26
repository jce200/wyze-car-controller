param(
    [Parameter(Mandatory = $true)]
    [ValidateNotNullOrEmpty()]
    [string]$Camera,
    [string]$User = 'root'
)

$ErrorActionPreference = 'Stop'
$targetHost = "$User@$Camera"
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path

Push-Location $projectRoot
try {
    & ssh.exe $targetHost 'mkdir -p /tmp/wyze-car-deploy'
    if ($LASTEXITCODE -ne 0) { throw 'SSH connection to the camera failed.' }

    & scp.exe -O 'camera/car-daemon.sh' 'camera/car.cgi' 'camera/S95wyze-car' `
        'camera/install-camera.sh' 'web/index.html' 'web/car.css' 'web/car.js' 'web/car-mark.svg' `
        "${targetHost}:/tmp/wyze-car-deploy/"
    if ($LASTEXITCODE -ne 0) { throw 'Copying files to the camera failed.' }

    & ssh.exe $targetHost 'sh /tmp/wyze-car-deploy/install-camera.sh'
    if ($LASTEXITCODE -ne 0) { throw 'Installation on the camera failed.' }

    Write-Host "Open http://$Camera/car/ and sign in to Thingino."
}
finally {
    Pop-Location
}
