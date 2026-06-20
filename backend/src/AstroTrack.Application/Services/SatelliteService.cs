using AstroTrack.Application.Abstractions;
using AstroTrack.Application.Dtos;

namespace AstroTrack.Application.Services;

public sealed class SatelliteService(
    ISatelliteCatalog catalog,
    IOrbitPropagator propagator)
{
    public async Task<IReadOnlyList<SatelliteDto>> GetCatalogAsync(CancellationToken ct = default)
    {
        var sats = await catalog.GetAllAsync(ct);
        return sats.Select(SatelliteDto.FromEntity).ToList();
    }

    public async Task<SatelliteDto?> GetByNoradIdAsync(int id, CancellationToken ct = default)
    {
        var s = await catalog.GetByNoradIdAsync(id, ct);
        return s is null ? null : SatelliteDto.FromEntity(s);
    }

    public async Task<SatellitePositionDto?> GetCurrentPositionAsync(int id, CancellationToken ct = default)
    {
        var s = await catalog.GetByNoradIdAsync(id, ct);
        if (s is null) return null;
        var p = propagator.Propagate(s, DateTimeOffset.UtcNow);
        if (p is null) return null;
        return new SatellitePositionDto(
            s.NoradId, p.Timestamp, p.LatitudeDeg, p.LongitudeDeg,
            p.AltitudeKm, p.VelocityKmS);
    }

    public async Task<OrbitTrailDto?> GetOrbitTrailAsync(int id, int samples, CancellationToken ct = default)
    {
        var s = await catalog.GetByNoradIdAsync(id, ct);
        if (s is null) return null;
        var start = DateTimeOffset.UtcNow;
        var pts = propagator.ComputeOrbitTrail(s, start, samples);
        var dtos = pts
            .Select(p => new SatellitePositionDto(
                s.NoradId, p.Timestamp, p.LatitudeDeg, p.LongitudeDeg,
                p.AltitudeKm, p.VelocityKmS))
            .ToList();
        return new OrbitTrailDto(s.NoradId, start, dtos);
    }

    public async Task<IReadOnlyList<PassDto>?> GetPassesAsync(
        int id,
        double lat,
        double lon,
        double heightKm,
        int hours,
        int maxPasses,
        CancellationToken ct = default)
    {
        var s = await catalog.GetByNoradIdAsync(id, ct);
        if (s is null) return null;
        var passes = propagator.PredictPasses(
            s, lat, lon, heightKm, TimeSpan.FromHours(hours), maxPasses);
        return passes
            .Select(p => new PassDto(p.StartTime, p.PeakTime, p.EndTime, p.MaxElevationDeg, p.VisibilityScore))
            .ToList();
    }
}
