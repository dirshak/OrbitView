using AstroTrack.Application.Abstractions;
using AstroTrack.Domain.Entities;
using Microsoft.Extensions.Logging;

namespace AstroTrack.Infrastructure.Providers;

public sealed class CelesTrakTleProvider(
    HttpClient http,
    ILogger<CelesTrakTleProvider> logger) : ITleProvider
{
    private static readonly (string Group, string Category, string? Operator)[] Groups =
    [
        ("stations", "iss", null),
        ("weather", "weather", null),
        ("noaa", "weather", "NOAA"),
        ("goes", "weather", "NOAA"),
        ("resource", "earth-observation", null),
        ("sarsat", "earth-observation", null),
        // Student-built and university satellites: CubeSats, education
        // missions, and amateur-radio satellites.
        ("cubesat", "cubesat", null),
        ("education", "cubesat", null),
        ("amateur", "cubesat", null),
        ("starlink", "communication", "SpaceX"),
        ("iridium-NEXT", "communication", "Iridium"),
        ("gps-ops", "navigation", "USAF"),
        ("galileo", "navigation", "ESA"),
        ("science", "science", null),
        ("active", "other", null),
    ];

    public async Task<IReadOnlyList<Satellite>> FetchAsync(CancellationToken ct = default)
    {
        var byNorad = new Dictionary<int, Satellite>();
        foreach (var (group, category, op) in Groups)
        {
            try
            {
                var url = $"https://celestrak.org/NORAD/elements/gp.php?GROUP={Uri.EscapeDataString(group)}&FORMAT=tle";
                var text = await http.GetStringAsync(url, ct);
                foreach (var sat in ParseTle(text, category, $"CelesTrak/{group}", op))
                {
                    if (!byNorad.ContainsKey(sat.NoradId))
                        byNorad[sat.NoradId] = sat;
                    else if (category != "other" && byNorad[sat.NoradId].Category == "other")
                        byNorad[sat.NoradId] = sat; // promote out of generic bucket
                }
            }
            catch (Exception ex)
            {
                logger.LogWarning(ex, "Failed to fetch CelesTrak group {Group}", group);
            }
        }
        return byNorad.Values.OrderBy(s => s.Name).ToList();
    }

    public static IEnumerable<Satellite> ParseTle(
        string text, string category, string source, string? op)
    {
        var lines = text.Split(['\r', '\n'], StringSplitOptions.RemoveEmptyEntries);
        for (var i = 0; i + 2 < lines.Length; i++)
        {
            var name = lines[i].Trim();
            var l1 = lines[i + 1];
            var l2 = lines[i + 2];
            if (!l1.StartsWith("1 ") || !l2.StartsWith("2 ")) continue;
            if (!int.TryParse(l1.AsSpan(2, 5).Trim(), out var noradId)) continue;

            yield return new Satellite
            {
                NoradId = noradId,
                Name = name,
                Category = category,
                Operator = op,
                OrbitType = ClassifyOrbit(l2),
                TleLine1 = l1,
                TleLine2 = l2,
                DataSource = source,
                LastUpdatedAt = DateTimeOffset.UtcNow,
            };
            i += 2;
        }
    }

    private static string ClassifyOrbit(string l2)
    {
        if (!double.TryParse(l2.AsSpan(52, 11).Trim(), out var meanMotion)) return "Unknown";
        var inclination = double.TryParse(l2.AsSpan(8, 8).Trim(), out var inc) ? inc : double.NaN;
        if (meanMotion < 1.5) return "GEO";
        if (meanMotion < 5) return "MEO";
        if (!double.IsNaN(inclination))
        {
            if (inclination is >= 96 and <= 100) return "SSO";
            if (inclination > 80) return "Polar";
        }
        return "LEO";
    }
}
