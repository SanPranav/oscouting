const DEFAULT_YEAR = 2026;
const TTL_MS = 5 * 60 * 1000;

const teamYearCache = new Map();

function cacheKey(teamNumber, year) {
  return `${teamNumber}:${year}`;
}

function getCached(teamNumber, year) {
  const key = cacheKey(teamNumber, year);
  const entry = teamYearCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.cachedAt > TTL_MS) {
    teamYearCache.delete(key);
    return null;
  }
  return entry.value;
}

function setCached(teamNumber, year, value) {
  teamYearCache.set(cacheKey(teamNumber, year), {
    cachedAt: Date.now(),
    value
  });
}

function normalizeTeamYearPayload(teamNumber, payload) {
  const epa = payload?.epa || {};
  const breakdown = epa?.breakdown || {};
  const ranks = epa?.ranks || {};
  const totalRank = ranks?.total || {};

  return {
    teamNumber,
    source: 'statbotics',
    epa: Number(epa?.total_points?.mean || epa?.total_points || 0),
    autoEPA: Number(breakdown?.auto_points || 0),
    teleopEPA: Number(breakdown?.teleop_points || 0),
    endgameEPA: Number(breakdown?.endgame_points || 0),
    normEPA: Number(epa?.norm || 0),
    wins: Number(payload?.record?.wins || 0),
    losses: Number(payload?.record?.losses || 0),
    ties: Number(payload?.record?.ties || 0),
    rank: Number(totalRank?.rank || 0),
    percentile: Number(totalRank?.percentile || 0)
  };
}

export async function fetchStatboticsTeamYear(teamNumber, year = DEFAULT_YEAR) {
  const numericTeam = Number(teamNumber);
  if (!Number.isFinite(numericTeam) || numericTeam <= 0) return null;

  const cached = getCached(numericTeam, year);
  if (cached) return cached;

  try {
    const response = await fetch(`https://api.statbotics.io/v3/team_year/${numericTeam}/${year}`);
    if (!response.ok) return null;
    const payload = await response.json();
    const normalized = normalizeTeamYearPayload(numericTeam, payload);
    setCached(numericTeam, year, normalized);
    return normalized;
  } catch {
    return null;
  }
}

export async function fetchStatboticsByTeams(teamNumbers, year = DEFAULT_YEAR) {
  const uniqueTeams = [...new Set((teamNumbers || []).map((value) => Number(value)).filter((value) => Number.isFinite(value) && value > 0))];
  const values = await Promise.all(uniqueTeams.map((teamNumber) => fetchStatboticsTeamYear(teamNumber, year)));
  return new Map(values.filter(Boolean).map((value) => [value.teamNumber, value]));
}
