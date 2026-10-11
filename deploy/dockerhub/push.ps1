# Experiment 2 - push the OrbitView images to Docker Hub.
#
# Prerequisites:  docker login -u <your-dockerhub-username>   (use an access token as the password)
# Usage:          powershell -ExecutionPolicy Bypass -File deploy/dockerhub/push.ps1 -User <username> [-Version 1.0.0]
#
# Tags the three locally built images as <user>/orbitview-<service>:<version> and :latest,
# pushes them, and writes push-log.txt (digests) next to this script as evidence.

param(
    [Parameter(Mandatory = $true)][string]$User,
    [string]$Version = "1.0.0"
)

$ErrorActionPreference = "Stop"
$images = [ordered]@{
    "astrotrack-frontend:latest"   = "orbitview-frontend"
    "astrotrack-backend:latest"    = "orbitview-backend"
    "astrotrack-ml-service:latest" = "orbitview-ml-service"
}
$log = Join-Path $PSScriptRoot "push-log.txt"
"`nOrbitView Docker Hub push - $(Get-Date -Format "yyyy-MM-dd HH:mm:ss zzz")" | Add-Content -Encoding utf8 $log

foreach ($local in $images.Keys) {
    $repo = "$User/$($images[$local])"
    foreach ($tag in @($Version, "latest")) {
        docker tag $local "${repo}:$tag"
        if ($LASTEXITCODE -ne 0) { throw "docker tag failed for $local" }
        docker push "${repo}:$tag"
        if ($LASTEXITCODE -ne 0) { throw "docker push failed for ${repo}:$tag (are you logged in?)" }
    }
    $digest = docker inspect --format "{{index .RepoDigests 0}}" "${repo}:$Version"
    "${repo}:${Version}  ->  $digest" | Add-Content -Encoding utf8 $log
}

Write-Host "`nPushed. Digests written to $log"
Get-Content $log
