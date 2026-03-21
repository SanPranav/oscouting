import { prisma } from '@3749/db/src/client.js';

const TBA_BASE = 'https://www.thebluealliance.com/api/v3';

const tba = async (path) => {
  const key = process.env.TBA_API_KEY;
  if (!key) throw new Error('TBA_API_KEY missing');
  const response = await fetch(`${TBA_BASE}${path}`, {
    headers: { 'X-TBA-Auth-Key': key }
  });
  if (!response.ok) throw new Error(`TBA request failed: ${response.status}`);
  return response.json();
};

export async function syncTbaEvent(eventKey) {
  const event = await tba(`/event/${eventKey}`);
  await prisma.event.upsert({
    where: { eventKey },
    update: {
      name: event.name,
      shortName: event.short_name,
      city: event.city,
      stateProv: event.state_prov,
      country: event.country,
      year: event.year,
      week: event.week,
      eventType: event.event_type,
      website: event.website,
      tbaSyncedAt: new Date()
    },
    create: {
      eventKey,
      name: event.name,
      shortName: event.short_name,
      city: event.city,
      stateProv: event.state_prov,
      country: event.country,
      year: event.year,
      week: event.week,
      eventType: event.event_type,
      website: event.website,
      tbaSyncedAt: new Date()
    }
  });

  const teams = await tba(`/event/${eventKey}/teams`);
  for (const team of teams) {
    await prisma.team.upsert({
      where: { teamNumber: team.team_number },
      update: {
        nickname: team.nickname,
        fullName: team.name,
        city: team.city,
        stateProv: team.state_prov,
        country: team.country,
        rookieYear: team.rookie_year
      },
      create: {
        teamNumber: team.team_number,
        nickname: team.nickname,
        fullName: team.name,
        city: team.city,
        stateProv: team.state_prov,
        country: team.country,
        rookieYear: team.rookie_year
      }
    });
  }

  const matches = await tba(`/event/${eventKey}/matches`);
  for (const match of matches) {
    await prisma.match.upsert({
      where: { matchKey: match.key },
      update: {
        compLevel: match.comp_level,
        matchNumber: match.match_number,
        setNumber: match.set_number,
        redTeam1: Number(match.alliances?.red?.team_keys?.[0]?.slice(3)) || null,
        redTeam2: Number(match.alliances?.red?.team_keys?.[1]?.slice(3)) || null,
        redTeam3: Number(match.alliances?.red?.team_keys?.[2]?.slice(3)) || null,
        blueTeam1: Number(match.alliances?.blue?.team_keys?.[0]?.slice(3)) || null,
        blueTeam2: Number(match.alliances?.blue?.team_keys?.[1]?.slice(3)) || null,
        blueTeam3: Number(match.alliances?.blue?.team_keys?.[2]?.slice(3)) || null,
        redScore: match.alliances?.red?.score ?? null,
        blueScore: match.alliances?.blue?.score ?? null,
        winningAlliance: match.winning_alliance || null,
        predictedTime: match.predicted_time ? new Date(match.predicted_time * 1000) : null,
        actualTime: match.actual_time ? new Date(match.actual_time * 1000) : null,
        tbaSyncedAt: new Date()
      },
      create: {
        matchKey: match.key,
        eventKey,
        compLevel: match.comp_level,
        matchNumber: match.match_number,
        setNumber: match.set_number,
        redTeam1: Number(match.alliances?.red?.team_keys?.[0]?.slice(3)) || null,
        redTeam2: Number(match.alliances?.red?.team_keys?.[1]?.slice(3)) || null,
        redTeam3: Number(match.alliances?.red?.team_keys?.[2]?.slice(3)) || null,
        blueTeam1: Number(match.alliances?.blue?.team_keys?.[0]?.slice(3)) || null,
        blueTeam2: Number(match.alliances?.blue?.team_keys?.[1]?.slice(3)) || null,
        blueTeam3: Number(match.alliances?.blue?.team_keys?.[2]?.slice(3)) || null,
        redScore: match.alliances?.red?.score ?? null,
        blueScore: match.alliances?.blue?.score ?? null,
        winningAlliance: match.winning_alliance || null,
        predictedTime: match.predicted_time ? new Date(match.predicted_time * 1000) : null,
        actualTime: match.actual_time ? new Date(match.actual_time * 1000) : null,
        tbaSyncedAt: new Date()
      }
    });
  }

  return { eventKey, teams: teams.length, matches: matches.length };
}
