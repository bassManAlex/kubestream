// Breaks a serialized event so JSON.parse rejects it. A strategy must never
// give valid JSON with different data (events.test.ts checks each one).

import { between, oneOf } from "./catalog.ts";

type Strategy = (json: string) => string;

const STRATEGIES: Strategy[] = [
  // cut the payload short; no proper prefix of an object is valid JSON
  (json) => json.slice(0, between(1, json.length - 1)),
  // a bare key
  (json) => json.replace('"metadata":', "metadata:"),
  // NaN is not a JSON number
  (json) => json.replace(/"count":\d+/, '"count":NaN'),
  // a trailing comma before the closing brace
  (json) => `${json.slice(0, -1)},}`,
  // = instead of : after a key
  (json) => json.replace('"reason":', '"reason"='),
];

export function corrupt(json: string): string {
  return oneOf(STRATEGIES)(json);
}

export const strategiesForTesting: readonly Strategy[] = STRATEGIES;
