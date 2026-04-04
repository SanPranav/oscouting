import { Router } from 'express';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prisma } from '@3749/db/src/client.js';
import { predictMatch } from '@3749/prediction/src/predict-match.js';
// import { callSmolLM } from '@3749/ai/src/lemonade-client.js';
import { syncTbaEvent } from '@3749/tba/src/sync.js';
import { recomputeExternalTeamStats } from '../stats.js';
import { fetchStatboticsByTeams, fetchStatboticsTeamYear } from '../services/statbotics.js';
import { fetchCaDistrictTop48Snapshot } from '../services/ca-district.js';

const router = Router();
const tbaScheduleSyncState = new Map();
const tbaEventTeamCache = new Map();
const tbaCompetitionCache = new Map();
const TBA_SCHEDULE_SYNC_TTL_MS = 90 * 1000;
const TBA_EVENT_TEAM_TTL_MS = 5 * 60 * 1000;
const TBA_COMPETITION_TTL_MS = 10 * 60 * 1000;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MOVEMENT_OVERRIDE_PATH = path.resolve(__dirname, '../data/movement-overrides.json');
const AUTO_OVERRIDE_PATH = path.resolve(__dirname, '../data/auto-overrides.json');
const DEFAULT_SELECTED_COMPETITION = {
  eventKey: process.env.DEFAULT_EVENT_KEY || '2026caasv',
  name: 'Aerospace Valley',
  shortName: 'Aerospace Valley',
  matchKey: '',
  scheduleText: '',
  teamsText: ''
};

let selectedCompetition = { ...DEFAULT_SELECTED_COMPETITION };
let movementOverrideCache = null;
let autoOverrideCache = null;

const TBA_BASE = 'https://www.thebluealliance.com/api/v3';

const normalizeMovementProfile = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  return ['none', 'trench', 'bump', 'both'].includes(normalized) ? normalized : 'none';
};

const movementKey = (eventKey, teamNumber) => `${String(eventKey || '').trim()}:${Number(teamNumber || 0)}`;

const loadMovementOverrides = async () => {
  if (movementOverrideCache) return movementOverrideCache;
  try {
    const raw = await fs.readFile(MOVEMENT_OVERRIDE_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    movementOverrideCache = parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    movementOverrideCache = {};
  }
  return movementOverrideCache;
};

const saveMovementOverrides = async (overrides) => {
  const safe = overrides && typeof overrides === 'object' ? overrides : {};
  const folder = path.dirname(MOVEMENT_OVERRIDE_PATH);
  await fs.mkdir(folder, { recursive: true });
  await fs.writeFile(MOVEMENT_OVERRIDE_PATH, JSON.stringify(safe, null, 2), 'utf8');
  movementOverrideCache = safe;
};

const normalizeAutoDid = (value, fallback = false) => {
  if (typeof value === 'boolean') return value;
  const normalized = String(value ?? '').trim().toLowerCase();
  if (['yes', 'true', '1', 'y'].includes(normalized)) return true;
  if (['no', 'false', '0', 'n'].includes(normalized)) return false;
  return Boolean(fallback);
};

const normalizeAutoDescription = (value) => String(value || '').trim().slice(0, 500);

const loadAutoOverrides = async () => {
  if (autoOverrideCache) return autoOverrideCache;
  try {
    const raw = await fs.readFile(AUTO_OVERRIDE_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    autoOverrideCache = parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    autoOverrideCache = {};
  }
  return autoOverrideCache;
};

const saveAutoOverrides = async (overrides) => {
  const safe = overrides && typeof overrides === 'object' ? overrides : {};
  const folder = path.dirname(AUTO_OVERRIDE_PATH);
  await fs.mkdir(folder, { recursive: true });
  await fs.writeFile(AUTO_OVERRIDE_PATH, JSON.stringify(safe, null, 2), 'utf8');
  autoOverrideCache = safe;
};

const fetchTbaRankings = async (eventKey) => {
  const key = process.env.TBA_API_KEY;
  if (!key) throw new Error('TBA_API_KEY missing');
  const response = await fetch(`${TBA_BASE}/event/${eventKey}/rankings`, {
    headers: { 'X-TBA-Auth-Key': key }
  });
  if (!response.ok) throw new Error(`TBA rankings request failed: ${response.status}`);
  const data = await response.json();
  const rankings = Array.isArray(data?.rankings) ? data.rankings : [];
  
  
  const mapped = rankings.map((row) => {
    const teamKey = String(row.team_key || '');
    const teamNumber = Number.parseInt(teamKey.replace('frc', ''), 10);
    const record = row.record || {};
    if (!Number.isFinite(teamNumber) || teamNumber <= 0) return null;
    
    const sortOrders = Array.isArray(row.sort_orders) ? row.sort_orders : [];
    return {
      teamNumber,
      rank: Number(row.rank || 0),
      rankingPoints: Number(sortOrders[0] ?? 0),
      wins: Number(record.wins || 0),
      losses: Number(record.losses || 0),
      ties: Number(record.ties || 0),
      dq: Number(record.dq || 0),
      matchesPlayed: Number(record.matches_played || 0),
      team: null
    };
  }).filter(Boolean);
  
  const sorted = mapped.sort((a, b) => {
    const rankA = Number(a.rank || 9999);
    const rankB = Number(b.rank || 9999);
    if (rankA !== rankB) return rankA - rankB;
    return Number(a.teamNumber) - Number(b.teamNumber);
  });
  return mapped.sort((a, b) => {
    const rankA = Number(a.rank || 9999);
    const rankB = Number(b.rank || 9999);
    if (rankA !== rankB) return rankA - rankB;
    return Number(a.teamNumber) - Number(b.teamNumber);
  });
};

const fetchTbaEventTeamNumbers = async (eventKey) => {
  const key = process.env.TBA_API_KEY;
  if (!key) throw new Error('TBA_API_KEY missing');

  const cacheKey = String(eventKey || '');
  const now = Date.now();
  const cached = tbaEventTeamCache.get(cacheKey);
  if (cached && now - cached.at < TBA_EVENT_TEAM_TTL_MS) {
    return cached.teams;
  }

  const response = await fetch(`${TBA_BASE}/event/${eventKey}/teams`, {
    headers: { 'X-TBA-Auth-Key': key }
  });
  if (!response.ok) throw new Error(`TBA teams request failed: ${response.status}`);

  const teams = await response.json();
  const teamNumbers = [...new Set(
    (Array.isArray(teams) ? teams : [])
      .map((team) => Number(team.team_number))
      .filter((teamNumber) => Number.isFinite(teamNumber) && teamNumber > 0)
  )].sort((a, b) => a - b);

  tbaEventTeamCache.set(cacheKey, { at: now, teams: teamNumbers });
  return teamNumbers;
};

const fetchTbaCompetitions = async (year) => {
  const key = process.env.TBA_API_KEY;
  if (!key) throw new Error('TBA_API_KEY missing');

  const normalizedYear = Number.parseInt(year, 10);
  if (!Number.isFinite(normalizedYear)) {
    throw new Error('Competition year is required');
  }

  const cacheKey = String(normalizedYear);
  const now = Date.now();
  const cached = tbaCompetitionCache.get(cacheKey);
  if (cached && now - cached.at < TBA_COMPETITION_TTL_MS) {
    return cached.events;
  }

  const response = await fetch(`${TBA_BASE}/events/${normalizedYear}`, {
    headers: { 'X-TBA-Auth-Key': key }
  });
  if (!response.ok) throw new Error(`TBA events request failed: ${response.status}`);

  const events = await response.json();
  const competitions = (Array.isArray(events) ? events : [])
    .map((event) => {
      const city = String(event.city || '').trim();
      const stateProv = String(event.state_prov || '').trim();
      const country = String(event.country || '').trim();
      const location = [city, stateProv, country].filter(Boolean).join(', ');
      const name = String(event.name || event.short_name || event.key || '').trim();
      return {
        eventKey: String(event.key || '').trim(),
        name: name || String(event.key || '').trim(),
        shortName: String(event.short_name || '').trim(),
        year: normalizedYear,
        week: Number(event.week || 0),
        startDate: String(event.start_date || '').trim(),
        endDate: String(event.end_date || '').trim(),
        location,
        city,
        stateProv,
        country,
        eventType: Number(event.event_type || 0),
        districtName: String(event.district?.display_name || '').trim(),
        districtAbbreviation: String(event.district?.abbreviation || '').trim()
      };
    })
    .filter((event) => event.eventKey)
    .sort((a, b) => {
      const aKey = `${a.startDate || ''} ${a.name || ''} ${a.eventKey || ''}`.toLowerCase();
      const bKey = `${b.startDate || ''} ${b.name || ''} ${b.eventKey || ''}`.toLowerCase();
      return aKey.localeCompare(bKey);
    });

  tbaCompetitionCache.set(cacheKey, { at: now, events: competitions });
  return competitions;
};

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const normalizeNoteKey = (key) => String(key || '').toLowerCase().replace(/[^a-z0-9]/g, '');

const parseFieldFromNotes = (notes, fieldKeys) => {
  const raw = String(notes || '').trim();
  const targets = (Array.isArray(fieldKeys) ? fieldKeys : [fieldKeys])
    .map((key) => normalizeNoteKey(key))
    .filter(Boolean);
  if (!raw || !targets.length) return '';

  const parts = raw.split('|');
  for (const part of parts) {
    const token = String(part || '').trim();
    if (!token) continue;

    const separatorIndex = token.includes('=') ? token.indexOf('=') : token.indexOf(':');
    if (separatorIndex < 0) continue;

    const key = token.slice(0, separatorIndex).trim();
    const rest = token.slice(separatorIndex + 1).trim();
    if (!targets.includes(normalizeNoteKey(key))) continue;

    const value = rest.trim();
    if (!value || /^n\/?a$/i.test(value)) return '';
    return value;
  }

  return '';
};

const parseAutoPathFromNotes = (notes) => parseFieldFromNotes(notes, [
  'auto_path',
  'auto path',
  'autopath',
  'describe the auto path',
  'describe auto path'
]);

const parseDisplayNotesFromGeneralNotes = (notes) => {
  const additional = parseFieldFromNotes(notes, 'additional_notes');
  if (additional) return additional;

  const cycle = parseFieldFromNotes(notes, 'cycle_notes');
  if (cycle) return cycle;

  const driving = parseFieldFromNotes(notes, 'driving_behavior_notes');
  if (driving) return driving;

  const raw = String(notes || '').trim();
  return raw && !/^n\/?a$/i.test(raw) ? raw : '';
};

const parseEventYear = (eventKey) => {
  const match = String(eventKey || '').match(/^(\d{4})/);
  const year = Number.parseInt(match?.[1] || '', 10);
  return Number.isFinite(year) ? year : new Date().getFullYear();
};

const isCaCmpEvent = (eventKey) => /cascmp/i.test(String(eventKey || ''));

const splitCsvLine = (line) => {
  const cells = [];
  let current = '';
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      cells.push(current.trim());
      current = '';
      continue;
    }

    current += char;
  }

  cells.push(current.trim());
  return cells;
};

const extractTeamNumber = (value) => {
  const match = String(value || '').match(/\b(?:frc)?(\d{2,5})\b/i);
  if (!match) return null;
  const teamNumber = Number.parseInt(match[1], 10);
  if (!Number.isFinite(teamNumber) || teamNumber <= 0) return null;
  return teamNumber;
};

