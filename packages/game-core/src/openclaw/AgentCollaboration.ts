/**
 * AgentCollaboration — Multi-agent coordination protocol.
 *
 * Handles how OpenClaw agents interact with each other:
 * - Trade resources between towns
 * - Share aesthetic DNA (art crossover)
 * - Collaborate on joint building projects
 * - Compete for territory and resources
 *
 * Agents discover each other based on proximity,
 * and their SocialDisposition determines how they interact.
 */

import type { OpenClawAgentComponent } from './OpenClawAgentComponent';
import type { InteractionMemory, TradeDesire, ArtDNA } from './types';
import { crossoverArtDNA } from './ArtDNA';
import { getCulturalTradeBonus } from './ArtEconomy';
import { ResourceType } from '../types/resources';

/** Distance threshold for agents to discover each other */
const DISCOVERY_RADIUS = 80;

/** Minimum positive interactions before art crossover is offered */
const CROSSOVER_TRUST_THRESHOLD = 3;

/**
 * Check if two agents are within discovery radius.
 */
export function areAgentsNearby(a: OpenClawAgentComponent, b: OpenClawAgentComponent): boolean {
  const dx = a.townPlan.centerX - b.townPlan.centerX;
  const dz = a.townPlan.centerZ - b.townPlan.centerZ;
  return (dx * dx + dz * dz) < DISCOVERY_RADIUS * DISCOVERY_RADIUS;
}

/**
 * Calculate trust level between two agents based on interaction history.
 * Returns a value from -1 (hostile) to 1 (very friendly).
 */
export function calculateTrust(
  agent: OpenClawAgentComponent,
  otherAgentEntityId: number,
): number {
  let trust = 0;
  const memories = agent.interactionMemory.filter(m => m.agentId === otherAgentEntityId);

  for (const memory of memories) {
    switch (memory.outcome) {
      case 'positive':
        trust += 0.15;
        break;
      case 'neutral':
        trust += 0.02;
        break;
      case 'negative':
        trust -= 0.2;
        break;
    }
  }

  // Social disposition modifier
  switch (agent.socialDisposition) {
    case 'Friendly':
      trust += 0.2;
      break;
    case 'Neutral':
      break;
    case 'Competitive':
      trust -= 0.1;
      break;
    case 'Isolationist':
      trust -= 0.3;
      break;
  }

  // Cultural towns are more attractive trade partners
  trust += getCulturalTradeBonus(agent.culturalValue ?? 0);

  return Math.max(-1, Math.min(1, trust));
}

/**
 * Determine what resources an agent wants and can offer for trade.
 * Based on current stockpile and building needs.
 */
export function calculateTradeDesires(
  agent: OpenClawAgentComponent,
  resources: Partial<Record<ResourceType, number>>,
): TradeDesire {
  const wants: Partial<Record<ResourceType, number>> = {};
  const offers: Partial<Record<ResourceType, number>> = {};

  const wood = resources[ResourceType.Wood] ?? 0;
  const stone = resources[ResourceType.Stone] ?? 0;
  const food = resources[ResourceType.Food] ?? 0;
  const iron = resources[ResourceType.Iron] ?? 0;

  // Want resources we're low on
  if (wood < 15) wants[ResourceType.Wood] = 15 - wood;
  if (stone < 10) wants[ResourceType.Stone] = 10 - stone;
  if (food < 10) wants[ResourceType.Food] = 10 - food;

  // Offer surplus resources
  if (wood > 40) offers[ResourceType.Wood] = Math.floor((wood - 30) / 2);
  if (stone > 30) offers[ResourceType.Stone] = Math.floor((stone - 20) / 2);
  if (food > 30) offers[ResourceType.Food] = Math.floor((food - 20) / 2);
  if (iron > 15) offers[ResourceType.Iron] = Math.floor((iron - 10) / 2);

  return { wants, offers };
}

/**
 * Attempt a trade between two agents.
 * Returns true if the trade was successful, with amounts traded.
 */
