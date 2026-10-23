import mongoose from 'mongoose';
import { XpEvent, UserReward, Mastery } from '../../models/index.js';

/**
 * Rewards reward LEARNING, not screen time: XP comes only from answered/correct work and improvement,
 * every award is idempotent per (source, refId), replays only earn XP for beating a previous best,
 * and there is a daily cap. Duration never earns XP.
 */
export const DAILY_XP_CAP = 300;
export const levelFor = (xp: number) => Math.floor(Math.sqrt(xp / 50)) + 1;
export const today = (d = new Date()) => d.toISOString().slice(0, 10);
const prevDay = (day: string) => today(new Date(Date.parse(day) - 86400000));
export const BADGES: Record<string, { name: string; description: string }> = {
  first_steps: { name: 'First steps', description: 'Completed your first practice or game' },
  perfect_score: { name: 'Perfect score', description: 'Scored 100% on a set of 5 or more questions' },
  streak_3: { name: '3-day streak', description: 'Learned on 3 days in a row' },
  streak_7: { name: 'Week of learning', description: 'Learned on 7 days in a row' },
  topic_master: { name: 'Topic master', description: 'Reached 80% mastery in a topic (10+ answers)' },
  improver: { name: 'Improver', description: 'Improved a score by 20 points or more on a retry' },
  game_explorer: { name: 'Game explorer', description: 'Finished 5 different kinds of learning game' },
  reviewer: { name: 'Reflective learner', description: 'Completed a remedial (revision) set' },
};
export async function awardXp(a: { userId: string; schoolId?: string; subjectId?: string; source: string; refId: string; xp: number; reason: string; qualifies: boolean }) {
  const day = today();
  const used = (await XpEvent.aggregate([{ $match: { userId: new mongoose.Types.ObjectId(a.userId), day } }, { $group: { _id: null, t: { $sum: '$xp' } } }]))[0]?.t ?? 0;
  const xp = Math.max(0, Math.min(Math.round(a.xp), DAILY_XP_CAP - used));
  try { await XpEvent.create({ ...a, xp, day }); } catch (e: any) { if (e.code === 11000) return { xp: 0, duplicate: true, newBadges: [] as string[] }; throw e; }
  const r = (await UserReward.findOne({ userId: a.userId })) ?? new UserReward({ userId: a.userId });
  r.xp += xp; r.level = levelFor(r.xp);
  if (a.qualifies && r.streak!.lastDay !== day) { r.streak!.current = r.streak!.lastDay === prevDay(day) ? r.streak!.current + 1 : 1; r.streak!.lastDay = day; r.streak!.longest = Math.max(r.streak!.longest, r.streak!.current); }
  await r.save();
  const newBadges: string[] = [];
  if (a.qualifies) newBadges.push('first_steps');
  if (r.streak!.current >= 3) newBadges.push('streak_3'); if (r.streak!.current >= 7) newBadges.push('streak_7');
  return { xp, duplicate: false, newBadges: await grantBadges(a.userId, newBadges) };
}
export async function grantBadges(userId: string, keys: string[]) {
  const r = (await UserReward.findOne({ userId })) ?? new UserReward({ userId }); const have = new Set(r.badges.map((b: any) => b.key));
  const add = [...new Set(keys)].filter((k) => BADGES[k] && !have.has(k)); if (!add.length) return [];
  r.badges.push(...add.map((key) => ({ key, at: new Date() }))); await r.save(); return add;
}
export async function updateMastery(userId: string, subjectId: string, topic: string, frac: number) {
  if (!topic) return null; const m = (await Mastery.findOne({ userId, subjectId, topic })) ?? new Mastery({ userId, subjectId, topic });
  m.score = m.answered ? 0.7 * m.score + 0.3 * frac : frac; m.answered += 1; if (frac >= 0.999) m.correct += 1; m.lastAt = new Date();
  m.history.push({ at: new Date(), frac }); if (m.history.length > 20) m.history.splice(0, m.history.length - 20);
  await m.save(); if (m.score >= 0.8 && m.answered >= 10) await grantBadges(userId, ['topic_master']); return m;
}