const parseTeamsFromText = (text) => {
  const raw = String(text || '').trim();
  if (!raw) return [];

  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (!lines.length) return [];

  const csvHeader = splitCsvLine(lines[0]).map((header) => header.toLowerCase());
  const teamColumnIndex = csvHeader.findIndex((header) => ['team_number', 'team number', 'teamnumber', 'team'].includes(header));

  if (teamColumnIndex >= 0) {
    const csvTeams = lines
      .slice(1)
      .map((line) => splitCsvLine(line)[teamColumnIndex])
      .map((cell) => extractTeamNumber(cell))
      .filter((teamNumber) => Number.isFinite(teamNumber));

    if (csvTeams.length) {
      return [...new Set(csvTeams)].sort((a, b) => a - b);
    }
  }

  const lineTeams = lines
    .map((line) => {
      const firstCell = splitCsvLine(line)[0] || '';
      return extractTeamNumber(firstCell);
    })
    .filter((teamNumber) => Number.isFinite(teamNumber));

  if (lineTeams.length) {
    return [...new Set(lineTeams)].sort((a, b) => a - b);
  }

  const freeformTeams = [...raw.matchAll(/\b(?:frc)?(\d{2,5})\b/gi)]
    .map((match) => Number.parseInt(match[1], 10))
    .filter((teamNumber) => Number.isFinite(teamNumber) && teamNumber > 0);

  return [...new Set(freeformTeams)].sort((a, b) => a - b);
};

const getCompetitionTeamNumbers = () => parseTeamsFromText(getSelectedCompetition().teamsText);

const getLatestHistoricalTeamStats = async (teamNumbers) => {
  const uniqueTeamNumbers = [...new Set((teamNumbers || []).map((teamNumber) => Number(teamNumber)).filter((teamNumber) => Number.isFinite(teamNumber) && teamNumber > 0))];
  if (!uniqueTeamNumbers.length) return [];

  const rows = await prisma.teamAggregatedStat.findMany({
    where: { teamNumber: { in: uniqueTeamNumbers } },
    orderBy: [{ lastComputed: 'desc' }, { createdAt: 'desc' }, { eventKey: 'desc' }, { teamNumber: 'asc' }]
  });

  const byTeam = new Map();
  for (const row of rows) {
    const teamNumber = Number(row.teamNumber);
    if (!teamNumber || byTeam.has(teamNumber)) continue;
    byTeam.set(teamNumber, row);
  }

  return uniqueTeamNumbers.map((teamNumber) => byTeam.get(teamNumber) || buildBaselineTeamStatRow(getSelectedCompetition().eventKey, teamNumber));
};

const getSelectedCompetition = () => selectedCompetition || { ...DEFAULT_SELECTED_COMPETITION };

const setSelectedCompetition = async (competition) => {
  const eventKey = String(competition?.eventKey || '').trim();
  if (!eventKey) {
    throw new Error('eventKey is required');
  }

  const name = String(competition?.name || competition?.shortName || eventKey).trim() || eventKey;
  const year = Number.parseInt(competition?.year || parseEventYear(eventKey), 10);
  selectedCompetition = {
    eventKey,
    name,
    shortName: String(competition?.shortName || name || eventKey).trim() || name,
    matchKey: String(competition?.matchKey || '').trim(),
    scheduleText: String(competition?.scheduleText || '').trim(),
    teamsText: String(competition?.teamsText || '').trim(),
    year: Number.isFinite(year) ? year : parseEventYear(eventKey),
    week: Number(competition?.week || 0),
    startDate: String(competition?.startDate || '').trim(),
    endDate: String(competition?.endDate || '').trim(),
    location: String(competition?.location || '').trim(),
    city: String(competition?.city || '').trim(),
    stateProv: String(competition?.stateProv || '').trim(),
    country: String(competition?.country || '').trim(),
    districtName: String(competition?.districtName || '').trim(),
    districtAbbreviation: String(competition?.districtAbbreviation || '').trim()
  };

  await prisma.event.upsert({
    where: { eventKey },
    create: {
      eventKey,
      name,
      shortName: selectedCompetition.shortName || null,
      city: selectedCompetition.city || null,
      stateProv: selectedCompetition.stateProv || null,
      country: selectedCompetition.country || null,
      startDate: selectedCompetition.startDate ? new Date(selectedCompetition.startDate) : null,
      endDate: selectedCompetition.endDate ? new Date(selectedCompetition.endDate) : null,
      year: selectedCompetition.year || parseEventYear(eventKey),
      eventType: Number.isFinite(Number(selectedCompetition.eventType)) ? Number(selectedCompetition.eventType) : null,
      week: Number.isFinite(Number(selectedCompetition.week)) ? Number(selectedCompetition.week) : null,
      website: null
    },
    update: {
      name,
      shortName: selectedCompetition.shortName || null,
      city: selectedCompetition.city || null,
      stateProv: selectedCompetition.stateProv || null,
      country: selectedCompetition.country || null,
      startDate: selectedCompetition.startDate ? new Date(selectedCompetition.startDate) : null,
      endDate: selectedCompetition.endDate ? new Date(selectedCompetition.endDate) : null,
      year: selectedCompetition.year || parseEventYear(eventKey),
      eventType: Number.isFinite(Number(selectedCompetition.eventType)) ? Number(selectedCompetition.eventType) : null,
      week: Number.isFinite(Number(selectedCompetition.week)) ? Number(selectedCompetition.week) : null,
      website: null
    }
  });

  return selectedCompetition;
};

const buildBaselineTeamStatRow = (eventKey, teamNumber) => ({
  eventKey,
  teamNumber,
  matchesScouted: 0,
  avgTeleopFuel: 0,
  avgAutoFuel: 0,
  avgCycleSeconds: 0,
  avgHumanLoadSec: 0,
  defenseStopsPerMatch: 0,
  foulRate: 0,
  disableRate: 0,
  climbSuccessRate: 0,
  notesDigest: null,
  spiderAuto: 0,
  spiderTeleop: 0,
  spiderDefense: 0,
  spiderCycleSpeed: 0,
  spiderReliability: 0,
  spiderEndgame: 0,
  updatedAt: new Date(0)
});

router.get('/competitions', async (req, res) => {
  const year = req.query.year || new Date().getFullYear();

  try {
    const competitions = await fetchTbaCompetitions(year);
    res.json({
      year: Number.parseInt(year, 10) || new Date().getFullYear(),
      competitions,
      selectedCompetition: getSelectedCompetition()
    });
  } catch (error) {
    res.status(503).json({
      errorCode: 'E_TBA_COMPETITIONS_FETCH_FAILED',
      error: error.message || 'Unable to load TBA competitions'
    });
  }
});

router.get('/selected-event', (_req, res) => {
  res.json(getSelectedCompetition());
});

router.post('/selected-event', async (req, res) => {
  try {
    const competition = await setSelectedCompetition(req.body || {});
    res.json(competition);
  } catch (error) {
    const status = String(error.message || '').includes('required') ? 400 : 500;
    res.status(status).json({
      errorCode: status === 400 ? 'E_EVENT_KEY_REQUIRED' : 'E_SELECTED_COMPETITION_UPDATE_FAILED',
      error: error.message || 'Unable to update selected competition'
    });
  }
});

async function maybeRefreshScheduleFromTba(eventKey, force = false) {
  const now = Date.now();
  const state = tbaScheduleSyncState.get(eventKey);

  if (!force && state && state.inFlight) return state.inFlight;
  if (!force && state && now - state.at < TBA_SCHEDULE_SYNC_TTL_MS) return state.lastResult || null;

  const inFlight = syncTbaEvent(eventKey)
    .then((result) => {
      tbaScheduleSyncState.set(eventKey, { at: Date.now(), inFlight: null, lastResult: result });
      return result;
    })
    .catch((error) => {
      tbaScheduleSyncState.set(eventKey, { at: Date.now(), inFlight: null, lastResult: null, lastError: error?.message || String(error) });
      return null;
    });

  tbaScheduleSyncState.set(eventKey, { at: now, inFlight, lastResult: state?.lastResult || null, lastError: state?.lastError || null });
  return inFlight;
}

function computePickLeaderboard(statsRows, ourTeam, context) {
  const byTeam = new Map(statsRows.map((row) => [row.teamNumber, row]));
  const our = byTeam.get(ourTeam) || null;
  const rankingByTeam = context?.rankingByTeam || new Map();
  const epaByTeam = context?.epaByTeam || new Map();
  const statboticsByTeam = context?.statboticsByTeam || new Map();
  const reportByTeam = context?.reportByTeam || new Map();

  const allEpaValues = [
    ...epaByTeam.values(),
    ...[...statboticsByTeam.values()].map((row) => Number(row?.epa || 0))
  ].filter((value) => Number.isFinite(value) && value > 0);
  const maxEpa = allEpaValues.length ? Math.max(...allEpaValues) : 0;

  const rankValues = [...rankingByTeam.values()]
    .map((row) => Number(row.rank || 0))
    .filter((value) => value > 0);
  const maxRank = rankValues.length ? Math.max(...rankValues) : 1;

  const scored = statsRows
    .filter((row) => row.teamNumber !== ourTeam)
    .map((row) => {
      const auto = Number(row.spiderAuto || 0);
      const teleop = Number(row.spiderTeleop || 0);
      const defense = Number(row.spiderDefense || 0);
      const cycle = Number(row.spiderCycleSpeed || 0);
      const reliability = Number(row.spiderReliability || 0);
      const endgame = Number(row.spiderEndgame || 0);
      const disableRate = Number(row.disableRate || 0);
      const foulRate = Number(row.foulRate || 0);
      const matches = Number(row.matchesScouted || 0);
      const climbSuccess = Number(row.climbSuccessRate || 0);

      const rankRow = rankingByTeam.get(row.teamNumber) || null;
      const rank = Number(rankRow?.rank || 0);
      const rankingPoints = Number(rankRow?.rankingPoints || 0);
      const rankScore = rank > 0 ? clamp(((maxRank - rank + 1) / maxRank) * 100, 0, 100) : 50;
      const rpScore = clamp(rankingPoints * 18, 0, 100);

      const epaRaw = Number(epaByTeam.get(row.teamNumber) || 0);
      const statbotics = statboticsByTeam.get(row.teamNumber) || null;
      const statboticsEpa = Number(statbotics?.epa || 0);
      const effectiveEpa = statboticsEpa > 0 ? statboticsEpa : epaRaw;
      const epaScore = maxEpa > 0 ? clamp((effectiveEpa / maxEpa) * 100, 0, 100) : 0;

      const reportStats = reportByTeam.get(row.teamNumber) || {
        autoFuelAvg: 0,
        teleFuelAvg: 0,
        endgamePointsAvg: 0,
        count: 0
      };
      const reportScore = clamp(
        reportStats.autoFuelAvg * 4 + reportStats.teleFuelAvg * 2.5 + reportStats.endgamePointsAvg * 2,
        0,
        100
      );

      const capability = (
        auto * 0.13 +
        teleop * 0.23 +
        defense * 0.10 +
        cycle * 0.14 +
        reliability * 0.12 +
        endgame * 0.10 +
        rpScore * 0.06 +
        rankScore * 0.04 +
        epaScore * 0.08
      );

      const durability = clamp(
        reliability - disableRate * 65 - foulRate * 10 + Math.min(12, matches * 0.9),
        0,
        100
      );

      const defaultFit = (defense * 0.35 + endgame * 0.35 + cycle * 0.3);
      const ourTeleop = our ? Number(our.spiderTeleop || 0) : 60;
      const ourDefense = our ? Number(our.spiderDefense || 0) : 60;
      const needDefense = clamp((65 - ourDefense) / 65, 0, 1);
      const needScoring = clamp((80 - ourTeleop) / 80, 0, 1);
      const fit = clamp(
        defaultFit * 0.45 +
          (defense * needDefense * 0.20) +
          ((teleop + cycle) / 2 * needScoring * 0.20) +
          (clamp(climbSuccess * 100, 0, 100) * 0.15),
        0,
        100
      );

      const pickScore = capability * 0.42 + durability * 0.22 + fit * 0.20 + reportScore * 0.16;

      const valueMap = [
        { label: 'Elite teleop scoring', value: teleop },
        { label: 'Fast cycle pace', value: cycle },
        { label: 'Defense anchor', value: defense },
        { label: 'Reliable execution', value: reliability },
        { label: 'Endgame impact', value: endgame },
        { label: 'High EPA ceiling', value: epaScore },
        { label: 'Top event rank', value: rankScore },
        { label: 'Recent fuel output', value: reportScore }
      ];
      valueMap.sort((a, b) => b.value - a.value);
      const strongestValue = valueMap[0]?.label || 'Balanced profile';

      const tags = [];
      if (teleop >= 75 && cycle >= 70) tags.push('high-cycle offense');
      if (defense >= 70) tags.push('strong defender');
      if (endgame >= 65) tags.push('reliable climb/endgame');
      if (rank > 0 && rank <= 8) tags.push('top event rank');
      if (epaScore >= 80) tags.push('high EPA');
      if (disableRate >= 0.2) tags.push('risk: disable rate');
      if (foulRate >= 1) tags.push('risk: foul heavy');
      if (matches < 3) tags.push('low sample size');

      return {
        teamNumber: row.teamNumber,
        matchesScouted: matches,
        capabilityScore: Number(capability.toFixed(2)),
        durabilityScore: Number(durability.toFixed(2)),
        fitScore: Number(fit.toFixed(2)),
        pickScore: Number(pickScore.toFixed(2)),
        strongestValue,
        spiderAuto: auto,
        spiderTeleop: teleop,
        spiderDefense: defense,
        spiderCycleSpeed: cycle,
        spiderReliability: reliability,
        spiderEndgame: endgame,
        rank,
        rankingPoints,
        epa: Number(epaRaw.toFixed(2)),
        statboticsEPA: Number(statboticsEpa.toFixed(2)),
        statboticsAutoEPA: Number((statbotics?.autoEPA || 0).toFixed(2)),
        statboticsTeleopEPA: Number((statbotics?.teleopEPA || 0).toFixed(2)),
        statboticsEndgameEPA: Number((statbotics?.endgameEPA || 0).toFixed(2)),
        reportFuelScore: Number(reportScore.toFixed(2)),
        disableRate,
        foulRate,
        tags
      };
    })
    .sort((a, b) => b.pickScore - a.pickScore || b.capabilityScore - a.capabilityScore || a.teamNumber - b.teamNumber)
    .map((row, index) => ({ ...row, rank: index + 1 }));

  return scored;
}

