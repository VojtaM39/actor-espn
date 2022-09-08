import { createHttpRouter } from 'crawlee';
import { Actor } from 'apify';
import { Labels, Leagues, ResultTypes, ScoreboardResponse, Sports, StandingsResponse } from './types.js';
import { getDatesBetween } from './tools/generic.js';
import { getScoreboardUrl } from './tools/url.js';
import { getCompetitionData } from './tools/extractors.js';

export const router = createHttpRouter();

/**
 * Route calls standings endpoint and gathers start and end dates for each season.
 * Then enqueues all scoreboard URLs.
 */
router.addHandler(Labels.ScoreDates, async ({ crawler, request, log, json }) => {
    log.info(`${request.label}: Parsing standings response - ${request.loadedUrl}`);
    const response = json as StandingsResponse;
    const { seasons, seasonTypes, sport, league } = request.userData;

    // Each year contains four seasons, pre-season, regular season, post-season and off-season
    const filteredYears = response.seasons.filter((season) => seasons.includes(season.year));

    const allSeasons = [];
    for (const year of filteredYears) {
        for (const season of year.types) {
            if (!seasonTypes.includes(season.abbreviation)) continue;

            allSeasons.push({
                startDate: season.startDate,
                endDate: season.endDate,
                type: season.abbreviation,
                year: year.year,
                sport,
                league,
            });
        }
    }

    // Enqueue scoreboard requests for each day of each season
    allSeasons.forEach((season) => {
        const { startDate, endDate } = season;
        const days = getDatesBetween(startDate, endDate);

        // Add each day to request queue
        days.forEach((day) => {
            crawler.requestQueue?.addRequest({
                url: getScoreboardUrl(Sports.Baseball, Leagues.MLB, day),
                userData: {
                    year: season.year,
                    type: season.type,
                    label: Labels.ScoreBoard,
                    sport,
                    league,
                },
            });
        });
    });
});

/**
 * Route calls scoreboard endpoint and saves to default dataset all matches of this day
 */
router.addHandler(Labels.ScoreBoard, async ({ json, log, request }) => {
    log.info(`${request.label}: Parsing one day scoreboard - ${request.url}`);
    const response = json as ScoreboardResponse;
    const { year, type, sport, league } = request.userData;
    for (const event of response.events) {
        if (event.competitions.length === 0) continue;

        const competition = event.competitions[0];
        const competitionData = getCompetitionData(competition);
        await Actor.pushData({
            ...competitionData,
            sport,
            league,
            season: year,
            seasonType: type,
            url: request.loadedUrl,
            resultType: ResultTypes.MatchList,
        });
    }
});
