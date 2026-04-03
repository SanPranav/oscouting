import { useEffect, useMemo, useState } from 'react';
import { Bot, MessageCircle, Radar, Save, Send, Settings2, Sparkles, Swords, X } from 'lucide-react';
import { Button } from './components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './components/ui/card';
import { Input } from './components/ui/input';
import { Badge } from './components/ui/badge';

const API_BASE = import.meta.env.VITE_API_BASE || '';
const DEFAULT_EVENT_KEY = '2026caasv';
const DEFAULT_MATCH_SUFFIX = 'qm5';

const competitionLabel = (competition) => {
  if (!competition?.eventKey) return 'Choose a competition';
  const details = [competition.name, competition.location].filter(Boolean).join(' · ');
  return details ? `${competition.eventKey} - ${details}` : competition.eventKey;
};

const clamp = (value, min = 0, max = 100) => Math.max(min, Math.min(max, value));

function buildSpiderMetrics(stat) {
  return [
    Number(stat?.spiderAuto || 0),
    Number(stat?.spiderTeleop || 0),
    Number(stat?.spiderDefense || 0),
    Number(stat?.spiderCycleSpeed || 0),
    Number(stat?.spiderReliability || 0),
    Number(stat?.spiderEndgame || 0)
  ].map((value) => clamp(Number(value || 0)));
}

function SpiderChart({ stat }) {
  if (!stat) return null;

  const metrics = buildSpiderMetrics(stat);

  const labels = ['Auto', 'Teleop', 'Defense', 'Cycle', 'Reliability', 'Endgame'];
  const cx = 120;
  const cy = 120;
  const r = 88;

  const points = metrics.map((value, index) => {
    const angle = (-90 + index * 60) * (Math.PI / 180);
    const rr = r * (value / 100);
    return `${cx + Math.cos(angle) * rr},${cy + Math.sin(angle) * rr}`;
  }).join(' ');

  const axis = labels.map((label, index) => {
    const angle = (-90 + index * 60) * (Math.PI / 180);
    const x = cx + Math.cos(angle) * r;
    const y = cy + Math.sin(angle) * r;
    const lx = cx + Math.cos(angle) * (r + 20);
    const ly = cy + Math.sin(angle) * (r + 20);
    return (
      <g key={label}>
        <line x1={cx} y1={cy} x2={x} y2={y} stroke="currentColor" opacity="0.28" />
        <text x={lx} y={ly} fontSize="11" textAnchor="middle" fill="currentColor" opacity="0.92">{label}</text>
      </g>
    );
  });

  return (
    <svg viewBox="0 0 240 240" className="h-64 w-64 text-foreground">
      <rect x="14" y="14" width="212" height="212" rx="12" fill="currentColor" opacity="0.04" />
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="currentColor" opacity="0.36" />
      <circle cx={cx} cy={cy} r={r * 0.66} fill="none" stroke="currentColor" opacity="0.24" />
      <circle cx={cx} cy={cy} r={r * 0.33} fill="none" stroke="currentColor" opacity="0.16" />
      {axis}
      <polygon points={points} fill="currentColor" fillOpacity="0.28" stroke="currentColor" strokeWidth="2.4" />
    </svg>
  );
}

function LoadingChip({ label }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-input bg-background px-2.5 py-1 text-xs text-muted-foreground">
      <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-muted border-t-foreground" />
      {label}
    </span>
  );
}

const getDraftInputKey = (allianceSeed, roundNumber) => `${Number(allianceSeed)}-${Number(roundNumber)}`;

