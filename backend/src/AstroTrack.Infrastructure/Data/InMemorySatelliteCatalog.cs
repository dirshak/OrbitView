using System.Collections.Concurrent;
using AstroTrack.Application.Abstractions;
using AstroTrack.Domain.Entities;

namespace AstroTrack.Infrastructure.Data;

/// <summary>
/// In-memory catalog used for the MVP. Replace with a Postgres-backed
/// implementation by binding <see cref="ISatelliteCatalog"/> to an EF Core
/// repository — public surface stays the same.
/// </summary>
public sealed class InMemorySatelliteCatalog : ISatelliteCatalog
{
    private readonly ConcurrentDictionary<int, Satellite> _byNorad = new();

    public Task<IReadOnlyList<Satellite>> GetAllAsync(CancellationToken ct = default)
    {
        IReadOnlyList<Satellite> snapshot = _byNorad.Values
            .OrderBy(s => s.Name)
            .ToList();
        return Task.FromResult(snapshot);
    }

    public Task<Satellite?> GetByNoradIdAsync(int noradId, CancellationToken ct = default)
    {
        _byNorad.TryGetValue(noradId, out var sat);
        return Task.FromResult(sat);
    }

    public Task UpsertManyAsync(IEnumerable<Satellite> satellites, CancellationToken ct = default)
    {
        foreach (var s in satellites)
        {
            _byNorad.AddOrUpdate(s.NoradId, s, (_, _) => s);
        }
        return Task.CompletedTask;
    }
}
