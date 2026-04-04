import { useEffect, useMemo, useRef, useState } from 'react';
import { Database, FileUp, Upload } from 'lucide-react';
import { Button } from './components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './components/ui/card';
import { Input } from './components/ui/input';
import { Badge } from './components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './components/ui/table';

const API_BASE = import.meta.env.VITE_API_BASE || '';
const DEFAULT_EVENT_KEY = '2026caasv';

const MODE_MATCH = 'match';
const MODE_PIT = 'pit';

const normalizeMatchSuffix = (rawValue, fallback) => {
  const value = String(rawValue || '').trim();
  if (!value) return fallback;
  if (/^qm\d+$/i.test(value)) return value.toLowerCase();
  if (/^\d+$/.test(value)) return `qm${value}`;
  if (/^(ef|qf|sf|f)\d+m?\d*$/i.test(value)) return value.toLowerCase();
  return fallback;
};

const parseLeadingZeroNumberish = (value, fallback = 0) => {
  const text = String(value ?? '').trim();
  if (!text) return fallback;
  const normalized = /^0\d+$/.test(text)
    ? text.replace(/^0+(?=\d)/, '')
    : text;
  const numeric = Number.parseInt(normalized, 10);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const normalizeMatchRow = (row) => ({
  ...row,
  teamNumber: parseLeadingZeroNumberish(row?.teamNumber, 0),
  matchesScouted: Number(row?.matchesScouted || 0),
  statbotics: row?.statbotics
    ? {
        ...row.statbotics,
        rank: parseLeadingZeroNumberish(row.statbotics.rank, Number(row.statbotics.rank || 0))
      }
    : null
});

const normalizePitRow = (row) => ({
  ...row,
  teamNumber: parseLeadingZeroNumberish(row?.teamNumber, 0)
});

const normalizeMissingScoutingRow = (row) => ({
  ...row,
  matchNumber: parseLeadingZeroNumberish(row?.matchNumber, 0),
  setNumber: parseLeadingZeroNumberish(row?.setNumber, 1),
  redTeams: Array.isArray(row?.redTeams)
    ? row.redTeams.map((team) => parseLeadingZeroNumberish(team, 0)).filter((team) => team > 0)
    : [],
  blueTeams: Array.isArray(row?.blueTeams)
    ? row.blueTeams.map((team) => parseLeadingZeroNumberish(team, 0)).filter((team) => team > 0)
    : [],
  missingTeams: Array.isArray(row?.missingTeams)
    ? row.missingTeams.map((team) => parseLeadingZeroNumberish(team, 0)).filter((team) => team > 0)
    : []
});

export default function App() {
  const [mode, setMode] = useState(MODE_MATCH);
  const [eventKey, setEventKey] = useState(DEFAULT_EVENT_KEY);
  const [matchKey, setMatchKey] = useState('qm24');
  const [rows, setRows] = useState([]);
  const [message, setMessage] = useState('');
  const [pasteText, setPasteText] = useState('');
  const [predictionMessage, setPredictionMessage] = useState('');
  const [teamSearch, setTeamSearch] = useState('');
  const [sortConfig, setSortConfig] = useState({ key: null, direction: 'asc' });
  const [loading, setLoading] = useState(false);
  const [loadingLabel, setLoadingLabel] = useState('Loading data...');
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [editingTeams, setEditingTeams] = useState({});
  const [manualEdits, setManualEdits] = useState({});
  const [savingTeams, setSavingTeams] = useState({});
  const [missingModalOpen, setMissingModalOpen] = useState(false);
  const [missingLoading, setMissingLoading] = useState(false);
  const [missingData, setMissingData] = useState({ rows: [], missingMatchCount: 0, missingTeamCount: 0, matchCount: 0 });
  const sharedSelectionSnapshotRef = useRef('');
  const consecutiveSyncFailuresRef = useRef(0);
  const lastSyncFailureMessageRef = useRef('');

  const filteredRows = useMemo(() => {
    const query = String(teamSearch || '').trim();
    if (!query) return rows;

    const tokens = query
      .split(/[\s,]+/)
      .map((part) => part.trim())
      .filter(Boolean);

    if (!tokens.length) return rows;

    if (tokens.length === 1) {
      return rows.filter((row) => String(row.teamNumber || '').includes(tokens[0]));
    }

    const exactTeams = new Set(tokens.map((value) => String(Number.parseInt(value, 10))).filter((value) => value !== 'NaN'));
    if (!exactTeams.size) return [];

    return rows.filter((row) => exactTeams.has(String(row.teamNumber || '')));
  }, [rows, teamSearch]);

  const sortedRows = useMemo(() => {
    if (!sortConfig.key) return filteredRows;

    const movementOrder = { none: 0, trench: 1, bump: 2, both: 3 };

    const getMatchValue = (row, key) => {
      switch (key) {
        case 'teamNumber': return Number(row.teamNumber || 0);
        case 'matchesScouted': return Number(row.matchesScouted || 0);
        case 'epa': return Number(row.statbotics?.epa || 0);
        case 'autoEPA': return Number(row.statbotics?.autoEPA || 0);
        case 'teleopEPA': return Number(row.statbotics?.teleopEPA || 0);
        case 'endgameEPA': return Number(row.statbotics?.endgameEPA || 0);
        case 'spiderAuto': return Number(row.spiderAuto || 0);
        case 'spiderTeleop': return Number(row.spiderTeleop || 0);
        case 'spiderDefense': return Number(row.spiderDefense || 0);
        case 'spiderCycleSpeed': return Number(row.spiderCycleSpeed || 0);
        case 'spiderEndgame': return Number(row.spiderEndgame || 0);
        case 'movementProfile': return movementOrder[String(row.movementProfile || 'none')] ?? 0;
        case 'autoDid': return row.autoDid ? 1 : 0;
        case 'autoDescription': return String(row.autoDescription || '');
        case 'spiderReliability': return Number(row.spiderReliability || 0);
        case 'disableRate': return Number(row.disableRate || 0);
        case 'foulRate': return Number(row.foulRate || 0);
        case 'climbSuccessRate': return Number(row.climbSuccessRate || 0);
        case 'notes': return String(row.notes || '');
        default: return 0;
      }
    };

    const getPitValue = (row, key) => {
      switch (key) {
        case 'teamNumber': return Number(row.teamNumber || 0);
        case 'hopperCapacity': return Number(row.hopperCapacity || 0);
        case 'drivetrainType': return String(row.drivetrainType || 'unknown');
        case 'swerveModuleType': return String(row.swerveModuleType || '');
        case 'swerveGearing': return String(row.swerveGearing || '');
        case 'shooterType': return String(row.shooterType || 'unknown');
        case 'canUseTrench': return row.canUseTrench ? 1 : 0;
        case 'canCrossBump': return row.canCrossBump ? 1 : 0;
        case 'trenchBumpCap': return (row.canUseTrench ? 1 : 0) + (row.canCrossBump ? 2 : 0);
        case 'cycleBallsPerSec': return Number(row.cycleBallsPerSec || 0);
        case 'outpostCapability': return row.outpostCapability ? 1 : 0;
        case 'depotCapability': return row.depotCapability ? 1 : 0;
        case 'hasGroundIntake': return row.hasGroundIntake ? 1 : 0;
        case 'visionType': return String(row.visionType || 'unknown');
        case 'autoPaths': return String(row.autoPaths || '');
        case 'cycleSpeed': return String(row.cycleSpeed || 'unknown');
        case 'climbCapability': return String(row.climbCapability || 'unknown');
        case 'softwareFeatures': return String(row.softwareFeatures || '');
        case 'mechanicalFeatures': return String(row.mechanicalFeatures || '');
        case 'aiConfidenceScore': return Number(row.aiConfidenceScore || 0);
        case 'updatedAt': return new Date(row.updatedAt || row.createdAt || 0).valueOf();
        default: return 0;
      }
    };

    const directionMultiplier = sortConfig.direction === 'asc' ? 1 : -1;
    return [...filteredRows].sort((a, b) => {
      const aValue = mode === MODE_MATCH ? getMatchValue(a, sortConfig.key) : getPitValue(a, sortConfig.key);
      const bValue = mode === MODE_MATCH ? getMatchValue(b, sortConfig.key) : getPitValue(b, sortConfig.key);

      if (typeof aValue === 'string' || typeof bValue === 'string') {
        const compare = String(aValue).localeCompare(String(bValue));
        if (compare === 0) return Number(a.teamNumber || 0) - Number(b.teamNumber || 0);
        return compare * directionMultiplier;
      }

      if (aValue === bValue) return Number(a.teamNumber || 0) - Number(b.teamNumber || 0);
      return (aValue - bValue) * directionMultiplier;
    });
  }, [filteredRows, sortConfig, mode]);

  const onSort = (key) => {
    setSortConfig((current) => {
      if (current.key === key) {
        return {
          key,
          direction: current.direction === 'asc' ? 'desc' : 'asc'
        };
      }

      return { key, direction: 'asc' };
    });
  };

  const sortArrow = (key) => {
    if (sortConfig.key !== key) return '';
    return sortConfig.direction === 'asc' ? '↑' : '↓';
  };

  const startLoading = (label = 'Loading data...') => {
    setLoading(true);
    setLoadingLabel(label);
    setLoadingProgress(0);
  };

  const stopLoading = () => {
    setLoadingProgress(100);
    setLoading(false);
    setLoadingProgress(0);
  };

  const setStageProgress = (base, span, fraction) => {
    const safeBase = Number(base || 0);
    const safeSpan = Number(span || 0);
    const safeFraction = Math.max(0, Math.min(1, Number(fraction || 0)));
    setLoadingProgress(Math.max(0, Math.min(100, safeBase + safeSpan * safeFraction)));
  };

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const buildSelectionSnapshot = (data) => JSON.stringify({
    eventKey: String(data?.eventKey || ''),
    matchKey: String(data?.matchKey || ''),
    scheduleText: String(data?.scheduleText || ''),
    teamsText: String(data?.teamsText || '')
  });

  const syncSelectedEvent = async ({ forceReload = false } = {}) => {
    try {
      const response = await fetch(`${API_BASE}/api/strategy/selected-event`);
      const data = await response.json();

      if (!response.ok || !data?.eventKey) throw new Error(data?.error || 'Failed loading selected competition');

      consecutiveSyncFailuresRef.current = 0;
      lastSyncFailureMessageRef.current = '';

      const nextSnapshot = buildSelectionSnapshot(data);
      const selectionChanged = sharedSelectionSnapshotRef.current !== nextSnapshot;
      if (!selectionChanged && !forceReload) return;

      sharedSelectionSnapshotRef.current = nextSnapshot;

      const currentSuffixRaw = String(matchKey || '').includes('_')
        ? String(matchKey).split('_').slice(1).join('_')
        : String(matchKey || '');
      const nextSuffix = normalizeMatchSuffix(currentSuffixRaw, 'qm24');

      setEventKey(data.eventKey);
      if (mode === MODE_MATCH) setMatchKey(String(data.matchKey || `${data.eventKey}_${nextSuffix}`));

      await load({ silent: true }, data.eventKey, mode);
    } catch (error) {
      consecutiveSyncFailuresRef.current += 1;
      if (consecutiveSyncFailuresRef.current >= 2 && lastSyncFailureMessageRef.current !== mode) {
        setMessage(`E_SELECTED_EVENT_UNAVAILABLE: ${error.message || 'backend API is offline'}`);
        lastSyncFailureMessageRef.current = mode;
      }
    }
  };

  const fetchJsonWithProgress = async (url, options = {}, progress = {}) => {
    const {
      base = 0,
      span = 100,
      label,
      trackProgress = false
    } = progress;

    if (label) setLoadingLabel(label);
    if (trackProgress) setStageProgress(base, span, 0);

    const response = await fetch(url, options);
    const data = await response.json();
    setStageProgress(base, span, 1);
    return { response, data };
  };

  const formatImportResultMessage = (data, sourceLabel = 'Import') => {
    if (data.imported !== undefined) {
      const headErrors = Array.isArray(data.errors)
        ? data.errors.slice(0, 3).map((entry) => `row ${entry.row}: ${entry.error}`).join(' | ')
        : '';
      const errorPart = data.errors?.length
        ? ` (${data.errors.length} row errors${headErrors ? `; ${headErrors}` : ''})`
        : '';
      const isPitImport = data.type === 'offline_pit_batch' || data.type === 'pit_scouting_csv';
      const hydrationPart = data.statboticsHydration
        ? `; Statbotics seeded ${data.statboticsHydration.rowsCreated || 0} new rows and refreshed ${data.statboticsHydration.rowsUpdated || 0}`
        : '';
      return `${sourceLabel}: Imported ${data.imported} ${isPitImport ? 'pit reports' : 'scouting rows'}${errorPart}${hydrationPart}`;
    }
    if (data.importedMatches !== undefined) {
      const hydrationPart = data.statboticsHydration
        ? `; Statbotics seeded ${data.statboticsHydration.rowsCreated || 0} new rows and refreshed ${data.statboticsHydration.rowsUpdated || 0}`
        : '';
      return `${sourceLabel}: Imported ${data.importedMatches} matches from ${data.type}${hydrationPart}`;
    }
    if (data.importedTeams !== undefined) {
      return `${sourceLabel}: Imported ${data.importedTeams} team OPR rows`;
    }
    return `${sourceLabel}: Import completed`;
  };

  const load = async ({ silent = false, progressBase = 0, progressSpan = 100 } = {}, targetEventKey = eventKey, targetMode = mode) => {
    if (!silent) startLoading(targetMode === MODE_MATCH ? 'Loading match stats...' : 'Loading pit reports...');
    try {
      const endpoint = targetMode === MODE_MATCH
        ? `${API_BASE}/api/strategy/stats/${targetEventKey}`
        : `${API_BASE}/api/strategy/pit/${targetEventKey}`;

      const { response, data } = await fetchJsonWithProgress(
        endpoint,
        {},
        {
          base: progressBase,
          span: progressSpan,
          label: targetMode === MODE_MATCH ? 'Loading match stats...' : 'Loading pit reports...',
          trackProgress: true
        }
      );
      if (!response.ok) {
        setMessage(data.errorCode ? `${data.errorCode}: ${data.error || 'Failed loading data'}` : (data.error || 'Failed loading data'));
        return;
      }

      const pitRows = Array.isArray(data)
        ? data
        : Array.isArray(data?.rows)
          ? data.rows
          : [];
      const normalizedRows = targetMode === MODE_MATCH
        ? pitRows.map((row) => normalizeMatchRow(row))
        : pitRows.map((row) => normalizePitRow(row));

      setRows(normalizedRows);
      if (mode === MODE_PIT && !silent && data && !Array.isArray(data)) {
        setMessage(`TBA roster filtered (${data.teamCount || 0} teams): loaded ${data.pitReportCount ?? pitRows.length} reports`);
      }
    } catch {
      setMessage('E_SERVER_UNREACHABLE: backend request failed');
    } finally {
      if (!silent) stopLoading();
    }
  };

  const createTeamEditDraft = (row) => ({
    matchesScouted: String(Number(row.matchesScouted || 0)),
    avgAutoTotalPoints: String(Number(row.avgAutoTotalPoints || 0).toFixed(2)),
    avgTeleopTotalPoints: String(Number(row.avgTeleopTotalPoints || 0).toFixed(2)),
    avgEndgamePoints: String(Number(row.avgEndgamePoints || 0).toFixed(2)),
    spiderAuto: String(Number(row.spiderAuto || 0).toFixed(1)),
    spiderTeleop: String(Number(row.spiderTeleop || 0).toFixed(1)),
    spiderDefense: String(Number(row.spiderDefense || 0).toFixed(1)),
    spiderCycleSpeed: String(Number(row.spiderCycleSpeed || 0).toFixed(1)),
    spiderEndgame: String(Number(row.spiderEndgame || 0).toFixed(1)),
    spiderReliability: String(Number(row.spiderReliability || 0).toFixed(1)),
    disableRatePct: String((Number(row.disableRate || 0) * 100).toFixed(1)),
    foulRate: String(Number(row.foulRate || 0).toFixed(2)),
    climbSuccessRatePct: String((Number(row.climbSuccessRate || 0) * 100).toFixed(1)),
    autoDid: row.autoDid ? 'yes' : 'no',
    autoDescription: String(row.autoDescription || ''),
    movementProfile: String(row.movementProfile || 'none'),
    notes: String(row.notes || '')
  });

  const startEditingTeam = (row) => {
    const teamNumber = Number(row.teamNumber || 0);
    if (!teamNumber) return;

    setManualEdits((prev) => ({
      ...prev,
      [teamNumber]: prev[teamNumber] || createTeamEditDraft(row)
    }));
    setEditingTeams((prev) => ({ ...prev, [teamNumber]: true }));
  };

  const cancelEditingTeam = (teamNumber) => {
    setEditingTeams((prev) => {
      const next = { ...prev };
      delete next[teamNumber];
      return next;
    });
    setManualEdits((prev) => {
      const next = { ...prev };
      delete next[teamNumber];
      return next;
    });
  };

  const updateTeamEditField = (teamNumber, field, value) => {
    setManualEdits((prev) => ({
      ...prev,
      [teamNumber]: {
        ...(prev[teamNumber] || {}),
        [field]: value
      }
    }));
  };

  const saveTeamManualStats = async (row) => {
    const teamNumber = Number(row.teamNumber || 0);
    if (!teamNumber) return;

    const draft = manualEdits[teamNumber];
    if (!draft) return;

    const parse = (value, fallback = 0) => {
      const numeric = Number.parseFloat(String(value ?? '').trim());
      return Number.isFinite(numeric) ? numeric : fallback;
    };

    const payload = {
      matchesScouted: Math.max(0, Math.round(parse(draft.matchesScouted, Number(row.matchesScouted || 0)))),
      avgAutoTotalPoints: Math.max(0, parse(draft.avgAutoTotalPoints, Number(row.avgAutoTotalPoints || 0))),
      avgTeleopTotalPoints: Math.max(0, parse(draft.avgTeleopTotalPoints, Number(row.avgTeleopTotalPoints || 0))),
      avgEndgamePoints: Math.max(0, parse(draft.avgEndgamePoints, Number(row.avgEndgamePoints || 0))),
      spiderAuto: Math.max(0, parse(draft.spiderAuto, Number(row.spiderAuto || 0))),
      spiderTeleop: Math.max(0, parse(draft.spiderTeleop, Number(row.spiderTeleop || 0))),
      spiderDefense: Math.max(0, Math.min(100, parse(draft.spiderDefense, Number(row.spiderDefense || 0)))),
      spiderCycleSpeed: Math.max(0, Math.min(100, parse(draft.spiderCycleSpeed, Number(row.spiderCycleSpeed || 0)))),
      spiderEndgame: Math.max(0, parse(draft.spiderEndgame, Number(row.spiderEndgame || 0))),
      spiderReliability: Math.max(0, Math.min(100, parse(draft.spiderReliability, Number(row.spiderReliability || 0)))),
      disableRate: Math.max(0, Math.min(1, parse(draft.disableRatePct, Number(row.disableRate || 0) * 100) / 100)),
      foulRate: Math.max(0, parse(draft.foulRate, Number(row.foulRate || 0))),
      climbSuccessRate: Math.max(0, Math.min(1, parse(draft.climbSuccessRatePct, Number(row.climbSuccessRate || 0) * 100) / 100)),
      autoDid: String(draft.autoDid || (row.autoDid ? 'yes' : 'no')).toLowerCase() === 'yes',
      autoDescription: String(draft.autoDescription || '').trim(),
      movementProfile: String(draft.movementProfile || row.movementProfile || 'none').toLowerCase(),
      notes: String(draft.notes || '').trim()
    };

    setSavingTeams((prev) => ({ ...prev, [teamNumber]: true }));
    try {
      const response = await fetch(`${API_BASE}/api/strategy/stats/${encodeURIComponent(row.eventKey || eventKey)}/${teamNumber}/manual`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await response.json();
      if (!response.ok) {
        setMessage(data.error || 'Failed saving manual stats');
        return;
      }

      setRows((prev) => prev.map((entry) => (
        Number(entry.teamNumber) === teamNumber
          ? {
              ...entry,
              ...payload,
              eventKey: row.eventKey || eventKey,
              autoDid: typeof data?.autoDid === 'boolean' ? data.autoDid : payload.autoDid,
              autoDescription: String(data?.autoDescription ?? payload.autoDescription ?? entry.autoDescription ?? ''),
              trenchUsed: payload.movementProfile === 'trench' || payload.movementProfile === 'both',
              bumpUsed: payload.movementProfile === 'bump' || payload.movementProfile === 'both',
              lastComputed: data?.stat?.lastComputed || entry.lastComputed
            }
          : entry
      )));
      setMessage(`Saved manual stats for Team ${teamNumber}.`);
      cancelEditingTeam(teamNumber);
    } catch {
      setMessage('E_SERVER_UNREACHABLE: failed saving manual stats');
    } finally {
      setSavingTeams((prev) => {
        const next = { ...prev };
        delete next[teamNumber];
        return next;
      });
    }
  };

  const runScrapeJob = async ({ startUrl, loadingText, initialMessage, completedMessage }) => {
    startLoading(loadingText);
    try {
      setMessage(initialMessage);

      const startResponse = await fetch(startUrl, { method: 'POST' });
      const started = await startResponse.json();
      if (!startResponse.ok || !started?.jobId) {
        setMessage(started.error || 'Failed to start refetch job');
        return;
      }

      let job = null;
      while (true) {
        const progressResponse = await fetch(`${API_BASE}/api/sync/scrape/job/${started.jobId}`);
        const progressData = await progressResponse.json();

        if (!progressResponse.ok) {
          setMessage(progressData.error || 'Failed to fetch refetch progress');
          return;
        }

        job = progressData;
        const totalRows = Number(job.totalRows || 0);
        const processedRows = Number(job.processedRows || 0);
        const scrapeProgress = totalRows > 0
          ? Math.max(0, Math.min(100, (processedRows / totalRows) * 100))
          : 0;

        setLoadingLabel(job.message || loadingText);
        setLoadingProgress(scrapeProgress);
        setMessage(`Scraping progress: ${processedRows}/${totalRows || '?'} rows`);

        if (job.status === 'completed') break;
        if (job.status === 'failed') {
          setMessage(job.error || 'Refetch job failed');
          return;
        }

        await sleep(350);
      }

      setLoadingLabel(mode === MODE_MATCH ? 'Refreshing match stats...' : 'Refreshing pit reports...');
      setLoadingProgress(100);
      await load({ silent: true, progressBase: 0, progressSpan: 100 });
      setMessage(completedMessage(job));
    } catch {
      setMessage('E_SERVER_UNREACHABLE: backend request failed');
    } finally {
      stopLoading();
    }
  };

  const scrape = async () => {
    if (mode !== MODE_MATCH) {
      setMessage('Refetch/scrape is only available in Match mode.');
      return;
    }

    await runScrapeJob({
      startUrl: `${API_BASE}/api/sync/scrape/${eventKey}/job`,
      loadingText: 'Refetching and syncing data...',
      initialMessage: 'Starting refetch for this event...',
      completedMessage: (job) => `Imported ${job.importedRows || 0} rows (${job.processedRows || 0}/${job.totalRows || 0})`
    });
  };

  const scrapeAll = async () => {
    if (mode !== MODE_MATCH) {
      setMessage('Refetch all is only available in Match mode.');
      return;
    }

    await runScrapeJob({
      startUrl: `${API_BASE}/api/sync/scrape-all/job`,
      loadingText: 'Refetching all events...',
      initialMessage: 'Starting global refetch job...',
      completedMessage: (job) => `Global refetch imported ${job.importedRows || 0} rows`
    });
  };

  const importPaste = async () => {
    startLoading('Importing pasted data...');
    try {
      setMessage('Importing pasted data...');
      const { response, data } = await fetchJsonWithProgress(
        `${API_BASE}/api/import/paste`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ eventKey, text: pasteText, type: 'auto' })
        },
        {
          base: 0,
          span: 70,
          label: 'Importing pasted data...',
          trackProgress: true
        }
      );
      if (!response.ok) {
        setMessage(data.error || 'Paste import failed');
        return;
      }

      if (data.eventKey && data.eventKey !== eventKey) {
        setEventKey(data.eventKey);
      }

      setMessage(formatImportResultMessage(data, 'Paste'));

      await load({ silent: true, progressBase: 70, progressSpan: 30 });
    } catch {
      setMessage('E_SERVER_UNREACHABLE: backend request failed');
    } finally {
      stopLoading();
    }
  };

  const importCsvFile = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    startLoading(`Importing ${file.name}...`);
    try {
      const text = await file.text();
      setPasteText(text);
      setStageProgress(0, 25, 1);

      setMessage(`Importing CSV file: ${file.name}...`);
      const { response, data } = await fetchJsonWithProgress(
        `${API_BASE}/api/import/paste`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ eventKey, text, type: 'auto' })
        },
        {
          base: 25,
          span: 50,
          label: `Importing ${file.name}...`,
          trackProgress: true
        }
      );
      if (!response.ok) {
        setMessage(data.error || 'CSV file import failed');
        return;
      }

      if (data.eventKey && data.eventKey !== eventKey) {
        setEventKey(data.eventKey);
      }

      setMessage(formatImportResultMessage(data, `CSV ${file.name}`));
      await load({ silent: true, progressBase: 75, progressSpan: 25 });
    } catch {
      setMessage('Could not read CSV file.');
    } finally {
      event.target.value = '';
      stopLoading();
    }
  };

  const importScheduleAndPredict = async () => {
    if (mode !== MODE_MATCH) {
      setPredictionMessage('Prediction is only available in Match mode.');
      return;
    }

    startLoading('Importing schedule and generating prediction...');
    try {
      setPredictionMessage('Importing schedule and predicting...');
      const { response, data: imported } = await fetchJsonWithProgress(
        `${API_BASE}/api/import/paste`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ eventKey, text: pasteText, type: 'auto' })
        },
        {
          base: 0,
          span: 45,
          label: 'Importing schedule...',
          trackProgress: true
        }
      );
      if (!response.ok) {
        setPredictionMessage(imported.error || 'Import failed before prediction');
        return;
      }

      if (imported.eventKey && imported.eventKey !== eventKey) {
        setEventKey(imported.eventKey);
      }

      const { response: predictResponse, data: prediction } = await fetchJsonWithProgress(
        `${API_BASE}/api/strategy/predict/${eventKey}/${matchKey}`,
        {},
        {
          base: 45,
          span: 35,
          label: 'Generating prediction...',
          trackProgress: true
        }
      );
      if (!predictResponse.ok) {
        setPredictionMessage(prediction.error || 'Prediction failed after import');
        return;
      }

      setPredictionMessage(
        `Pred ${prediction.matchKey}: Red ${prediction.redPredicted} | Blue ${prediction.bluePredicted} (${prediction.confidence})`
      );
      await load({ silent: true, progressBase: 80, progressSpan: 20 });
    } catch {
      setPredictionMessage('E_SERVER_UNREACHABLE: backend request failed');
    } finally {
      stopLoading();
    }
  };

  const importOfflineBatch = async () => {
    startLoading('Importing offline tablet batch...');
    try {
      const parsed = JSON.parse(pasteText);
      setStageProgress(0, 20, 1);

      if (!parsed || !Array.isArray(parsed.reports)) {
        setMessage('Offline JSON must include a reports array.');
        return;
      }

      const { response, data } = await fetchJsonWithProgress(
        `${API_BASE}/api/import/offline-batch`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(parsed)
        },
        {
          base: 20,
          span: 55,
          label: 'Importing offline tablet batch...',
          trackProgress: true
        }
      );
      if (!response.ok) {
        setMessage(data.error || 'Offline batch import failed');
        return;
      }

      if (data.eventKey && data.eventKey !== eventKey) {
        setEventKey(data.eventKey);
      }

      setMessage(`Imported ${data.imported} ${data.type === 'offline_pit_batch' ? 'offline pit reports' : 'offline tablet reports'}`);
      await load({ silent: true, progressBase: 75, progressSpan: 25 });
    } catch {
      setMessage('Invalid offline JSON payload');
    } finally {
      stopLoading();
    }
  };

  const importOfflineFile = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    startLoading(`Importing ${file.name}...`);
    try {
      const text = await file.text();
      setPasteText(text);
      setStageProgress(0, 20, 1);
      const parsed = JSON.parse(text);

      if (!parsed || !Array.isArray(parsed.reports)) {
        setMessage('Selected file is not a valid offline batch JSON (missing reports).');
        return;
      }

      const { response, data } = await fetchJsonWithProgress(
        `${API_BASE}/api/import/offline-batch`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(parsed)
        },
        {
          base: 20,
          span: 55,
          label: `Importing ${file.name}...`,
          trackProgress: true
        }
      );
      if (!response.ok) {
        setMessage(data.error || 'Offline batch import failed');
        return;
      }

      if (data.eventKey && data.eventKey !== eventKey) {
        setEventKey(data.eventKey);
      }

      setMessage(`Imported ${data.imported} ${data.type === 'offline_pit_batch' ? 'pit reports' : 'offline tablet reports'} from ${file.name}`);
      await load({ silent: true, progressBase: 75, progressSpan: 25 });
    } catch {
      setMessage('Could not read JSON file.');
    } finally {
      event.target.value = '';
      stopLoading();
    }
  };

  const openMissingScoutingModal = async () => {
    setMissingModalOpen(true);
    setMissingLoading(true);
    try {
      const response = await fetch(`${API_BASE}/api/strategy/missing-scouting/${encodeURIComponent(eventKey)}`);
      const data = await response.json();
      if (!response.ok) {
        setMessage(data.error || 'Failed loading missing scouting list');
        setMissingData({ rows: [], missingMatchCount: 0, missingTeamCount: 0, matchCount: 0 });
        return;
      }

      const rows = Array.isArray(data.rows) ? data.rows.map((row) => normalizeMissingScoutingRow(row)) : [];
      setMissingData({
        rows,
        missingMatchCount: Number(data.missingMatchCount || rows.length),
        missingTeamCount: Number(data.missingTeamCount || 0),
        matchCount: Number(data.matchCount || 0)
      });
    } catch {
      setMessage('E_SERVER_UNREACHABLE: failed loading missing scouting list');
      setMissingData({ rows: [], missingMatchCount: 0, missingTeamCount: 0, matchCount: 0 });
    } finally {
      setMissingLoading(false);
    }
  };

  useEffect(() => {
    syncSelectedEvent({ forceReload: true });
  }, [mode]);

  useEffect(() => {
    const intervalId = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      void syncSelectedEvent();
    }, 10000);

    return () => clearInterval(intervalId);
  }, [mode]);

  return (
    <main className="mx-auto min-h-screen max-w-7xl space-y-8 p-6">
      <div className="mb-4 flex justify-end" />
      <Card>
        <CardHeader>
          <div className="mb-2 flex items-center gap-2">
            <Database className="h-5 w-5 text-foreground" />
            <Badge>Aggregator</Badge>
            <Badge className="border border-input bg-background text-foreground">
              {mode === MODE_MATCH ? 'Match Mode' : 'Pit Mode'}
            </Badge>
          </div>
          <CardTitle>Event Aggregation Console</CardTitle>
          <CardDescription>
            {mode === MODE_MATCH
              ? 'Match mode for schedule, scouting, and strategy stats.'
              : 'Pit mode for robot-specific mechanisms, drivetrain, and motor package scouting.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex flex-wrap gap-2">
            <Button variant={mode === MODE_MATCH ? 'default' : 'outline'} onClick={() => setMode(MODE_MATCH)}>
              Match Mode
            </Button>
            <Button variant={mode === MODE_PIT ? 'default' : 'outline'} onClick={() => setMode(MODE_PIT)}>
              Pit Mode
            </Button>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row">
            <Input value={eventKey} onChange={(e) => setEventKey(e.target.value)} placeholder="event key (e.g. 2026casnd)" />
            {mode === MODE_MATCH ? (
              <Input value={matchKey} onChange={(e) => setMatchKey(e.target.value)} placeholder="match (e.g. qm24 or 24)" />
            ) : null}
            <Button onClick={() => load()}>Load {mode === MODE_MATCH ? 'Stats' : 'Pit Reports'}</Button>
            {mode === MODE_MATCH ? (
              <>
                <Button variant="secondary" onClick={scrape}>Refetch</Button>
                <Button variant="outline" onClick={scrapeAll}>Refetch All</Button>
                <Button variant="outline" onClick={openMissingScoutingModal}>Missing Scouts</Button>
              </>
            ) : (
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-input px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground">
                <FileUp className="h-4 w-4" />
                Import Pit CSV File
                <input type="file" accept=".csv,text/csv" className="hidden" onChange={importCsvFile} />
              </label>
            )}
          </div>

          <Input
            value={teamSearch}
            onChange={(e) => setTeamSearch(e.target.value)}
            placeholder="Search team(s): 3749 or 3749, 254, 1678"
          />

          <div className="space-y-2">
            <label className="text-sm text-muted-foreground">
              {mode === MODE_MATCH
                ? 'Paste schedule, flat schedule, component OPRs, scouting CSV, or offline tablet JSON'
                : 'Paste pit offline JSON payloads (with mode: pit)'}
            </label>
            <textarea
              className="min-h-36 w-full rounded-md border border-input bg-background p-3 text-sm"
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              placeholder={mode === MODE_MATCH ? 'Paste CSV or offline JSON payload here' : 'Paste offline pit JSON payload here'}
            />
            <div className="flex flex-wrap gap-2">
              <Button className="gap-2" onClick={importPaste}><Upload className="h-4 w-4" />AI Import Paste</Button>
              {mode === MODE_MATCH ? (
                <>
                  <Button variant="secondary" onClick={importScheduleAndPredict}>Import Schedule + Predict Match</Button>
                  <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-input px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground">
                    <FileUp className="h-4 w-4" />
                    Import CSV File
                    <input type="file" accept=".csv,text/csv" className="hidden" onChange={importCsvFile} />
                  </label>
                </>
              ) : (
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-input px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground">
                  <FileUp className="h-4 w-4" />
                  Import Pit CSV File
                  <input type="file" accept=".csv,text/csv" className="hidden" onChange={importCsvFile} />
                </label>
              )}
              <Button variant="outline" onClick={importOfflineBatch}>Import Offline Tablet Batch</Button>
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-input px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground">
                <FileUp className="h-4 w-4" />
                Import Offline JSON File
                <input type="file" accept="application/json,.json" className="hidden" onChange={importOfflineFile} />
              </label>
            </div>
          </div>

          {predictionMessage ? <p className="text-sm text-muted-foreground">{predictionMessage}</p> : null}

          {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}

          {loading ? (
            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{loadingLabel}</span>
                <span>{Math.round(loadingProgress)}%</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full bg-primary transition-all duration-200"
                  style={{ width: `${loadingProgress}%` }}
                />
              </div>
            </div>
          ) : null}

          {missingModalOpen ? (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
              <div className="max-h-[85vh] w-full max-w-5xl overflow-hidden rounded-lg border border-input bg-background shadow-lg">
                <div className="flex items-center justify-between border-b border-input p-4">
                  <div>
                    <h3 className="text-base font-semibold">Missing Scouting Records</h3>
                    <p className="text-xs text-muted-foreground">
                      Event {eventKey} | Missing matches: {missingData.missingMatchCount} | Missing team records: {missingData.missingTeamCount} | Scheduled matches: {missingData.matchCount}
                    </p>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => setMissingModalOpen(false)}>Close</Button>
                </div>
                <div className="max-h-[70vh] overflow-auto p-4">
                  {missingLoading ? (
                    <p className="text-sm text-muted-foreground">Loading missing scouting records...</p>
                  ) : !missingData.rows.length ? (
                    <p className="text-sm text-muted-foreground">No missing scouting records found.</p>
                  ) : (
                    <div className="space-y-2">
                      {missingData.rows.map((row) => (
                        <div key={String(row.matchKey || `${row.compLevel}-${row.matchNumber}`)} className="rounded border border-input p-3">
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                            <span className="font-semibold">{row.matchKey || `${row.compLevel}${row.matchNumber}`}</span>
                            <span className="text-muted-foreground">{row.scheduledDate || 'Date N/A'} {row.scheduledTime || 'Time N/A'}</span>
                            <span className="text-muted-foreground">Missing: {Array.isArray(row.missingTeams) ? row.missingTeams.join(', ') : '—'}</span>
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            Red: {Array.isArray(row.redTeams) ? row.redTeams.join(', ') : '—'} | Blue: {Array.isArray(row.blueTeams) ? row.blueTeams.join(', ') : '—'}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : null}

          {mode === MODE_MATCH ? (
            <Table className="w-full table-fixed text-xs">
              <TableHeader className="[&_th]:p-1 [&_th]:align-top [&_th]:whitespace-normal [&_th]:break-words [&_button]:w-full [&_button]:justify-start [&_button]:whitespace-normal [&_button]:text-[11px]">
                <TableRow>
                  <TableHead><button type="button" className="inline-flex items-center gap-1" onClick={() => onSort('teamNumber')}>Team <span>{sortArrow('teamNumber')}</span></button></TableHead>
                  <TableHead><button type="button" className="inline-flex items-center gap-1" onClick={() => onSort('matchesScouted')}>Matches <span>{sortArrow('matchesScouted')}</span></button></TableHead>
                  <TableHead><button type="button" className="inline-flex items-center gap-1" onClick={() => onSort('epa')}>EPA <span>{sortArrow('epa')}</span></button></TableHead>
                  <TableHead><button type="button" className="inline-flex items-center gap-1" onClick={() => onSort('autoEPA')}>Auto EPA <span>{sortArrow('autoEPA')}</span></button></TableHead>
                  <TableHead><button type="button" className="inline-flex items-center gap-1" onClick={() => onSort('teleopEPA')}>Tele EPA <span>{sortArrow('teleopEPA')}</span></button></TableHead>
                  <TableHead><button type="button" className="inline-flex items-center gap-1" onClick={() => onSort('endgameEPA')}>Endgame EPA <span>{sortArrow('endgameEPA')}</span></button></TableHead>
                  <TableHead><button type="button" className="inline-flex items-center gap-1" onClick={() => onSort('autoDid')}>Auto <span>{sortArrow('autoDid')}</span></button></TableHead>
                  <TableHead><button type="button" className="inline-flex items-center gap-1" onClick={() => onSort('autoDescription')}>Auto Desc <span>{sortArrow('autoDescription')}</span></button></TableHead>
                  <TableHead><button type="button" className="inline-flex items-center gap-1" onClick={() => onSort('spiderAuto')}>Auto <span>{sortArrow('spiderAuto')}</span></button></TableHead>
                  <TableHead><button type="button" className="inline-flex items-center gap-1" onClick={() => onSort('spiderTeleop')}>Teleop <span>{sortArrow('spiderTeleop')}</span></button></TableHead>
                  <TableHead>Avg Auto Pts</TableHead>
                  <TableHead>Avg Tele Pts</TableHead>
                  <TableHead>Avg End Pts</TableHead>
                  <TableHead><button type="button" className="inline-flex items-center gap-1" onClick={() => onSort('spiderDefense')}>Defense <span>{sortArrow('spiderDefense')}</span></button></TableHead>
                  <TableHead><button type="button" className="inline-flex items-center gap-1" onClick={() => onSort('spiderCycleSpeed')}>Cycle <span>{sortArrow('spiderCycleSpeed')}</span></button></TableHead>
                  <TableHead><button type="button" className="inline-flex items-center gap-1" onClick={() => onSort('spiderEndgame')}>Endgame <span>{sortArrow('spiderEndgame')}</span></button></TableHead>
                  <TableHead><button type="button" className="inline-flex items-center gap-1" onClick={() => onSort('movementProfile')}>Trench/Bump <span>{sortArrow('movementProfile')}</span></button></TableHead>
                  <TableHead><button type="button" className="inline-flex items-center gap-1" onClick={() => onSort('spiderReliability')}>Reliability <span>{sortArrow('spiderReliability')}</span></button></TableHead>
                  <TableHead><button type="button" className="inline-flex items-center gap-1" onClick={() => onSort('disableRate')}>Disable% <span>{sortArrow('disableRate')}</span></button></TableHead>
                  <TableHead><button type="button" className="inline-flex items-center gap-1" onClick={() => onSort('foulRate')}>Foul Rate <span>{sortArrow('foulRate')}</span></button></TableHead>
                  <TableHead><button type="button" className="inline-flex items-center gap-1" onClick={() => onSort('climbSuccessRate')}>Climb % <span>{sortArrow('climbSuccessRate')}</span></button></TableHead>
                  <TableHead><button type="button" className="inline-flex items-center gap-1" onClick={() => onSort('notes')}>Notes <span>{sortArrow('notes')}</span></button></TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody className="[&_td]:overflow-hidden [&_td]:p-1 [&_td]:align-top [&_td]:whitespace-normal [&_td]:break-words [&_td]:text-[11px]">
                {sortedRows.map((row) => {
                  const teamNumber = Number(row.teamNumber || 0);
                  const edit = manualEdits[teamNumber] || createTeamEditDraft(row);
                  const isEditing = Boolean(editingTeams[teamNumber]);
                  const isSaving = Boolean(savingTeams[teamNumber]);
                  const numericInputClass = 'h-7 w-full min-w-0 max-w-full box-border rounded border border-input bg-background px-1 text-[11px]';

                  return (
                    <TableRow key={`${row.eventKey}-${row.teamNumber}`}>
                      <TableCell>{row.teamNumber}</TableCell>
                      <TableCell>
                        {isEditing ? (
                          <input className={numericInputClass} value={edit.matchesScouted || ''} onChange={(e) => updateTeamEditField(teamNumber, 'matchesScouted', e.target.value)} />
                        ) : row.matchesScouted}
                      </TableCell>
                      <TableCell>{row.statbotics ? Number(row.statbotics.epa || 0).toFixed(2) : '—'}</TableCell>
                      <TableCell>{row.statbotics ? Number(row.statbotics.autoEPA || 0).toFixed(2) : '—'}</TableCell>
                      <TableCell>{row.statbotics ? Number(row.statbotics.teleopEPA || 0).toFixed(2) : '—'}</TableCell>
                      <TableCell>{row.statbotics ? Number(row.statbotics.endgameEPA || 0).toFixed(2) : '—'}</TableCell>
                      <TableCell>
                        {isEditing ? (
                          <select
                            className="h-7 w-full min-w-0 max-w-full box-border rounded border border-input bg-background px-1 text-[11px]"
                            value={String(edit.autoDid || 'no')}
                            onChange={(e) => updateTeamEditField(teamNumber, 'autoDid', e.target.value)}
                          >
                            <option value="yes">Yes</option>
                            <option value="no">No</option>
                          </select>
                        ) : row.autoDid ? 'Yes' : 'No'}
                      </TableCell>
                      <TableCell>
                        {isEditing ? (
                          <textarea
                            className="h-16 w-full min-w-0 max-w-full box-border resize-y rounded border border-input bg-background px-2 py-1 text-[11px]"
                            value={edit.autoDescription || ''}
                            onChange={(e) => updateTeamEditField(teamNumber, 'autoDescription', e.target.value)}
                            placeholder="Auto description..."
                          />
                        ) : row.autoDescription ? (
                          <details>
                            <summary className="cursor-pointer text-xs leading-none text-muted-foreground" aria-label="Toggle auto description">▸</summary>
                            <div className="mt-1 text-xs italic text-muted-foreground">{row.autoDescription}</div>
                          </details>
                        ) : '—'}
                      </TableCell>
                      <TableCell>
                        {isEditing ? (
                          <input className={numericInputClass} value={edit.spiderAuto || ''} onChange={(e) => updateTeamEditField(teamNumber, 'spiderAuto', e.target.value)} />
                        ) : Number(row.spiderAuto || 0).toFixed(1)}
                      </TableCell>
                      <TableCell>
                        {isEditing ? (
                          <input className={numericInputClass} value={edit.spiderTeleop || ''} onChange={(e) => updateTeamEditField(teamNumber, 'spiderTeleop', e.target.value)} />
                        ) : Number(row.spiderTeleop || 0).toFixed(1)}
                      </TableCell>
                      <TableCell>
                        {isEditing ? (
                          <input className={numericInputClass} value={edit.avgAutoTotalPoints || ''} onChange={(e) => updateTeamEditField(teamNumber, 'avgAutoTotalPoints', e.target.value)} />
                        ) : Number(row.avgAutoTotalPoints || 0).toFixed(2)}
                      </TableCell>
                      <TableCell>
                        {isEditing ? (
                          <input className={numericInputClass} value={edit.avgTeleopTotalPoints || ''} onChange={(e) => updateTeamEditField(teamNumber, 'avgTeleopTotalPoints', e.target.value)} />
                        ) : Number(row.avgTeleopTotalPoints || 0).toFixed(2)}
                      </TableCell>
                      <TableCell>
                        {isEditing ? (
                          <input className={numericInputClass} value={edit.avgEndgamePoints || ''} onChange={(e) => updateTeamEditField(teamNumber, 'avgEndgamePoints', e.target.value)} />
                        ) : Number(row.avgEndgamePoints || 0).toFixed(2)}
                      </TableCell>
                      <TableCell>
                        {isEditing ? (
                          <input className={numericInputClass} value={edit.spiderDefense || ''} onChange={(e) => updateTeamEditField(teamNumber, 'spiderDefense', e.target.value)} />
                        ) : Number(row.spiderDefense || 0).toFixed(1)}
                      </TableCell>
                      <TableCell>
                        {isEditing ? (
                          <input className={numericInputClass} value={edit.spiderCycleSpeed || ''} onChange={(e) => updateTeamEditField(teamNumber, 'spiderCycleSpeed', e.target.value)} />
                        ) : Number(row.spiderCycleSpeed || 0).toFixed(1)}
                      </TableCell>
                      <TableCell>
                        {isEditing ? (
                          <input className={numericInputClass} value={edit.spiderEndgame || ''} onChange={(e) => updateTeamEditField(teamNumber, 'spiderEndgame', e.target.value)} />
                        ) : Number(row.spiderEndgame || 0).toFixed(1)}
                      </TableCell>
                      <TableCell>
                        {isEditing ? (
                          <select
                            className="h-7 w-full min-w-0 max-w-full box-border rounded border border-input bg-background px-1 text-[11px]"
                            value={String(edit.movementProfile || 'none')}
                            onChange={(e) => updateTeamEditField(teamNumber, 'movementProfile', e.target.value)}
                          >
                            <option value="none">None</option>
                            <option value="trench">Trench</option>
                            <option value="bump">Bump</option>
                            <option value="both">Both</option>
                          </select>
                        ) : row.movementProfile === 'both'
                          ? 'Both'
                          : row.movementProfile === 'trench'
                            ? 'Trench'
                            : row.movementProfile === 'bump'
                              ? 'Bump'
                              : '—'}
                      </TableCell>
                      <TableCell>
                        {isEditing ? (
                          <input className={numericInputClass} value={edit.spiderReliability || ''} onChange={(e) => updateTeamEditField(teamNumber, 'spiderReliability', e.target.value)} />
                        ) : Number(row.spiderReliability || 0).toFixed(1)}
                      </TableCell>
                      <TableCell>
                        {isEditing ? (
                          <input className={numericInputClass} value={edit.disableRatePct || ''} onChange={(e) => updateTeamEditField(teamNumber, 'disableRatePct', e.target.value)} />
                        ) : (Number(row.disableRate || 0) * 100).toFixed(1)}
                      </TableCell>
                      <TableCell>
                        {isEditing ? (
                          <input className={numericInputClass} value={edit.foulRate || ''} onChange={(e) => updateTeamEditField(teamNumber, 'foulRate', e.target.value)} />
                        ) : Number(row.foulRate || 0).toFixed(2)}
                      </TableCell>
                      <TableCell>
                        {isEditing ? (
                          <input className={numericInputClass} value={edit.climbSuccessRatePct || ''} onChange={(e) => updateTeamEditField(teamNumber, 'climbSuccessRatePct', e.target.value)} />
                        ) : (Number(row.climbSuccessRate || 0) * 100).toFixed(1)}
                      </TableCell>
                      <TableCell>
                        {isEditing ? (
                          <textarea className="h-16 w-full min-w-0 max-w-full box-border resize-y rounded border border-input bg-background px-2 py-1 text-[11px]" value={edit.notes || ''} onChange={(e) => updateTeamEditField(teamNumber, 'notes', e.target.value)} placeholder="Add notes..." />
                        ) : row.notes ? (
                          <details>
                            <summary className="cursor-pointer text-xs leading-none text-muted-foreground" aria-label="Toggle notes">▸</summary>
                            <div className="mt-1 text-xs italic text-muted-foreground">{row.notes}</div>
                          </details>
                        ) : '—'}
                      </TableCell>
                      <TableCell>
                        {isEditing ? (
                          <div className="flex flex-col gap-1">
                            <Button size="sm" className="h-7 px-2 text-[11px]" onClick={() => saveTeamManualStats(row)} disabled={isSaving}>{isSaving ? 'Saving...' : 'Save'}</Button>
                            <Button size="sm" variant="outline" className="h-7 px-2 text-[11px]" onClick={() => cancelEditingTeam(teamNumber)} disabled={isSaving}>Cancel</Button>
                          </div>
                        ) : (
                          <Button size="sm" variant="outline" onClick={() => startEditingTeam(row)}>Edit</Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead><button type="button" className="inline-flex items-center gap-1" onClick={() => onSort('teamNumber')}>Team <span>{sortArrow('teamNumber')}</span></button></TableHead>
                  <TableHead><button type="button" className="inline-flex items-center gap-1" onClick={() => onSort('hopperCapacity')}>Hopper <span>{sortArrow('hopperCapacity')}</span></button></TableHead>
                  <TableHead><button type="button" className="inline-flex items-center gap-1" onClick={() => onSort('drivetrainType')}>Drivetrain <span>{sortArrow('drivetrainType')}</span></button></TableHead>
                  <TableHead><button type="button" className="inline-flex items-center gap-1" onClick={() => onSort('swerveModuleType')}>Swerve Module/Gearing <span>{sortArrow('swerveModuleType')}</span></button></TableHead>
                  <TableHead><button type="button" className="inline-flex items-center gap-1" onClick={() => onSort('shooterType')}>Shooter <span>{sortArrow('shooterType')}</span></button></TableHead>
                  <TableHead><button type="button" className="inline-flex items-center gap-1" onClick={() => onSort('cycleBallsPerSec')}>Balls/s <span>{sortArrow('cycleBallsPerSec')}</span></button></TableHead>
                  <TableHead><button type="button" className="inline-flex items-center gap-1" onClick={() => onSort('outpostCapability')}>Outpost <span>{sortArrow('outpostCapability')}</span></button></TableHead>
                  <TableHead><button type="button" className="inline-flex items-center gap-1" onClick={() => onSort('depotCapability')}>Depot <span>{sortArrow('depotCapability')}</span></button></TableHead>
                  <TableHead><button type="button" className="inline-flex items-center gap-1" onClick={() => onSort('hasGroundIntake')}>Ground Intake <span>{sortArrow('hasGroundIntake')}</span></button></TableHead>
                  <TableHead><button type="button" className="inline-flex items-center gap-1" onClick={() => onSort('visionType')}>Vision <span>{sortArrow('visionType')}</span></button></TableHead>
                  <TableHead><button type="button" className="inline-flex items-center gap-1" onClick={() => onSort('autoPaths')}>Auto Paths <span>{sortArrow('autoPaths')}</span></button></TableHead>
                  <TableHead><button type="button" className="inline-flex items-center gap-1" onClick={() => onSort('cycleSpeed')}>Cycle Speed <span>{sortArrow('cycleSpeed')}</span></button></TableHead>
                  <TableHead><button type="button" className="inline-flex items-center gap-1" onClick={() => onSort('trenchBumpCap')}>Trench/Bump Cap <span>{sortArrow('trenchBumpCap')}</span></button></TableHead>
                  <TableHead><button type="button" className="inline-flex items-center gap-1" onClick={() => onSort('climbCapability')}>Climb Capability <span>{sortArrow('climbCapability')}</span></button></TableHead>
                  <TableHead><button type="button" className="inline-flex items-center gap-1" onClick={() => onSort('softwareFeatures')}>Software Features <span>{sortArrow('softwareFeatures')}</span></button></TableHead>
                  <TableHead><button type="button" className="inline-flex items-center gap-1" onClick={() => onSort('mechanicalFeatures')}>Mechanical Features <span>{sortArrow('mechanicalFeatures')}</span></button></TableHead>
                  <TableHead><button type="button" className="inline-flex items-center gap-1" onClick={() => onSort('aiConfidenceScore')}>AI% <span>{sortArrow('aiConfidenceScore')}</span></button></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedRows.map((row) => (
                  <TableRow key={`${row.eventKey}-${row.teamNumber}`}>
                    <TableCell>{row.teamNumber}</TableCell>
                    <TableCell>{row.hopperCapacity ?? '—'}</TableCell>
                    <TableCell>{row.drivetrainType || 'unknown'}</TableCell>
                    <TableCell>
                      {(row.swerveModuleType || row.swerveGearing)
                        ? `${row.swerveModuleType || '—'}${row.swerveGearing ? ` / ${row.swerveGearing}` : ''}`
                        : '—'}
                    </TableCell>
                    <TableCell>{row.shooterType || 'unknown'}</TableCell>
                    <TableCell>{Number(row.cycleBallsPerSec || 0).toFixed(2)}</TableCell>
                    <TableCell>{row.outpostCapability ? 'Yes' : 'No'}</TableCell>
                    <TableCell>{row.depotCapability ? 'Yes' : 'No'}</TableCell>
                    <TableCell>{row.hasGroundIntake ? 'Yes' : 'No'}</TableCell>
                    <TableCell>{row.visionType || 'unknown'}</TableCell>
                    <TableCell>{row.autoPaths || '—'}</TableCell>
                    <TableCell>{row.cycleSpeed || 'unknown'}</TableCell>
                    <TableCell>{row.canUseTrench && row.canCrossBump ? 'Both' : row.canUseTrench ? 'Trench' : row.canCrossBump ? 'Bump' : 'None'}</TableCell>
                    <TableCell>{row.climbCapability || row.climberType || 'unknown'}</TableCell>
                    <TableCell>{row.softwareFeatures || '—'}</TableCell>
                    <TableCell>{row.mechanicalFeatures || row.mechanismNotes || '—'}</TableCell>
                    <TableCell>{Math.round(Number(row.aiConfidenceScore || 0) * 100)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <footer className="pb-3 text-center text-xs text-muted-foreground">
        Made by SanPranav © 2026
      </footer>
    </main>
  );
}
