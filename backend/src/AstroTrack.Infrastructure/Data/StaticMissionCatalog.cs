using AstroTrack.Application.Abstractions;
using AstroTrack.Domain.Entities;

namespace AstroTrack.Infrastructure.Data;

public sealed class StaticMissionCatalog : IMissionCatalog
{
    private static readonly Mission[] Missions =
    [
        new()
        {
            Id = "iss",
            Name = "International Space Station",
            Agency = "NASA / Roscosmos / ESA / JAXA / CSA",
            Description = "A modular space station in low Earth orbit, hosting continuous crewed presence since November 2000. Conducts microgravity research across biology, physics, astronomy, and Earth observation.",
            Link = "https://www.nasa.gov/international-space-station/",
            ImageUrl = "https://images-assets.nasa.gov/image/iss066e081229/iss066e081229~medium.jpg",
            NoradId = 25544,
        },
        new()
        {
            Id = "hubble",
            Name = "Hubble Space Telescope",
            Agency = "NASA / ESA",
            Description = "Optical/UV/near-infrared space telescope launched in 1990. Has produced some of the most detailed visible-light images of the universe, helping refine the age and expansion rate of the cosmos.",
            Link = "https://science.nasa.gov/mission/hubble/",
            ImageUrl = "https://images-assets.nasa.gov/image/hubble-sees-the-wings-of-a-butterfly-the-twin-jet-nebula_20283986193_o/hubble-sees-the-wings-of-a-butterfly-the-twin-jet-nebula_20283986193_o~medium.jpg",
            NoradId = 20580,
        },
        new()
        {
            Id = "jpss",
            Name = "Joint Polar Satellite System (NOAA-20 / JPSS-1)",
            Agency = "NOAA / NASA",
            Description = "Polar-orbiting weather and Earth observation constellation that provides global atmospheric and surface data twice per day. Critical input to numerical weather prediction.",
            Link = "https://www.nesdis.noaa.gov/our-satellites/currently-flying/joint-polar-satellite-system",
            NoradId = 43013,
        },
        new()
        {
            Id = "landsat-9",
            Name = "Landsat 9",
            Agency = "NASA / USGS",
            Description = "Continues the longest-running enterprise for acquisition of multispectral satellite imagery of Earth's land surface. Used in agriculture, forestry, water resources, and climate science.",
            Link = "https://landsat.gsfc.nasa.gov/satellites/landsat-9/",
        },
    ];

    public Task<IReadOnlyList<Mission>> GetAllAsync(CancellationToken ct = default)
        => Task.FromResult<IReadOnlyList<Mission>>(Missions);

    public Task<Mission?> GetByIdAsync(string id, CancellationToken ct = default)
        => Task.FromResult(Missions.FirstOrDefault(m => m.Id == id));
}
