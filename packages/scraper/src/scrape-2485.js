import * as cheerio from 'cheerio';
import { prisma } from '@3749/db/src/client.js';
import { callSmolLM } from '@3749/ai/src/lemonade-client.js';

const SCRAPE_URL = 'https://frc2485analytics.vercel.app/sudo';
const SCRAPE_API_URL = 'https://frc2485analytics.vercel.app/api/get-data';
const DEFAULT_GLOBAL_EVENT = '2485_all';

const FALLBACK_HEADERS = [
  'ScoutName', 'Team', 'EPA', 'Match', 'Action', 'AUTO', 'TELE', 'END', 'Scout Team', 'Breakdown',
  'noshow', 'matchtype', 'autoclimb', 'autoclimbposition', 'autofuel', 'intakeground', 'intakeoutpost',
  'passingbulldozer', 'passingshooter', 'passingdump', 'shootwhilemove', 'telefuel', 'defenselocationaz',
  'defenselocationnz', 'endclimbposition', 'wideclimb', 'shootingmechanism', 'bump', 'trench', 'stuckonfuel',
  'stuckonbump', 'fouls', 'playeddefense', 'defense', 'climbhazard', 'hoppercapacity', 'maneuverability',
  'defenseevasion', 'climbspeed', 'fuelspeed', 'passingquantity', 'autodeclimbspeed', 'generalcomments',
  'breakdowncomments', 'defensecomments', 'foulcomments'
];

const toBool = (value) => ['1', 'true', 'yes', 'y', 'x'].includes(String(value ?? '').toLowerCase().trim());
const toInt = (value, max = 999) => Math.max(0, Math.min(max, Number.parseInt(value ?? '0', 10) || 0));
const toFloat = (value) => Number.parseFloat(value ?? '0') || 0;
const toMatchType = (value) => {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (['2', 'qm', 'qual', 'quals', 'qualification'].includes(normalized)) return 'qm';
  if (['qf', 'quarterfinal', 'quarterfinals'].includes(normalized)) return 'qf';
  if (['sf', 'semifinal', 'semifinals'].includes(normalized)) return 'sf';
  if (['f', 'final', 'finals'].includes(normalized)) return 'f';
  return normalized || 'qm';
};

const pick = (row, keys) => {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== '') return row[key];
  }

  const normalizedEntries = Object.entries(row).map(([k, v]) => [k.trim().toLowerCase(), v]);
  for (const key of keys.map((k) => k.trim().toLowerCase())) {
    const match = normalizedEntries.find(([k]) => k === key);
    if (match && match[1] !== '') return match[1];
  }

  return '';
};

async function fetchRowsFromApi() {
  try {
    const response = await fetch(SCRAPE_API_URL);
    if (!response.ok) return [];

    const payload = await response.json();
    if (!Array.isArray(payload?.rows)) return [];

    return payload.rows.map((row) => ({
      ScoutName: row.scoutname ?? '',
      Team: row.team ?? '',
      EPA: row.epa ?? row.EPA ?? '',
      Match: row.match ?? '',
      matchtype: row.matchtype ?? '',
      noshow: row.noshow ?? '',
      autofuel: row.autofuel ?? '',
      telefuel: row.telefuel ?? '',
      defense: row.defense ?? '',
      fouls: row.fouls ?? '',
      generalcomments: row.generalcomments ?? '',
      __cells: []
    }));
  } catch {
    return [];
  }
}

