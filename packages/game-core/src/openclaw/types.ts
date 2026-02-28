/**
 * OpenClaw Autonomous Towns — Core type definitions.
 *
 * Defines the DNA, personality, and decision-making structures
 * that allow OpenClaw agents to autonomously build, evolve,
 * and collaborate on their own towns.
 */

import type { BuildingType } from '../types/buildings';
import type { ResourceType } from '../types/resources';

// ─── Agent Personality ───────────────────────────────────────────────

/** Architectural style preference that influences building shapes and layout */
export enum ArchitecturalStyle {
  Organic = 'Organic',         // Curved, nature-integrated, spread out
  Geometric = 'Geometric',     // Grid-based, symmetrical, orderly
  Fortified = 'Fortified',     // Walls, towers, compact defensive layout
  Sprawling = 'Sprawling',     // Wide roads, scattered buildings, lots of space
  Vertical = 'Vertical',       // Tall buildings, stacked structures
}

/** What the agent prioritizes when making decisions */
export enum AgentPriority {
  Growth = 'Growth',           // Maximize population and buildings
  Economy = 'Economy',         // Maximize resource production and trade
  Aesthetics = 'Aesthetics',   // Focus on beautiful, well-designed towns
  Defense = 'Defense',         // Prioritize fortifications and military
  Exploration = 'Exploration', // Expand territory, discover resources
}

/** Social disposition toward other agents */
export enum SocialDisposition {
  Friendly = 'Friendly',       // Eager to trade and collaborate
  Neutral = 'Neutral',         // Open to interaction but cautious
  Competitive = 'Competitive', // Tries to outperform neighbors
  Isolationist = 'Isolationist', // Prefers independence
}

// ─── Art DNA — the "genetic code" for procedural art ─────────────────

/** Color gene: HSL-based color with variation ranges */
export interface ColorGene {
  hue: number;        // 0-360
  saturation: number; // 0-1
  lightness: number;  // 0-1
  variance: number;   // How much this gene can mutate (0-1)
}

/** Shape gene: controls proportions of procedural geometry */
export interface ShapeGene {
  /** Height multiplier for buildings (0.5 - 3.0) */
  heightScale: number;
  /** Width multiplier (0.5 - 2.0) */
  widthScale: number;
  /** Roof steepness (0 = flat, 1 = very steep) */
  roofSteepness: number;
  /** How rounded vs angular shapes are (0 = sharp, 1 = round) */
  roundness: number;
  /** Level of decorative detail (0 = plain, 1 = ornate) */
  detailLevel: number;
  /** Asymmetry factor (0 = perfectly symmetrical, 1 = very asymmetric) */
  asymmetry: number;
}

/** Decoration gene: what embellishments buildings get */
export interface DecorationGene {
  /** Whether to add window-like features */
  hasWindows: boolean;
  /** Whether to add chimney/smoke features */
  hasChimney: boolean;
  /** Whether to add banner/flag features */
  hasBanners: boolean;
  /** Whether to add garden/planter features */
  hasGardens: boolean;
  /** Fence/wall style around buildings (0 = none, 1 = full) */
  fenceAmount: number;
  /** Torch/lantern density (0 = none, 1 = many) */
  lightingDensity: number;
}

/** Complete art DNA for an agent's visual style */
export interface ArtDNA {
  /** Primary building color palette */
  primaryColor: ColorGene;
  /** Secondary/accent color */
  accentColor: ColorGene;
  /** Roof color */
  roofColor: ColorGene;
  /** Ground/path color */
  pathColor: ColorGene;
  /** Shape parameters */
  shape: ShapeGene;
  /** Decoration parameters */
  decoration: DecorationGene;
  /** Generation number (how many times this DNA has been evolved) */
  generation: number;
  /** Fitness score from agent's self-evaluation (0-1) */
  fitnessScore: number;
}

// ─── Town Layout ────────────────────────────────────────────────────

/** A planned building placement in the town grid */
export interface TownPlot {
  /** World X position */
  x: number;
  /** World Z position */
  z: number;
  /** Building type to place */
  buildingType: BuildingType;
  /** Whether this plot has been built */
  isBuilt: boolean;
  /** Priority score for building order (higher = build first) */
  priority: number;
}

/** Road segment connecting two points */
export interface RoadSegment {
  startX: number;
  startZ: number;
  endX: number;
  endZ: number;
  width: number;
}

/** The town's master plan */
export interface TownPlan {
  /** Center of the town */
  centerX: number;
  centerZ: number;
  /** Current expansion radius */
  radius: number;
  /** Planned building plots */
  plots: TownPlot[];
  /** Road network */
  roads: RoadSegment[];
  /** Current expansion ring (which layer of buildings we're on) */
  expansionRing: number;
  /** Maximum planned radius before needing a new district */
  maxRadius: number;
}

// ─── Agent Memory & State ───────────────────────────────────────────

/** Record of a past interaction with another agent */
export interface InteractionMemory {
  agentId: number;
  type: 'trade' | 'gift' | 'competition' | 'collaboration';
  timestamp: number;
  outcome: 'positive' | 'neutral' | 'negative';
}

/** What resources the agent wants and offers for trade */
export interface TradeDesire {
  wants: Partial<Record<ResourceType, number>>;
  offers: Partial<Record<ResourceType, number>>;
}

/** An agent's evaluation of a past art mutation */
export interface ArtMemory {
  /** The DNA before mutation */
  parentGeneration: number;
  /** What was changed */
  mutationType: 'color' | 'shape' | 'decoration' | 'crossover';
  /** Whether the agent "liked" the result */
  wasKept: boolean;
}

// ─── Agent Decision ─────────────────────────────────────────────────

/** Types of decisions an agent can make */
export enum AgentDecisionType {
  Build = 'Build',
  ExpandTerritory = 'ExpandTerritory',
  EvolveArt = 'EvolveArt',
  Trade = 'Trade',
  SpawnCitizen = 'SpawnCitizen',
  AssignJobs = 'AssignJobs',
  Idle = 'Idle',
}

/** A decision queued by the agent's AI */
export interface AgentDecision {
  type: AgentDecisionType;
  /** Building type to build (for Build decisions) */
  buildingType?: BuildingType;
  /** Position to build at */
  position?: { x: number; z: number };
  /** Trade partner agent entity ID */
  tradePartner?: number;
  /** Trade offer details */
  tradeDesire?: TradeDesire;
  /** Priority of this decision */
  priority: number;
  /** Reason for this decision (for debugging) */
  reason: string;
}
