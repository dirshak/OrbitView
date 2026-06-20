using AstroTrack.Domain.Entities;
using Microsoft.EntityFrameworkCore;

namespace AstroTrack.Infrastructure.Data;

public sealed class AstroTrackDbContext(DbContextOptions<AstroTrackDbContext> options)
    : DbContext(options)
{
    public DbSet<Satellite> Satellites => Set<Satellite>();
    public DbSet<SatellitePosition> SatellitePositions => Set<SatellitePosition>();
    public DbSet<UserProfile> UserProfiles => Set<UserProfile>();
    public DbSet<UserFavorite> UserFavorites => Set<UserFavorite>();
    public DbSet<PassPrediction> PassPredictions => Set<PassPrediction>();

    protected override void OnModelCreating(ModelBuilder mb)
    {
        mb.Entity<Satellite>(e =>
        {
            e.ToTable("satellites");
            e.HasKey(x => x.Id);
            e.HasIndex(x => x.NoradId).IsUnique();
            e.HasIndex(x => x.Category);
            e.Property(x => x.Name).IsRequired();
            e.Property(x => x.Category).IsRequired();
            e.Property(x => x.TleLine1).IsRequired();
            e.Property(x => x.TleLine2).IsRequired();
            e.Property(x => x.DataSource).IsRequired();
        });

        mb.Entity<SatellitePosition>(e =>
        {
            e.ToTable("satellite_positions");
            e.HasKey(x => x.Id);
            e.HasIndex(x => new { x.SatelliteId, x.Timestamp });
        });

        mb.Entity<UserProfile>(e =>
        {
            e.ToTable("user_profiles");
            e.HasKey(x => x.Id);
            e.HasIndex(x => x.Email).IsUnique();
            e.Property(x => x.Email).IsRequired();
        });

        mb.Entity<UserFavorite>(e =>
        {
            e.ToTable("user_favorites");
            e.HasKey(x => x.Id);
            e.HasIndex(x => new { x.UserId, x.NoradId }).IsUnique();
        });

        mb.Entity<PassPrediction>(e =>
        {
            e.ToTable("pass_predictions");
            e.HasKey(x => x.Id);
            e.HasIndex(x => new { x.UserId, x.StartTime });
        });
    }
}
