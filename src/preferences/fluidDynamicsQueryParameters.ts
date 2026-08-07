/**
 * fluidDynamicsQueryParameters.ts
 *
 * Sim-specific startup query parameters. This is the single place where every
 * sim-specific query parameter is declared and documented. Public-facing
 * parameters (intended for end users / sharing links) must set `public: true`.
 *
 * ── How to add a query parameter ──────────────────────────────────────────────
 * 1. Add an entry below with a `type`, `defaultValue`, and (if user-facing)
 *    `public: true`. Add `isValidValue` to bound numeric ranges.
 * 2. If it should also be user-editable at runtime, surface it as a preference
 *    in FluidDynamicsPreferencesModel (initialize that Property from this query parameter).
 *
 * Usage: append e.g. `?highQualitySolver=true` to the sim URL.
 */

import { logGlobal } from "scenerystack/phet-core";
import { QueryStringMachine } from "scenerystack/query-string-machine";
import FluidDynamicsNamespace from "../FluidDynamicsNamespace.js";

const fluidDynamicsQueryParameters = QueryStringMachine.getAll({
  /**
   * Start with the higher-accuracy pressure solve. Surfaced as a preference in
   * Preferences → Simulation, so this only sets the initial value.
   */
  highQualitySolver: {
    type: "boolean",
    defaultValue: false,
    public: true,
  },

  /**
   * Jacobi iterations in the pressure projection, overriding both the default
   * and the quality preference. A development escape hatch for measuring how
   * much the projection actually costs, not something to put in a shared link —
   * hence not `public`.
   *
   * 0 means "use the preference".
   */
  pressureIterations: {
    type: "number",
    defaultValue: 0,
    isValidValue: (value: number) => value === 0 || (value >= 1 && value <= 200),
  },
});

FluidDynamicsNamespace.register("fluidDynamicsQueryParameters", fluidDynamicsQueryParameters);

// Log query parameters (for the console / PhET-iO).
logGlobal("phet.chipper.queryParameters");

export default fluidDynamicsQueryParameters;