function computeAlliancePickProbabilities({ rankingRows, statsRows, lockedPicks = [] }) {
  const statsByTeam = new Map((statsRows || []).map((row) => [Number(row.teamNumber), row]));
  const sortedRankings = [...(rankingRows || [])]
    .filter((row) => Number(row.teamNumber) > 0)
    .sort((a, b) => {
      const rankA = Number(a.rank || 9999);
      const rankB = Number(b.rank || 9999);
      if (rankA !== rankB) return rankA - rankB;
      return Number(a.teamNumber) - Number(b.teamNumber);
    });

  const captainRows = sortedRankings.slice(0, 8);
  if (!captainRows.length) return { alliances: [], warnings: [], nextOnClock: null };

  const rankingByTeam = new Map(sortedRankings.map((row) => [Number(row.teamNumber), row]));
  const maxRank = Math.max(1, ...sortedRankings.map((row) => Number(row.rank || 1)));
  const maxRp = Math.max(1, ...sortedRankings.map((row) => Number(row.rankingPoints || 0)));
  const warnings = [];

  const allianceBySeed = new Map();
  const captainSeedByTeam = new Map();
  const assignedTeamNumbers = new Set();

  for (const row of captainRows) {
    const allianceSeed = Number(row.rank || 0);
    const teamNumber = Number(row.teamNumber || 0);
    if (allianceSeed <= 0 || teamNumber <= 0) continue;
    
    allianceBySeed.set(allianceSeed, {
      allianceSeed,
      captainTeamNumber: teamNumber,
      captainNickname: row.team?.nickname || null,
      captainRankingPoints: Number(row.rankingPoints || 0),
      projectedPicks: []
    });
    captainSeedByTeam.set(teamNumber, allianceSeed);
    assignedTeamNumbers.add(teamNumber);
  }

  const seedOrderAsc = [...allianceBySeed.keys()].sort((a, b) => a - b);
  if (!seedOrderAsc.length) return { alliances: [], warnings: [], nextOnClock: null };
  
  const unassignedTeamNumbers = new Set(
    sortedRankings
      .map((row) => Number(row.teamNumber || 0))
      .filter((teamNumber) => teamNumber > 0 && !assignedTeamNumbers.has(teamNumber))
  );

  const lockBySlot = new Map();
  for (const rawLock of lockedPicks || []) {
    const roundNumber = Number(rawLock?.roundNumber || 0);
    const teamNumber = Number(rawLock?.teamNumber || 0);
    const requestedSeed = Number(rawLock?.allianceSeed || 0);
    const captainTeamNumber = Number(rawLock?.captainTeamNumber || 0);

    if (roundNumber < 1 || roundNumber > 3 || teamNumber <= 0) continue;

    let resolvedSeed = requestedSeed;
    if (resolvedSeed <= 0 && captainTeamNumber > 0) {
      resolvedSeed = Number(captainSeedByTeam.get(captainTeamNumber) || 0);
    }

    if (resolvedSeed <= 0 || !allianceBySeed.has(resolvedSeed)) {
      warnings.push(`Ignored lock for team ${teamNumber}: invalid captain/seed context.`);
      continue;
    }

    const slotKey = `${resolvedSeed}:${roundNumber}`;
    if (lockBySlot.has(slotKey)) {
      warnings.push(`Duplicate lock for seed ${resolvedSeed} round ${roundNumber}; keeping latest entry.`);
    }

    lockBySlot.set(slotKey, {
      allianceSeed: resolvedSeed,
      roundNumber,
      teamNumber
    });
  }

  const scoreCandidateForCaptain = (captainTeamNumber, candidateTeamNumber, roundNumber) => {
    const captainRow = rankingByTeam.get(Number(captainTeamNumber)) || null;
    const candidateRow = rankingByTeam.get(Number(candidateTeamNumber)) || null;
    const captainStats = statsByTeam.get(Number(captainTeamNumber)) || {};
    const candidateStats = statsByTeam.get(Number(candidateTeamNumber)) || {};

    const candidateRank = Number(candidateRow?.rank || maxRank);
    const rankScore = clamp(((maxRank - candidateRank + 1) / maxRank) * 100, 0, 100);
    const rpScore = clamp((Number(candidateRow?.rankingPoints || 0) / maxRp) * 100, 0, 100);

    const candidateTeleop = Number(candidateStats.spiderTeleop || 0);
    const candidateDefense = Number(candidateStats.spiderDefense || 0);
    const candidateReliability = Number(candidateStats.spiderReliability || 0);
    const candidateEndgame = Number(candidateStats.spiderEndgame || 0);

    const candidatePerformance = clamp(
      candidateTeleop * 0.4 +
        candidateDefense * 0.2 +
        candidateReliability * 0.25 +
        candidateEndgame * 0.15,
      0,
      100
    );

    const captainTeleop = Number(captainStats.spiderTeleop || 60);
    const captainDefense = Number(captainStats.spiderDefense || 60);
    const captainEndgame = Number(captainStats.spiderEndgame || 60);

    const needTeleop = clamp((75 - captainTeleop) / 75, 0, 1);
    const needDefense = clamp((70 - captainDefense) / 70, 0, 1);
    const needEndgame = clamp((70 - captainEndgame) / 70, 0, 1);

    const fitScore = clamp(
      candidateTeleop * (0.35 + needTeleop * 0.35) +
        candidateDefense * (0.2 + needDefense * 0.35) +
        candidateEndgame * (0.15 + needEndgame * 0.25),
      0,
      100
    );

    const roundWeight = roundNumber === 1
      ? { rank: 0.36, rp: 0.16, perf: 0.30, fit: 0.18 }
      : roundNumber === 2
        ? { rank: 0.22, rp: 0.10, perf: 0.32, fit: 0.36 }
        : { rank: 0.16, rp: 0.08, perf: 0.30, fit: 0.46 };

    const captainStrength = clamp(
      Number(captainRow?.rankingPoints || 0) > 0 ? Number(captainRow?.rankingPoints || 0) : 0,
      0,
      maxRp
    );

    const captainBias = maxRp > 0 ? clamp((captainStrength / maxRp) * 5, 0, 5) : 0;

    const composite = clamp(
      rankScore * roundWeight.rank +
        rpScore * roundWeight.rp +
        candidatePerformance * roundWeight.perf +
        fitScore * roundWeight.fit +
        captainBias,
      0,
      100
    );

    return Number(composite.toFixed(2));
  };

  const shiftCaptainsAfterCaptainPick = (pickedCaptainSeed) => {
    if (!Number.isFinite(pickedCaptainSeed) || pickedCaptainSeed < 1 || pickedCaptainSeed > 8) return false;

    for (let seed = pickedCaptainSeed; seed < 8; seed += 1) {
      const targetAlliance = allianceBySeed.get(seed);
      const sourceAlliance = allianceBySeed.get(seed + 1);
      if (!targetAlliance || !sourceAlliance) continue;

      const nextCaptainTeamNumber = Number(sourceAlliance.captainTeamNumber || 0);
      if (nextCaptainTeamNumber <= 0) {
        targetAlliance.captainTeamNumber = 0;
        targetAlliance.captainNickname = null;
        targetAlliance.captainRankingPoints = 0;
        continue;
      }

      captainSeedByTeam.set(nextCaptainTeamNumber, seed);

      targetAlliance.captainTeamNumber = nextCaptainTeamNumber;
      targetAlliance.captainNickname = sourceAlliance.captainNickname || null;
      targetAlliance.captainRankingPoints = Number(sourceAlliance.captainRankingPoints || 0);
    }

    const allianceEight = allianceBySeed.get(8);
    if (!allianceEight) return false;

    const replacementRow = sortedRankings.find((row) => {
      const teamNumber = Number(row.teamNumber || 0);
      const isUnassigned = unassignedTeamNumbers.has(teamNumber);
      const isCaptain = captainSeedByTeam.has(teamNumber);
      return teamNumber > 0 && isUnassigned && !isCaptain;
    });

    if (!replacementRow) {
      allianceEight.captainTeamNumber = 0;
      allianceEight.captainNickname = null;
      allianceEight.captainRankingPoints = 0;
      warnings.push(`Alliance 8 has no captain replacement available after captain transfer.`);
      return false;
    }

    const replacementTeamNumber = Number(replacementRow.teamNumber || 0);
    unassignedTeamNumbers.delete(replacementTeamNumber);
    assignedTeamNumbers.add(replacementTeamNumber);
    captainSeedByTeam.set(replacementTeamNumber, 8);

    allianceEight.captainTeamNumber = replacementTeamNumber;
    allianceEight.captainNickname = replacementRow.team?.nickname || null;
    allianceEight.captainRankingPoints = Number(replacementRow.rankingPoints || 0);
    return true;
  };

  const getCandidateEntries = (roundNumber, allianceSeed, options = {}) => {
    const allowCaptainSelections = Boolean(options.allowCaptainSelections);
    const alliance = allianceBySeed.get(allianceSeed);
    if (!alliance || Number(alliance.captainTeamNumber || 0) <= 0) return [];

    const captainTeamNumber = Number(alliance.captainTeamNumber);
    const candidateEntries = [];

    for (const row of sortedRankings) {
      const teamNumber = Number(row.teamNumber || 0);
      if (teamNumber <= 0 || teamNumber === captainTeamNumber) continue;

      const captainSeed = captainSeedByTeam.get(teamNumber);
      const isCaptainElsewhere = Number.isFinite(captainSeed) && captainSeed !== allianceSeed;
      const isUnassigned = unassignedTeamNumbers.has(teamNumber);
      const isEligible = isUnassigned || (allowCaptainSelections && roundNumber === 1 && isCaptainElsewhere);
      if (!isEligible) continue;

      const probabilityScore = scoreCandidateForCaptain(captainTeamNumber, teamNumber, roundNumber);
      candidateEntries.push({
        teamNumber,
        nickname: row.team?.nickname || null,
        eventRank: Number(row.rank || 0),
        rankingPoints: Number(row.rankingPoints || 0),
        probabilityScore,
        candidateType: isCaptainElsewhere ? 'captain' : 'pool'
      });
    }

    return candidateEntries.sort((a, b) => (
      b.probabilityScore - a.probabilityScore ||
      a.eventRank - b.eventRank ||
      a.teamNumber - b.teamNumber
    ));
  };

  const applyPick = ({ allianceSeed, roundNumber, overallPickNumber, pick, source, isLocked }) => {
    const alliance = allianceBySeed.get(allianceSeed);
    if (!alliance || Number(alliance.captainTeamNumber || 0) <= 0) return false;

    const teamNumber = Number(pick.teamNumber || 0);
    if (teamNumber <= 0) return false;

    const candidateCaptainSeed = captainSeedByTeam.get(teamNumber);
    const pickingCaptainTeamNumber = Number(alliance.captainTeamNumber || 0);

    if (isLocked && roundNumber === 1 && Number.isFinite(candidateCaptainSeed) && candidateCaptainSeed !== allianceSeed) {
      // Captain is being picked in round 1: remove and shift lower captains up, then fill seed 8 from next rank
      captainSeedByTeam.delete(teamNumber);
      unassignedTeamNumbers.delete(teamNumber);
      assignedTeamNumbers.add(teamNumber);
      shiftCaptainsAfterCaptainPick(candidateCaptainSeed);
    } else {
      if (!unassignedTeamNumbers.has(teamNumber)) return false;
      unassignedTeamNumbers.delete(teamNumber);
      assignedTeamNumbers.add(teamNumber);
    }

    alliance.projectedPicks.push({
      pickNumber: roundNumber,
      roundNumber,
      overallPickNumber,
      source,
      isLocked,
      selectedByCaptain: pickingCaptainTeamNumber,
      teamNumber,
      nickname: pick.nickname || null,
      eventRank: Number(pick.eventRank || 0),
      rankingPoints: Number(pick.rankingPoints || 0),
      probabilityScore: Number(Number(pick.probabilityScore || 0).toFixed(2)),
      candidateType: pick.candidateType || 'pool'
    });

    return true;
  };

  const roundOrders = [seedOrderAsc, [...seedOrderAsc].reverse(), seedOrderAsc];
  let overallPickNumber = 1;
  let nextOnClock = null;

  for (let roundIndex = 0; roundIndex < roundOrders.length; roundIndex += 1) {
    const roundNumber = roundIndex + 1;
    const order = roundOrders[roundIndex];

    for (const allianceSeed of order) {
      const alliance = allianceBySeed.get(allianceSeed);
      if (!alliance || Number(alliance.captainTeamNumber || 0) <= 0) continue;

      const slotKey = `${allianceSeed}:${roundNumber}`;
      const lockedPick = lockBySlot.get(slotKey) || null;
      const candidates = getCandidateEntries(roundNumber, allianceSeed, {
        allowCaptainSelections: Boolean(lockedPick)
      });
      if (!candidates.length) {
        warnings.push(`No available candidates for seed ${allianceSeed} round ${roundNumber}.`);
        continue;
      }

      const candidateByTeam = new Map(candidates.map((entry) => [Number(entry.teamNumber), entry]));

      if (!nextOnClock && !lockedPick) {
        nextOnClock = {
          allianceSeed,
          roundNumber,
          overallPickNumber,
          captainTeamNumber: Number(alliance.captainTeamNumber || 0),
          captainNickname: alliance.captainNickname || null,
          topCandidates: candidates.slice(0, 8)
        };
      }

      let chosen = null;
      let source = 'projected';
      let isLocked = false;

      if (lockedPick) {
        const lockedTeamNumber = Number(lockedPick.teamNumber || 0);
        const lockedCandidate = candidateByTeam.get(lockedTeamNumber) || null;
        if (lockedCandidate) {
          chosen = lockedCandidate;
          source = 'actual';
          isLocked = true;
        } else {
          warnings.push(`Locked pick ${lockedTeamNumber} for seed ${allianceSeed} round ${roundNumber} is unavailable; projected value used.`);
        }
      }

      if (!chosen) {
        chosen = candidates[0] || null;
        source = 'projected';
        isLocked = false;
      }

      if (!chosen) continue;

      const pickApplied = applyPick({
        allianceSeed,
        roundNumber,
        overallPickNumber,
        pick: chosen,
        source,
        isLocked
      });

      if (pickApplied) overallPickNumber += 1;
    }
  }

  const alliances = seedOrderAsc
    .map((seed) => allianceBySeed.get(seed))
    .filter(Boolean)
    .sort((a, b) => Number(a.allianceSeed || 0) - Number(b.allianceSeed || 0))
    .map((alliance) => ({
      ...alliance,
      projectedTeamNumbers: [alliance.captainTeamNumber, ...alliance.projectedPicks.map((pick) => pick.teamNumber)]
        .filter((teamNumber) => Number(teamNumber) > 0)
    }));

  return {
    alliances,
    warnings,
    nextOnClock
  };
}

