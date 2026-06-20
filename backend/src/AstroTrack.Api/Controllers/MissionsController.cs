using AstroTrack.Application.Abstractions;
using AstroTrack.Application.Dtos;
using AstroTrack.Domain.Entities;
using Microsoft.AspNetCore.Mvc;

namespace AstroTrack.Api.Controllers;

[ApiController]
[Route("api/missions")]
public sealed class MissionsController(IMissionCatalog catalog) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<IReadOnlyList<MissionDto>>> GetAll(CancellationToken ct)
    {
        var missions = await catalog.GetAllAsync(ct);
        return Ok(missions.Select(ToDto).ToList());
    }

    [HttpGet("{id}")]
    public async Task<ActionResult<MissionDto>> GetById(string id, CancellationToken ct)
    {
        var m = await catalog.GetByIdAsync(id, ct);
        return m is null ? NotFound() : Ok(ToDto(m));
    }

    [HttpGet("{id}/images")]
    public async Task<ActionResult<IEnumerable<string>>> GetImages(string id, CancellationToken ct)
    {
        var m = await catalog.GetByIdAsync(id, ct);
        if (m is null) return NotFound();
        return Ok(m.ImageUrl is null ? Array.Empty<string>() : new[] { m.ImageUrl });
    }

    private static MissionDto ToDto(Mission m) =>
        new(m.Id, m.Name, m.Agency, m.Description, m.Link, m.ImageUrl, m.NoradId);
}
