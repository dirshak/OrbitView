using AstroTrack.Domain.Entities;

namespace AstroTrack.Application.Dtos;

public sealed record SatelliteDto(
    int NoradId,
    string Name,
    string Category,
    string? Operator,
    string? Country,
    string? LaunchDate,
    string? OrbitType,
    string? MissionDescription,
    string DataSource,
    string TleLine1,
    string TleLine2)
{
    public static SatelliteDto FromEntity(Satellite s) => new(
        s.NoradId,
        s.Name,
        s.Category,
        s.Operator,
        s.Country,
        s.LaunchDate?.ToString("O"),
        s.OrbitType,
        s.MissionDescription,
        s.DataSource,
        s.TleLine1,
        s.TleLine2);
}

public sealed record SatellitePositionDto(
    int NoradId,
    DateTimeOffset Timestamp,
    double LatitudeDeg,
    double LongitudeDeg,
    double AltitudeKm,
    double VelocityKmS);

public sealed record OrbitTrailDto(
    int NoradId,
    DateTimeOffset Start,
    IReadOnlyList<SatellitePositionDto> Points);

public sealed record PassDto(
    DateTimeOffset StartTime,
    DateTimeOffset PeakTime,
    DateTimeOffset EndTime,
    double MaxElevationDeg,
    double VisibilityScore);

public sealed record MissionDto(
    string Id,
    string Name,
    string Agency,
    string Description,
    string Link,
    string? ImageUrl,
    int? NoradId);
