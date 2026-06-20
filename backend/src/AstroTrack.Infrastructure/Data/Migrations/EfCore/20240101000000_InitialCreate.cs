using System;
using AstroTrack.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace AstroTrack.Infrastructure.Data.Migrations.EfCore;

/// <inheritdoc />
[DbContext(typeof(AstroTrackDbContext))]
[Migration("20240101000000_InitialCreate")]
public partial class InitialCreate : Migration
{
    /// <inheritdoc />
    protected override void Up(MigrationBuilder mb)
    {
        mb.CreateTable(
            name: "satellites",
            columns: t => new
            {
                Id = t.Column<Guid>(nullable: false),
                NoradId = t.Column<int>(nullable: false),
                Name = t.Column<string>(nullable: false),
                Category = t.Column<string>(nullable: false),
                Operator = t.Column<string>(nullable: true),
                Country = t.Column<string>(nullable: true),
                LaunchDate = t.Column<DateOnly>(nullable: true),
                OrbitType = t.Column<string>(nullable: true),
                TleLine1 = t.Column<string>(nullable: false),
                TleLine2 = t.Column<string>(nullable: false),
                MissionDescription = t.Column<string>(nullable: true),
                DataSource = t.Column<string>(nullable: false),
                LastUpdatedAt = t.Column<DateTimeOffset>(nullable: false, defaultValueSql: "NOW()")
            },
            constraints: t => t.PrimaryKey("PK_satellites", x => x.Id));

        mb.CreateIndex("IX_satellites_NoradId", "satellites", "NoradId", unique: true);
        mb.CreateIndex("IX_satellites_Category", "satellites", "Category");

        mb.CreateTable(
            name: "satellite_positions",
            columns: t => new
            {
                Id = t.Column<Guid>(nullable: false),
                SatelliteId = t.Column<Guid>(nullable: false),
                Timestamp = t.Column<DateTimeOffset>(nullable: false),
                LatitudeDeg = t.Column<double>(nullable: false),
                LongitudeDeg = t.Column<double>(nullable: false),
                AltitudeKm = t.Column<double>(nullable: false),
                VelocityKmS = t.Column<double>(nullable: false)
            },
            constraints: t =>
            {
                t.PrimaryKey("PK_satellite_positions", x => x.Id);
                t.ForeignKey("FK_satellite_positions_satellites", x => x.SatelliteId,
                    "satellites", "Id", onDelete: ReferentialAction.Cascade);
            });

        mb.CreateIndex("IX_satellite_positions_SatelliteId_Timestamp",
            "satellite_positions", ["SatelliteId", "Timestamp"]);

        mb.CreateTable(
            name: "user_profiles",
            columns: t => new
            {
                Id = t.Column<Guid>(nullable: false),
                Email = t.Column<string>(nullable: false),
                DisplayName = t.Column<string>(nullable: true),
                DefaultLatitude = t.Column<double>(nullable: true),
                DefaultLongitude = t.Column<double>(nullable: true),
                DefaultCity = t.Column<string>(nullable: true),
                CreatedAt = t.Column<DateTimeOffset>(nullable: false, defaultValueSql: "NOW()")
            },
            constraints: t => t.PrimaryKey("PK_user_profiles", x => x.Id));

        mb.CreateIndex("IX_user_profiles_Email", "user_profiles", "Email", unique: true);

        mb.CreateTable(
            name: "user_favorites",
            columns: t => new
            {
                Id = t.Column<Guid>(nullable: false),
                UserId = t.Column<Guid>(nullable: false),
                NoradId = t.Column<int>(nullable: false)
            },
            constraints: t =>
            {
                t.PrimaryKey("PK_user_favorites", x => x.Id);
                t.ForeignKey("FK_user_favorites_user_profiles", x => x.UserId,
                    "user_profiles", "Id", onDelete: ReferentialAction.Cascade);
            });

        mb.CreateIndex("IX_user_favorites_UserId_NoradId",
            "user_favorites", ["UserId", "NoradId"], unique: true);

        mb.CreateTable(
            name: "pass_predictions",
            columns: t => new
            {
                Id = t.Column<Guid>(nullable: false),
                UserId = t.Column<Guid>(nullable: false),
                NoradId = t.Column<int>(nullable: false),
                StartTime = t.Column<DateTimeOffset>(nullable: false),
                PeakTime = t.Column<DateTimeOffset>(nullable: false),
                EndTime = t.Column<DateTimeOffset>(nullable: false),
                MaxElevationDeg = t.Column<double>(nullable: false),
                VisibilityScore = t.Column<double>(nullable: false)
            },
            constraints: t =>
            {
                t.PrimaryKey("PK_pass_predictions", x => x.Id);
                t.ForeignKey("FK_pass_predictions_user_profiles", x => x.UserId,
                    "user_profiles", "Id", onDelete: ReferentialAction.Cascade);
            });

        mb.CreateIndex("IX_pass_predictions_UserId_StartTime",
            "pass_predictions", ["UserId", "StartTime"]);
    }

    /// <inheritdoc />
    protected override void Down(MigrationBuilder mb)
    {
        mb.DropTable("pass_predictions");
        mb.DropTable("user_favorites");
        mb.DropTable("user_profiles");
        mb.DropTable("satellite_positions");
        mb.DropTable("satellites");
    }
}
