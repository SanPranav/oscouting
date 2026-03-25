import * as cheerio from 'cheerio';
import { request as httpsRequest } from 'node:https';
import { prisma } from '@3749/db/src/client.js';
import { callSmolLM } from '@3749/ai/src/lemonade-client.js';

const SCRAPE_URL = process.env.EXTERNAL_SCRAPE_SUDO_URL || 'https://frc2485analytics.vercel.app/sudo';
const SCRAPE_API_URL = process.env.EXTERNAL_SCRAPE_API_URL || 'https://frc2485analytics.vercel.app/api/get-data';
const DEFAULT_GLOBAL_EVENT = '2485_all';
const REQUEST_TIMEOUT_MS = Number(process.env.EXTERNAL_SCRAPE_TIMEOUT_MS || 20000);
const SCRAPE_ORIGIN = (() => {
  try {
    return new URL(SCRAPE_URL).origin;
  } catch {
    return 'https://frc2485analytics.vercel.app';
  }
})();
const SCRAPE_API_CANDIDATES = Array.from(new Set([
  SCRAPE_API_URL,
  `${SCRAPE_ORIGIN}/api/get-data`,
  `${SCRAPE_ORIGIN}/api/getData`,
  `${SCRAPE_ORIGIN}/api/data`
].filter(Boolean)));
const PUBLIC_DNS_PROVIDERS = [
  (hostname) => `https://dns.google/resolve?name=${encodeURIComponent(hostname)}&type=A`,
  (hostname) => `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(hostname)}&type=A`
];

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

const createFetchOptions = () => ({
  headers: {
    Accept: 'application/json,text/html;q=0.9,*/*;q=0.8',
    'User-Agent': 'team3749-oscouting-scraper/1.0'
  }
});

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function resolvePublicIPv4(hostname) {
  const addresses = [];

  for (const provider of PUBLIC_DNS_PROVIDERS) {
    try {
      const endpoint = provider(hostname);
      const headers = endpoint.includes('cloudflare-dns.com')
        ? { Accept: 'application/dns-json' }
        : undefined;

      const response = await fetchWithTimeout(endpoint, headers ? { headers } : undefined);
      if (!response.ok) continue;

      const payload = await response.json();
      const answers = Array.isArray(payload?.Answer) ? payload.Answer : [];
      for (const entry of answers) {
        if (entry?.type === 1 && typeof entry?.data === 'string') {
          addresses.push(entry.data.trim());
        }
      }
    } catch {
      continue;
    }
  }

  return Array.from(new Set(addresses));
}

function requestTextByIp(urlString, ip) {
  return new Promise((resolve, reject) => {
    const target = new URL(urlString);
    const req = httpsRequest({
      protocol: target.protocol,
      host: ip,
      port: target.port || 443,
      servername: target.hostname,
      method: 'GET',
      path: `${target.pathname}${target.search}`,
      headers: {
        ...createFetchOptions().headers,
        Host: target.hostname
      },
      timeout: REQUEST_TIMEOUT_MS
    }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => {
        resolve({ ok: (res.statusCode || 0) >= 200 && (res.statusCode || 0) < 300, status: Number(res.statusCode || 0), text: body });
      });
    });

    req.on('timeout', () => {
      req.destroy(new Error('request timed out'));
    });
    req.on('error', reject);
    req.end();
  });
}

async function fetchDirectText(url, errors, label) {
  try {
    const response = await fetchWithTimeout(url, createFetchOptions());
    if (response.ok) {
      return await response.text();
    }
    errors.push(`${label} request returned ${response.status}`);
  } catch (error) {
    errors.push(`${label} request failed`);
  }

  let target;
  try {
    target = new URL(url);
  } catch {
    return null;
  }

  const ips = await resolvePublicIPv4(target.hostname);
  if (!ips.length) {
    errors.push(`${label} public DNS returned no IPv4 records`);
    return null;
  }

  for (const ip of ips) {
    try {
      const response = await requestTextByIp(url, ip);
      if (response.ok) {
        return response.text;
      }
      errors.push(`${label} IP route returned ${response.status}`);
    } catch (error) {
      errors.push(`${label} IP route failed`);
    }
  }

  return null;
}

const parseJsonFromText = (rawText) => {
  if (!rawText) return null;

  const direct = rawText.trim();
  try {
    return JSON.parse(direct);
  } catch {
    // continue
  }

  const marker = 'Markdown Content:';
  const markerIndex = rawText.indexOf(marker);
  if (markerIndex >= 0) {
    const markdownContent = rawText.slice(markerIndex + marker.length).trim();
    try {
      return JSON.parse(markdownContent);
    } catch {
      // continue
    }
  }

  const firstBrace = rawText.indexOf('{');
  const lastBrace = rawText.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    const jsonSlice = rawText.slice(firstBrace, lastBrace + 1);
    try {
      return JSON.parse(jsonSlice);
    } catch {
      return null;
    }
  }

  return null;
};