router.get('/stats/:eventKey', async (req, res) => {
  const eventKey = req.params.eventKey;
  const movementOverrides = await loadMovementOverrides();
  const autoOverrides = await loadAutoOverrides();

  let data = await prisma.teamAggregatedStat.findMany({
    where: { eventKey: req.params.eventKey },
    orderBy: [{ spiderReliability: 'desc' }, { teamNumber: 'asc' }]
  });

  if (!data.length) {
    await recomputeExternalTeamStats(req.params.eventKey);
    data = await prisma.teamAggregatedStat.findMany({
      where: { eventKey: req.params.eventKey },
      orderBy: [{ spiderReliability: 'desc' }, { teamNumber: 'asc' }]
    });
  }

  const competitionTeamNumbers = getCompetitionTeamNumbers();
  if (!data.length && competitionTeamNumbers.length) {
    data = await getLatestHistoricalTeamStats(competitionTeamNumbers);
  } else if (competitionTeamNumbers.length) {
    const rowsByTeam = new Map(data.map((row) => [Number(row.teamNumber), row]));
    const historicalRows = await getLatestHistoricalTeamStats(competitionTeamNumbers.filter((teamNumber) => !rowsByTeam.has(teamNumber)));
    for (const row of historicalRows) {
      if (!rowsByTeam.has(Number(row.teamNumber))) {
        rowsByTeam.set(Number(row.teamNumber), row);
      }
    }
    data = [...rowsByTeam.values()];
  }

  const externalAggRows = await prisma.externalScoutImport.groupBy({
    by: ['teamNumber'],
    where: { eventKey, teamNumber: { not: null } },
    _count: { teamNumber: true },
    _avg: {
      autoFuel: true,
      teleFuel: true,
      defenseRating: true,
      fouls: true
    }
  });

  const externalAggByTeam = new Map(
    externalAggRows
      .filter((row) => Number.isFinite(Number(row.teamNumber)))
      .map((row) => [
        Number(row.teamNumber),
        {
          matchesScouted: Number(row._count.teamNumber || 0),
          autoAvg: Number(row._avg.autoFuel || 0),
          teleAvg: Number(row._avg.teleFuel || 0),
          defenseAvg: Number(row._avg.defenseRating || 0),
          foulRate: Number(row._avg.fouls || 0)
        }
      ])
  );

  const mergedData = data.map((row) => {
    const external = externalAggByTeam.get(row.teamNumber);
    if (!external) return row;

    const currentAuto = Number(row.avgAutoTotalPoints || 0);
    const currentTele = Number(row.avgTeleopTotalPoints || 0);
    const shouldUseExternal = currentAuto === 0 && currentTele === 0 && (external.autoAvg > 0 || external.teleAvg > 0);
    if (!shouldUseExternal) return row;

    const autoAvg = external.autoAvg;
    const teleAvg = external.teleAvg;
    const defenseAvg = external.defenseAvg;
    const foulRate = external.foulRate;

    return {
      ...row,
      matchesScouted: Math.max(Number(row.matchesScouted || 0), external.matchesScouted),
      avgAutoTotalPoints: autoAvg,
      avgTeleopTotalPoints: teleAvg,
      spiderAuto: clamp(autoAvg * 5, 0, 100),
      spiderTeleop: clamp(teleAvg * 3, 0, 100),
      spiderDefense: defenseAvg > 0 ? clamp((defenseAvg / 5) * 100, 0, 100) : row.spiderDefense,
      foulRate: foulRate > 0 ? foulRate : row.foulRate,
      spiderReliability: clamp(
        ((1 - Number(row.disableRate || 0)) * 0.7 + (1 - clamp((foulRate > 0 ? foulRate : Number(row.foulRate || 0)) / 3, 0, 1)) * 0.3) * 100,
        0,
        100
      )
    };
  });

  const movementRows = await prisma.matchScoutingReport.findMany({
    where: { eventKey },
    select: {
      teamNumber: true,
      autoFuelAuto: true,
      autoTowerClimb: true,
      autoMobility: true,
      autoHubShiftWon: true,
      generalNotes: true,
      createdAt: true,
      teleopCrossedBump: true,
      teleopCrossedTrench: true
    }
  });

  const movementByTeam = new Map();
  const autoByTeam = new Map();
  const notesByTeam = new Map();
  for (const row of movementRows) {
    const teamNumber = Number(row.teamNumber);
    if (!teamNumber) continue;

    if (!movementByTeam.has(teamNumber)) {
      movementByTeam.set(teamNumber, {
        total: 0,
        bumpCrosses: 0,
        trenchCrosses: 0
      });
    }

    const agg = movementByTeam.get(teamNumber);
    agg.total += 1;
    if (row.teleopCrossedBump) agg.bumpCrosses += 1;
    if (row.teleopCrossedTrench) agg.trenchCrosses += 1;

    if (!autoByTeam.has(teamNumber)) {
      autoByTeam.set(teamNumber, {
        autoRuns: 0,
        latestCreatedAt: 0,
        latestDescription: ''
      });
    }

    if (!notesByTeam.has(teamNumber)) {
      notesByTeam.set(teamNumber, {
        latestCreatedAt: 0,
        latestNote: ''
      });
    }

    const autoAgg = autoByTeam.get(teamNumber);
    const hadAutoAction = Boolean(
      Number(row.autoFuelAuto || 0) > 0
      || Number(row.autoTowerClimb || 0) > 0
      || row.autoMobility
      || row.autoHubShiftWon
    );
    if (hadAutoAction) autoAgg.autoRuns += 1;

    const noteAutoPath = parseAutoPathFromNotes(row.generalNotes || '');
    const noteDisplay = parseDisplayNotesFromGeneralNotes(row.generalNotes || '');
    const createdAtValue = new Date(row.createdAt || 0).valueOf();
    if (noteAutoPath && createdAtValue >= autoAgg.latestCreatedAt) {
      autoAgg.latestCreatedAt = createdAtValue;
      autoAgg.latestDescription = noteAutoPath;
    }

    const noteAgg = notesByTeam.get(teamNumber);
    if (noteDisplay && createdAtValue >= noteAgg.latestCreatedAt) {
      noteAgg.latestCreatedAt = createdAtValue;
      noteAgg.latestNote = noteDisplay;
    }
  }

  const teams = mergedData.map((row) => row.teamNumber);
  const statboticsByTeam = await fetchStatboticsByTeams(teams);

  const enriched = mergedData.map((row) => {
    const sb = statboticsByTeam.get(row.teamNumber);
    const movement = movementByTeam.get(row.teamNumber);
    const auto = autoByTeam.get(row.teamNumber);
    const teamNotes = notesByTeam.get(row.teamNumber);
    const bumpUsed = Boolean(movement && movement.bumpCrosses > 0);
    const trenchUsed = Boolean(movement && movement.trenchCrosses > 0);
    const autoDid = Boolean((auto && auto.autoRuns > 0) || Number(row.avgAutoTotalPoints || 0) > 0);
    const autoDescription = auto && auto.latestDescription
      ? auto.latestDescription
      : '—';
    const autoOverride = autoOverrides[movementKey(eventKey, row.teamNumber)] || null;
    const finalAutoDid = autoOverride && Object.prototype.hasOwnProperty.call(autoOverride, 'autoDid')
      ? normalizeAutoDid(autoOverride.autoDid, autoDid)
      : autoDid;
    const overrideAutoDescription = autoOverride ? normalizeAutoDescription(autoOverride.autoDescription || '') : '';
    const finalAutoDescription = overrideAutoDescription || autoDescription;
    const finalNotes = String(row.notes || '').trim() || String(teamNotes?.latestNote || '').trim() || '—';
    const movementProfile = trenchUsed && bumpUsed
      ? 'both'
      : trenchUsed
        ? 'trench'
        : bumpUsed
          ? 'bump'
          : 'none';

    const overrideProfile = normalizeMovementProfile(movementOverrides[movementKey(eventKey, row.teamNumber)] || '');
    const finalMovementProfile = overrideProfile !== 'none' ? overrideProfile : movementProfile;
    const finalTrenchUsed = finalMovementProfile === 'trench' || finalMovementProfile === 'both';
    const finalBumpUsed = finalMovementProfile === 'bump' || finalMovementProfile === 'both';

    return {
      ...row,
      movementProfile: finalMovementProfile,
      trenchUsed: finalTrenchUsed,
      bumpUsed: finalBumpUsed,
      autoDid: finalAutoDid,
      autoDescription: finalAutoDescription,
      notes: finalNotes,
      movementSampleSize: movement ? movement.total : 0,
      trenchCrossCount: movement ? movement.trenchCrosses : 0,
      bumpCrossCount: movement ? movement.bumpCrosses : 0,
      statbotics: sb
        ? {
            epa: Number(sb.epa.toFixed(2)),
            autoEPA: Number(sb.autoEPA.toFixed(2)),
            teleopEPA: Number(sb.teleopEPA.toFixed(2)),
            endgameEPA: Number(sb.endgameEPA.toFixed(2)),
            normEPA: Number(sb.normEPA.toFixed(2)),
            rank: sb.rank,
            wins: sb.wins,
            losses: sb.losses,
            ties: sb.ties,
            percentile: Number(sb.percentile.toFixed(2))
          }
        : null
    };
  });

  res.json(enriched);
});