export async function scrapeAndImport(eventKey, options = {}) {
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
  const returnRows = options.returnRows !== false;
  const effectiveEventKey = eventKey || DEFAULT_GLOBAL_EVENT;

  onProgress?.({ phase: 'initializing', message: `Preparing scrape for ${effectiveEventKey}...` });

  await prisma.event.upsert({
    where: { eventKey: effectiveEventKey },
    update: {},
    create: { eventKey: effectiveEventKey, name: effectiveEventKey, year: 2026 }
  });

  let rows = await fetchRowsFromApi();
  onProgress?.({ phase: 'fetching', message: 'Fetching source rows...' });

  if (!rows.length) {
    onProgress?.({ phase: 'fallback-html', message: 'API empty, scraping HTML table...' });
    const response = await fetch(SCRAPE_URL);
    if (!response.ok) throw new Error(`Scrape failed: ${response.status} from ${SCRAPE_URL}`);
    const html = await response.text();
    const $ = cheerio.load(html);

    const headers = [];
    $('table thead tr th').each((_, el) => headers.push($(el).text().trim()));

    const effectiveHeaders = headers.length ? headers : FALLBACK_HEADERS;

    rows = [];
    $('table tbody tr').each((_, row) => {
      const cells = [];
      $(row).find('td').each((__, cell) => cells.push($(cell).text().trim()));
      if (cells.some(Boolean)) {
        const joined = cells.join(' ').toLowerCase();
        if (joined.includes('no data')) return;

        const record = {};
        effectiveHeaders.forEach((header, index) => {
          record[header] = cells[index] ?? '';
        });
        record.__cells = cells;
        rows.push(record);
      }
    });
  }

  if (!rows.length) {
    onProgress?.({ phase: 'done', totalRows: 0, processedRows: 0, importedRows: 0, message: 'No rows found to import.' });
    return [];
  }

  onProgress?.({ phase: 'importing', totalRows: rows.length, processedRows: 0, importedRows: 0, message: `Importing 0/${rows.length} rows...` });

  const imported = returnRows ? [] : null;
  let importedCount = 0;
  let processedRows = 0;
  for (const row of rows) {
    const teamNumber = toInt(pick(row, ['Team', 'team']) || row.__cells?.[1], 99999);
    const matchNumber = toInt(pick(row, ['Match', 'match']) || row.__cells?.[3], 999);
    if (!teamNumber || !matchNumber) {
      processedRows += 1;
      onProgress?.({
        phase: 'importing',
        totalRows: rows.length,
        processedRows,
        importedRows: importedCount,
        message: `Importing ${processedRows}/${rows.length} rows...`
      });
      continue;
    }

    await prisma.team.upsert({
      where: { teamNumber },
      update: {},
      create: { teamNumber, nickname: `Team ${teamNumber}` }
    });

    const payload = {
      sourceTeam: 2485,
      eventKey: effectiveEventKey,
      teamNumber,
      matchNumber,
      matchType: toMatchType(row.matchtype),
      scoutName: row.ScoutName || null,
      epaScore: toFloat(row.EPA),
      noShow: toBool(row.noshow),
      autoFuel: toInt(pick(row, ['autofuel', 'auto_fuel', 'autoFuel', 'AUTO', 'Auto']) || row.__cells?.[5], 99),
      teleFuel: toInt(pick(row, ['telefuel', 'tele_fuel', 'teleFuel', 'TELE', 'Tele', 'Teleop']) || row.__cells?.[6], 200),
      defenseRating: toInt(pick(row, ['defense', 'Defense', 'defenseRating']) || row.__cells?.[37], 5),
      fouls: toInt(pick(row, ['fouls', 'Fouls']) || row.__cells?.[34], 20),
      generalComments: pick(row, ['generalcomments', 'generalComments', 'General Comments']) || null,
      importedToMain: false
    };

    let aiPayload = null;
    try {
      aiPayload = await callSmolLM(
        'You normalize FRC scouting rows. Return strict JSON with fields: teamNumber, matchNumber, epaScore, autoFuel, teleFuel, defenseRating, fouls, noShow, generalComments. Use numbers, booleans, strings.',
        JSON.stringify(row),
        true
      );
    } catch {
      aiPayload = null;
    }

    const normalizedPayload = {
      ...payload,
      teamNumber: Number(aiPayload?.teamNumber) || payload.teamNumber,
      matchNumber: Number(aiPayload?.matchNumber) || payload.matchNumber,
      matchType: toMatchType(aiPayload?.matchType ?? payload.matchType),
      epaScore: Number(aiPayload?.epaScore ?? payload.epaScore) || payload.epaScore,
      autoFuel: Number(aiPayload?.autoFuel ?? payload.autoFuel) || payload.autoFuel,
      teleFuel: Number(aiPayload?.teleFuel ?? payload.teleFuel) || payload.teleFuel,
      defenseRating: Number(aiPayload?.defenseRating ?? payload.defenseRating) || payload.defenseRating,
      fouls: Number(aiPayload?.fouls ?? payload.fouls) || payload.fouls,
      noShow: typeof aiPayload?.noShow === 'boolean' ? aiPayload.noShow : payload.noShow,
      generalComments: String(aiPayload?.generalComments ?? payload.generalComments ?? '') || null
    };

    const upserted = await prisma.externalScoutImport.upsert({
      where: {
        teamNumber_matchNumber_sourceTeam_eventKey: {
          teamNumber: normalizedPayload.teamNumber,
          matchNumber: normalizedPayload.matchNumber,
          sourceTeam: normalizedPayload.sourceTeam,
          eventKey: normalizedPayload.eventKey
        }
      },
      update: normalizedPayload,
      create: normalizedPayload
    });

    importedCount += 1;
    if (returnRows) imported.push(upserted);
    processedRows += 1;
    onProgress?.({
      phase: 'importing',
      totalRows: rows.length,
      processedRows,
      importedRows: importedCount,
      message: `Importing ${processedRows}/${rows.length} rows...`
    });
  }

  onProgress?.({
    phase: 'done',
    totalRows: rows.length,
    processedRows,
    importedRows: importedCount,
    message: `Imported ${importedCount}/${rows.length} rows.`
  });

  if (!returnRows) {
    return {
      importedCount,
      totalRows: rows.length,
      eventKey: effectiveEventKey
    };
  }

  return imported;
}
