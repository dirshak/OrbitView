using AstroTrack.Application.Abstractions;
using AstroTrack.Domain.Entities;
using SGPdotNET.CoordinateSystem;
using SGPdotNET.Propagation;
using SGPdotNET.TLE;
using SGPdotNET.Util;

namespace AstroTrack.Infrastructure.Propagation;

/// <summary>SGP4 propagation using the SGP.NET library.</summary>
public sealed class Sgp4OrbitPropagator : IOrbitPropagator
{
    public SatellitePosition? Propagate(Satellite sat, DateTimeOffset at)
    {
        var sgp = TryLoad(sat);
        if (sgp is null) return null;

        try
        {
            var eci = sgp.Predict(at.UtcDateTime);
            var geo = eci.ToGeodetic();
            var velocity = eci.Velocity.Length;

            return new SatellitePosition
            {
                SatelliteId = sat.Id,
                Timestamp = at,
                LatitudeDeg = geo.Latitude.Degrees,
                LongitudeDeg = geo.Longitude.Degrees,
                AltitudeKm = geo.Altitude,
                VelocityKmS = velocity,
            };
        }
        catch
        {
            return null;
        }
    }

    public IReadOnlyList<SatellitePosition> ComputeOrbitTrail(
        Satellite sat, DateTimeOffset start, int samples = 120)
    {
        var sgp = TryLoad(sat);
        if (sgp is null) return Array.Empty<SatellitePosition>();

        if (!double.TryParse(sat.TleLine2.AsSpan(52, 11).Trim(), out var meanMotion) ||
            meanMotion <= 0)
            return Array.Empty<SatellitePosition>();

        var periodMinutes = 1440.0 / meanMotion;
        var stepMs = (periodMinutes * 60_000.0) / samples;
        var trail = new List<SatellitePosition>(samples);
        for (var i = 0; i < samples; i++)
        {
            var t = start.AddMilliseconds(i * stepMs);
            var p = Propagate(sat, t);
            if (p is not null) trail.Add(p);
        }
        return trail;
    }

    public IReadOnlyList<PassWindowDto> PredictPasses(
        Satellite sat,
        double observerLatDeg,
        double observerLonDeg,
        double observerHeightKm,
        TimeSpan horizon,
        int maxPasses)
    {
        var sgp = TryLoad(sat);
        if (sgp is null) return Array.Empty<PassWindowDto>();

        var observer = new SGPdotNET.Observation.GroundStation(new GeodeticCoordinate(
            Angle.FromDegrees(observerLatDeg),
            Angle.FromDegrees(observerLonDeg),
            observerHeightKm));

        var stepSeconds = 30.0;
        var steps = (int)(horizon.TotalSeconds / stepSeconds);
        var startUtc = DateTime.UtcNow;
        var passes = new List<PassWindowDto>();
        var inPass = false;
        DateTime passStart = default;
        DateTime peakTime = default;
        var peakElevation = double.NegativeInfinity;

        for (var i = 0; i < steps; i++)
        {
            var t = startUtc.AddSeconds(i * stepSeconds);
            try
            {
                var topo = observer.Observe(sgp, t);
                var elDeg = topo.Elevation.Degrees;

                if (elDeg > 0)
                {
                    if (!inPass)
                    {
                        inPass = true;
                        passStart = t;
                        peakElevation = elDeg;
                        peakTime = t;
                    }
                    else if (elDeg > peakElevation)
                    {
                        peakElevation = elDeg;
                        peakTime = t;
                    }
                }
                else if (inPass)
                {
                    passes.Add(new PassWindowDto(
                        new DateTimeOffset(passStart, TimeSpan.Zero),
                        new DateTimeOffset(peakTime, TimeSpan.Zero),
                        new DateTimeOffset(t, TimeSpan.Zero),
                        peakElevation,
                        ScoreVisibility(peakElevation, peakTime)));
                    inPass = false;
                    peakElevation = double.NegativeInfinity;
                    if (passes.Count >= maxPasses) break;
                }
            }
            catch
            {
                // skip propagation errors at this step
            }
        }
        return passes;
    }

    private static SGPdotNET.Observation.Satellite? TryLoad(Satellite sat)
    {
        try
        {
            var tle = new Tle(sat.Name, sat.TleLine1, sat.TleLine2);
            return new SGPdotNET.Observation.Satellite(tle);
        }
        catch
        {
            return null;
        }
    }

    private static double ScoreVisibility(double maxElevationDeg, DateTime peakTime)
    {
        var elScore = Math.Min(1.0, maxElevationDeg / 60.0);
        var hour = peakTime.Hour;
        var twilightBoost = hour <= 5 || hour >= 19 ? 0.25
                          : hour <= 7 || hour >= 17 ? 0.15
                          : 0.0;
        return Math.Min(1.0, elScore * 0.85 + twilightBoost);
    }
}