export default function App() {
  const [eventKey, setEventKey] = useState(DEFAULT_EVENT_KEY);
  const [matchKey, setMatchKey] = useState(`${DEFAULT_EVENT_KEY}_${DEFAULT_MATCH_SUFFIX}`);
  const [teamNumber, setTeamNumber] = useState('3749');
  const [competitionPickerOpen, setCompetitionPickerOpen] = useState(true);
  const [competitionYear, setCompetitionYear] = useState(String(new Date().getFullYear()));
  const [competitionLoading, setCompetitionLoading] = useState(false);
  const [competitionError, setCompetitionError] = useState('');
  const [selectedCompetition, setSelectedCompetition] = useState(null);
  const [competitionReady, setCompetitionReady] = useState(false);
  const [competitionName, setCompetitionName] = useState('Aerospace Valley');
  const [competitionMatchKey, setCompetitionMatchKey] = useState(`${DEFAULT_EVENT_KEY}_${DEFAULT_MATCH_SUFFIX}`);
  const [competitionScheduleText, setCompetitionScheduleText] = useState('');
  const [competitionTeamsText, setCompetitionTeamsText] = useState('');
  const [result, setResult] = useState(null);
  const [teamDetail, setTeamDetail] = useState(null);
  const [robotStatus, setRobotStatus] = useState([]);
  const [scheduleRows, setScheduleRows] = useState([]);
  const [pickLeaderboard, setPickLeaderboard] = useState([]);
  const [schedulePasteText, setSchedulePasteText] = useState('');
  const [importMessage, setImportMessage] = useState('');
  const [error, setError] = useState('');
  const [team3749Ready, setTeam3749Ready] = useState(true);
  const [predictionLoading, setPredictionLoading] = useState(false);
  const [predictionProgress, setPredictionProgress] = useState(0);
  const [predictionLoadingLabel, setPredictionLoadingLabel] = useState('Loading prediction...');
  const [brickOpen, setBrickOpen] = useState(false);
  const [brickInput, setBrickInput] = useState('');
  const [brickLoading, setBrickLoading] = useState(false);
  const [brickTypingDots, setBrickTypingDots] = useState('.');
  const [allianceModalOpen, setAllianceModalOpen] = useState(false);
  const [allianceProjection, setAllianceProjection] = useState(null);
  const [allianceError, setAllianceError] = useState('');
  const [liveDraftInputs, setLiveDraftInputs] = useState({});
  const [liveDraftProjection, setLiveDraftProjection] = useState(null);
  const [liveDraftError, setLiveDraftError] = useState('');
  const [liveDraftWarnings, setLiveDraftWarnings] = useState([]);
  const [loadingCounts, setLoadingCounts] = useState({
    teamPanels: 0,
    schedule: 0,
    leaderboard: 0,
    scheduleImport: 0,
    alliances: 0,
    liveAlliances: 0
  });
  const [brickMessages, setBrickMessages] = useState([
    {
      role: 'assistant',
      text: 'Brick AI ready. Ask about team strengths, weaknesses, matchup plans, or reliability trends.'
    }
  ]);

  const fetchJsonWithProgress = async (url, options = {}) => {
    const response = await fetch(url, options);
    setPredictionProgress(70);
    const data = await response.json();
    setPredictionProgress(95);
    return { response, data };
  };

  const beginLoad = (key) => {
    setLoadingCounts((prev) => ({
      ...prev,
      [key]: (prev[key] || 0) + 1
    }));
  };

  const endLoad = (key) => {
    setLoadingCounts((prev) => ({
      ...prev,
      [key]: Math.max(0, (prev[key] || 0) - 1)
    }));
  };

  const isLoading = (key) => Number(loadingCounts[key] || 0) > 0;

  const buildLockedPicks = () => {
    if (!allianceProjection?.alliances?.length) return [];

    const locked = [];
    for (const alliance of allianceProjection.alliances) {
      const seed = Number(alliance.allianceSeed || 0);
      for (let roundNumber = 1; roundNumber <= 3; roundNumber += 1) {
        const rawValue = String(liveDraftInputs[getDraftInputKey(seed, roundNumber)] || '').trim();
        if (!rawValue) continue;
        const teamNumber = Number.parseInt(rawValue, 10);
        if (!Number.isFinite(teamNumber) || teamNumber <= 0) continue;
        locked.push({
          allianceSeed: seed,
          captainTeamNumber: Number(alliance.captainTeamNumber || 0),
          roundNumber,
          teamNumber
        });
      }
    }

    return locked;
  };

  const initializeLiveDraftFromProjection = (projection) => {
    const nextInputs = {};
    for (const alliance of projection?.alliances || []) {
      const seed = Number(alliance?.allianceSeed || 0);
      for (let roundNumber = 1; roundNumber <= 3; roundNumber += 1) {
        nextInputs[getDraftInputKey(seed, roundNumber)] = '';
      }
    }
    setLiveDraftInputs(nextInputs);
    setLiveDraftProjection(projection || null);
    setLiveDraftError('');
    setLiveDraftWarnings([]);
  };

  const runPrediction = async () => {
    try {
      setError('');
      setPredictionLoading(true);
      setPredictionProgress(0);
      setPredictionLoadingLabel('Generating match prediction...');

      const { response, data } = await fetchJsonWithProgress(
        `${API_BASE}/api/strategy/predict/${eventKey}/${matchKey}?team=${encodeURIComponent(teamNumber)}&teamReady=${team3749Ready}`
      );
      if (!response.ok) {
        setError(data.error || 'Prediction failed');
        setResult(null);
        return;
      }
      setPredictionProgress(100);
      setResult(data);
    } catch {
      setError('E_SERVER_UNREACHABLE: start backend and retry');
      setResult(null);
    } finally {
      setPredictionLoading(false);
      setPredictionProgress(0);
    }
  };

  const loadTeamPanels = async () => {
    beginLoad('teamPanels');
    try {
      setError('');
      const numericTeam = Number(teamNumber);
      const [detailRes, statusRes, statsRes] = await Promise.all([
        fetch(`${API_BASE}/api/strategy/stats/${eventKey}/${teamNumber}`),
        fetch(`${API_BASE}/api/strategy/robot-status/${eventKey}`),
        fetch(`${API_BASE}/api/strategy/stats/${eventKey}`)
      ]);

      const detail = await detailRes.json();
      const status = await statusRes.json();
      const stats = await statsRes.json();

      if (!detailRes.ok) throw new Error(detail.error || 'Failed loading team detail');
      if (!statusRes.ok) throw new Error(status.error || 'Failed loading robot status');
      if (!statsRes.ok) throw new Error(stats.error || 'Failed loading team stats');

      const matchingStat = Array.isArray(stats)
        ? stats.find((row) => Number(row.teamNumber) === numericTeam)
        : null;

      setTeamDetail({
        ...detail,
        stat: matchingStat || detail?.stat || null
      });
      setRobotStatus(
        Array.isArray(status)
          ? status.filter((row) => Number(row.teamNumber) === numericTeam)
          : []
      );
    } catch (err) {
      setError(err.message || 'Failed loading dashboard panels');
    } finally {
      endLoad('teamPanels');
    }
  };

  const loadSchedule = async () => {
    beginLoad('schedule');
    try {
      const response = await fetch(`${API_BASE}/api/strategy/schedule/${eventKey}?team=${encodeURIComponent(teamNumber)}`);
      const data = await response.json();
      if (!response.ok) {
        setError(data.error || 'Failed loading schedule');
        return;
      }
      setScheduleRows(Array.isArray(data) ? data : []);
    } catch {
      setError('Failed loading schedule');
    } finally {
      endLoad('schedule');
    }
  };

  const loadLeaderboard = async () => {
    beginLoad('leaderboard');
    try {
      const response = await fetch(`${API_BASE}/api/strategy/leaderboard/${eventKey}?ourTeam=${teamNumber}&limit=12`);
      const data = await response.json();
      if (!response.ok) {
        setError(data.error || 'Failed loading leaderboard');
        return;
      }

      setPickLeaderboard(Array.isArray(data.leaderboard) ? data.leaderboard : []);
    } catch {
      setError('Failed loading leaderboard');
    } finally {
      endLoad('leaderboard');
    }
  };

  const normalizeMatchSuffix = (rawValue, fallback) => {
    const value = String(rawValue || '').trim();
    if (!value) return fallback;
    if (/^qm\d+$/i.test(value)) return value.toLowerCase();
    if (/^\d+$/.test(value)) return `qm${value}`;
    if (/^(ef|qf|sf|f)\d+m?\d*$/i.test(value)) return value.toLowerCase();
    return fallback;
  };

  const saveSelectedCompetition = async (competition) => {
    const response = await fetch(`${API_BASE}/api/strategy/selected-event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(competition)
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.errorCode ? `${data.errorCode}: ${data.error || 'Failed saving competition'}` : (data.error || 'Failed saving competition'));
    }
    return data;
  };

  const setCompetitionSelection = async (competition, options = {}) => {
    const nextCompetition = competition || null;
    const nextEventKey = String(nextCompetition?.eventKey || '').trim();
    if (!nextEventKey) return;

    const currentSuffixRaw = String(matchKey || '').includes('_')
      ? String(matchKey).split('_').slice(1).join('_')
      : String(matchKey || '');
    const nextMatchSuffix = normalizeMatchSuffix(currentSuffixRaw, DEFAULT_MATCH_SUFFIX);
    const nextMatchKey = `${nextEventKey}_${nextMatchSuffix}`;

    setCompetitionLoading(true);
    setCompetitionError('');
    try {
      const saved = await saveSelectedCompetition({
        eventKey: nextEventKey,
        name: competitionName || nextEventKey,
        shortName: competitionName || nextEventKey,
        matchKey: competitionMatchKey || nextMatchKey,
        year: competitionYear,
        scheduleText: competitionScheduleText,
        teamsText: competitionTeamsText
      });
      const resolvedCompetition = {
        eventKey: String(saved.eventKey || nextEventKey),
        name: String(saved.name || nextCompetition.name || nextEventKey),
        shortName: String(saved.shortName || nextCompetition.shortName || saved.name || nextEventKey),
        year: Number(saved.year || nextCompetition.year || new Date().getFullYear()),
        week: Number(saved.week || nextCompetition.week || 0),
        matchKey: String(saved.matchKey || competitionMatchKey || nextMatchKey || ''),
        scheduleText: String(saved.scheduleText || competitionScheduleText || ''),
        teamsText: String(saved.teamsText || competitionTeamsText || ''),
        startDate: String(saved.startDate || nextCompetition.startDate || ''),
        endDate: String(saved.endDate || nextCompetition.endDate || ''),
        location: String(saved.location || nextCompetition.location || ''),
        city: String(saved.city || nextCompetition.city || ''),
        stateProv: String(saved.stateProv || nextCompetition.stateProv || ''),
        country: String(saved.country || nextCompetition.country || ''),
        districtName: String(saved.districtName || nextCompetition.districtName || ''),
        districtAbbreviation: String(saved.districtAbbreviation || nextCompetition.districtAbbreviation || '')
      };

      setSelectedCompetition(resolvedCompetition);
      setEventKey(nextEventKey);
      setMatchKey(String(resolvedCompetition.matchKey || nextMatchKey));
      setCompetitionName(String(resolvedCompetition.name || nextEventKey));
      setCompetitionMatchKey(String(resolvedCompetition.matchKey || nextMatchKey));
      setCompetitionScheduleText(String(resolvedCompetition.scheduleText || ''));
      setCompetitionTeamsText(String(resolvedCompetition.teamsText || ''));
      setCompetitionPickerOpen(Boolean(options.keepOpen));

      if (allianceModalOpen) {
        loadAllianceProbabilities(nextEventKey);
      }
    } catch (error) {
      setCompetitionError(error.message || 'Failed saving competition');
    } finally {
      setCompetitionLoading(false);
    }
  };

  const loadCompetitionContext = async () => {
    try {
      setCompetitionError('');
      const selectedRes = await fetch(`${API_BASE}/api/strategy/selected-event`);

      const selectedData = await selectedRes.json();

      if (!selectedRes.ok) {
        throw new Error(selectedData.errorCode ? `${selectedData.errorCode}: ${selectedData.error || 'Failed loading selected competition'}` : (selectedData.error || 'Failed loading selected competition'));
      }

      const nextSelected = {
        eventKey: String(selectedData.eventKey || DEFAULT_EVENT_KEY),
        name: String(selectedData.name || selectedData.shortName || selectedData.eventKey || DEFAULT_EVENT_KEY),
        shortName: String(selectedData.shortName || selectedData.name || selectedData.eventKey || DEFAULT_EVENT_KEY),
        year: Number(selectedData.year || new Date().getFullYear()),
        week: Number(selectedData.week || 0),
        matchKey: String(selectedData.matchKey || `${String(selectedData.eventKey || DEFAULT_EVENT_KEY)}_${DEFAULT_MATCH_SUFFIX}`),
        scheduleText: String(selectedData.scheduleText || ''),
        teamsText: String(selectedData.teamsText || ''),
        startDate: String(selectedData.startDate || ''),
        endDate: String(selectedData.endDate || ''),
        location: String(selectedData.location || ''),
        city: String(selectedData.city || ''),
        stateProv: String(selectedData.stateProv || ''),
        country: String(selectedData.country || ''),
        districtName: String(selectedData.districtName || ''),
        districtAbbreviation: String(selectedData.districtAbbreviation || '')
      };

      setSelectedCompetition(nextSelected);
      setEventKey(nextSelected.eventKey);
      setMatchKey(String(nextSelected.matchKey || `${nextSelected.eventKey}_${DEFAULT_MATCH_SUFFIX}`));
      setCompetitionName(String(nextSelected.name || nextSelected.eventKey));
      setCompetitionMatchKey(String(nextSelected.matchKey || `${nextSelected.eventKey}_${DEFAULT_MATCH_SUFFIX}`));
      setCompetitionScheduleText(String(nextSelected.scheduleText || ''));
      setCompetitionTeamsText(String(nextSelected.teamsText || ''));
    } catch (error) {
      setCompetitionError(error.message || 'E_SELECTED_EVENT_UNAVAILABLE: Failed loading selected competition');
    } finally {
      setCompetitionReady(true);
    }
  };

  async function loadAllianceProbabilities(targetEventKey = eventKey) {
    beginLoad('alliances');
    try {
      setAllianceError('');
      setAllianceProjection(null);
      const response = await fetch(`${API_BASE}/api/strategy/alliance-probabilities/${targetEventKey}?refreshTba=true`);
      const data = await response.json();
      if (!response.ok) {
        setAllianceProjection(null);
        setAllianceError(data.error || 'Failed loading alliance projections');
        setLiveDraftProjection(null);
        return;
      }

      const sortedData = {
        ...data,
        alliances: (data.alliances || []).sort((a, b) => Number(a.allianceSeed || 0) - Number(b.allianceSeed || 0))
      };

      setAllianceProjection(sortedData);
      initializeLiveDraftFromProjection(sortedData);
    } catch {
      setAllianceProjection(null);
      setAllianceError('Failed loading alliance projections');
      setLiveDraftProjection(null);
    } finally {
      endLoad('alliances');
    }
  }

  async function loadLiveAllianceProbabilities(targetEventKey = eventKey, lockedPicks = null) {
    beginLoad('liveAlliances');
    try {
      setLiveDraftError('');
      const picksPayload = Array.isArray(lockedPicks) ? lockedPicks : buildLockedPicks();

      const response = await fetch(`${API_BASE}/api/strategy/alliance-probabilities/${targetEventKey}/live?refreshTba=true`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lockedPicks: picksPayload })
      });
      const data = await response.json();

      if (!response.ok) {
        setLiveDraftProjection(null);
        setLiveDraftError(data.error || 'Failed loading live alliance projection');
        setLiveDraftWarnings([]);
        return;
      }

      const sortedData = {
        ...data,
        alliances: (data.alliances || []).sort((a, b) => Number(a.allianceSeed || 0) - Number(b.allianceSeed || 0))
      };

      setLiveDraftProjection(sortedData);
      setLiveDraftWarnings(Array.isArray(sortedData.warnings) ? sortedData.warnings : []);
    } catch {
      setLiveDraftProjection(null);
      setLiveDraftError('Failed loading live alliance projection');
      setLiveDraftWarnings([]);
    } finally {
      endLoad('liveAlliances');
    }
  }

  const handleLiveDraftInputChange = (key, value) => {
    const sanitized = String(value || '').replace(/[^0-9]/g, '');
    setLiveDraftInputs((prev) => ({
      ...prev,
      [key]: sanitized
    }));
  };

  const importScheduleFromPaste = async () => {
    beginLoad('scheduleImport');
    try {
      setError('');
      setImportMessage('Importing schedule...');
      const response = await fetch(`${API_BASE}/api/import/paste`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventKey, text: schedulePasteText, type: 'auto' })
      });

      const data = await response.json();
      if (!response.ok) {
        setImportMessage(data.error || 'Schedule import failed');
        return;
      }

      const resolvedEventKey = data.eventKey || eventKey;
      if (resolvedEventKey !== eventKey) {
        const importedCompetition = competitions.find((competition) => String(competition.eventKey || '') === String(resolvedEventKey)) || {
          eventKey: resolvedEventKey,
          name: resolvedEventKey
        };

        void saveSelectedCompetition(importedCompetition).then((saved) => {
          setSelectedCompetition((prev) => ({
            ...saved,
            name: String(saved.name || importedCompetition.name || resolvedEventKey),
            shortName: String(saved.shortName || importedCompetition.shortName || saved.name || resolvedEventKey)
          }));
          setCompetitions((prev) => mergeCompetitionIntoList(prev, saved));
        }).catch(() => null);

        setEventKey(resolvedEventKey);

        const currentSuffixRaw = String(matchKey || '').includes('_')
          ? String(matchKey).split('_').slice(1).join('_')
          : String(matchKey || '');
        const nextSuffix = normalizeMatchSuffix(currentSuffixRaw, DEFAULT_MATCH_SUFFIX);
        setMatchKey(`${resolvedEventKey}_${nextSuffix}`);
      }

      if (data.importedMatches !== undefined) {
        setImportMessage(`Imported ${data.importedMatches} matches into ${resolvedEventKey}`);
      } else {
        setImportMessage(`Import complete for ${resolvedEventKey}`);
      }

      await loadSchedule();
      await loadLeaderboard();
    } catch {
      setImportMessage('E_SCHEDULE_IMPORT_SERVER_UNREACHABLE: schedule import failed');
    } finally {
      endLoad('scheduleImport');
    }
  };

  const askBrickAi = async () => {
    const question = brickInput.trim();
    if (!question || brickLoading) return;

    const userMessage = { role: 'user', text: question };
    setBrickMessages((prev) => [...prev, userMessage]);
    setBrickInput('');
    setBrickLoading(true);

    try {
      const response = await fetch(`${API_BASE}/api/strategy/brick-ai/${eventKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, teamNumber })
      });

      const data = await response.json();
      if (!response.ok) {
        setBrickMessages((prev) => [
          ...prev,
          { role: 'assistant', text: data.error || 'Brick AI request failed.' }
        ]);
        return;
      }

      const answerText = String(data.answer || 'No answer returned.');
      const warningText = data.degraded && data.warning
        ? `\n\n(${data.warning})`
        : '';

      setBrickMessages((prev) => [
        ...prev,
        { role: 'assistant', text: `${answerText}${warningText}` }
      ]);
    } catch {
      setBrickMessages((prev) => [
        ...prev,
        { role: 'assistant', text: 'E_BRICK_AI_UNAVAILABLE: check server and model runtime.' }
      ]);
    } finally {
      setBrickLoading(false);
    }
  };

  useEffect(() => {
    if (!brickLoading) {
      setBrickTypingDots('.');
      return;
    }

    const frames = ['.', '..', '...'];
    let idx = 0;
    const interval = setInterval(() => {
      idx = (idx + 1) % frames.length;
      setBrickTypingDots(frames[idx]);
    }, 400);

    return () => clearInterval(interval);
  }, [brickLoading]);

  useEffect(() => {
    setCompetitionPickerOpen(true);
    loadCompetitionContext();
  }, []);

  useEffect(() => {
    if (!competitionReady) return;
    loadSchedule();
    loadLeaderboard();
    const timer = setInterval(loadSchedule, 30000);
    const leaderboardTimer = setInterval(loadLeaderboard, 30000);
    return () => {
      clearInterval(timer);
      clearInterval(leaderboardTimer);
    };
  }, [competitionReady, eventKey, teamNumber]);

  useEffect(() => {
    if (!allianceModalOpen || !allianceProjection?.alliances?.length) return;

    const debounce = setTimeout(() => {
      loadLiveAllianceProbabilities(eventKey);
    }, 300);

    return () => clearTimeout(debounce);
  }, [allianceModalOpen, allianceProjection, liveDraftInputs, eventKey]);

  const currentOnClock = liveDraftProjection?.nextOnClock || allianceProjection?.nextOnClock || null;

  return (
    <main className="mx-auto min-h-screen max-w-[1500px] p-6 lg:p-8">
      <div className="mb-4 flex justify-end">
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            className="gap-2 border-input bg-card px-3 py-1.5 text-xs font-semibold shadow-lg backdrop-blur"
            onClick={() => setCompetitionPickerOpen(true)}
          >
            <Settings2 className="h-4 w-4" />
            {selectedCompetition ? 'Change Competition' : 'Choose Competition'}
          </Button>
          <a
            href="/system-guide.html"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center rounded-full border border-input bg-card px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-accent/10"
          >
            System Docs + Formulas
          </a>
        </div>
      </div>
      <div className="space-y-8 pb-28">
        <Card>
          <CardHeader className="pb-4">
            <div className="mb-2 flex items-center gap-2">
              <Radar className="h-5 w-5 text-foreground" />
              <Badge>Drive Dashboard</Badge>
            </div>
            <CardTitle>Match Prediction</CardTitle>
            <CardDescription>
              Use local scouting stats plus AI narrative for strategy calls.
              {selectedCompetition?.name ? ` Current competition: ${selectedCompetition.name}.` : ''}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex flex-wrap gap-2">
              <Badge className="border border-input bg-background text-foreground">Event {eventKey}</Badge>
              <Badge className="border border-input bg-background text-foreground">
                {selectedCompetition ? competitionLabel(selectedCompetition) : 'Choose a competition'}
              </Badge>
            </div>

            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <Input value={matchKey} onChange={(e) => setMatchKey(e.target.value)} placeholder="match id (5, qm5, or 2026casnd_qm5)" />
              <Input value={teamNumber} onChange={(e) => setTeamNumber(e.target.value)} placeholder="team for spider/status" />
              <div className="flex gap-2">
                <Button className="w-full gap-2" onClick={runPrediction} disabled={predictionLoading}>
                  <Sparkles className="h-4 w-4" />
                  {predictionLoading ? 'Predicting...' : 'Predict Match'}
                </Button>
                <Button variant="outline" className="w-full" onClick={loadTeamPanels}>Load Panels</Button>
              </div>
            </div>

            <div className="rounded-md border border-input p-3">
              <p className="mb-2 text-sm font-medium">Team {teamNumber} Status</p>
              <button
                type="button"
                role="switch"
                aria-checked={team3749Ready}
                onClick={() => setTeam3749Ready((current) => !current)}
                className={`inline-flex h-6 w-12 items-center rounded-full transition-colors ${team3749Ready ? 'bg-primary' : 'bg-muted'}`}
              >
                <span
                  className={`h-5 w-5 rounded-full bg-background shadow transition-transform ${team3749Ready ? 'translate-x-6' : 'translate-x-1'}`}
                />
              </button>
              <p className="mt-2 text-xs text-muted-foreground">
                {team3749Ready
                  ? 'TRUE: prioritize balanced offense + selective defense.'
                  : 'FALSE: prioritize defensive disruption and low-risk cycles.'}
              </p>
            </div>

            {error ? <p className="text-sm text-destructive">{error}</p> : null}

            {(predictionLoading || isLoading('teamPanels') || isLoading('schedule') || isLoading('leaderboard') || isLoading('scheduleImport') || isLoading('alliances') || isLoading('liveAlliances')) ? (
              <div className="flex flex-wrap gap-2">
                {predictionLoading ? <LoadingChip label="Prediction" /> : null}
                {isLoading('teamPanels') ? <LoadingChip label="Team Panels" /> : null}
                {isLoading('schedule') ? <LoadingChip label="Schedule" /> : null}
                {isLoading('leaderboard') ? <LoadingChip label="Leaderboard" /> : null}
                {isLoading('scheduleImport') ? <LoadingChip label="Schedule Import" /> : null}
                {isLoading('alliances') ? <LoadingChip label="Alliances" /> : null}
                {isLoading('liveAlliances') ? <LoadingChip label="Live Draft" /> : null}
              </div>
            ) : null}

            {predictionLoading ? (
              <div className="space-y-1">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{predictionLoadingLabel}</span>
                  <span>{Math.round(predictionProgress)}%</span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full bg-primary transition-all duration-150"
                    style={{ width: `${predictionProgress}%` }}
                  />
                </div>
              </div>
            ) : null}

            <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_340px]">
              <section className="space-y-6">
                {result ? (
                  <Card className="border-primary/40">
                    <CardHeader>
                      <CardTitle className="text-base">{result.matchKey}</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3 text-sm">
                      <p>Red: <span className="font-semibold">{result.redPredicted}</span> | Blue: <span className="font-semibold">{result.bluePredicted}</span></p>
                      <p>Confidence: {result.confidence}</p>
                      {result.dataQuality ? (
                        <div className="rounded-md border border-input p-2 text-xs text-muted-foreground">
                          <p>
                            Data quality · Red points coverage: <span className="font-semibold">{result.dataQuality.red?.pointsCoveragePct ?? 0}%</span>
                            {' '}| Blue points coverage: <span className="font-semibold">{result.dataQuality.blue?.pointsCoveragePct ?? 0}%</span>
                          </p>
                          <p>
                            Team sources:{' '}
                            {(result.dataQuality.byTeam || [])
                              .map((entry) => `${entry.teamNumber}:${entry.source}`)
                              .join(', ')}
                          </p>
                        </div>
                      ) : null}
                      {result.focusTeamPlaying ?? result.team3749Playing
                        ? <p>{result.focusTeam || teamNumber} alliance: <span className="font-semibold">{result.ourAlliance}</span></p>
                        : <p className="font-semibold">{result.focusTeam || teamNumber} is not playing.</p>}
                      {Array.isArray(result.opponentWeaknesses) && result.opponentWeaknesses.length ? (
                        <div>
                          <p className="font-medium">Opponent Weaknesses</p>
                          <ul className="list-disc pl-5 text-muted-foreground">
                            {result.opponentWeaknesses.slice(0, 5).map((weakness) => (
                              <li key={weakness}>{weakness}</li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                      {Array.isArray(result.opponentStrengths) && result.opponentStrengths.length ? (
                        <div>
                          <p className="font-medium">Opponent Strengths</p>
                          <ul className="list-disc pl-5 text-muted-foreground">
                            {result.opponentStrengths.slice(0, 4).map((strength) => (
                              <li key={strength}>{strength}</li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                      <p className="text-muted-foreground">{result.narrative}</p>
                    </CardContent>
                  </Card>
                ) : null}

                {result?.tacticalPlan ? (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">Drive-Team Tactical Strategy</CardTitle>
                      <CardDescription>Concise calls for 2026 Rebuilt: mobility, lane denial, endgame conversion.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4 text-sm">
                      <div className="flex items-center justify-between rounded-md border border-input p-2">
                        <p className="text-xs text-muted-foreground">Strategy Mode</p>
                        <Badge className="border border-input bg-background text-foreground">{result.tacticalPlan.mode || 'balanced'}</Badge>
                      </div>

                      {result.tacticalPlan.primaryThreat ? (
                        <div className="rounded-md border border-input p-3">
                          <p className="font-semibold">Primary Threat · Team {result.tacticalPlan.primaryThreat.teamNumber}</p>
                          <p className="text-muted-foreground">{result.tacticalPlan.primaryThreat.reason}</p>
                          <div className="mt-2 grid gap-2 text-xs sm:grid-cols-3">
                            <p>Threat: <span className="font-semibold">{result.tacticalPlan.primaryThreat.threatLevel}</span></p>
                            <p>Teleop: <span className="font-semibold">{result.tacticalPlan.primaryThreat.stats.teleopScore}</span></p>
                            <p>Endgame: <span className="font-semibold">{result.tacticalPlan.primaryThreat.stats.endgameScore}</span></p>
                            <p>Cycle: <span className="font-semibold">{result.tacticalPlan.primaryThreat.stats.cycleSpeed || 'N/A'}</span></p>
                            <p>EPA: <span className="font-semibold">{result.tacticalPlan.primaryThreat.stats.statboticsEPA || '0.00'}</span></p>
                            <p>Window: <span className="font-semibold">{result.tacticalPlan.primaryThreat.stats.exploitable}</span></p>
                          </div>
                          {Array.isArray(result.tacticalPlan.primaryThreat.habits) && result.tacticalPlan.primaryThreat.habits.length ? (
                            <div className="mt-2">
                              <p className="text-xs font-medium">Opponent Habits</p>
                              <ul className="list-disc pl-5 text-xs text-muted-foreground">
                                {result.tacticalPlan.primaryThreat.habits.map((habit) => (
                                  <li key={habit}>{habit}</li>
                                ))}
                              </ul>
                            </div>
                          ) : null}
                        </div>
                      ) : null}

                      <div className="rounded-md border border-input p-3">
                        <p className="font-medium">Auto Call</p>
                        <p className="text-muted-foreground">{result.tacticalPlan.autoRecommendation}</p>
                      </div>

                      {Array.isArray(result.tacticalPlan.offensePlan) && result.tacticalPlan.offensePlan.length ? (
                        <div className="rounded-md border border-input p-3">
                          <p className="font-medium">Shooting and Cycle Plan</p>
                          <ul className="list-disc pl-5 text-muted-foreground">
                            {result.tacticalPlan.offensePlan.map((line) => (
                              <li key={line}>{line}</li>
                            ))}
                          </ul>
                        </div>
                      ) : null}

                      {Array.isArray(result.tacticalPlan.defensePlan) && result.tacticalPlan.defensePlan.length ? (
                        <div className="rounded-md border border-input p-3">
                          <p className="font-medium">Defense Plan</p>
                          <ul className="list-disc pl-5 text-muted-foreground">
                            {result.tacticalPlan.defensePlan.map((line) => (
                              <li key={line}>{line}</li>
                            ))}
                          </ul>
                        </div>
                      ) : null}

                      {Array.isArray(result.tacticalPlan.habitCounters) && result.tacticalPlan.habitCounters.length ? (
                        <div className="rounded-md border border-input p-3">
                          <p className="font-medium">Habit Counters</p>
                          <ul className="list-disc pl-5 text-muted-foreground">
                            {result.tacticalPlan.habitCounters.map((line) => (
                              <li key={line}>{line}</li>
                            ))}
                          </ul>
                        </div>
                      ) : null}

                      {Array.isArray(result.tacticalPlan.concisePlan) && result.tacticalPlan.concisePlan.length ? (
                        <div className="rounded-md border border-input p-3">
                          <p className="font-medium">Quick Calls</p>
                          <ul className="list-disc pl-5 text-muted-foreground">
                            {result.tacticalPlan.concisePlan.slice(0, 4).map((line) => (
                              <li key={line}>{line}</li>
                            ))}
                          </ul>
                        </div>
                      ) : null}

                      {result.tacticalPlan.summary ? (
                        <p className="rounded-md border border-input p-3 font-medium">{result.tacticalPlan.summary}</p>
                      ) : null}
                    </CardContent>
                  </Card>
                ) : null}

                <Card>
                  <CardHeader>
                    <div className="flex items-center justify-between gap-3">
                      <CardTitle className="text-base">Dynamic Match Schedule (Team {teamNumber})</CardTitle>
                      {isLoading('schedule') ? <LoadingChip label="Refreshing" /> : null}
                    </div>
                    <CardDescription>Auto-refreshes every 30s for {eventKey}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="max-h-80 overflow-auto rounded-md border border-input">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-input text-left text-muted-foreground">
                            <th className="p-2">Match</th>
                            <th className="p-2">Team {teamNumber}</th>
                            <th className="p-2">Red</th>
                            <th className="p-2">Blue</th>
                            <th className="p-2">Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {scheduleRows.map((row) => (
                            <tr key={row.matchKey} className="border-b border-input/50 align-top">
                              <td className="p-2">{row.matchKey}</td>
                              <td className="p-2">{row.allianceForTeam || row.alliance3749 || 'N/A'}</td>
                              <td className="p-2">{(row.redTeams || []).join(', ')}</td>
                              <td className="p-2">{(row.blueTeams || []).join(', ')}</td>
                              <td className="p-2">{row.status}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <div className="flex items-center justify-between gap-3">
                      <CardTitle className="text-base">Pick Leaderboard</CardTitle>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          className="gap-2"
                          onClick={() => {
                            setAllianceModalOpen(true);
                            loadAllianceProbabilities();
                          }}
                        >
                          <Swords className="h-4 w-4" />
                          Probable Alliances
                        </Button>
                        {isLoading('leaderboard') ? <LoadingChip label="Refreshing" /> : null}
                      </div>
                    </div>
                    <CardDescription>Best alliance partners ranked for Team {teamNumber} from live event stats</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="max-h-96 overflow-auto rounded-md border border-input">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-input text-left text-muted-foreground">
                            <th className="p-2">Rank</th>
                            <th className="p-2">Team</th>
                            <th className="p-2">Pick Score</th>
                            <th className="p-2">Capability</th>
                            <th className="p-2">Durability</th>
                            <th className="p-2">Fit</th>
                            <th className="p-2">DCMP</th>
                            <th className="p-2">Strongest Value</th>
                            <th className="p-2">Tags</th>
                          </tr>
                        </thead>
                        <tbody>
                          {pickLeaderboard.map((row) => (
                            <tr key={row.teamNumber} className="border-b border-input/50 align-top">
                              <td className="p-2">{row.rank}</td>
                              <td className="p-2">{row.teamNumber}</td>
                              <td className="p-2 font-semibold">{Number(row.pickScore || 0).toFixed(1)}</td>
                              <td className="p-2">{Number(row.capabilityScore || 0).toFixed(1)}</td>
                              <td className="p-2">{Number(row.durabilityScore || 0).toFixed(1)}</td>
                              <td className="p-2">{Number(row.fitScore || 0).toFixed(1)}</td>
                              <td className="p-2">{row.dcmpStatus || 'N/A'}</td>
                              <td className="p-2">{row.strongestValue || 'Balanced profile'}</td>
                              <td className="p-2">{Array.isArray(row.tags) && row.tags.length ? row.tags.join(', ') : '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </CardContent>
                </Card>

                <div className="grid gap-6 lg:grid-cols-2">
                  <Card className="border-border/80 bg-card/90">
                    <CardHeader>
                      <div className="flex items-center justify-between gap-3">
                        <CardTitle className="text-base">Spider Chart · Team {teamNumber}</CardTitle>
                        {isLoading('teamPanels') ? <LoadingChip label="Refreshing" /> : null}
                      </div>
                      <CardDescription>Auto, Teleop, Defense, Cycle, Reliability, Endgame</CardDescription>
                    </CardHeader>
                    <CardContent className="flex justify-center">
                      <div className="rounded-xl border border-border/80 bg-background/50 p-2">
                        {isLoading('teamPanels') && !teamDetail?.stat ? (
                          <div className="flex h-64 w-64 items-center justify-center">
                            <LoadingChip label="Loading chart" />
                          </div>
                        ) : (
                          <SpiderChart stat={teamDetail?.stat} />
                        )}
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader>
                      <div className="flex items-center justify-between gap-3">
                        <CardTitle className="text-base">Robot Status</CardTitle>
                        {isLoading('teamPanels') ? <LoadingChip label="Refreshing" /> : null}
                      </div>
                      <CardDescription>Disable/tip/foul trends from scouted reports</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="max-h-72 overflow-auto rounded-md border border-input">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-input text-left text-muted-foreground">
                              <th className="p-2">Team</th>
                              <th className="p-2">Disable%</th>
                              <th className="p-2">Tip%</th>
                              <th className="p-2">Avg Fouls</th>
                              <th className="p-2">Last Climb</th>
                            </tr>
                          </thead>
                          <tbody>
                            {robotStatus.map((row) => (
                              <tr key={row.teamNumber} className="border-b border-input/50">
                                <td className="p-2">{row.teamNumber}</td>
                                <td className="p-2">{(Number(row.disableRate || 0) * 100).toFixed(1)}</td>
                                <td className="p-2">{(Number(row.tipRate || 0) * 100).toFixed(1)}</td>
                                <td className="p-2">{Number(row.avgFouls || 0).toFixed(2)}</td>
                                <td className="p-2">{row.lastEndgame}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </section>

              <aside className="space-y-4 xl:sticky xl:top-6 xl:self-start">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Schedule Import</CardTitle>
                    <CardDescription>Paste schedule CSV/JSON here. Event key auto-updates when detected.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <textarea
                      className="min-h-64 w-full rounded-md border border-input bg-background p-3 text-sm"
                      value={schedulePasteText}
                      onChange={(e) => setSchedulePasteText(e.target.value)}
                      placeholder="Paste schedule CSV/JSON here"
                    />
                    <Button className="w-full" onClick={importScheduleFromPaste}>Import Schedule</Button>
                    {isLoading('scheduleImport') ? <LoadingChip label="Importing" /> : null}
                    {importMessage ? <p className="text-xs text-muted-foreground">{importMessage}</p> : null}
                  </CardContent>
                </Card>
              </aside>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="fixed right-4 top-4 z-50">
        <Button variant="outline" className="gap-2 border-input bg-card/95 shadow-lg backdrop-blur" onClick={() => setCompetitionPickerOpen(true)}>
          <Settings2 className="h-4 w-4" />
          Config
        </Button>
      </div>

      {competitionPickerOpen ? (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm">
          <Card className="max-h-[92vh] w-full max-w-4xl overflow-hidden border-border/80 bg-card/95 shadow-xl">
            <CardHeader className="border-b border-input">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <CardTitle className="text-base">Competition Config</CardTitle>
                  <CardDescription>
                    Set the shared event and paste the schedule and teams list here. The other pages will follow this config.
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    onClick={loadCompetitionContext}
                    disabled={competitionLoading}
                  >
                    {competitionLoading ? 'Loading...' : 'Reload Config'}
                  </Button>
                  <Button variant="outline" className="gap-1" onClick={() => setCompetitionPickerOpen(false)}>
                    <X className="h-4 w-4" />
                    Close
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4 overflow-auto p-4">
              {competitionError ? <p className="text-sm text-destructive">{competitionError}</p> : null}

              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">Event Key</label>
                  <Input
                    value={eventKey}
                    onChange={(e) => setEventKey(e.target.value)}
                    placeholder="2026caasv"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">Competition Name</label>
                  <Input
                    value={competitionName}
                    onChange={(e) => setCompetitionName(e.target.value)}
                    placeholder="Aerospace Valley"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">Match Key</label>
                  <Input
                    value={competitionMatchKey}
                    onChange={(e) => setCompetitionMatchKey(e.target.value)}
                    placeholder={`${DEFAULT_EVENT_KEY}_${DEFAULT_MATCH_SUFFIX}`}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">Event Year</label>
                  <Input
                    value={competitionYear}
                    onChange={(e) => setCompetitionYear(e.target.value.replace(/[^0-9]/g, '').slice(0, 4))}
                    placeholder="2026"
                    inputMode="numeric"
                  />
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1 md:col-span-2">
                  <label className="block text-xs font-medium text-muted-foreground">Match Schedule</label>
                  <textarea
                    className="min-h-40 w-full rounded-md border border-input bg-background p-3 text-sm"
                    value={competitionScheduleText}
                    onChange={(e) => setCompetitionScheduleText(e.target.value)}
                    placeholder="Paste schedule text here"
                  />
                </div>
                <div className="space-y-1 md:col-span-2">
                  <label className="block text-xs font-medium text-muted-foreground">Teams Playing</label>
                  <textarea
                    className="min-h-36 w-full rounded-md border border-input bg-background p-3 text-sm"
                    value={competitionTeamsText}
                    onChange={(e) => setCompetitionTeamsText(e.target.value)}
                    placeholder="Paste team list here"
                  />
                </div>
                <Button
                  className="gap-2 md:col-start-2"
                  onClick={() => setCompetitionSelection({
                    eventKey,
                    name: competitionName,
                    shortName: competitionName,
                    matchKey: competitionMatchKey,
                    year: competitionYear,
                    scheduleText: competitionScheduleText,
                    teamsText: competitionTeamsText
                  })}
                  disabled={competitionLoading}
                >
                  <Save className="h-4 w-4" />
                  Save Config
                </Button>
              </div>

              <p className="text-xs text-muted-foreground">
                This config is shared with the aggregator, match tablet, and pit tablet.
              </p>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {allianceModalOpen ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-background/75 p-4 backdrop-blur-sm">
          <Card className="max-h-[92vh] w-full max-w-6xl overflow-hidden border-border/80 bg-card/95 shadow-xl">
            <CardHeader className="border-b border-input">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <CardTitle className="text-base">Most Probable Alliances · {eventKey}</CardTitle>
                  <CardDescription>
                    Top 8 captains with serpentine 1st-3rd picks (4 teams per alliance), using TBA rankings + collected scouting stats.
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="outline" onClick={() => loadAllianceProbabilities()} disabled={isLoading('alliances')}>
                    {isLoading('alliances') ? 'Refreshing...' : 'Refresh'}
                  </Button>
                  <Button variant="outline" className="gap-1" onClick={() => setAllianceModalOpen(false)}>
                    <X className="h-4 w-4" />
                    Close
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3 overflow-auto p-4">
              {allianceError ? <p className="text-sm text-destructive">{allianceError}</p> : null}
              {isLoading('alliances') && !allianceProjection ? <LoadingChip label="Loading alliances" /> : null}

              {allianceProjection?.alliances?.length ? (
                <div className="grid gap-4 xl:grid-cols-2">
                  <section className="space-y-2 rounded-md border border-input p-2">
                    <p className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Baseline Probable Alliances</p>
                    <div className="max-h-[68vh] overflow-auto rounded-md border border-input">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-input text-left text-muted-foreground">
                            <th className="p-2">Seed</th>
                            <th className="p-2">Captain</th>
                            <th className="p-2">1st Pick</th>
                            <th className="p-2">2nd Pick</th>
                            <th className="p-2">3rd Pick</th>
                            <th className="p-2">Final</th>
                          </tr>
                        </thead>
                        <tbody>
                          {allianceProjection.alliances.map((alliance) => {
                            const pickOne = alliance.projectedPicks?.find((pick) => Number(pick.roundNumber) === 1) || null;
                            const pickTwo = alliance.projectedPicks?.find((pick) => Number(pick.roundNumber) === 2) || null;
                            const pickThree = alliance.projectedPicks?.find((pick) => Number(pick.roundNumber) === 3) || null;

                            const renderPick = (pick) => {
                              if (!pick) return '—';
                              return `${pick.teamNumber} (${Number(pick.probabilityScore || 0).toFixed(1)})`;
                            };

                            const finalTeams = [
                              alliance.captainTeamNumber,
                              ...(alliance.projectedPicks || []).map((pick) => pick.teamNumber)
                            ].filter((teamNumber) => Number.isFinite(Number(teamNumber)));

                            return (
                              <tr key={`alliance-baseline-${alliance.allianceSeed}-${alliance.captainTeamNumber}`} className="border-b border-input/50 align-top">
                                <td className="p-2 font-semibold">{alliance.allianceSeed}</td>
                                <td className="p-2">
                                  <div className="font-semibold">{alliance.captainTeamNumber}</div>
                                  <div className="text-xs text-muted-foreground">{alliance.captainNickname || 'Captain'}</div>
                                </td>
                                <td className="p-2">{renderPick(pickOne)}</td>
                                <td className="p-2">{renderPick(pickTwo)}</td>
                                <td className="p-2">{renderPick(pickThree)}</td>
                                <td className="p-2">{finalTeams.join(', ') || '—'}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </section>

                  <section className="space-y-2 rounded-md border border-input p-2">
                    <div className="flex items-center justify-between gap-2 px-1">
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Live Draft Override (Enter Real Picks)</p>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => loadLiveAllianceProbabilities(eventKey)}
                        disabled={isLoading('liveAlliances')}
                      >
                        {isLoading('liveAlliances') ? 'Updating...' : 'Update Now'}
                      </Button>
                    </div>

                    {liveDraftError ? <p className="px-1 text-sm text-destructive">{liveDraftError}</p> : null}
                    {liveDraftWarnings.length ? (
                      <div className="space-y-1 rounded-md border border-input bg-background/60 p-2 text-xs text-muted-foreground">
                        {liveDraftWarnings.slice(0, 4).map((warning) => (
                          <p key={warning}>• {warning}</p>
                        ))}
                      </div>
                    ) : null}

                    {currentOnClock ? (
                      <div className="space-y-2 rounded-md border border-input bg-background/60 p-2">
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">On The Clock Right Now</p>
                        <p className="text-sm">
                          Seed {currentOnClock.allianceSeed} · Round {currentOnClock.roundNumber} · Captain {currentOnClock.captainTeamNumber}
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {(currentOnClock.topCandidates || []).slice(0, 6).map((candidate) => (
                            <Badge key={`onclock-${currentOnClock.allianceSeed}-${currentOnClock.roundNumber}-${candidate.teamNumber}`} className="border border-input bg-background text-foreground">
                              {candidate.teamNumber} ({Number(candidate.probabilityScore || 0).toFixed(1)}){candidate.candidateType === 'captain' ? ' C' : ''}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-md border border-input bg-background/60 p-2 text-xs text-muted-foreground">
                        All picks are locked in for the simulated draft.
                      </div>
                    )}

                    <div className="max-h-[26vh] overflow-auto rounded-md border border-input">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-input text-left text-muted-foreground">
                            <th className="p-2">Seed</th>
                            <th className="p-2">Captain</th>
                            <th className="p-2">Actual 1st</th>
                            <th className="p-2">Actual 2nd</th>
                            <th className="p-2">Actual 3rd</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(liveDraftProjection?.alliances || allianceProjection?.alliances || []).map((alliance) => {
                            const seed = Number(alliance.allianceSeed || 0);
                            return (
                              <tr key={`live-input-${seed}-${alliance.captainTeamNumber}`} className="border-b border-input/50 align-top">
                                <td className="p-2 font-semibold">{seed}</td>
                                <td className="p-2">{alliance.captainTeamNumber}</td>
                                {[1, 2, 3].map((roundNumber) => {
                                  const key = getDraftInputKey(seed, roundNumber);
                                  return (
                                    <td key={key} className="p-2">
                                      <Input
                                        value={liveDraftInputs[key] || ''}
                                        onChange={(e) => handleLiveDraftInputChange(key, e.target.value)}
                                        placeholder="Team #"
                                        className="h-8"
                                      />
                                    </td>
                                  );
                                })}
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>

                    <div className="max-h-[38vh] overflow-auto rounded-md border border-input">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-input text-left text-muted-foreground">
                            <th className="p-2">Seed</th>
                            <th className="p-2">Captain</th>
                            <th className="p-2">1st Pick</th>
                            <th className="p-2">2nd Pick</th>
                            <th className="p-2">3rd Pick</th>
                            <th className="p-2">Final</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(liveDraftProjection?.alliances || allianceProjection?.alliances || []).map((alliance) => {
                            const pickOne = alliance.projectedPicks?.find((pick) => Number(pick.roundNumber) === 1) || null;
                            const pickTwo = alliance.projectedPicks?.find((pick) => Number(pick.roundNumber) === 2) || null;
                            const pickThree = alliance.projectedPicks?.find((pick) => Number(pick.roundNumber) === 3) || null;

                            const renderPick = (pick) => {
                              if (!pick) return '—';
                              const isActual = Boolean(pick.isLocked) || String(pick.source || '') === 'actual';
                              return (
                                <div className="space-y-1">
                                  <div>{pick.teamNumber} ({Number(pick.probabilityScore || 0).toFixed(1)})</div>
                                  <Badge className="border border-input bg-background text-[10px] text-foreground">
                                    {isActual ? 'ACTUAL' : 'PROBABLE'}
                                  </Badge>
                                </div>
                              );
                            };

                            const finalTeams = [
                              alliance.captainTeamNumber,
                              ...(alliance.projectedPicks || []).map((pick) => pick.teamNumber)
                            ].filter((teamNumber) => Number.isFinite(Number(teamNumber)));

                            return (
                              <tr key={`alliance-live-${alliance.allianceSeed}-${alliance.captainTeamNumber}`} className="border-b border-input/50 align-top">
                                <td className="p-2 font-semibold">{alliance.allianceSeed}</td>
                                <td className="p-2">
                                  <div className="font-semibold">{alliance.captainTeamNumber}</div>
                                  <div className="text-xs text-muted-foreground">{alliance.captainNickname || 'Captain'}</div>
                                </td>
                                <td className="p-2">{renderPick(pickOne)}</td>
                                <td className="p-2">{renderPick(pickTwo)}</td>
                                <td className="p-2">{renderPick(pickThree)}</td>
                                <td className="p-2">{finalTeams.join(', ') || '—'}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </section>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </div>
      ) : null}

      <div className="fixed bottom-4 right-4 z-50 flex flex-col items-end">
        {brickOpen ? (
          <Card className="mb-2 w-[min(92vw,380px)] border-border/80 bg-card/95 shadow-xl backdrop-blur">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Bot className="h-4 w-4 text-foreground" />
                  <CardTitle className="text-sm">Brick AI</CardTitle>
                </div>
                <Badge className="border border-input bg-background text-xs text-muted-foreground">Assistant</Badge>
              </div>
              <CardDescription>Ask team and matchup questions for {eventKey}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="max-h-64 space-y-2 overflow-auto rounded-md border border-input bg-background/50 p-2">
                {brickMessages.map((message, index) => (
                  <div
                    key={`${message.role}-${index}`}
                    className={`rounded-md p-2 text-xs ${message.role === 'user' ? 'bg-accent text-accent-foreground' : 'bg-card text-foreground'}`}
                  >
                    <p className="mb-1 font-semibold">{message.role === 'user' ? 'You' : 'Brick AI'}</p>
                    <p className="whitespace-pre-wrap text-muted-foreground">{message.text}</p>
                  </div>
                ))}
                {brickLoading ? (
                  <div className="rounded-md bg-card p-2 text-xs text-foreground">
                    <p className="mb-1 font-semibold">Brick AI</p>
                    <p className="text-muted-foreground">Brick is typing{brickTypingDots}</p>
                  </div>
                ) : null}
              </div>
              <div className="flex gap-2">
                <Input
                  value={brickInput}
                  onChange={(e) => setBrickInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      askBrickAi();
                    }
                  }}
                  placeholder="Ask about teams, defense, reliability..."
                />
                <Button className="gap-1" onClick={askBrickAi} disabled={brickLoading}>
                  <Send className="h-4 w-4" />
                  {brickLoading ? '...' : 'Send'}
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : null}

        <Button
          className="gap-2 rounded-full border border-input bg-card px-4 shadow-xl hover:bg-accent"
          onClick={() => setBrickOpen((open) => !open)}
        >
          {brickOpen ? <X className="h-4 w-4" /> : <MessageCircle className="h-4 w-4" />}
          {brickOpen ? 'Close Brick AI' : 'Brick AI'}
        </Button>
      </div>

      <footer className="mt-10 pb-3 text-center text-xs text-muted-foreground">
        Made by SanPranav © 2026
      </footer>
    </main>
  );
}
