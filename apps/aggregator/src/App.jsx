import { useEffect, useMemo, useState } from 'react';
import { Database, FileUp, Upload } from 'lucide-react';
import { Button } from './components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './components/ui/card';
import { Input } from './components/ui/input';
import { Badge } from './components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './components/ui/table';

const API_BASE = import.meta.env.VITE_API_BASE || '';

export default function App() {
  const [eventKey, setEventKey] = useState('2026casnd');
  const [matchKey, setMatchKey] = useState('qm24');
  const [rows, setRows] = useState([]);
  const [message, setMessage] = useState('');
  const [pasteText, setPasteText] = useState('');
  const [predictionMessage, setPredictionMessage] = useState('');
  const [teamSearch, setTeamSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingLabel, setLoadingLabel] = useState('Loading data...');
  const [loadingProgress, setLoadingProgress] = useState(0);

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
      return `${sourceLabel}: Imported ${data.imported} scouting rows${errorPart}`;
    }
    if (data.importedMatches !== undefined) {
      return `${sourceLabel}: Imported ${data.importedMatches} matches from ${data.type}`;
    }
    if (data.importedTeams !== undefined) {
      return `${sourceLabel}: Imported ${data.importedTeams} team OPR rows`;
    }
    return `${sourceLabel}: Import completed`;
  };

  const load = async ({ silent = false, progressBase = 0, progressSpan = 100 } = {}) => {
    if (!silent) startLoading('Loading event data...');
    try {
      const { response, data } = await fetchJsonWithProgress(
        `${API_BASE}/api/strategy/stats/${eventKey}`,
        {},
        {
          base: progressBase,
          span: progressSpan,
          label: 'Loading event data...',
          trackProgress: true
        }
      );
      if (!response.ok) {
        setMessage(data.error || 'Failed loading stats');
        return;
      }
      setRows(Array.isArray(data) ? data : []);
    } catch {
      setMessage('Server unreachable. Start backend on http://localhost:2540.');
    } finally {
      if (!silent) stopLoading();
    }
  };

  const runScrapeJob = async ({ startUrl, loadingText, initialMessage, completedMessage }) => {
    startLoading(loadingText);
    try {
      setMessage(initialMessage);

      const startResponse = await fetch(startUrl, { method: 'POST' });
      const started = await startResponse.json();
      if (!startResponse.ok || !started?.jobId) {
        setMessage(started.error || 'Failed to start scrape job');
        return;
      }

      let job = null;
      while (true) {
        const progressResponse = await fetch(`${API_BASE}/api/sync/scrape/job/${started.jobId}`);
        const progressData = await progressResponse.json();

        if (!progressResponse.ok) {
          setMessage(progressData.error || 'Failed to fetch scrape progress');
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
          setMessage(job.error || 'Scrape job failed');
          return;
        }

        await sleep(350);
      }

      setLoadingLabel('Refreshing stats...');
      setLoadingProgress(100);
      await load({ silent: true, progressBase: 0, progressSpan: 100 });
      setMessage(completedMessage(job));
    } catch {
      setMessage('Server unreachable. Start backend on http://localhost:2540.');
    } finally {
      stopLoading();
    }
  };

  const scrape = async () => {
    await runScrapeJob({
      startUrl: `${API_BASE}/api/sync/scrape/${eventKey}/job`,
      loadingText: 'Scraping and syncing data...',
      initialMessage: 'Starting scrape for this event...',
      completedMessage: (job) => `Imported ${job.importedRows || 0} rows (${job.processedRows || 0}/${job.totalRows || 0})`
    });
  };

  const scrapeAll = async () => {
    await runScrapeJob({
      startUrl: `${API_BASE}/api/sync/scrape-all/job`,
      loadingText: 'Scraping all events...',
      initialMessage: 'Starting global scrape job...',
      completedMessage: (job) => `Global scrape imported ${job.importedRows || 0} rows into ${job.eventKey}`
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
      setMessage('Server unreachable. Start backend on http://localhost:2540.');
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
      setPredictionMessage('Server unreachable. Start backend on http://localhost:2540.');
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

      setMessage(`Imported ${data.imported} offline tablet reports`);
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

      setMessage(`Imported ${data.imported} offline tablet reports from ${file.name}`);
      await load({ silent: true, progressBase: 75, progressSpan: 25 });
    } catch {
      setMessage('Could not read JSON file.');
    } finally {
      event.target.value = '';
      stopLoading();
    }
  };

  useEffect(() => {
    load();
  }, []);

  return (
    <main className="mx-auto min-h-screen max-w-7xl space-y-8 p-6">
      <Card>
        <CardHeader>
          <div className="mb-2 flex items-center gap-2">
            <Database className="h-5 w-5 text-foreground" />
            <Badge>Aggregator</Badge>
          </div>
          <CardTitle>Event Aggregation Console</CardTitle>
          <CardDescription>Paste CSV or JSON in the box below and click AI Import Paste. Auto-detect supports schedule, flat schedule, OPRs, scouting CSV, and offline tablet batch JSON across competitions. Statbotics EPA fields are auto-enriched on team stats load.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input value={eventKey} onChange={(e) => setEventKey(e.target.value)} placeholder="event key (e.g. 2026casnd)" />
            <Input value={matchKey} onChange={(e) => setMatchKey(e.target.value)} placeholder="match (e.g. qm24 or 24)" />
            <Button onClick={load}>Load Stats</Button>
            <Button variant="secondary" onClick={scrape}>Scrape 2485</Button>
            <Button variant="outline" onClick={scrapeAll}>Scrape All 2485</Button>
          </div>

          <Input
            value={teamSearch}
            onChange={(e) => setTeamSearch(e.target.value)}
            placeholder="Search team(s): 3749 or 3749, 254, 1678"
          />

          <div className="space-y-2">
            <label className="text-sm text-muted-foreground">Paste schedule, flat schedule, component OPRs, scouting CSV, or offline tablet JSON</label>
            <textarea
              className="min-h-36 w-full rounded-md border border-input bg-background p-3 text-sm"
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              placeholder="Paste CSV or offline JSON payload here"
            />
            <div className="flex flex-wrap gap-2">
              <Button className="gap-2" onClick={importPaste}><Upload className="h-4 w-4" />AI Import Paste</Button>
              <Button variant="secondary" onClick={importScheduleAndPredict}>Import Schedule + Predict Match</Button>
              <Button variant="outline" onClick={importOfflineBatch}>Import Offline Tablet Batch</Button>
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-input px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground">
                <FileUp className="h-4 w-4" />
                Import CSV File
                <input type="file" accept=".csv,text/csv" className="hidden" onChange={importCsvFile} />
              </label>
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

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Team</TableHead>
                <TableHead>Matches</TableHead>
                <TableHead>EPA</TableHead>
                <TableHead>Auto EPA</TableHead>
                <TableHead>Tele EPA</TableHead>
                <TableHead>Endgame EPA</TableHead>
                <TableHead>Auto</TableHead>
                <TableHead>Teleop</TableHead>
                <TableHead>Defense</TableHead>
                <TableHead>Cycle</TableHead>
                <TableHead>Endgame</TableHead>
                <TableHead>Trench/Bumper</TableHead>
                <TableHead>Reliability</TableHead>
                <TableHead>Disable%</TableHead>
                <TableHead>Foul Rate</TableHead>
                <TableHead>Climb %</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredRows.map((row) => (
                <TableRow key={`${row.eventKey}-${row.teamNumber}`}>
                  <TableCell>{row.teamNumber}</TableCell>
                  <TableCell>{row.matchesScouted}</TableCell>
                  <TableCell>{row.statbotics ? Number(row.statbotics.epa || 0).toFixed(2) : '—'}</TableCell>
                  <TableCell>{row.statbotics ? Number(row.statbotics.autoEPA || 0).toFixed(2) : '—'}</TableCell>
                  <TableCell>{row.statbotics ? Number(row.statbotics.teleopEPA || 0).toFixed(2) : '—'}</TableCell>
                  <TableCell>{row.statbotics ? Number(row.statbotics.endgameEPA || 0).toFixed(2) : '—'}</TableCell>
                  <TableCell>{Number(row.spiderAuto || 0).toFixed(1)}</TableCell>
                  <TableCell>{Number(row.spiderTeleop || 0).toFixed(1)}</TableCell>
                  <TableCell>{Number(row.spiderDefense || 0).toFixed(1)}</TableCell>
                  <TableCell>{Number(row.spiderCycleSpeed || 0).toFixed(1)}</TableCell>
                  <TableCell>{Number(row.spiderEndgame || 0).toFixed(1)}</TableCell>
                  <TableCell>
                    {row.movementProfile === 'both'
                      ? 'Both'
                      : row.movementProfile === 'trench'
                        ? 'Trench'
                        : row.movementProfile === 'bumper'
                          ? 'Bumper'
                          : '—'}
                  </TableCell>
                  <TableCell>{Number(row.spiderReliability || 0).toFixed(1)}</TableCell>
                  <TableCell>{(Number(row.disableRate || 0) * 100).toFixed(1)}</TableCell>
                  <TableCell>{Number(row.foulRate || 0).toFixed(2)}</TableCell>
                  <TableCell>{(Number(row.climbSuccessRate || 0) * 100).toFixed(1)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <footer className="pb-3 text-center text-xs text-muted-foreground">
        Made by SanPranav © 2026
      </footer>
    </main>
  );
}
