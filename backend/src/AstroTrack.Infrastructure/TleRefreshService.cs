using AstroTrack.Application.Abstractions;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace AstroTrack.Infrastructure;

/// <summary>
/// Background worker that refreshes the TLE catalog on a fixed cadence.
/// In production, swap to Hangfire/Quartz with persistent scheduling.
/// </summary>
public sealed class TleRefreshService(
    ITleProvider provider,
    ISatelliteCatalog catalog,
    ILogger<TleRefreshService> logger) : BackgroundService
{
    private static readonly TimeSpan RefreshInterval = TimeSpan.FromHours(6);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        // First refresh runs immediately so the catalog isn't empty on cold start.
        await RefreshAsync(stoppingToken);

        using var timer = new PeriodicTimer(RefreshInterval);
        while (!stoppingToken.IsCancellationRequested && await timer.WaitForNextTickAsync(stoppingToken))
        {
            await RefreshAsync(stoppingToken);
        }
    }

    private async Task RefreshAsync(CancellationToken ct)
    {
        try
        {
            var sats = await provider.FetchAsync(ct);
            await catalog.UpsertManyAsync(sats, ct);
            logger.LogInformation("TLE refresh upserted {Count} satellites", sats.Count);
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "TLE refresh failed");
        }
    }
}
