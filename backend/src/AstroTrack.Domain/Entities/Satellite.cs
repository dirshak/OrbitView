namespace AstroTrack.Domain.Entities;

public sealed class Satellite
{
    public Guid Id { get; init; } = Guid.NewGuid();
    public required int NoradId { get; init; }
    public required string Name { get; set; }
    public required string Category { get; set; }
    public string? Operator { get; set; }
    public string? Country { get; set; }
    public DateOnly? LaunchDate { get; set; }
    public string? OrbitType { get; set; }
    public required string TleLine1 { get; set; }
    public required string TleLine2 { get; set; }
    public string? MissionDescription { get; set; }
    public required string DataSource { get; set; }
    public DateTimeOffset LastUpdatedAt { get; set; } = DateTimeOffset.UtcNow;
}

public sealed class SatellitePosition
{
    public Guid Id { get; init; } = Guid.NewGuid();
    public required Guid SatelliteId { get; init; }
    public required DateTimeOffset Timestamp { get; init; }
    public required double LatitudeDeg { get; init; }
    public required double LongitudeDeg { get; init; }
    public required double AltitudeKm { get; init; }
    public required double VelocityKmS { get; init; }
}

public sealed class UserProfile
{
    public Guid Id { get; init; } = Guid.NewGuid();
    public required string Email { get; set; }
    public string? DisplayName { get; set; }
    public double? DefaultLatitude { get; set; }
    public double? DefaultLongitude { get; set; }
    public string? DefaultCity { get; set; }
    public DateTimeOffset CreatedAt { get; init; } = DateTimeOffset.UtcNow;
}

public sealed class UserFavorite
{
    public Guid Id { get; init; } = Guid.NewGuid();
    public required Guid UserId { get; init; }
    public required int NoradId { get; init; }
}

public sealed class PassPrediction
{
    public Guid Id { get; init; } = Guid.NewGuid();
    public required Guid UserId { get; init; }
    public required int NoradId { get; init; }
    public required DateTimeOffset StartTime { get; init; }
    public required DateTimeOffset PeakTime { get; init; }
    public required DateTimeOffset EndTime { get; init; }
    public required double MaxElevationDeg { get; init; }
    public required double VisibilityScore { get; init; }
}

public sealed class Mission
{
    public required string Id { get; init; }
    public required string Name { get; init; }
    public required string Agency { get; init; }
    public required string Description { get; init; }
    public required string Link { get; init; }
    public string? ImageUrl { get; init; }
    public int? NoradId { get; init; }
}
