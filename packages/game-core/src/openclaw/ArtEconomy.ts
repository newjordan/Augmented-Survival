/**
 * ArtEconomy — The economic loop connecting art evolution to resources.
 *
 * Core mechanic:
 *   Resources → Art Investment → Cultural Value → Citizen Bonuses → More Resources
 *
 * This creates a strategic tension: spend resources on art (long-term growth)
 * or spend on buildings (immediate utility). Agents that invest in art get:
 *
 * 1. Cultural Value — accumulated prestige from art generations
 * 2. Citizen Happiness Bonus — higher culture → happier citizens → faster work
 * 3. Population Attraction — high-culture towns attract new citizens faster
 * 4. Trade Leverage — cultural towns are more desirable trade partners
 * 5. Art Export Revenue — sell art influence to neighbors for resources
 *
 * Art Evolution Costs (per mutation attempt):
 *   - Minor tweak (intensity < 0.3): 2 Gold (pigments)
 *   - Standard mutation (intensity 0.3-0.7): 5 Gold + 3 Wood (materials + scaffolding)
 *   - Major overhaul (intensity > 0.7): 8 Gold + 5 Wood + 3 Stone (full renovation)
 *
 * Art Crossover (cultural exchange) costs:
 *   - Both agents pay: 4 Gold + 2 Wood (cultural exchange fee)
 *   - The receiving agent gets a crossover DNA worth more cultural value
 *
 * Art Commission (one agent pays another for art influence):
 *   - Commissioner pays: 10 Gold + negotiated resources
 *   - Artist receives: payment + cultural prestige bonus
 *   - Commissioner gets: art DNA crossover biased toward the artist's style
 */

import type { OpenClawAgentComponent } from './OpenClawAgentComponent';
import type { ArtDNA } from './types';
import { ResourceType } from '../types/resources';

// ─── Art Evolution Costs ─────────────────────────────────────────

/** Cost tiers for art evolution based on mutation intensity */
export interface ArtEvolutionCost {
  /** Resources required */
  resources: Partial<Record<ResourceType, number>>;
  /** Description of what the agent is doing */
  description: string;
  /** Tier name for UI/logging */
  tier: 'minor' | 'standard' | 'major';
}

/**
 * Calculate the resource cost for an art evolution attempt.
 * Higher intensity = more dramatic change = more expensive.
 */
export function getArtEvolutionCost(intensity: number): ArtEvolutionCost {
  if (intensity < 0.3) {
    return {
      resources: { [ResourceType.Gold]: 2 },
      description: 'Minor color adjustment — mixing new pigments',
      tier: 'minor',
    };
  }

  if (intensity <= 0.7) {
    return {
      resources: {
        [ResourceType.Gold]: 5,
        [ResourceType.Wood]: 3,
      },
      description: 'Architectural refinement — reshaping structures and repainting',
      tier: 'standard',
    };
  }

  return {
    resources: {
      [ResourceType.Gold]: 8,
      [ResourceType.Wood]: 5,
      [ResourceType.Stone]: 3,
    },
    description: 'Major artistic overhaul — rebuilding facades and redesigning layout',
    tier: 'major',
  };
}

/**
 * Cost for art crossover (cultural exchange between two agents).
 * Each agent pays this to participate.
 */
export function getArtCrossoverCost(): Partial<Record<ResourceType, number>> {
  return {
    [ResourceType.Gold]: 4,
    [ResourceType.Wood]: 2,
  };
}

/**
 * Cost for commissioning art from another agent.
 * The commissioner pays this to the artist.
 */
export function getArtCommissionCost(): Partial<Record<ResourceType, number>> {
  return {
    [ResourceType.Gold]: 10,
    [ResourceType.Wood]: 3,
    [ResourceType.Stone]: 2,
  };
}

// ─── Cultural Value ──────────────────────────────────────────────

/**
 * Calculate the cultural value of a town based on its art history.
 *
 * Cultural value accumulates from:
 * - Each accepted art generation (higher fitness = more value per gen)
 * - Art crossovers with other agents (cultural exchange bonus)
 * - Art commissions completed (prestige)
 * - Decoration gene richness (gardens, banners, lighting)
 *
 * Returns a value from 0 (no culture) to uncapped (grows with investment).
 */
export function calculateCulturalValue(agent: OpenClawAgentComponent): number {
  let value = 0;

  // Base value from art generations (each gen is worth its fitness)
  value += agent.artDNA.generation * (0.5 + agent.artDNA.fitnessScore * 0.5);

  // Bonus from accepted mutations in memory
  const acceptedMutations = agent.artMemory.filter(m => m.wasKept).length;
  const totalMutations = agent.artMemory.length;
  const acceptRate = totalMutations > 0 ? acceptedMutations / totalMutations : 0.5;
  value += acceptedMutations * 0.3;

  // Curator bonus: high accept rate means discerning taste
  if (acceptRate > 0.5 && totalMutations > 5) {
    value += (acceptRate - 0.5) * 10;
  }

  // Decoration richness bonus
  const deco = agent.artDNA.decoration;
  const decoScore =
    (deco.hasWindows ? 1 : 0) +
    (deco.hasChimney ? 0.5 : 0) +
    (deco.hasBanners ? 1.5 : 0) +  // Banners are showy
    (deco.hasGardens ? 2 : 0) +     // Gardens are most impressive
    deco.lightingDensity * 2 +
    deco.fenceAmount * 0.5;
  value += decoScore;

  // Detail level bonus (ornate buildings are more culturally valuable)
  value += agent.artDNA.shape.detailLevel * 5;

  // Art investment bonus (from the artInvestment tracking field)
  value += (agent.artInvestment ?? 0) * 0.1;

  // Crossover bonus — cultural exchange creates extra value
  const crossovers = agent.artMemory.filter(m => m.mutationType === 'crossover');
  value += crossovers.length * 2;

  return Math.max(0, value);
}

