const CACHE_TTL_MS = 15 * 60 * 1000;
const cache = new Map();

function parseDistrictRows(html, year) {
  if (!html) return [];

  const teamAnchors = [...html.matchAll(new RegExp(`/${year}/team/(\\d{1,5})`, 'g'))]
    .map((match) => Number.parseInt(match[1], 10))
    .filter((value) => Number.isFinite(value) && value > 0);

  const seen = new Set();
  const orderedUniqueTeams = [];
  for (const teamNumber of teamAnchors) {
    if (seen.has(teamNumber)) continue;
    seen.add(teamNumber);
    orderedUniqueTeams.push(teamNumber);
  }

  return orderedUniqueTeams.map((teamNumber, index) => ({
    rank: index + 1,
    teamNumber
  }));
}

export async function fetchCaDistrictTop48Snapshot(year) {
  const parsedYear = Number.parseInt(String(year || ''), 10);
  const effectiveYear = Number.isFinite(parsedYear) ? parsedYear : new Date().getFullYear();
  const cacheKey = String(effectiveYear);
  const now = Date.now();
  const cached = cache.get(cacheKey);

  if (cached && now - cached.cachedAt < CACHE_TTL_MS) {
    return cached.value;
  }

  const url = `https://frc-events.firstinspires.org/${effectiveYear}/district/CA`;
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Team-Optix-Scouting/1.0 (+https://frc-events.firstinspires.org)'
    }
  });

  if (!response.ok) {
    throw new Error(`CA district fetch failed: ${response.status}`);
  }

  const html = await response.text();
  const rows = parseDistrictRows(html, effectiveYear);
  if (!rows.length) {
    throw new Error('CA district scrape returned no teams');
  }

  const teamCount = rows.length;
  const cutoffPercent = 0.48;
  const cutoffRank = Math.max(1, Math.ceil(teamCount * cutoffPercent));

  const byTeam = new Map(
    rows.map((row) => [
      row.teamNumber,
      {
        rank: row.rank,
        inTop48Percent: row.rank <= cutoffRank
      }
    ])
  );

  const value = {
    district: 'CA',
    year: effectiveYear,
    url,
    fetchedAt: new Date().toISOString(),
    cutoffPercent,
    cutoffRank,
    teamCount,
    byTeam
  };

  cache.set(cacheKey, { cachedAt: now, value });
  return value;
}