export function attemptTrade(
  agentA: OpenClawAgentComponent,
  agentB: OpenClawAgentComponent,
  resourcesA: Partial<Record<ResourceType, number>>,
  resourcesB: Partial<Record<ResourceType, number>>,
): { success: boolean; transfers: Array<{ from: 'A' | 'B'; resource: ResourceType; amount: number }> } {
  const desiresA = calculateTradeDesires(agentA, resourcesA);
  const desiresB = calculateTradeDesires(agentB, resourcesB);

  const transfers: Array<{ from: 'A' | 'B'; resource: ResourceType; amount: number }> = [];

  // Find matching wants/offers
  for (const [resource, wantAmount] of Object.entries(desiresA.wants) as [ResourceType, number][]) {
    const offerAmount = desiresB.offers[resource];
    if (offerAmount && offerAmount > 0 && wantAmount > 0) {
      const tradeAmount = Math.min(wantAmount, offerAmount);
      transfers.push({ from: 'B', resource, amount: tradeAmount });
    }
  }

  for (const [resource, wantAmount] of Object.entries(desiresB.wants) as [ResourceType, number][]) {
    const offerAmount = desiresA.offers[resource];
    if (offerAmount && offerAmount > 0 && wantAmount > 0) {
      const tradeAmount = Math.min(wantAmount, offerAmount);
      transfers.push({ from: 'A', resource, amount: tradeAmount });
    }
  }

  return {
    success: transfers.length > 0,
    transfers,
  };
}

/**
 * Attempt an art DNA crossover between two agents.
 * Only happens when trust is high enough and both agents agree.
 */
export function attemptArtCrossover(
  agentA: OpenClawAgentComponent,
  agentB: OpenClawAgentComponent,
  agentBEntityId: number,
  seed: number,
): ArtDNA | null {
  // Check trust threshold
  const trust = calculateTrust(agentA, agentBEntityId);
  if (trust < 0.3) return null;

  // Count positive interactions
  const positiveCount = agentA.interactionMemory
    .filter(m => m.agentId === agentBEntityId && m.outcome === 'positive')
    .length;

  if (positiveCount < CROSSOVER_TRUST_THRESHOLD) return null;

  // Perform crossover with bias toward the agent with higher fitness
  const bias = agentA.artDNA.fitnessScore > agentB.artDNA.fitnessScore ? 0.7 : 0.3;
  return crossoverArtDNA(agentA.artDNA, agentB.artDNA, bias, seed);
}

/**
 * Record an interaction in an agent's memory.
 */
export function recordInteraction(
  agent: OpenClawAgentComponent,
  otherAgentId: number,
  type: InteractionMemory['type'],
  outcome: InteractionMemory['outcome'],
  gameTime: number,
): void {
  agent.interactionMemory.push({
    agentId: otherAgentId,
    type,
    timestamp: gameTime,
    outcome,
  });

  // Keep memory bounded (last 50 interactions)
  if (agent.interactionMemory.length > 50) {
    agent.interactionMemory.shift();
  }
}

/**
 * Determine if an agent wants to collaborate with another
 * on a joint building project.
 */
export function wouldCollaborate(
  agent: OpenClawAgentComponent,
  otherAgentId: number,
): boolean {
  if (agent.socialDisposition === 'Isolationist') return false;

  const trust = calculateTrust(agent, otherAgentId);

  switch (agent.socialDisposition) {
    case 'Friendly':
      return trust > -0.2;
    case 'Neutral':
      return trust > 0.2;
    case 'Competitive':
      return trust > 0.5;
    default:
      return false;
  }
}

/**
 * Calculate a "town score" for competitive comparison.
 * Cultural value is now the heaviest scoring component — towns that invest
 * in art dramatically outscale those that only build.
 *
 * Scoring breakdown:
 *   Buildings:  10 pts each (infrastructure)
 *   Population: 15 pts each (citizens)
 *   Art gen:     5 pts each (creativity)
 *   Culture:     3 pts per cultural value point (the big multiplier)
 *   Satisfaction: 20 pts max (happiness)
 *   Crossovers:  10 pts each (cultural exchange prestige)
 */
export function calculateTownScore(agent: OpenClawAgentComponent): number {
  let score = 0;

  // Buildings contribute
  score += agent.totalBuildingsBuilt * 10;

  // Population contributes
  score += agent.citizenEntities.length * 15;

  // Art evolution contributes (creativity bonus)
  score += agent.artDNA.generation * 5;

  // Cultural value is the heavyweight — this is the payoff for art investment
  score += (agent.culturalValue ?? 0) * 3;

  // Art crossovers (cultural exchange) give prestige
  score += (agent.crossoversCompleted ?? 0) * 10;

  // Commissions completed (being a sought-after artist)
  score += (agent.commissionsCompleted ?? 0) * 8;

  // Satisfaction bonus
  score += agent.satisfaction * 20;

  return Math.round(score);
}
