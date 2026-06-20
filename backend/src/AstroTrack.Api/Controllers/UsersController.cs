using System.Collections.Concurrent;
using Microsoft.AspNetCore.Mvc;

namespace AstroTrack.Api.Controllers;

/// <summary>
/// Stub user controller for the MVP. Stores favorites and default location
/// in-memory keyed by an X-User-Id header. Replace with proper auth (Auth0,
/// Azure AD B2C, etc.) and a Postgres-backed user repository before production.
/// </summary>
[ApiController]
[Route("api/users")]
public sealed class UsersController : ControllerBase
{
    private static readonly ConcurrentDictionary<string, UserState> Users = new();

    [HttpPost("location")]
    public ActionResult SetLocation([FromBody] LocationRequest req)
    {
        if (req.Latitude is < -90 or > 90 || req.Longitude is < -180 or > 180)
            return BadRequest(new { error = "Invalid coordinates" });
        var userId = ResolveUserId();
        var state = Users.GetOrAdd(userId, _ => new UserState());
        state.Latitude = req.Latitude;
        state.Longitude = req.Longitude;
        state.City = req.City;
        return Ok(new { userId, req.Latitude, req.Longitude, req.City });
    }

    [HttpGet("favorites")]
    public ActionResult<IEnumerable<int>> GetFavorites()
    {
        var userId = ResolveUserId();
        return Ok(Users.TryGetValue(userId, out var s) ? s.Favorites.ToArray() : Array.Empty<int>());
    }

    [HttpPost("favorites/{noradId:int}")]
    public ActionResult AddFavorite(int noradId)
    {
        var userId = ResolveUserId();
        var state = Users.GetOrAdd(userId, _ => new UserState());
        state.Favorites.Add(noradId);
        return NoContent();
    }

    [HttpDelete("favorites/{noradId:int}")]
    public ActionResult RemoveFavorite(int noradId)
    {
        var userId = ResolveUserId();
        if (Users.TryGetValue(userId, out var state)) state.Favorites.Remove(noradId);
        return NoContent();
    }

    private string ResolveUserId()
    {
        if (Request.Headers.TryGetValue("X-User-Id", out var v) && !string.IsNullOrWhiteSpace(v))
            return v.ToString();
        return "anonymous";
    }

    public sealed record LocationRequest(double Latitude, double Longitude, string? City);

    private sealed class UserState
    {
        public double? Latitude { get; set; }
        public double? Longitude { get; set; }
        public string? City { get; set; }
        public HashSet<int> Favorites { get; } = new();
    }
}
