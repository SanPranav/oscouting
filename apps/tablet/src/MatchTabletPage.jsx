import { useEffect, useMemo, useState } from 'react';
import { Calculator, Joystick, RotateCcw, Save } from 'lucide-react';
import { Button } from './components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './components/ui/card';
import { Input } from './components/ui/input';
import { Badge } from './components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from './components/ui/select';

const API_BASE = import.meta.env.VITE_API_BASE || '';
const DEFAULT_EVENT_KEY = '2026cascmp';
const DEFAULT_COMPETITION_YEAR = 2026;
const DEFAULT_COMPETITION_QUERY = 'FIRST California Southern State Championship presented by Qualcomm';

const initial = {
  eventKey: '',
  scoutName: '',
  matchNum: 1,
  teamNumber: 3749,
  startingPosition: '2',
  autoPath: '',
  crossedCenterLine: 'maybe',
  autoClimb: 'none',
  cycles: 0,
  cycleAccuracy: 3,
  cycleNotes: '',
  climb: 'none',
  intakeType: 'idk',
  usingDepot: 'idk',
  usingTrench: 'idk',
  usingBump: 'idk',
  passing: 'idk',
  penalties: '',
  additionalNotes: ''
};

const PHASE_CONFIG = [
  {
    key: 'autonomous',
    label: 'Autonomous',
    helper: 'Auto score tracker'
  },
  {
    key: 'teleop',
    label: 'Teleop',
    helper: 'Driver-controlled score tracker'
  },
  {
    key: 'endgame',
    label: 'Endgame',
    helper: 'Endgame score tracker'
  }
];

const createInitialScoreState = () => ({
  autonomous: { ones: 0, fives: 0 },
  teleop: { ones: 0, fives: 0 },
  endgame: { ones: 0, fives: 0 }
});

const normalizeCompetitionText = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ');

