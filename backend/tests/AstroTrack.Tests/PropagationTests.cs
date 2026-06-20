using AstroTrack.Domain.Entities;
using AstroTrack.Infrastructure.Propagation;
using FluentAssertions;
using Xunit;

namespace AstroTrack.Tests;

public class PropagationTests
{
    private static Satellite IssSample() => new()
    {
        NoradId = 25544,
        Name = "ISS (ZARYA)",
        Category = "iss",
        TleLine1 = "1 25544U 98067A   24001.50000000  .00012345  00000-0  22000-3 0  9990",
        TleLine2 = "2 25544  51.6400 100.0000 0006000  90.0000 270.0000 15.50000000300000",
        DataSource = "test",
    };

    [Fact]
    public void Propagate_returns_position_for_valid_tle()
    {
        var prop = new Sgp4OrbitPropagator();
        var pos = prop.Propagate(IssSample(), DateTimeOffset.UtcNow);
        pos.Should().NotBeNull();
        pos!.AltitudeKm.Should().BeInRange(200, 600);
        pos.LatitudeDeg.Should().BeInRange(-90, 90);
        pos.LongitudeDeg.Should().BeInRange(-180, 180);
    }

    [Fact]
    public void Orbit_trail_has_expected_sample_count()
    {
        var prop = new Sgp4OrbitPropagator();
        var trail = prop.ComputeOrbitTrail(IssSample(), DateTimeOffset.UtcNow, samples: 32);
        // Some samples may fail propagation, but we should get most of them.
        trail.Count.Should().BeGreaterThan(20);
    }

    [Fact]
    public void Propagate_returns_null_for_garbage_tle()
    {
        var bogus = new Satellite
        {
            NoradId = 99999,
            Name = "GARBAGE",
            Category = "other",
            TleLine1 = "garbage",
            TleLine2 = "garbage",
            DataSource = "test",
        };
        var prop = new Sgp4OrbitPropagator();
        var pos = prop.Propagate(bogus, DateTimeOffset.UtcNow);
        pos.Should().BeNull();
    }
}
