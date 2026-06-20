using AstroTrack.Application.Dtos;
using AstroTrack.Application.Services;
using Microsoft.AspNetCore.Mvc;

namespace AstroTrack.Api.Controllers;

[ApiController]
[Route("api/satellites")]
public sealed class SatellitesController(SatelliteService service) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<IReadOnlyList<SatelliteDto>>> GetAll(CancellationToken ct)
        => Ok(await service.GetCatalogAsync(ct));

    [HttpGet("{noradId:int}")]
    public async Task<ActionResult<SatelliteDto>> GetById(int noradId, CancellationToken ct)
    {
        var dto = await service.GetByNoradIdAsync(noradId, ct);
        return dto is null ? NotFound() : Ok(dto);
    }

    [HttpGet("{noradId:int}/position")]
    public async Task<ActionResult<SatellitePositionDto>> GetPosition(int noradId, CancellationToken ct)
    {
        var pos = await service.GetCurrentPositionAsync(noradId, ct);
        return pos is null ? NotFound() : Ok(pos);
    }

    [HttpGet("{noradId:int}/orbit")]
    public async Task<ActionResult<OrbitTrailDto>> GetOrbit(
        int noradId,
        [FromQuery] int samples = 120,
        CancellationToken ct = default)
    {
        var clamped = Math.Clamp(samples, 16, 720);
        var trail = await service.GetOrbitTrailAsync(noradId, clamped, ct);
        return trail is null ? NotFound() : Ok(trail);
    }

    [HttpGet("{noradId:int}/passes")]
    public async Task<ActionResult<IReadOnlyList<PassDto>>> GetPasses(
        int noradId,
        [FromQuery] double lat,
        [FromQuery] double lon,
        [FromQuery] double heightKm = 0,
        [FromQuery] int hours = 48,
        [FromQuery] int maxPasses = 5,
        CancellationToken ct = default)
    {
        if (lat is < -90 or > 90 || lon is < -180 or > 180)
            return BadRequest(new { error = "lat must be in [-90,90] and lon in [-180,180]" });

        var clampedHours = Math.Clamp(hours, 1, 168);
        var clampedMax = Math.Clamp(maxPasses, 1, 20);
        var passes = await service.GetPassesAsync(
            noradId, lat, lon, heightKm, clampedHours, clampedMax, ct);
        return passes is null ? NotFound() : Ok(passes);
    }
}
