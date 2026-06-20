using AstroTrack.Application.Abstractions;
using AstroTrack.Application.Services;
using AstroTrack.Infrastructure;
using AstroTrack.Infrastructure.Data;
using AstroTrack.Infrastructure.Propagation;
using AstroTrack.Infrastructure.Providers;
using Microsoft.EntityFrameworkCore;
using OpenTelemetry.Metrics;
using OpenTelemetry.Resources;
using OpenTelemetry.Trace;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddControllers();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

var corsOrigins = builder.Configuration
    .GetSection("AstroTrack:Cors:AllowedOrigins")
    .Get<string[]>() ?? ["http://localhost:5173"];
builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(p =>
        p.WithOrigins(corsOrigins).AllowAnyHeader().AllowAnyMethod());
});

// Catalog — use Postgres when connection string is configured, in-memory otherwise.
var pgConn = builder.Configuration.GetConnectionString("Postgres");
if (!string.IsNullOrWhiteSpace(pgConn))
{
    builder.Services.AddDbContext<AstroTrackDbContext>(o =>
        o.UseNpgsql(pgConn, npgsql =>
            npgsql.MigrationsAssembly(typeof(AstroTrackDbContext).Assembly.FullName)));
    builder.Services.AddScoped<ISatelliteCatalog, EfCoreSatelliteCatalog>();
}
else
{
    builder.Services.AddSingleton<ISatelliteCatalog, InMemorySatelliteCatalog>();
}

builder.Services.AddSingleton<IMissionCatalog, StaticMissionCatalog>();
builder.Services.AddSingleton<IOrbitPropagator, Sgp4OrbitPropagator>();
builder.Services.AddScoped<SatelliteService>();

// TLE provider
builder.Services.AddHttpClient<ITleProvider, CelesTrakTleProvider>(c =>
{
    c.Timeout = TimeSpan.FromSeconds(30);
    c.DefaultRequestHeaders.Add("User-Agent", "AstroTrack/0.1 (+https://example.org)");
});

// Background TLE refresh
builder.Services.AddHostedService<TleRefreshService>();

// OpenTelemetry — instrumentation always active; OTLP export is opt-in.
// Set OTEL_EXPORTER_OTLP_ENDPOINT (e.g. http://otel-collector:4317) to enable export.
var otlpEndpoint = builder.Configuration["OTEL_EXPORTER_OTLP_ENDPOINT"]
    ?? Environment.GetEnvironmentVariable("OTEL_EXPORTER_OTLP_ENDPOINT");
var otlpEnabled = !string.IsNullOrWhiteSpace(otlpEndpoint);
builder.Services.AddOpenTelemetry()
    .ConfigureResource(r => r.AddService("astrotrack-api"))
    .WithTracing(t =>
    {
        t.AddAspNetCoreInstrumentation()
         .AddHttpClientInstrumentation();
        if (otlpEnabled)
            t.AddOtlpExporter(o => o.Endpoint = new Uri(otlpEndpoint!));
    })
    .WithMetrics(m =>
    {
        m.AddAspNetCoreInstrumentation()
         .AddHttpClientInstrumentation()
         .AddRuntimeInstrumentation();
        if (otlpEnabled)
            m.AddOtlpExporter(o => o.Endpoint = new Uri(otlpEndpoint!));
    });

var app = builder.Build();

if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

// Auto-apply EF Core migrations on startup when using Postgres.
if (!string.IsNullOrWhiteSpace(pgConn))
{
    using var scope = app.Services.CreateScope();
    var db = scope.ServiceProvider.GetRequiredService<AstroTrackDbContext>();
    await db.Database.MigrateAsync();
}

app.UseCors();
app.MapControllers();
app.MapGet("/healthz", () => Results.Ok(new { status = "ok", time = DateTimeOffset.UtcNow }));

app.Run();
