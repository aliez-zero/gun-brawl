import { describe, expect, it } from 'vitest';
import {
  CAMPAIGN_LEVELS, campaignScore, createCampaignConfig, normalizeCampaignProgress,
} from '../src/content/campaign';
import { SaveStore } from '../src/storage/SaveStore';
import type { MatchResult } from '../src/game/core/types';

function memoryStorage(initial: string | null = null): { getItem(): string | null; setItem(key: string, value: string): void; removeItem(key: string): void } {
  let current = initial;
  return {
    getItem: () => current,
    setItem: (_key, value) => { current = value; },
    removeItem: () => { current = null; },
  };
}

function result(levelId: string, winner: string | null, id = `campaign-${levelId}-${winner}`): MatchResult {
  return {
    id, mode: 'campaign', campaignLevelId: levelId, winner, duration: 60, overtime: false,
    actors: [{ id: 'p1', name: '玩家 1', stocks: winner === 'p1' ? 1 : 0, knockouts: 2, falls: 0, selfFalls: 0 }],
  };
}

describe('T09 campaign progression', () => {
  it('defines six sequential levels with valid maps and configurations', () => {
    expect(CAMPAIGN_LEVELS).toHaveLength(6);
    expect(CAMPAIGN_LEVELS.map((level) => level.order)).toEqual([1, 2, 3, 4, 5, 6]);
    const config = createCampaignConfig(CAMPAIGN_LEVELS[4]!, 42, { matchId: 'campaign-match' });
    expect(config.mode).toBe('campaign');
    expect(config.campaignLevelId).toBe('level-5');
    const opponent = config.actors[1]!;
    expect('difficulty' in opponent ? opponent.difficulty : null).toBe('hard');
    expect(config.stocks).toBe(2);
    expect(config.duration).toBe(90);
    expect(config.dropMode).toBe('standard');
    expect(config.matchId).toBe('campaign-match');
  });

  it('unlocks only on a human win and keeps the best score', () => {
    const storage = memoryStorage();
    const store = new SaveStore(storage);
    expect(store.data.campaign.unlocked).toBe(1);
    expect(store.recordCampaignResult(result('level-1', 'bot'))).toBe(false);
    expect(store.recordCampaignResult(result('level-1', null))).toBe(false);
    expect(store.data.campaign.unlocked).toBe(1);

    expect(store.recordCampaignResult(result('level-1', 'p1', 'win-1'))).toBe(true);
    expect(store.data.campaign.unlocked).toBe(2);
    expect(store.data.campaign.completed).toContain('level-1');
    const firstBest = store.data.campaign.bestScores['level-1']!;
    expect(store.recordCampaignResult({ ...result('level-1', 'p1', 'win-2'), duration: 180 })).toBe(true);
    expect(store.data.campaign.bestScores['level-1']).toBe(firstBest);
    expect(store.data.recentResults).toContain('win-2');
    expect(new SaveStore(storage).data.campaign.unlocked).toBe(2);
  });

  it('does not count campaign wins in casual statistics or duplicate the same result', () => {
    const store = new SaveStore(memoryStorage());
    const win = result('level-1', 'p1', 'same-win');
    store.recordResult(win);
    expect(store.data.stats.completed).toBe(0);
    expect(store.recordCampaignResult(win)).toBe(true);
    expect(store.recordCampaignResult(win)).toBe(false);
    expect(store.data.stats.completed).toBe(0);
    expect(store.data.recentResults).toEqual(['same-win']);
  });

  it('scores wins only and normalizes damaged progress', () => {
    const win = { winner: 'p1', duration: 30, overtime: false, actors: [{ id: 'p1', name: 'P1', stocks: 1, knockouts: 1, falls: 0, selfFalls: 0 }] };
    expect(campaignScore(win)).toBeGreaterThan(10_000);
    expect(campaignScore({ ...win, winner: 'bot' })).toBe(0);
    expect(campaignScore({ ...win, winner: null })).toBe(0);
    expect(normalizeCampaignProgress({ unlocked: 99, bestScores: { 'level-1': 900, bad: 5 }, completed: ['level-1', 'bad', 'level-1'] }))
      .toEqual({ unlocked: 6, bestScores: { 'level-1': 900 }, completed: ['level-1'] });
    expect(normalizeCampaignProgress({ unlocked: -2 }).unlocked).toBe(1);
  });
});
