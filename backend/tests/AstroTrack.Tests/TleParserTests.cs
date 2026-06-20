using AstroTrack.Infrastructure.Providers;
using FluentAssertions;
using Xunit;

namespace AstroTrack.Tests;

public class TleParserTests
{
    private const string SampleTle =
        "ISS (ZARYA)\r\n" +
        "1 25544U 98067A   24001.50000000  .00012345  00000-0  22000-3 0  9990\r\n" +
        "2 25544  51.6400 100.0000 0006000  90.0000 270.0000 15.50000000300000\r\n" +
        "HST\r\n" +
        "1 20580U 90037B   24001.50000000  .00001500  00000-0  10000-3 0  9990\r\n" +
        "2 20580  28.4690 280.0000 0002500  90.0000 270.0000 15.10000000300000\r\n";

    [Fact]
    public void Parses_two_satellites()
    {
        var sats = CelesTrakTleProvider.ParseTle(SampleTle, "iss", "test", null).ToList();
        sats.Should().HaveCount(2);
        sats[0].NoradId.Should().Be(25544);
        sats[0].Name.Should().Be("ISS (ZARYA)");
        sats[1].NoradId.Should().Be(20580);
    }

    [Fact]
    public void Sets_metadata_from_arguments()
    {
        var sats = CelesTrakTleProvider.ParseTle(SampleTle, "weather", "CelesTrak/weather", "NOAA").ToList();
        sats.Should().AllSatisfy(s =>
        {
            s.Category.Should().Be("weather");
            s.DataSource.Should().Be("CelesTrak/weather");
            s.Operator.Should().Be("NOAA");
        });
    }

    [Fact]
    public void Skips_malformed_blocks()
    {
        var malformed = "JUST A NAME LINE\r\nNOT TLE\r\nALSO NOT\r\n";
        var sats = CelesTrakTleProvider.ParseTle(malformed, "other", "test", null).ToList();
        sats.Should().BeEmpty();
    }
}
