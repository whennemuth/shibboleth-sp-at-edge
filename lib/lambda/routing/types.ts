/**
 * TypeScript type definitions for DynamoDB routing rules.
 * 
 * Design: DynamoDB-native schema (not type-prefixed strings).
 * Each routing type has specific fields, enabling full type discrimination.
 */

export type RoutingRuleBase = {
  path: string;
};

export type ClusterRoutingRule = RoutingRuleBase & {
  routingType: 'cluster';
  targetOrigin: string;
  description?: string;
};

export type RedirectRoutingRule = RoutingRuleBase & {
  routingType: 'redirect';
  redirectStatus: 301 | 302 | 303 | 307 | 308;
  redirectTarget: string;
  description?: string;
};

export type StaticRoutingRule = RoutingRuleBase & {
  routingType: 'static';
  targetOrigin: string;
  description?: string;
};

export type PhpAppRoutingRule = RoutingRuleBase & {
  routingType: 'php';
  targetOrigin: string;
  description?: string;
};

/**
 * Union type for all routing rules.
 * TypeScript uses discriminated union on routingType field.
 */
export type RoutingRule = 
  | ClusterRoutingRule 
  | RedirectRoutingRule 
  | StaticRoutingRule 
  | PhpAppRoutingRule;