router.get('/pit/:eventKey', async (req, res) => {
  const eventKey = req.params.eventKey;
  try {
    const [reports, eventTeamNumbers] = await Promise.all([
      prisma.pitScoutingReport.findMany({
        where: { eventKey },
        orderBy: [{ createdAt: 'desc' }]
      }),
      fetchTbaEventTeamNumbers(eventKey)
    ]);

    const teamFilter = new Set(eventTeamNumbers);

    const latestByTeam = new Map();
    for (const report of reports) {
      if (!teamFilter.has(Number(report.teamNumber))) continue;
      if (!latestByTeam.has(report.teamNumber)) latestByTeam.set(report.teamNumber, report);
    }

    const rows = [...latestByTeam.values()]
      .map((report) => {
        const tags = String(report.aiTags || '')
          .split(',')
          .map((part) => part.trim())
          .filter(Boolean);

        return {
          eventKey: report.eventKey,
          teamNumber: report.teamNumber,
          scoutName: report.scoutName,
          hopperCapacity: report.hopperCapacity ?? null,
          drivetrainType: report.drivetrainType || 'unknown',
          swerveModuleType: report.swerveModuleType || '',
          swerveGearing: report.swerveGearing || '',
          canUseTrench: Boolean(report.canUseTrench),
          canCrossBump: Boolean(report.canCrossBump),
          cycleBallsPerSec: Number(report.cycleBallsPerSec || 0),
          cycleSpeed: report.cycleSpeed || 'unknown',
          outpostCapability: Boolean(report.outpostCapability),
          depotCapability: Boolean(report.depotCapability),
          intakeType: report.intakeType || 'unknown',
          shooterType: report.shooterType || 'unknown',
          visionType: report.visionType || 'unknown',
          autoPaths: report.autoPaths || '',
          climberType: report.climberType || 'unknown',
          climbCapability: report.climbCapability || 'unknown',
          hasGroundIntake: Boolean(report.hasGroundIntake),
          hasSourceIntake: Boolean(report.hasSourceIntake),
          driveMotorType: report.driveMotorType || 'unknown',
          shooterMotorType: report.shooterMotorType || 'unknown',
          intakeMotorType: report.intakeMotorType || 'unknown',
          climberMotorType: report.climberMotorType || 'unknown',
          softwareFeatures: report.softwareFeatures || '',
          mechanicalFeatures: report.mechanicalFeatures || '',
          mechanismNotes: report.mechanismNotes || '',
          aiTags: tags,
          aiConfidenceScore: Number(report.aiConfidenceScore || 0),
          updatedAt: report.updatedAt,
          createdAt: report.createdAt
        };
      })
      .sort((a, b) => a.teamNumber - b.teamNumber);

    res.json({
      eventKey,
      filteredBy: 'tba_event_teams',
      teamCount: teamFilter.size,
      pitReportCount: rows.length,
      rows
    });
  } catch (error) {
    return res.status(503).json({
      errorCode: 'E_TBA_PIT_ROSTER_FETCH_FAILED',
      error: error.message || 'Unable to load TBA team roster for pit filtering'
    });
  }
});

router.get('/stats/:eventKey/:teamNumber', async (req, res) => {
  const eventKey = req.params.eventKey;
  const teamNumber = Number(req.params.teamNumber);

  const stat = await prisma.teamAggregatedStat.findUnique({
    where: { eventKey_teamNumber: { eventKey, teamNumber } }
  });
  const historicalStat = stat && Number(stat.matchesScouted || 0) > 0
    ? stat
    : (await getLatestHistoricalTeamStats([teamNumber]))[0] || null;

  const recent = await prisma.matchScoutingReport.findMany({
    where: { eventKey, teamNumber },
    orderBy: { createdAt: 'desc' },
    take: 8
  });

  const reportAgg = await prisma.matchScoutingReport.aggregate({
    where: { eventKey, teamNumber },
    _count: { _all: true },
    _avg: {
      autoFuelAuto: true,
      teleopFuelScored: true,
      endgameTowerPoints: true,
      teleopDefenseRating: true,
      foulsCommitted: true
    }
  });

  const externalAgg = await prisma.externalScoutImport.aggregate({
    where: { eventKey, teamNumber },
    _count: { _all: true },
    _avg: {
      autoFuel: true,
      teleFuel: true,
      defenseRating: true,
      fouls: true
    }
  });

  const reportCount = Number(reportAgg?._count?._all || 0);
  const externalCount = Number(externalAgg?._count?._all || 0);

  const reportAuto = Number(reportAgg?._avg?.autoFuelAuto || 0);
  const reportTele = Number(reportAgg?._avg?.teleopFuelScored || 0);
  const reportEnd = Number(reportAgg?._avg?.endgameTowerPoints || 0);

  const externalAuto = Number(externalAgg?._avg?.autoFuel || 0);
  const externalTele = Number(externalAgg?._avg?.teleFuel || 0);

  const fallbackAuto = reportCount > 0 ? reportAuto : externalAuto;
  const fallbackTele = reportCount > 0 ? reportTele : externalTele;
  const fallbackEnd = reportCount > 0 ? reportEnd : 0;

  const fallbackDefense = reportCount > 0
    ? Number(reportAgg?._avg?.teleopDefenseRating || 0)
    : Number(externalAgg?._avg?.defenseRating || 0);

  const fallbackFoulRate = reportCount > 0
    ? Number(reportAgg?._avg?.foulsCommitted || 0)
    : Number(externalAgg?._avg?.fouls || 0);

  const fallbackMatches = Math.max(reportCount, externalCount);

  const statForResponse = (() => {
    const base = historicalStat
      ? { ...historicalStat, sourceEventKey: historicalStat.eventKey || eventKey, eventKey }
      : {
          eventKey,
          teamNumber,
          matchesScouted: 0,
          avgAutoTotalPoints: 0,
          avgTeleopTotalPoints: 0,
          avgEndgamePoints: 0,
          climbAttemptRate: 0,
          climbSuccessRate: 0,
          disableRate: 0,
          foulRate: 0,
          spiderAuto: 0,
          spiderTeleop: 0,
          spiderDefense: 0,
          spiderCycleSpeed: 0,
          spiderReliability: 0,
          spiderEndgame: 0,
          lastComputed: new Date(0)
        };

    const hasFallback = fallbackAuto > 0 || fallbackTele > 0 || fallbackEnd > 0;
    if (!hasFallback) return base;

    const existingAuto = Number(base.avgAutoTotalPoints || 0);
    const existingTele = Number(base.avgTeleopTotalPoints || 0);
    const existingEnd = Number(base.avgEndgamePoints || 0);

    const finalAuto = existingAuto > 0 ? existingAuto : fallbackAuto;
    const finalTele = existingTele > 0 ? existingTele : fallbackTele;
    const finalEnd = existingEnd > 0 ? existingEnd : fallbackEnd;

    return {
      ...base,
      matchesScouted: Math.max(Number(base.matchesScouted || 0), fallbackMatches),
      avgAutoTotalPoints: finalAuto,
      avgTeleopTotalPoints: finalTele,
      avgEndgamePoints: finalEnd,
      foulRate: Number(base.foulRate || 0) > 0 ? base.foulRate : fallbackFoulRate,
      spiderAuto: Number(base.spiderAuto || 0) > 0 ? base.spiderAuto : clamp(finalAuto * 5, 0, 100),
      spiderTeleop: Number(base.spiderTeleop || 0) > 0 ? base.spiderTeleop : clamp(finalTele * 3, 0, 100),
      spiderEndgame: Number(base.spiderEndgame || 0) > 0 ? base.spiderEndgame : clamp((finalEnd / 30) * 100, 0, 100),
      spiderDefense: Number(base.spiderDefense || 0) > 0
        ? base.spiderDefense
        : (fallbackDefense > 0 ? clamp((fallbackDefense / 5) * 100, 0, 100) : base.spiderDefense),
      spiderReliability: Number(base.spiderReliability || 0) > 0
        ? base.spiderReliability
        : clamp(
            ((1 - Number(base.disableRate || 0)) * 0.7 + (1 - clamp((fallbackFoulRate > 0 ? fallbackFoulRate : Number(base.foulRate || 0)) / 3, 0, 1)) * 0.3) * 100,
            0,
            100
          )
    };
  })();

  const statbotics = await fetchStatboticsTeamYear(teamNumber);

  res.json({
    stat: statForResponse,
    recent,
    statbotics: statbotics
      ? {
          epa: Number(statbotics.epa.toFixed(2)),
          autoEPA: Number(statbotics.autoEPA.toFixed(2)),
          teleopEPA: Number(statbotics.teleopEPA.toFixed(2)),
          endgameEPA: Number(statbotics.endgameEPA.toFixed(2)),
          normEPA: Number(statbotics.normEPA.toFixed(2)),
          rank: statbotics.rank,
          wins: statbotics.wins,
          losses: statbotics.losses,
          ties: statbotics.ties,
          percentile: Number(statbotics.percentile.toFixed(2))
        }
      : null
  });
});