const normalizeSourceRow = (row) => ({
  ScoutName: pick(row, ['ScoutName', 'scoutname', 'scout_name', 'scout']) ?? '',
  Team: pick(row, ['Team', 'team', 'teamNumber', 'team_number']) ?? '',
  EPA: pick(row, ['EPA', 'epa', 'epaScore', 'epa_score']) ?? '',
  Match: pick(row, ['Match', 'match', 'matchNumber', 'match_number']) ?? '',
  matchtype: pick(row, ['matchtype', 'matchType', 'compLevel', 'comp_level']) ?? '',
  noshow: pick(row, ['noshow', 'noShow', 'no_show']) ?? '',
  autofuel: pick(row, ['autofuel', 'autoFuel', 'auto_fuel']) ?? '',
  telefuel: pick(row, ['telefuel', 'teleFuel', 'tele_fuel']) ?? '',
  defense: pick(row, ['defense', 'defenseRating', 'defense_rating']) ?? '',
  fouls: pick(row, ['fouls']) ?? '',
  generalcomments: pick(row, ['generalcomments', 'generalComments', 'general_comments']) ?? '',
  __cells: []
});

const looksLikeScoutRow = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;

  const keys = Object.keys(value).map((entry) => entry.toLowerCase());
  return keys.includes('team')
    || keys.includes('teamnumber')
    || keys.includes('team_number')
    || keys.includes('match')
    || keys.includes('matchnumber')
    || keys.includes('match_number')
    || keys.includes('scoutname')
    || keys.includes('scout_name');
};

const findFirstRowArray = (value, depth = 0) => {
  if (depth > 6 || value == null) return null;

  if (Array.isArray(value)) {
    if (!value.length) return null;
    if (value.some(looksLikeScoutRow)) return value;

    for (const item of value) {
      const nested = findFirstRowArray(item, depth + 1);
      if (nested) return nested;
    }

    return null;
  }

  if (typeof value === 'object') {
    for (const nested of Object.values(value)) {
      const found = findFirstRowArray(nested, depth + 1);
      if (found) return found;
    }
  }

  return null;
};

const parseRowsFromJsonPayload = (payload) => {
  const rowArray = findFirstRowArray(payload);
  if (!rowArray) return [];
  return rowArray.map((row) => normalizeSourceRow(row));
};

async function fetchRowsFromApi() {
  const errors = [];

  for (const apiUrl of SCRAPE_API_CANDIDATES) {
    try {
      const raw = await fetchDirectText(apiUrl, errors, 'API');
      if (!raw) {
        continue;
      }

      const payload = parseJsonFromText(raw);
      if (!payload) {
        errors.push(`${apiUrl} -> response was not valid JSON payload`);
        continue;
      }

      const rows = parseRowsFromJsonPayload(payload);
      if (rows.length) {
        return { rows, errors };
      }

      errors.push(`${apiUrl} -> payload did not contain row data`);
    } catch (error) {
      errors.push(`${apiUrl} -> ${error?.message || 'API fetch failed'}`);
    }
  }

  return { rows: [], errors };
}

function extractRowsFromHtml(html) {
  const $ = cheerio.load(html);

  const headers = [];
  $('table thead tr th').each((_, el) => headers.push($(el).text().trim()));

  const effectiveHeaders = headers.length ? headers : FALLBACK_HEADERS;

  const rows = [];
  $('table tbody tr').each((_, row) => {
    const cells = [];
    $(row).find('td').each((__, cell) => cells.push($(cell).text().trim()));
    if (!cells.some(Boolean)) return;

    const joined = cells.join(' ').toLowerCase();
    if (joined.includes('no data')) return;

    const record = {};
    effectiveHeaders.forEach((header, index) => {
      record[header] = cells[index] ?? '';
    });
    record.__cells = cells;
    rows.push(record);
  });

  if (rows.length) return rows;

  const jsonSources = [];
  $('script#__NEXT_DATA__, script[type="application/json"]').each((_, script) => {
    const text = $(script).contents().text()?.trim();
    if (text) jsonSources.push(text);
  });

  for (const source of jsonSources) {
    try {
      const payload = JSON.parse(source);
      const normalized = parseRowsFromJsonPayload(payload);
      if (normalized.length) return normalized;
    } catch {
      continue;
    }
  }

  return [];
}

export async function scrapeAndImport(eventKey, options = {}) {
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
  const returnRows = options.returnRows !== false;
  const effectiveEventKey = eventKey || DEFAULT_GLOBAL_EVENT;

  onProgress?.({ phase: 'initializing', message: 'Preparing external sync...' });

  await prisma.event.upsert({
    where: { eventKey: effectiveEventKey },
    update: {},
    create: { eventKey: effectiveEventKey, name: effectiveEventKey, year: 2026 }
  });

  const apiResult = await fetchRowsFromApi();
  let rows = apiResult.rows;
  onProgress?.({ phase: 'fetching', message: 'Fetching source rows...' });

  let htmlError = null;
  if (!rows.length) {
    onProgress?.({ phase: 'fallback-html', message: 'API empty, scraping HTML table...' });
    try {
      const htmlErrors = [];
      const html = await fetchDirectText(SCRAPE_URL, htmlErrors, 'HTML');
      if (!html) {
        throw new Error(htmlErrors.join(' | ') || 'HTML fetch failed');
      }
      rows = extractRowsFromHtml(html);
    } catch (error) {
      htmlError = error?.message || 'HTML fallback failed';
    }
  }

  if (!rows.length) {
    const apiErrorText = apiResult.errors?.length ? ` API: ${apiResult.errors.join(' | ')}` : '';
    const htmlErrorText = htmlError ? ` HTML: ${htmlError}` : '';
    throw new Error(`No rows found in external scouting source.${apiErrorText}${htmlErrorText}`.trim());
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