const parseNumberOr = (value, fallback = 0) => {
  if (value === '' || value === null || value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const computePhaseTotals = (scores) => ({
  autonomous: parseNumberOr(scores?.autonomous?.ones, 0) + (parseNumberOr(scores?.autonomous?.fives, 0) * 5),
  teleop: parseNumberOr(scores?.teleop?.ones, 0) + (parseNumberOr(scores?.teleop?.fives, 0) * 5),
  endgame: parseNumberOr(scores?.endgame?.ones, 0) + (parseNumberOr(scores?.endgame?.fives, 0) * 5)
});

const deriveMatchKey = (eventKey, matchNum) => {
  const safeEventKey = String(eventKey || DEFAULT_EVENT_KEY).trim() || DEFAULT_EVENT_KEY;
  const safeMatchNum = Math.max(1, Number(matchNum) || 1);
  return `${safeEventKey}_qm${safeMatchNum}`;
};

const findDefaultCompetition = (competitions = []) => {
  const needles = ['california southern state championship', 'qualcomm'];
  return competitions.find((competition) => {
    const searchable = normalizeCompetitionText(`${competition?.name || ''} ${competition?.shortName || ''}`);
    return needles.every((needle) => searchable.includes(needle));
  }) || competitions[0] || null;
};

const searchMatchesCompetition = (competition, query) => {
  const normalizedQuery = normalizeCompetitionText(query).trim();
  if (!normalizedQuery) return true;

  const searchable = normalizeCompetitionText([
    competition?.name,
    competition?.shortName,
    competition?.eventKey,
    competition?.districtName,
    competition?.location
  ].filter(Boolean).join(' '));

  if (normalizedQuery === 'dcmp') {
    return searchable.includes('district championship')
      || searchable.includes('state championship')
      || searchable.includes('championship')
      || searchable.includes('cmp');
  }

  return normalizedQuery
    .split(/\s+/)
    .filter(Boolean)
    .every((token) => searchable.includes(token));
};

const getCompetitionSearchRank = (competition, query) => {
  const normalizedQuery = normalizeCompetitionText(query).trim();
  if (!normalizedQuery) return 0;

  const searchable = normalizeCompetitionText([
    competition?.name,
    competition?.shortName,
    competition?.eventKey,
    competition?.districtName,
    competition?.location
  ].filter(Boolean).join(' '));

  const isQualcommStateChamp = normalizeCompetitionText(DEFAULT_COMPETITION_QUERY)
    .split(/\s+/)
    .filter(Boolean)
    .every((token) => searchable.includes(token));

  if (normalizedQuery === 'dcmp') {
    if (isQualcommStateChamp) return -100;
    if (searchable.includes('state championship')) return -80;
    if (searchable.includes('district championship')) return -60;
    if (searchable.includes('championship')) return -40;
    return 0;
  }

  if (isQualcommStateChamp) return -20;
  if (searchable.includes(normalizedQuery)) return -10;
  return 0;
};

const parseClimb = (value) => {
  const normalized = String(value || '').toLowerCase();
  if (normalized === 'l1') return 'level1';
  if (normalized === 'l2') return 'level2';
  if (normalized === 'l3') return 'level3';
  return 'none';
};

const parsePenaltyCount = (value) => {
  const found = String(value || '').match(/\d+/)?.[0];
  return found ? Number(found) : 0;
};

const toBoolFromYes = (value) => String(value || '').toLowerCase() === 'yes';

const readJsonIfAvailable = async (response) => {
  const contentType = String(response.headers.get('content-type') || '').toLowerCase();
  if (!contentType.includes('application/json')) return null;
  try {
    return await response.json();
  } catch {
    return null;
  }
};

const buildPayloadFromForm = (form, scores, competition) => {
  const eventKey = String(competition?.eventKey || form.eventKey || DEFAULT_EVENT_KEY).trim() || DEFAULT_EVENT_KEY;
  const matchKey = deriveMatchKey(eventKey, parseNumberOr(form.matchNum, 1));
  const competitionYear = Number(competition?.year || DEFAULT_COMPETITION_YEAR);
  const competitionName = String(competition?.name || competition?.shortName || DEFAULT_COMPETITION_QUERY).trim();
  const phaseTotals = computePhaseTotals(scores);

  const generalNotes = [
    `starting_position=${form.startingPosition}`,
    `auto_path=${form.autoPath}`,
    `crossed_center_line=${form.crossedCenterLine}`,
    `cycle_accuracy=${form.cycleAccuracy}`,
    `cycle_notes=${form.cycleNotes}`,
    `intake_type=${form.intakeType}`,
    `using_depot=${form.usingDepot}`,
    `passing=${form.passing}`,
    `penalties=${form.penalties}`,
    `additional_notes=${form.additionalNotes}`,
    `competition_name=${competitionName}`,
    `competition_year=${competitionYear}`,
    `match_key=${matchKey}`,
    `autonomous_points=${phaseTotals.autonomous}`,
    `teleop_points=${phaseTotals.teleop}`,
    `endgame_points=${phaseTotals.endgame}`,
    `match_points=${phaseTotals.autonomous + phaseTotals.teleop + phaseTotals.endgame}`
  ].filter(Boolean).join(' | ');

  return {
    eventKey,
    matchKey,
    scoutName: form.scoutName || 'unknown',
    team_number: parseNumberOr(form.teamNumber, 0),
    match_number: parseNumberOr(form.matchNum, 0),
    alliance_color: 'red',
    auto_fuel_auto: phaseTotals.autonomous,
    auto_fuel_missed: 0,
    auto_tower_climb: parseClimb(form.autoClimb) === 'none' ? 0 : 1,
    auto_mobility: form.crossedCenterLine !== 'no',
    auto_hub_shift_won: false,
    teleop_fuel_scored: phaseTotals.teleop,
    teleop_fuel_missed: 0,
    teleop_defense_rating: 3,
    teleop_speed_rating: 3,
    teleop_crossed_bump: toBoolFromYes(form.usingBump),
    teleop_crossed_trench: toBoolFromYes(form.usingTrench),
    endgame_result: parseClimb(form.climb),
    endgame_attempted_climb: parseClimb(form.climb) !== 'none',
    robot_disabled: false,
    robot_tipped: false,
    fouls_committed: parsePenaltyCount(form.penalties),
    general_notes: generalNotes
  };
};

function ScoreTracker({ label, helper, value, onAdjust, total }) {
  return (
    <div className="rounded-2xl border border-input bg-background p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-foreground">{label}</p>
          <p className="text-xs text-muted-foreground">{helper}</p>
        </div>
        <div className="rounded-full border border-input bg-muted/40 px-3 py-1 text-xs font-medium text-foreground">
          {total} pts
        </div>
      </div>

      <div className="mt-4">
        <div className="grid grid-cols-2 gap-2">
          <Button type="button" variant="outline" className="h-11 rounded-xl" onClick={() => onAdjust('ones', -1)}>-1</Button>
          <Button type="button" className="h-11 rounded-xl" onClick={() => onAdjust('ones', 1)}>+1</Button>
          <Button type="button" variant="outline" className="h-11 rounded-xl" onClick={() => onAdjust('fives', -1)}>-5</Button>
          <Button type="button" className="h-11 rounded-xl" onClick={() => onAdjust('fives', 1)}>+5</Button>
        </div>
      </div>
    </div>
  );
}

function RatingSlider({ label, value, onChange }) {
  const filledPercent = ((Number(value) - 1) / 4) * 100;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-sm text-muted-foreground">{label}</label>
        <span className="rounded-md border border-input bg-card px-2 py-0.5 text-xs font-semibold text-foreground">{value}/5</span>
      </div>
      <input
        type="range"
        min="1"
        max="5"
        step="1"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="rating-slider h-11 w-full cursor-pointer rounded-xl border border-input px-3"
        style={{
          background: `linear-gradient(to right, hsl(var(--foreground)) 0%, hsl(var(--foreground)) ${filledPercent}%, hsl(var(--muted)) ${filledPercent}%, hsl(var(--muted)) 100%)`
        }}
      />
      <div className="flex justify-between px-1 text-[11px] text-muted-foreground">
        <span>1</span>
        <span>5</span>
      </div>
    </div>
  );
}

export default function MatchTabletPage() {
  const [form, setForm] = useState(initial);
  const [scores, setScores] = useState(createInitialScoreState);
  const [competitions, setCompetitions] = useState([]);
  const [selectedCompetition, setSelectedCompetition] = useState(null);
  const [competitionYear, setCompetitionYear] = useState(DEFAULT_COMPETITION_YEAR);
  const [competitionLoading, setCompetitionLoading] = useState(false);
  const [competitionError, setCompetitionError] = useState('');
  const [competitionSearch, setCompetitionSearch] = useState('');
  const [message, setMessage] = useState('');
  const [offlinePayload, setOfflinePayload] = useState('');
  const [pendingCount, setPendingCount] = useState(() => {
    const raw = localStorage.getItem('tablet-pending-reports');
    if (!raw) return 0;
    try {
      return JSON.parse(raw).length;
    } catch {
      return 0;
    }
  });

  const selectedEventKey = String(selectedCompetition?.eventKey || form.eventKey || DEFAULT_EVENT_KEY).trim() || DEFAULT_EVENT_KEY;
  const suggestedMatchKey = deriveMatchKey(selectedEventKey, parseNumberOr(form.matchNum, 1));

  const competitionOptions = useMemo(() => {
    const currentOptions = Array.isArray(competitions) ? competitions : [];
    const activeCompetition = selectedCompetition?.eventKey && !currentOptions.some((competition) => competition.eventKey === selectedCompetition.eventKey)
      ? selectedCompetition
      : null;
    if (currentOptions.length || activeCompetition) return activeCompetition ? [activeCompetition, ...currentOptions] : currentOptions;
    return [{
      eventKey: selectedEventKey,
      name: selectedCompetition?.name || DEFAULT_COMPETITION_QUERY,
      shortName: selectedCompetition?.shortName || DEFAULT_COMPETITION_QUERY,
      year: competitionYear
    }];
  }, [competitions, competitionYear, selectedCompetition?.name, selectedCompetition?.shortName, selectedEventKey]);

  const filteredCompetitionOptions = useMemo(() => (
    competitionOptions
      .filter((competition) => String(competition?.eventKey || '').trim())
      .filter((competition) => searchMatchesCompetition(competition, competitionSearch))
      .sort((a, b) => getCompetitionSearchRank(a, competitionSearch) - getCompetitionSearchRank(b, competitionSearch))
  ), [competitionOptions, competitionSearch]);

  const selectedEventValue = String(selectedEventKey || '').trim() || undefined;

  const phaseTotals = useMemo(() => computePhaseTotals(scores), [scores]);

  const totalPoints = phaseTotals.autonomous + phaseTotals.teleop + phaseTotals.endgame;

  const setField = (field, value) => setForm((prev) => ({ ...prev, [field]: value }));

  const setNumericField = (field, rawValue) => {
    if (rawValue === '') {
      setField(field, '');
      return;
    }
    const parsed = Number(rawValue);
    if (Number.isFinite(parsed)) {
      setField(field, parsed);
    }
  };

  const selectCompetition = (competition) => {
    const nextCompetition = competition || null;
    setSelectedCompetition(nextCompetition);
    setCompetitionYear(Number(nextCompetition?.year || DEFAULT_COMPETITION_YEAR));
    if (nextCompetition?.eventKey) {
      setField('eventKey', nextCompetition.eventKey);
    }
    setCompetitionSearch(String(nextCompetition?.name || nextCompetition?.shortName || nextCompetition?.eventKey || ''));
  };

  const handleCompetitionSelected = async (nextCompetition) => {
    if (!nextCompetition?.eventKey) return;
    selectCompetition(nextCompetition);
    try {
      await syncSelectedCompetition({
        eventKey: nextCompetition.eventKey,
        name: nextCompetition.name || nextCompetition.shortName || nextCompetition.eventKey,
        shortName: nextCompetition.shortName || nextCompetition.name || nextCompetition.eventKey,
        year: Number(nextCompetition.year || competitionYear),
        matchKey: deriveMatchKey(nextCompetition.eventKey, parseNumberOr(form.matchNum, 1))
      });
    } catch {
      // Keep the local selection even if the shared update fails.
    }
  };

  const adjustScore = (phase, field, delta) => {
    setScores((prev) => ({
      ...prev,
      [phase]: {
        ...prev[phase],
        [field]: Math.max(0, prev[phase][field] + delta)
      }
    }));
  };

  const resetScores = () => setScores(createInitialScoreState());

  const syncSelectedCompetition = async (competition) => {
    const response = await fetch(`${API_BASE}/api/strategy/selected-event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(competition)
    });
    const data = await readJsonIfAvailable(response);
    if (!response.ok) {
      throw new Error(data?.errorCode ? `${data.errorCode}: ${data.error || 'Failed saving competition'}` : (data?.error || 'Failed saving competition'));
    }
    return data;
  };

  useEffect(() => {
    const normalizedSearch = normalizeCompetitionText(competitionSearch).trim();
    if (normalizedSearch !== 'dcmp') return;
    const topMatch = filteredCompetitionOptions[0];
    if (!topMatch?.eventKey || String(topMatch.eventKey) === String(selectedEventKey)) return;
    void handleCompetitionSelected(topMatch);
  }, [competitionSearch, filteredCompetitionOptions, selectedEventKey]);

  useEffect(() => {
    const loadCompetitionList = async () => {
      setCompetitionLoading(true);
      try {
        const response = await fetch(`${API_BASE}/api/strategy/competitions?year=${DEFAULT_COMPETITION_YEAR}`);
        const data = await readJsonIfAvailable(response);
        if (!response.ok) {
          throw new Error(data?.errorCode ? `${data.errorCode}: ${data.error || 'Failed loading competitions'}` : (data?.error || 'Failed loading competitions'));
        }
        if (!data) {
          throw new Error('Competition endpoint returned non-JSON response');
        }
        const nextCompetitions = Array.isArray(data.competitions) ? data.competitions : [];
        setCompetitions(nextCompetitions);

        const selectedFromServer = data?.selectedCompetition?.eventKey
          ? nextCompetitions.find((competition) => competition.eventKey === data.selectedCompetition.eventKey) || data.selectedCompetition
          : null;
        const preferredCompetition = selectedFromServer || findDefaultCompetition(nextCompetitions);

        if (preferredCompetition) {
          selectCompetition(preferredCompetition);
        } else {
          selectCompetition({
            eventKey: DEFAULT_EVENT_KEY,
            name: DEFAULT_COMPETITION_QUERY,
            shortName: DEFAULT_COMPETITION_QUERY,
            year: DEFAULT_COMPETITION_YEAR
          });
        }
      } catch (error) {
        setCompetitionError(error.message || 'Failed loading competitions');
        selectCompetition({
          eventKey: DEFAULT_EVENT_KEY,
          name: DEFAULT_COMPETITION_QUERY,
          shortName: DEFAULT_COMPETITION_QUERY,
          year: DEFAULT_COMPETITION_YEAR
        });
      } finally {
        setCompetitionLoading(false);
      }
    };

    loadCompetitionList();
  }, []);

  const queueOffline = (payload) => {
    const raw = localStorage.getItem('tablet-pending-reports');
    const current = raw ? JSON.parse(raw) : [];
    current.push(payload);
    localStorage.setItem('tablet-pending-reports', JSON.stringify(current));
    setPendingCount(current.length);
    return current;
  };

  const submit = async (event) => {
    event.preventDefault();
    const payload = buildPayloadFromForm(form, scores, selectedCompetition);

    try {
      setMessage('Submitting...');
      const response = await fetch(`${API_BASE}/api/scouting/match`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await response.json();
      if (!response.ok) {
        setMessage(data.error || 'Failed to submit');
        return;
      }

      setMessage(`Saved report #${data.report.id} (confidence ${data.ai.confidence_score})`);
    } catch {
      queueOffline(payload);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      setMessage('Match saved. Download to JSON and send to Pranav as soon as your shift ends. Scroll to top and get ready for the next match.');
    }
  };

  const buildOfflinePayload = () => {
    const raw = localStorage.getItem('tablet-pending-reports');
    const current = raw ? JSON.parse(raw) : [];
    if (!current.length) {
      setMessage('No pending offline reports.');
      setOfflinePayload('');
      return;
    }

    setOfflinePayload(JSON.stringify({
      eventKey: form.eventKey,
      createdAt: new Date().toISOString(),
      reports: current
    }, null, 2));
    setMessage(`Offline batch ready (${current.length} reports). Download JSON and DM it.`);
  };

  const downloadOfflinePayload = () => {
    const raw = localStorage.getItem('tablet-pending-reports');
    const current = raw ? JSON.parse(raw) : [];
    if (!current.length) {
      setMessage('No pending offline reports to download.');
      return;
    }

    const exportData = {
      eventKey: form.eventKey,
      createdAt: new Date().toISOString(),
      reports: current
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const filename = `scouting-offline-${form.eventKey}-${Date.now()}.json`;
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    setMessage(`Downloaded ${filename}. Send this file to your aggregator laptop.`);
  };

  const clearOfflinePayload = () => {
    localStorage.removeItem('tablet-pending-reports');
    setPendingCount(0);
    setOfflinePayload('');
    setMessage('Cleared local offline queue.');
  };

  return (
    <main className="mx-auto min-h-screen max-w-6xl space-y-6 p-4 sm:p-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Match Scouting Control Panel</CardTitle>
          <CardDescription>Track one robot per match and submit fast, structured observations.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2 text-xs">
          <Badge className="border border-input bg-background text-foreground">Event {selectedEventKey}</Badge>
          <Badge className="border border-input bg-background text-foreground">Year {competitionYear}</Badge>
          <Badge className="border border-input bg-background text-foreground">Match Key {suggestedMatchKey}</Badge>
          <Badge className="border border-input bg-background text-foreground">Pending Offline: {pendingCount}</Badge>
          <Badge className="border border-input bg-background text-foreground">Backend {API_BASE ? 'Configured' : 'E_BACKEND_ENDPOINT_UNSET'}</Badge>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="mb-2 flex items-center gap-2">
            <Joystick className="h-5 w-5 text-foreground" />
            <Badge>Tablet Scouting</Badge>
          </div>
          <CardTitle>Team 3749 Tablet Scouting Form</CardTitle>
          <CardDescription>Fuel is intentionally not tracked in this form. Fuel scouting data is handled by external import.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="mb-2 flex flex-col gap-2 rounded-md border border-input p-3 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
            <span>Offline pending reports: {pendingCount}</span>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={buildOfflinePayload}>Generate Offline Batch</Button>
              <Button type="button" variant="outline" onClick={downloadOfflinePayload}>Download JSON</Button>
              <Button type="button" variant="secondary" onClick={clearOfflinePayload}>Clear Queue</Button>
            </div>
          </div>

          <div className="rounded-3xl border border-input bg-background p-4 shadow-sm sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold text-foreground">Competition Picker</h3>
                <p className="mt-1 text-sm text-muted-foreground">Choose a Blue Alliance competition and the event key, year, and match key fill in automatically.</p>
              </div>
              <Badge className="border border-input bg-muted/40 text-foreground">
                {competitionLoading ? 'Loading TBA competitions...' : 'Blue Alliance'}
              </Badge>
            </div>

            {competitionError ? (
              <p className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
                {competitionError}
              </p>
            ) : null}

            <div className="mt-4 space-y-2">
              <label className="text-sm text-muted-foreground">Competition name</label>
              <Input
                className="h-11 rounded-xl"
                placeholder="Search competition (e.g. dcmp or Qualcomm)"
                value={competitionSearch}
                onChange={(e) => setCompetitionSearch(e.target.value)}
                onKeyDown={async (e) => {
                  if (e.key !== 'Enter') return;
                  e.preventDefault();
                  const topMatch = filteredCompetitionOptions[0];
                  if (!topMatch) return;
                  await handleCompetitionSelected(topMatch);
                }}
              />
              <Select value={selectedEventValue} onValueChange={async (value) => {
                const nextCompetition = competitionOptions.find((competition) => competition.eventKey === value) || {
                  eventKey: value,
                  name: value,
                  shortName: value,
                  year: competitionYear
                };

                await handleCompetitionSelected(nextCompetition);
              }}>
                <SelectTrigger className="h-11 rounded-xl">
                  <SelectValue placeholder="Select competition" />
                </SelectTrigger>
                <SelectContent>
                  {filteredCompetitionOptions.map((option) => (
                    <SelectItem key={option.eventKey} value={option.eventKey}>
                      {option.name || option.shortName || option.eventKey}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <div className="space-y-2">
                <label className="text-sm text-muted-foreground">Event key</label>
                <Input className="h-11 rounded-xl bg-muted/40" value={selectedEventKey} readOnly />
              </div>
              <div className="space-y-2">
                <label className="text-sm text-muted-foreground">Event year</label>
                <Input className="h-11 rounded-xl bg-muted/40" value={competitionYear} readOnly />
              </div>
              <div className="space-y-2">
                <label className="text-sm text-muted-foreground">Match key</label>
                <Input className="h-11 rounded-xl bg-muted/40" value={suggestedMatchKey} readOnly />
              </div>
            </div>
          </div>

          <div className="rounded-3xl border border-input bg-muted/20 p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <Calculator className="h-5 w-5 text-foreground" />
                  <h3 className="text-base font-semibold text-foreground">Quick Point Counter</h3>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">Tap +1 or +5 as the match unfolds. Totals update instantly.</p>
              </div>
              <Button type="button" variant="outline" className="gap-2 rounded-xl" onClick={resetScores}>
                <RotateCcw className="h-4 w-4" />Reset all
              </Button>
            </div>

            <div className="mt-4 grid gap-3 lg:grid-cols-3">
              {PHASE_CONFIG.map((phase) => (
                <ScoreTracker
                  key={phase.key}
                  label={phase.label}
                  helper={phase.helper}
                  value={scores[phase.key]}
                  total={phaseTotals[phase.key]}
                  onAdjust={(field, delta) => adjustScore(phase.key, field, delta)}
                />
              ))}
            </div>

            <div className="mt-4 flex flex-col gap-2 rounded-2xl border border-input bg-background px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <span className="text-sm font-medium text-foreground">Total match points</span>
              <div className="text-3xl font-semibold tracking-tight text-foreground">{totalPoints}</div>
            </div>
          </div>

          <form onSubmit={submit} className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-2"><label className="text-sm text-muted-foreground">Your name</label><Input className="h-11" value={form.scoutName} onChange={(e) => setField('scoutName', e.target.value)} /></div>
            <div className="space-y-2"><label className="text-sm text-muted-foreground">Match Num</label><Input className="h-11" type="number" value={form.matchNum} onChange={(e) => setNumericField('matchNum', e.target.value)} /></div>
            <div className="space-y-2"><label className="text-sm text-muted-foreground">Team Number You Are Scouting</label><Input className="h-11" type="number" value={form.teamNumber} onChange={(e) => setNumericField('teamNumber', e.target.value)} /></div>
            <div className="space-y-2"><label className="text-sm text-muted-foreground">Starting Position (1 left, 3 right)</label><Input className="h-11" value={form.startingPosition} onChange={(e) => setField('startingPosition', e.target.value)} placeholder="1/2/3" /></div>
            <div className="space-y-2"><label className="text-sm text-muted-foreground">Describe The Auto Path</label><Input className="h-11" value={form.autoPath} onChange={(e) => setField('autoPath', e.target.value)} /></div>
            <div className="space-y-2">
              <label className="text-sm text-muted-foreground">Did they cross center line for auto?</label>
              <Select value={form.crossedCenterLine} onValueChange={(value) => setField('crossedCenterLine', value)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="yes">Yes</SelectItem>
                  <SelectItem value="no">No</SelectItem>
                  <SelectItem value="maybe">Maybe</SelectItem>
                  <SelectItem value="idk">IDK</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm text-muted-foreground">Auto Climb</label>
              <Select value={form.autoClimb} onValueChange={(value) => setField('autoClimb', value)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select climb" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  <SelectItem value="l1">L1</SelectItem>
                  <SelectItem value="l2">L2</SelectItem>
                  <SelectItem value="l3">L3</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2"><label className="text-sm text-muted-foreground">How many cycles</label><Input className="h-11" type="number" value={form.cycles} onChange={(e) => setNumericField('cycles', e.target.value)} /></div>
            <RatingSlider
              label="Cycle accuracy"
              value={form.cycleAccuracy}
              onChange={(value) => setField('cycleAccuracy', value)}
            />
            <div className="space-y-2"><label className="text-sm text-muted-foreground">Addtional Cycle Notes</label><Input className="h-11" value={form.cycleNotes} onChange={(e) => setField('cycleNotes', e.target.value)} /></div>
            <div className="space-y-2">
              <label className="text-sm text-muted-foreground">Climb</label>
              <Select value={form.climb} onValueChange={(value) => setField('climb', value)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select climb" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  <SelectItem value="l1">L1</SelectItem>
                  <SelectItem value="l2">L2</SelectItem>
                  <SelectItem value="l3">L3</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm text-muted-foreground">Ground Intake or Outpost Intake</label>
              <Select value={form.intakeType} onValueChange={(value) => setField('intakeType', value)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select intake" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ground">Ground</SelectItem>
                  <SelectItem value="outpost">Outpost</SelectItem>
                  <SelectItem value="idk">IDK</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm text-muted-foreground">Are they using depot?</label>
              <Select value={form.usingDepot} onValueChange={(value) => setField('usingDepot', value)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="yes">Yes</SelectItem>
                  <SelectItem value="no">No</SelectItem>
                  <SelectItem value="idk">IDK</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm text-muted-foreground">Using Trench?</label>
              <Select value={form.usingTrench} onValueChange={(value) => setField('usingTrench', value)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="yes">Yes</SelectItem>
                  <SelectItem value="no">No</SelectItem>
                  <SelectItem value="idk">IDK</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm text-muted-foreground">Using Bump?</label>
              <Select value={form.usingBump} onValueChange={(value) => setField('usingBump', value)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="yes">Yes</SelectItem>
                  <SelectItem value="no">No</SelectItem>
                  <SelectItem value="idk">IDK</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm text-muted-foreground">Are they Passing?</label>
              <Select value={form.passing} onValueChange={(value) => setField('passing', value)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="yes">Yes</SelectItem>
                  <SelectItem value="no">No</SelectItem>
                  <SelectItem value="idk">IDK</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2"><label className="text-sm text-muted-foreground">Things they did wrong (penalties)</label><Input className="h-11" value={form.penalties} onChange={(e) => setField('penalties', e.target.value)} /></div>
            <div className="space-y-2"><label className="text-sm text-muted-foreground">Additional Notes?</label><Input className="h-11" value={form.additionalNotes} onChange={(e) => setField('additionalNotes', e.target.value)} /></div>
            <div className="sticky bottom-0 z-10 -mx-1 border-t border-input bg-background/95 p-2 backdrop-blur sm:col-span-2 lg:col-span-3">
              <Button variant="outline" type="submit" className="h-12 w-full gap-2 rounded-xl border-input bg-card text-base text-foreground shadow-none hover:bg-accent"><Save className="h-4 w-4" />Submit Match Report</Button>
            </div>
          </form>

          {offlinePayload ? (
            <div className="mt-4 space-y-2">
              <label className="text-sm text-muted-foreground">Offline Batch Payload (copy this)</label>
              <textarea className="min-h-32 w-full rounded-md border border-input bg-background p-3 text-xs" value={offlinePayload} readOnly />
            </div>
          ) : null}

          {message ? <p className="mt-4 text-sm text-muted-foreground">{message}</p> : null}
        </CardContent>
      </Card>

      <footer className="pb-3 text-center text-xs text-muted-foreground">
        Made by SanPranav © 2026
      </footer>

    </main>
  );
}
