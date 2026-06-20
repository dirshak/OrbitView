using AstroTrack.Domain.Entities;

namespace AstroTrack.Application.Abstractions;

public interface ISatelliteCatalog
{
    Task<IReadOnlyList<Satellite>> GetAllAsync(CancellationToken ct = default);
    Task<Satellite?> GetByNoradIdAsync(int noradId, CancellationToken ct = default);
    Task UpsertManyAsync(IEnumerable<Satellite> satellites, CancellationToken ct = default);
}

public interface ITleProvider
{
    /// <summary>Fetches the latest TLE catalog from an external source (e.g. CelesTrak).</summary>
    Task<IReadOnlyList<Satellite>> FetchAsync(CancellationToken ct = default);
}

public interface IOrbitPropagator
{
    SatellitePosition? Propagate(Satellite sat, DateTimeOffset at);

    IReadOnlyList<SatellitePosition> ComputeOrbitTrail(
        Satellite sat,
        DateTimeOffset start,
        int samples = 120);

    IReadOnlyList<PassWindowDto> PredictPasses(
        Satellite sat,
        double observerLatDeg,
        double observerLonDeg,
        double observerHeightKm,
        TimeSpan horizon,
        int maxPasses);
}

public sealed record PassWindowDto(
    DateTimeOffset StartTime,
    DateTimeOffset PeakTime,
    DateTimeOffset EndTime,
    double MaxElevationDeg,
    double VisibilityScore);

public interface IMissionCatalog
{
    Task<IReadOnlyList<Mission>> GetAllAsync(CancellationToken ct = default);
    Task<Mission?> GetByIdAsync(string id, CancellationToken ct = default);
}