router.post('/stats/:eventKey/:teamNumber/manual', async (req, res) => {
  const eventKey = String(req.params.eventKey || '').trim();
  const teamNumber = Number.parseInt(String(req.params.teamNumber || ''), 10);

  if (!eventKey) {
    return res.status(400).json({ error: 'eventKey is required' });
  }
  if (!Number.isFinite(teamNumber) || teamNumber <= 0) {
    return res.status(400).json({ error: 'teamNumber is required' });
  }

  const payload = req.body || {};
  const requestedMovementProfile = normalizeMovementProfile(payload.movementProfile || '');
  const requestedAutoDid = normalizeAutoDid(payload.autoDid, false);
  const requestedAutoDescription = normalizeAutoDescription(payload.autoDescription || '');
  const parseNumber = (value, fallback) => {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
  };

  try {
    const existing = await prisma.teamAggregatedStat.findUnique({
      where: { eventKey_teamNumber: { eventKey, teamNumber } }
    });

    await prisma.team.upsert({
      where: { teamNumber },
      create: { teamNumber },
      update: {}
    });

    const base = existing || {
      matchesScouted: 0,
      avgAutoTotalPoints: 0,
      avgTeleopTotalPoints: 0,
      avgEndgamePoints: 0,
      climbAttemptRate: 0,
      climbSuccessRate: 0,
      disableRate: 0,
      foulRate: 0,
      spiderAuto: 0,
      spiderTeleop: 0,
      spiderDefense: 0,
      spiderCycleSpeed: 0,
      spiderReliability: 0,
      spiderEndgame: 0
    };

    const updateData = {
      matchesScouted: Math.max(0, Math.round(parseNumber(payload.matchesScouted, Number(base.matchesScouted || 0)))),
      avgAutoTotalPoints: Math.max(0, parseNumber(payload.avgAutoTotalPoints, Number(base.avgAutoTotalPoints || 0))),
      avgTeleopTotalPoints: Math.max(0, parseNumber(payload.avgTeleopTotalPoints, Number(base.avgTeleopTotalPoints || 0))),
      avgEndgamePoints: Math.max(0, parseNumber(payload.avgEndgamePoints, Number(base.avgEndgamePoints || 0))),
      climbAttemptRate: clamp(parseNumber(payload.climbAttemptRate, Number(base.climbAttemptRate || 0)), 0, 1),
      climbSuccessRate: clamp(parseNumber(payload.climbSuccessRate, Number(base.climbSuccessRate || 0)), 0, 1),
      disableRate: clamp(parseNumber(payload.disableRate, Number(base.disableRate || 0)), 0, 1),
      foulRate: Math.max(0, parseNumber(payload.foulRate, Number(base.foulRate || 0))),
      spiderAuto: Math.max(0, parseNumber(payload.spiderAuto, Number(base.spiderAuto || 0))),
      spiderTeleop: Math.max(0, parseNumber(payload.spiderTeleop, Number(base.spiderTeleop || 0))),
      spiderDefense: clamp(parseNumber(payload.spiderDefense, Number(base.spiderDefense || 0)), 0, 100),
      spiderCycleSpeed: clamp(parseNumber(payload.spiderCycleSpeed, Number(base.spiderCycleSpeed || 0)), 0, 100),
      spiderReliability: clamp(parseNumber(payload.spiderReliability, Number(base.spiderReliability || 0)), 0, 100),
      spiderEndgame: Math.max(0, parseNumber(payload.spiderEndgame, Number(base.spiderEndgame || 0))),
      notes: String(payload.notes || base.notes || '').trim(),
      lastComputed: new Date()
    };

    const saved = await prisma.teamAggregatedStat.upsert({
      where: { eventKey_teamNumber: { eventKey, teamNumber } },
      create: {
        eventKey,
        teamNumber,
        ...updateData
      },
      update: updateData
    });

    const movementOverrides = await loadMovementOverrides();
    const key = movementKey(eventKey, teamNumber);
    if (requestedMovementProfile && requestedMovementProfile !== 'none') {
      movementOverrides[key] = requestedMovementProfile;
    } else {
      delete movementOverrides[key];
    }
    await saveMovementOverrides(movementOverrides);

    const autoOverrides = await loadAutoOverrides();
    if (requestedAutoDid || requestedAutoDescription) {
      autoOverrides[key] = {
        autoDid: requestedAutoDid,
        autoDescription: requestedAutoDescription
      };
    } else {
      delete autoOverrides[key];
    }
    await saveAutoOverrides(autoOverrides);

    return res.json({
      ok: true,
      stat: saved,
      movementProfile: requestedMovementProfile === 'none' ? null : requestedMovementProfile,
      autoDid: requestedAutoDid,
      autoDescription: requestedAutoDescription
    });
  } catch (error) {
    return res.status(500).json({
      errorCode: 'E_MANUAL_STAT_UPDATE_FAILED',
      error: error.message || 'Failed to save manual stat edits'
    });
  }
});

router.get('/statbotics/:eventKey', async (req, res) => {
  const eventKey = req.params.eventKey;
  const rows = await prisma.teamAggregatedStat.findMany({
    where: { eventKey },
    select: { teamNumber: true }
  });

  const competitionTeamNumbers = getCompetitionTeamNumbers();
  const teams = rows.length ? rows.map((row) => row.teamNumber) : competitionTeamNumbers;
  const historicalRows = !rows.length && competitionTeamNumbers.length
    ? await getLatestHistoricalTeamStats(competitionTeamNumbers)
    : [];
  const teamsForLookup = historicalRows.length ? historicalRows.map((row) => row.teamNumber) : teams;
  const statboticsByTeam = await fetchStatboticsByTeams(teams);

  const data = teamsForLookup.map((teamNumber) => {
    const sb = statboticsByTeam.get(teamNumber);
    return {
      teamNumber,
      statbotics: sb
        ? {
            epa: Number(sb.epa.toFixed(2)),
            autoEPA: Number(sb.autoEPA.toFixed(2)),
            teleopEPA: Number(sb.teleopEPA.toFixed(2)),
            endgameEPA: Number(sb.endgameEPA.toFixed(2)),
            normEPA: Number(sb.normEPA.toFixed(2)),
            rank: sb.rank,
            wins: sb.wins,
            losses: sb.losses,
            ties: sb.ties,
            percentile: Number(sb.percentile.toFixed(2))
          }
        : null
    };
  });

  res.json({ eventKey, count: data.length, teams: data });
});

router.get('/robot-status/:eventKey', async (req, res) => {
  const eventKey = req.params.eventKey;
  const rows = await prisma.matchScoutingReport.findMany({ where: { eventKey } });

  const byTeam = new Map();
  for (const row of rows) {
    if (!byTeam.has(row.teamNumber)) {
      byTeam.set(row.teamNumber, {
        teamNumber: row.teamNumber,
        reports: 0,
        disabled: 0,
        tipped: 0,
        fouls: 0,
        lastEndgame: 'none'
      });
    }

    const t = byTeam.get(row.teamNumber);
    t.reports += 1;
    if (row.robotDisabled) t.disabled += 1;
    if (row.robotTipped) t.tipped += 1;
    t.fouls += row.foulsCommitted || 0;
    if (row.endgameResult) t.lastEndgame = row.endgameResult;
  }

  const status = [...byTeam.values()].map((row) => ({
    ...row,
    disableRate: row.reports ? row.disabled / row.reports : 0,
    tipRate: row.reports ? row.tipped / row.reports : 0,
    avgFouls: row.reports ? row.fouls / row.reports : 0
  })).sort((a, b) => a.teamNumber - b.teamNumber);

  res.json(status);
});

