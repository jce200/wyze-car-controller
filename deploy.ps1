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
    $uploadDir = (& ssh.exe $targetHost 'mktemp -d /tmp/wyze-car-deploy.XXXXXX' | Out-String).Trim()
    if ($LASTEXITCODE -ne 0) { throw 'SSH connection to the camera failed.' }
    if ($uploadDir -notmatch '^/tmp/wyze-car-deploy\.[A-Za-z0-9]+$') {
        throw 'Camera did not return a safe upload directory.'
    }
    Write-Host "Upload directory on camera: $uploadDir"

    & scp.exe -O 'camera/car-daemon.sh' 'camera/car.cgi' 'camera/S95wyze-car' `
        'camera/install-camera.sh' 'web/index.html' 'web/car.css' 'web/car.js' 'web/car-logo.svg' 'web/car-logo.js' `
        "${targetHost}:$uploadDir/"
    if ($LASTEXITCODE -ne 0) { throw 'Copying files to the camera failed.' }

    & ssh.exe $targetHost "sh $uploadDir/install-camera.sh $uploadDir"
    if ($LASTEXITCODE -ne 0) { throw 'Installation on the camera failed.' }

    Write-Host "Open http://$Camera/car/ and sign in to Thingino."
}
finally {
    Pop-Location
}