// ─── Economic Bonuses from Culture ───────────────────────────────

/**
 * Get the citizen happiness multiplier from cultural value.
 * Higher culture → happier citizens → work faster.
 *
 * Returns a multiplier (1.0 = no bonus, up to ~1.5 at very high culture).
 */
export function getCulturalHappinessBonus(culturalValue: number): number {
  // Diminishing returns: first 20 points of culture give the most
  // Formula: 1 + 0.3 * (1 - e^(-value/20))
  return 1 + 0.3 * (1 - Math.exp(-culturalValue / 20));
}

/**
 * Get the resource production multiplier from cultural value.
 * Culture → citizen morale → they gather and produce faster.
 *
 * Returns a multiplier (1.0 = no bonus, up to ~1.3 at very high culture).
 */
export function getCulturalProductionBonus(culturalValue: number): number {
  return 1 + 0.2 * (1 - Math.exp(-culturalValue / 25));
}

/**
 * Get the population growth rate modifier from cultural value.
 * High-culture towns attract citizens more often.
 *
 * Returns the reduction in seconds between citizen spawns.
 * At 0 culture: 0 reduction (normal rate)
 * At high culture: up to 30 seconds faster spawning
 */
export function getCulturalPopulationBonus(culturalValue: number): number {
  return Math.min(30, culturalValue * 0.8);
}

/**
 * Get the trade desirability bonus from cultural value.
 * Cultural towns are more attractive trade partners.
 *
 * Returns extra trust points toward all agents.
 */
export function getCulturalTradeBonus(culturalValue: number): number {
  return Math.min(0.3, culturalValue * 0.01);
}

// ─── Art Commission System ───────────────────────────────────────

/** Result of an art commission attempt */
export interface CommissionResult {
  success: boolean;
  /** New DNA for the commissioner (blend of both styles) */
  resultDNA?: ArtDNA;
  /** Cultural value gained by the artist */
  artistPrestige: number;
  /** Cultural value gained by the commissioner */
  commissionerPrestige: number;
  /** Reason for failure (if !success) */
  reason?: string;
}

/**
 * Check if an agent should invest in art based on its current state.
 * Returns true if art investment is strategically sound right now.
 *
 * Agents invest in art when:
 * - They have surplus resources (basic needs met)
 * - Their cultural value is low relative to their town size
 * - Their priority is Aesthetics (always interested)
 * - Their satisfaction is low (looking for something new)
 */
export function shouldInvestInArt(
  agent: OpenClawAgentComponent,
  resources: Partial<Record<ResourceType, number>>,
): boolean {
  const gold = resources[ResourceType.Gold] ?? 0;
  const wood = resources[ResourceType.Wood] ?? 0;

  // Must have minimum resources for cheapest art
  if (gold < 2) return false;

  // Aesthetics-priority agents are always eager
  if (agent.priority === 'Aesthetics' && gold >= 5) return true;

  // Low satisfaction agents seek change through art
  if (agent.satisfaction < 0.3 && gold >= 2) return true;

  // Surplus resources — might as well invest in culture
  const culturalValue = calculateCulturalValue(agent);
  const expectedForSize = agent.totalBuildingsBuilt * 1.5;
  if (culturalValue < expectedForSize && gold >= 5 && wood >= 3) return true;

  // Good economy but low culture — time to invest
  if (gold > 20 && wood > 20 && culturalValue < 15) return true;

  return false;
}

/**
 * Choose the art evolution intensity based on available resources
 * and strategic considerations.
 */
export function chooseArtIntensity(
  agent: OpenClawAgentComponent,
  resources: Partial<Record<ResourceType, number>>,
): number {
  const gold = resources[ResourceType.Gold] ?? 0;
  const wood = resources[ResourceType.Wood] ?? 0;
  const stone = resources[ResourceType.Stone] ?? 0;

  // Can afford major overhaul?
  if (gold >= 8 && wood >= 5 && stone >= 3) {
    // Only do major overhaul if low satisfaction or Aesthetics priority
    if (agent.satisfaction < 0.3 || agent.priority === 'Aesthetics') {
      return 0.7 + Math.random() * 0.3; // 0.7-1.0
    }
  }

  // Can afford standard?
  if (gold >= 5 && wood >= 3) {
    return 0.3 + Math.random() * 0.4; // 0.3-0.7
  }

  // Can only afford minor
  if (gold >= 2) {
    return 0.1 + Math.random() * 0.2; // 0.1-0.3
  }

  return 0; // Can't afford anything
}

/**
 * Calculate the art investment "return" — how much cultural value
 * was generated per unit of resource spent.
 *
 * This helps agents decide if art investment is paying off.
 */
export function calculateArtROI(agent: OpenClawAgentComponent): number {
  const investment = agent.artInvestment ?? 0;
  if (investment <= 0) return 0;

  const culturalValue = calculateCulturalValue(agent);
  return culturalValue / investment;
}

// ─── Resource Checking Utility ───────────────────────────────────

/**
 * Check if an agent can afford a set of resource costs.
 */
export function canAffordArtCost(
  cost: Partial<Record<ResourceType, number>>,
  available: Partial<Record<ResourceType, number>>,
): boolean {
  for (const [resource, amount] of Object.entries(cost)) {
    const have = available[resource as ResourceType] ?? 0;
    if (have < (amount ?? 0)) return false;
  }
  return true;
}
