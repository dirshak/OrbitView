# --- build stage ---
FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /src
COPY backend/AstroTrack.sln backend/Directory.Build.props ./backend/
COPY backend/src ./backend/src
COPY backend/tests ./backend/tests
RUN dotnet restore backend/AstroTrack.sln
RUN dotnet publish backend/src/AstroTrack.Api/AstroTrack.Api.csproj \
    -c Release -o /app/publish /p:UseAppHost=false

# --- run stage ---
FROM mcr.microsoft.com/dotnet/aspnet:8.0 AS final
WORKDIR /app
# curl is used by the container HEALTHCHECK below; it is not in the base image.
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/publish ./
ENV ASPNETCORE_URLS=http://0.0.0.0:8080
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s CMD curl -f http://localhost:8080/healthz || exit 1
ENTRYPOINT ["dotnet", "AstroTrack.Api.dll"]
