using AstroTrack.Application.Abstractions;
using AstroTrack.Domain.Entities;
using Microsoft.EntityFrameworkCore;

namespace AstroTrack.Infrastructure.Data;

/// <summary>
/// Postgres-backed catalog via EF Core. Registered when the "Postgres"
/// connection string is present; falls back to <see cref="InMemorySatelliteCatalog"/>.
/// </summary>
public sealed class EfCoreSatelliteCatalog(AstroTrackDbContext db) : ISatelliteCatalog
{
    public async Task<IReadOnlyList<Satellite>> GetAllAsync(CancellationToken ct = default)
        => await db.Satellites.AsNoTracking().OrderBy(s => s.Name).ToListAsync(ct);

    public async Task<Satellite?> GetByNoradIdAsync(int noradId, CancellationToken ct = default)
        => await db.Satellites.AsNoTracking()
            .FirstOrDefaultAsync(s => s.NoradId == noradId, ct);

    public async Task UpsertManyAsync(IEnumerable<Satellite> satellites, CancellationToken ct = default)
    {
        // Bulk upsert — fetch existing NORAD ids, then insert or update.
        var incoming = satellites.ToList();
        var noradIds = incoming.Select(s => s.NoradId).ToHashSet();
        var existing = await db.Satellites
            .Where(s => noradIds.Contains(s.NoradId))
            .ToDictionaryAsync(s => s.NoradId, ct);

        foreach (var sat in incoming)
        {
            if (existing.TryGetValue(sat.NoradId, out var current))
            {
                current.Name = sat.Name;
                current.Category = sat.Category;
                current.Operator = sat.Operator;
                current.Country = sat.Country;
                current.LaunchDate = sat.LaunchDate;
                current.OrbitType = sat.OrbitType;
                current.TleLine1 = sat.TleLine1;
                current.TleLine2 = sat.TleLine2;
                current.MissionDescription = sat.MissionDescription;
                current.DataSource = sat.DataSource;
                current.LastUpdatedAt = DateTimeOffset.UtcNow;
            }
            else
            {
                db.Satellites.Add(sat);
            }
        }

        await db.SaveChangesAsync(ct);
    }
}