router.get('/predict/:eventKey/:matchKey', async (req, res) => {
  try {
    const focusTeam = Number.parseInt(String(req.query.team ?? req.query.focusTeam ?? '3749'), 10) || 3749;
    const teamReady = String(req.query.teamReady ?? req.query.team3749Ready ?? 'true').toLowerCase() !== 'false';
    const result = await predictMatch(req.params.eventKey, req.params.matchKey, {
      focusTeam,
      teamReady,
      team3749Ready: teamReady
    });
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.get('/schedule/:eventKey', async (req, res) => {
  const eventKey = req.params.eventKey;
  const forceTbaRefresh = String(req.query.refreshTba || '').toLowerCase() === 'true';
  await maybeRefreshScheduleFromTba(eventKey, forceTbaRefresh);

  const teamFilter = Number.parseInt(String(req.query.team || ''), 10);
  const focusTeam = Number.isFinite(teamFilter) ? teamFilter : 3749;

  const where = Number.isFinite(teamFilter)
    ? {
        eventKey,
        OR: [
          { redTeam1: teamFilter },
          { redTeam2: teamFilter },
          { redTeam3: teamFilter },
          { blueTeam1: teamFilter },
          { blueTeam2: teamFilter },
          { blueTeam3: teamFilter }
        ]
      }
    : { eventKey };

  const rows = await prisma.match.findMany({
    where,
    orderBy: [{ compLevel: 'asc' }, { setNumber: 'asc' }, { matchNumber: 'asc' }]
  });

  const reportProgressRows = await prisma.matchScoutingReport.findMany({
    where: { eventKey, matchNumber: { not: null } },
    select: { compLevel: true, matchNumber: true }
  });

  const scoutedMatchKeys = new Set(
    reportProgressRows
      .map((row) => `${String(row.compLevel || '').toLowerCase()}:${Number(row.matchNumber || 0)}`)
      .filter((key) => !key.endsWith(':0'))
  );

  const latestReportedQual = reportProgressRows.reduce((max, row) => {
    if (String(row.compLevel || '').toLowerCase() !== 'qm') return max;
    const value = Number(row.matchNumber || 0);
    return value > max ? value : max;
  }, 0);

  const schedule = rows.map((row) => {
    const containsFocusTeam = [row.redTeam1, row.redTeam2, row.redTeam3, row.blueTeam1, row.blueTeam2, row.blueTeam3].includes(focusTeam);
    const allianceForTeam = [row.redTeam1, row.redTeam2, row.redTeam3].includes(focusTeam)
      ? 'red'
      : [row.blueTeam1, row.blueTeam2, row.blueTeam3].includes(focusTeam)
        ? 'blue'
        : null;

    const redScore = Number(row.redScore);
    const blueScore = Number(row.blueScore);
    const scoreCompleted = Number.isFinite(redScore) && Number.isFinite(blueScore) && redScore >= 0 && blueScore >= 0;
    const reportCompleted = scoutedMatchKeys.has(`${String(row.compLevel || '').toLowerCase()}:${Number(row.matchNumber || 0)}`);

    return {
      matchKey: row.matchKey,
      compLevel: row.compLevel,
      setNumber: row.setNumber,
      matchNumber: row.matchNumber,
      redTeams: [row.redTeam1, row.redTeam2, row.redTeam3].filter(Boolean),
      blueTeams: [row.blueTeam1, row.blueTeam2, row.blueTeam3].filter(Boolean),
      redScore: row.redScore,
      blueScore: row.blueScore,
      status: scoreCompleted || reportCompleted ? 'completed' : 'scheduled',
      statusSource: scoreCompleted ? 'score' : reportCompleted ? 'scouting_reports' : 'schedule',
      contains3749: containsFocusTeam,
      alliance3749: allianceForTeam,
      focusTeam,
      containsFocusTeam,
      allianceForTeam,
      predictedTime: row.predictedTime,
      latestReportedQual
    };
  });

  res.json(schedule);
});

router.get('/missing-scouting/:eventKey', async (req, res) => {
  const eventKey = String(req.params.eventKey || '').trim();
  if (!eventKey) {
    return res.status(400).json({ error: 'eventKey is required' });
  }

  try {
    const [matches, reports] = await Promise.all([
      prisma.match.findMany({
        where: { eventKey },
        select: {
          matchKey: true,
          compLevel: true,
          matchNumber: true,
          setNumber: true,
          predictedTime: true,
          redTeam1: true,
          redTeam2: true,
          redTeam3: true,
          blueTeam1: true,
          blueTeam2: true,
          blueTeam3: true
        },
        orderBy: [{ compLevel: 'asc' }, { setNumber: 'asc' }, { matchNumber: 'asc' }]
      }),
      prisma.matchScoutingReport.findMany({
        where: { eventKey, matchNumber: { not: null } },
        select: { compLevel: true, matchNumber: true, teamNumber: true }
      })
    ]);

    const reportedByMatch = new Map();
    for (const row of reports) {
      const compLevel = String(row.compLevel || '').toLowerCase();
      const matchNumber = Number(row.matchNumber || 0);
      const teamNumber = Number(row.teamNumber || 0);
      if (!compLevel || !matchNumber || !teamNumber) continue;

      const key = `${compLevel}:${matchNumber}`;
      if (!reportedByMatch.has(key)) reportedByMatch.set(key, new Set());
      reportedByMatch.get(key).add(teamNumber);
    }

    const missingMatches = [];
    for (const match of matches) {
      const compLevel = String(match.compLevel || '').toLowerCase();
      const matchNumber = Number(match.matchNumber || 0);
      if (!compLevel || !matchNumber) continue;

      const scheduledTeams = [
        Number(match.redTeam1 || 0),
        Number(match.redTeam2 || 0),
        Number(match.redTeam3 || 0),
        Number(match.blueTeam1 || 0),
        Number(match.blueTeam2 || 0),
        Number(match.blueTeam3 || 0)
      ].filter((team) => team > 0);

      if (!scheduledTeams.length) continue;

      const key = `${compLevel}:${matchNumber}`;
      const reportedTeams = reportedByMatch.get(key) || new Set();
      const missingTeams = scheduledTeams.filter((team) => !reportedTeams.has(team));

      if (!missingTeams.length) continue;

      const when = match.predictedTime ? new Date(match.predictedTime) : null;
      missingMatches.push({
        matchKey: match.matchKey,
        compLevel,
        matchNumber,
        setNumber: Number(match.setNumber || 1),
        scheduledDate: when ? when.toISOString().slice(0, 10) : null,
        scheduledTime: when ? when.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : null,
        redTeams: [match.redTeam1, match.redTeam2, match.redTeam3].map((team) => Number(team || 0)).filter((team) => team > 0),
        blueTeams: [match.blueTeam1, match.blueTeam2, match.blueTeam3].map((team) => Number(team || 0)).filter((team) => team > 0),
        missingTeams,
        missingCount: missingTeams.length
      });
    }

    return res.json({
      eventKey,
      matchCount: matches.length,
      missingMatchCount: missingMatches.length,
      missingTeamCount: missingMatches.reduce((sum, row) => sum + Number(row.missingCount || 0), 0),
      rows: missingMatches
    });
  } catch (error) {
    return res.status(500).json({
      errorCode: 'E_MISSING_SCOUTING_LOOKUP_FAILED',
      error: error.message || 'Failed loading missing scouting records'
    });
  }
});

router.get('/leaderboard/:eventKey', async (req, res) => {
  const eventKey = req.params.eventKey;
  const ourTeam = Number.parseInt(String(req.query.ourTeam || '3749'), 10) || 3749;
  const limit = Math.max(1, Math.min(50, Number.parseInt(String(req.query.limit || '15'), 10) || 15));

  let rows = await prisma.teamAggregatedStat.findMany({
    where: { eventKey }
  });

  if (!rows.length) {
    await recomputeExternalTeamStats(eventKey);
    rows = await prisma.teamAggregatedStat.findMany({
      where: { eventKey }
    });
  }

  const competitionTeamNumbers = getCompetitionTeamNumbers();

  const [rankRows, scheduleRows, externalRows, reportRows] = await Promise.all([
    prisma.ranking.findMany({ where: { eventKey } }),
    prisma.match.findMany({
      where: { eventKey },
      select: {
        redTeam1: true,
        redTeam2: true,
        redTeam3: true,
        blueTeam1: true,
        blueTeam2: true,
        blueTeam3: true
      }
    }),
    prisma.externalScoutImport.findMany({
      where: { eventKey, teamNumber: { not: null } },
      select: { teamNumber: true, epaScore: true }
    }),
    prisma.matchScoutingReport.findMany({
      where: { eventKey },
      select: { teamNumber: true, autoFuelAuto: true, teleopFuelScored: true, endgameTowerPoints: true }
    })
  ]);

  const eventTeamNumbers = new Set();
  for (const row of rankRows) {
    const teamNumber = Number(row.teamNumber || 0);
    if (teamNumber > 0) eventTeamNumbers.add(teamNumber);
  }
  for (const row of scheduleRows) {
    for (const teamNumber of [row.redTeam1, row.redTeam2, row.redTeam3, row.blueTeam1, row.blueTeam2, row.blueTeam3]) {
      const parsed = Number(teamNumber || 0);
      if (parsed > 0) eventTeamNumbers.add(parsed);
    }
  }

  if (!eventTeamNumbers.size && competitionTeamNumbers.length) {
    for (const teamNumber of competitionTeamNumbers) eventTeamNumbers.add(teamNumber);
  }

  const sourceRows = eventTeamNumbers.size
    ? rows.filter((row) => eventTeamNumbers.has(Number(row.teamNumber || 0)))
    : rows;

  const rowsByTeam = new Map(sourceRows.map((row) => [Number(row.teamNumber), row]));
  for (const teamNumber of eventTeamNumbers) {
    if (!rowsByTeam.has(teamNumber)) {
      rowsByTeam.set(teamNumber, buildBaselineTeamStatRow(eventKey, teamNumber));
    }
  }
  let competitionRows = [...rowsByTeam.values()];

  if ((!competitionRows.length || competitionRows.every((row) => Number(row.matchesScouted || 0) === 0)) && eventTeamNumbers.size) {
    competitionRows = await getLatestHistoricalTeamStats([...eventTeamNumbers]);
  } else if (!competitionRows.length && competitionTeamNumbers.length) {
    competitionRows = await getLatestHistoricalTeamStats(competitionTeamNumbers);
  }

  const statboticsByTeam = await fetchStatboticsByTeams(competitionRows.map((row) => row.teamNumber));

  const rankingByTeam = new Map(rankRows.map((row) => [row.teamNumber, row]));

  const epaByTeam = new Map();
  const epaCountByTeam = new Map();
  for (const row of externalRows) {
    const teamNumber = Number(row.teamNumber);
    const epa = Number(row.epaScore);
    if (!teamNumber || !Number.isFinite(epa)) continue;
    epaByTeam.set(teamNumber, (epaByTeam.get(teamNumber) || 0) + epa);
    epaCountByTeam.set(teamNumber, (epaCountByTeam.get(teamNumber) || 0) + 1);
  }
  for (const [teamNumber, total] of epaByTeam.entries()) {
    const count = epaCountByTeam.get(teamNumber) || 1;
    epaByTeam.set(teamNumber, total / count);
  }

  const reportByTeam = new Map();
  for (const row of reportRows) {
    const teamNumber = Number(row.teamNumber);
    if (!teamNumber) continue;
    if (!reportByTeam.has(teamNumber)) {
      reportByTeam.set(teamNumber, {
        autoFuelAvg: 0,
        teleFuelAvg: 0,
        endgamePointsAvg: 0,
        count: 0
      });
    }

    const agg = reportByTeam.get(teamNumber);
    agg.count += 1;
    agg.autoFuelAvg += Number(row.autoFuelAuto || 0);
    agg.teleFuelAvg += Number(row.teleopFuelScored || 0);
    agg.endgamePointsAvg += Number(row.endgameTowerPoints || 0);
  }
  for (const agg of reportByTeam.values()) {
    const denom = Math.max(1, agg.count);
    agg.autoFuelAvg /= denom;
    agg.teleFuelAvg /= denom;
    agg.endgamePointsAvg /= denom;
  }

  const ranked = computePickLeaderboard(competitionRows, ourTeam, {
    rankingByTeam,
    epaByTeam,
    reportByTeam,
    statboticsByTeam
  });

  let dcmpSnapshot = null;
  if (isCaCmpEvent(eventKey)) {
    try {
      dcmpSnapshot = await fetchCaDistrictTop48Snapshot(parseEventYear(eventKey));
    } catch (error) {
      console.error(`[leaderboard] Failed to fetch CA district snapshot: ${error.message}`);
    }
  }

  const dcmpByTeam = dcmpSnapshot?.byTeam || new Map();
  const rankedWithDcmp = ranked.map((row) => {
    const dcmp = dcmpByTeam.get(Number(row.teamNumber)) || null;
    let dcmpStatus = 'N/A';
    if (dcmp) {
      dcmpStatus = dcmp.inTop48Percent ? 'Top 48%' : 'Outside 48%';
    } else if (dcmpSnapshot) {
      dcmpStatus = 'Not in CA data';
    }

    return {
      ...row,
      dcmpStatus,
      dcmpRank: dcmp?.rank || null,
      dcmpCutoffRank: dcmpSnapshot?.cutoffRank || null
    };
  });

  res.json({
    eventKey,
    ourTeam,
    count: rankedWithDcmp.length,
    leaderboard: rankedWithDcmp.slice(0, limit),
    competitionFilter: {
      eventTeamCount: eventTeamNumbers.size || competitionRows.length,
      source: eventTeamNumbers.size ? 'rankings+schedule+history' : 'historical-stats'
    },
    dcmp: dcmpSnapshot
      ? {
          district: dcmpSnapshot.district,
          cutoffPercent: dcmpSnapshot.cutoffPercent,
          cutoffRank: dcmpSnapshot.cutoffRank,
          teamCount: dcmpSnapshot.teamCount,
          url: dcmpSnapshot.url,
          fetchedAt: dcmpSnapshot.fetchedAt
        }
      : null
  });
});

router.get('/alliance-probabilities/:eventKey', async (req, res) => {
  const eventKey = req.params.eventKey;
  const forceTbaRefresh = String(req.query.refreshTba || '').toLowerCase() === 'true';

  try {
    await maybeRefreshScheduleFromTba(eventKey, true);
  } catch (err) {
    console.error(`[alliance-probabilities] TBA sync failed: ${err.message}`);
  }

  const rankingRows = await prisma.ranking.findMany({
    where: { eventKey },
    include: {
      team: {
        select: { nickname: true }
      }
    },
    orderBy: [
      { rank: 'asc' },
      { teamNumber: 'asc' }
    ]
  });
  const fetchSource = 'database';

  const statsRows = await prisma.teamAggregatedStat.findMany({ where: { eventKey } });

  if (!rankingRows.length) {
    res.status(400).json({ error: `No rankings found for ${eventKey}. Run TBA sync first.` });
    return;
  }

  const { alliances, warnings, nextOnClock } = computeAlliancePickProbabilities({ rankingRows, statsRows });
  res.json({
    eventKey,
    draftFormat: 'serpentine',
    rounds: 3,
    teamsPerAlliance: 4,
    captainCount: alliances.length,
    alliances,
    warnings,
    nextOnClock,
    rankingsSource: fetchSource
  });
});

router.post('/alliance-probabilities/:eventKey/live', async (req, res) => {
  const eventKey = req.params.eventKey;
  const forceTbaRefresh = String(req.query.refreshTba || '').toLowerCase() === 'true';

  try {
    await maybeRefreshScheduleFromTba(eventKey, true);
  } catch (err) {
    console.error(`[alliance-probabilities/live] TBA sync failed: ${err.message}`);
  }

  const rawLocks = Array.isArray(req.body?.lockedPicks) ? req.body.lockedPicks : [];
  const lockedPicks = rawLocks
    .map((entry) => ({
      allianceSeed: Number(entry?.allianceSeed || 0),
      captainTeamNumber: Number(entry?.captainTeamNumber || 0),
      roundNumber: Number(entry?.roundNumber || 0),
      teamNumber: Number(entry?.teamNumber || 0)
    }))
    .filter((entry) => entry.roundNumber >= 1 && entry.roundNumber <= 3 && entry.teamNumber > 0 && (entry.allianceSeed > 0 || entry.captainTeamNumber > 0))
    .slice(0, 24);

  const rankingRows = await prisma.ranking.findMany({
    where: { eventKey },
    include: {
      team: {
        select: { nickname: true }
      }
    },
    orderBy: [
      { rank: 'asc' },
      { teamNumber: 'asc' }
    ]
  });
  const fetchSource = 'database';

  const statsRows = await prisma.teamAggregatedStat.findMany({ where: { eventKey } });

  if (!rankingRows.length) {
    res.status(400).json({ error: `No rankings found for ${eventKey}. Run TBA sync first.` });
    return;
  }

  const { alliances, warnings, nextOnClock } = computeAlliancePickProbabilities({ rankingRows, statsRows, lockedPicks });
  res.json({
    eventKey,
    draftFormat: 'serpentine',
    rounds: 3,
    teamsPerAlliance: 4,
    captainCount: alliances.length,
    alliances,
    lockedPicks,
    warnings,
    nextOnClock,
    rankingsSource: fetchSource
  });
});

router.post('/brick-ai/:eventKey', async (req, res) => {
  const eventKey = req.params.eventKey;
  const question = String(req.body?.question || '').trim();
  const selectedTeam = Number.parseInt(String(req.body?.teamNumber || ''), 10);

  if (!question) {
    res.status(400).json({ error: 'Question is required.' });
    return;
  }

  const explicitMentionedTeams = [
    ...new Set(
      (question.match(/\b\d{3,5}\b/g) || [])
        .map((entry) => Number.parseInt(entry, 10))
        .filter((value) => Number.isFinite(value) && value > 0)
    )
  ];

  const mentionedTeams = [...explicitMentionedTeams];
  if (Number.isFinite(selectedTeam) && selectedTeam > 0 && !mentionedTeams.includes(selectedTeam)) mentionedTeams.push(selectedTeam);

  const [eventStatsRows, globalStatsRows] = await Promise.all([
    prisma.teamAggregatedStat.findMany({
      where: { eventKey },
      orderBy: [{ spiderReliability: 'desc' }, { teamNumber: 'asc' }],
      take: 60
    }),
    prisma.teamAggregatedStat.findMany({
      orderBy: [{ matchesScouted: 'desc' }, { spiderReliability: 'desc' }, { teamNumber: 'asc' }],
      take: 260
    })
  ]);

  const preferredByTeam = new Map();
  for (const row of globalStatsRows) {
    if (!preferredByTeam.has(row.teamNumber)) preferredByTeam.set(row.teamNumber, row);
  }
  for (const row of eventStatsRows) {
    preferredByTeam.set(row.teamNumber, row);
  }

  if (mentionedTeams.length) {
    const missingMentioned = mentionedTeams.filter((teamNumber) => !preferredByTeam.has(teamNumber));
    if (missingMentioned.length) {
      const mentionedRows = await prisma.teamAggregatedStat.findMany({
        where: { teamNumber: { in: missingMentioned } },
        orderBy: [{ matchesScouted: 'desc' }, { spiderReliability: 'desc' }],
        take: Math.max(15, missingMentioned.length * 2)
      });
      for (const row of mentionedRows) {
        if (!preferredByTeam.has(row.teamNumber)) preferredByTeam.set(row.teamNumber, row);
      }
    }
  }

  const statsRows = [...preferredByTeam.values()];
  const baseTeams = explicitMentionedTeams.length
    ? mentionedTeams
    : statsRows.slice(0, 30).map((row) => row.teamNumber);

  const statusRows = await prisma.matchScoutingReport.findMany({
    where: baseTeams.length
      ? { teamNumber: { in: baseTeams } }
      : undefined,
    orderBy: { createdAt: 'desc' },
    take: 320,
    select: {
      eventKey: true,
      teamNumber: true,
      robotDisabled: true,
      robotTipped: true,
      foulsCommitted: true,
      endgameResult: true,
      generalNotes: true,
      createdAt: true
    }
  });

  const statusByTeam = new Map();
  for (const row of statusRows) {
    if (!statusByTeam.has(row.teamNumber)) {
      statusByTeam.set(row.teamNumber, {
        reports: 0,
        disabled: 0,
        tipped: 0,
        fouls: 0,
        latestNotes: [],
        events: new Set()
      });
    }

    const status = statusByTeam.get(row.teamNumber);
    status.reports += 1;
    if (row.robotDisabled) status.disabled += 1;
    if (row.robotTipped) status.tipped += 1;
    status.fouls += Number(row.foulsCommitted || 0);
    if (row.eventKey) status.events.add(row.eventKey);
    if (row.generalNotes && status.latestNotes.length < 3) {
      status.latestNotes.push(String(row.generalNotes).slice(0, 180));
    }
  }

  const teamsToInclude = explicitMentionedTeams.length
    ? statsRows.filter((row) => mentionedTeams.includes(row.teamNumber))
    : (() => {
        const top = statsRows.slice(0, 18);
        if (!Number.isFinite(selectedTeam) || selectedTeam <= 0) return top;
        if (top.some((row) => row.teamNumber === selectedTeam)) return top;
        const selectedRow = statsRows.find((row) => row.teamNumber === selectedTeam);
        return selectedRow ? [selectedRow, ...top.slice(0, 17)] : top;
      })();

  const context = teamsToInclude.map((row) => {
    const status = statusByTeam.get(row.teamNumber) || {
      reports: 0,
      disabled: 0,
      tipped: 0,
      fouls: 0,
      latestNotes: [],
      events: new Set()
    };

    const reports = Math.max(1, status.reports);
    return {
      teamNumber: row.teamNumber,
      spiderAuto: Number(row.spiderAuto || 0),
      spiderTeleop: Number(row.spiderTeleop || 0),
      spiderDefense: Number(row.spiderDefense || 0),
      spiderCycleSpeed: Number(row.spiderCycleSpeed || 0),
      spiderReliability: Number(row.spiderReliability || 0),
      spiderEndgame: Number(row.spiderEndgame || 0),
      matchesScouted: Number(row.matchesScouted || 0),
      sourceEventKey: row.eventKey,
      observedEvents: [...status.events].slice(0, 8),
      disableRate: Number((status.disabled / reports).toFixed(3)),
      tipRate: Number((status.tipped / reports).toFixed(3)),
      avgFouls: Number((status.fouls / reports).toFixed(3)),
      notes: status.latestNotes
    };
  });

  const fallbackBrickAnswer = () => {
    if (!context.length) {
      return [
        `No scouting context found yet for ${eventKey}.`,
        'Import match scouting or aggregator stats, then ask again.',
        'You can still ask by team number once data exists in the database.'
      ].join('\n');
    }

    const byReliability = [...context].sort((a, b) => b.spiderReliability - a.spiderReliability);
    const byTeleop = [...context].sort((a, b) => b.spiderTeleop - a.spiderTeleop);
    const byDefense = [...context].sort((a, b) => b.spiderDefense - a.spiderDefense);
    const focusTeams = explicitMentionedTeams.length
      ? context.filter((entry) => mentionedTeams.includes(entry.teamNumber)).map((entry) => entry.teamNumber)
      : byTeleop.slice(0, 3).map((entry) => entry.teamNumber);

    return [
      'E_BRICK_AI_RUNTIME_UNAVAILABLE: database scouting only.',
      `Question: ${question}`,
      `Focus teams: ${focusTeams.length ? focusTeams.join(', ') : 'none identified'}`,
      `Top teleop: ${byTeleop.slice(0, 3).map((entry) => `${entry.teamNumber} (${entry.spiderTeleop.toFixed(1)})`).join(' | ')}`,
      `Top defense: ${byDefense.slice(0, 3).map((entry) => `${entry.teamNumber} (${entry.spiderDefense.toFixed(1)})`).join(' | ')}`,
      `Most reliable: ${byReliability.slice(0, 3).map((entry) => `${entry.teamNumber} (${entry.spiderReliability.toFixed(1)})`).join(' | ')}`,
      'Callouts: prioritize denying highest teleop team cycle lanes; avoid foul-heavy contact against high reliability teams.'
    ].join('\n');
  };

  res.json({
    eventKey,
    answer: fallbackBrickAnswer(),
    teamsUsed: context.map((entry) => entry.teamNumber),
    degraded: true,
    dataScope: 'all-available-with-event-priority',
    warning: 'E_BRICK_AI_TEMPORARILY_DISABLED'
  });
});

router.get('/debug/rankings/:eventKey', async (req, res) => {
  const eventKey = req.params.eventKey;
  
  console.log(`\n[DEBUG] Rankings diagnostic for ${eventKey}`);
  
  let tbaRankings = [];
  try {
    tbaRankings = await fetchTbaRankings(eventKey);
    console.log(`✓ Fetched ${tbaRankings.length} rankings from TBA`);
    console.log(`  Top 8: ${tbaRankings.slice(0, 8).map(r => `${r.teamNumber}(rank${r.rank})`).join(', ')}`);
  } catch (err) {
    console.warn(`✗ TBA fetch failed: ${err.message}`);
  }
  
  const dbRankings = await prisma.ranking.findMany({
    where: { eventKey },
    orderBy: [{ rank: 'asc' }, { teamNumber: 'asc' }],
    take: 20
  });
  console.log(`\n✓ Database has ${dbRankings.length} rankings total`);
  console.log(`  Top 8: ${dbRankings.slice(0, 8).map(r => `${r.teamNumber}(rank${r.rank})`).join(', ')}`);
  
  res.json({
    eventKey,
    tbaCount: tbaRankings.length,
    tbaTop8: tbaRankings.slice(0, 8).map(r => ({ teamNumber: r.teamNumber, rank: r.rank, rankingPoints: r.rankingPoints })),
    dbCount: dbRankings.length,
    dbTop8: dbRankings.slice(0, 8).map(r => ({ teamNumber: r.teamNumber, rank: r.rank, rankingPoints: r.rankingPoints })),
    tbaApiKeyConfigured: !!process.env.TBA_API_KEY
  });
});

export default router;
