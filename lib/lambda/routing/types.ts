/**
 * TypeScript type definitions for DynamoDB routing rules.
 * 
 * Design: DynamoDB-native schema with discriminated unions.
 * Two actions: 'origin' (modify request.origin) and 'redirect' (return redirect response).
 */

export type RoutingRuleBase = {
  /**
   * URL path to match.
   * 
   * Case-insensitive: paths are normalized to lowercase during lookup.
   * WordPress routes are de-facto case-insensitive at BU.
   * 
   * Examples: '/admissions', '/cas/biology', '/'
   */
  path: string;

  /**
   * Match type: 'exact' or 'prefix'.
   * 
   * - 'exact': Rule matches only the literal path. Request for /studentlink/foo does NOT match rule /studentlink.
   * - 'prefix': Rule matches the path and all sub-paths (default behavior).
   * 
   * Defaults to 'prefix' if omitted for backward compatibility.
   */
  matchType?: 'exact' | 'prefix';

  /**
   * Enable/disable flag.
   * 
   * When false, the rule is filtered out by the cache layer at load time.
   * Re-enabling a rule (false → true) takes effect on next cache refresh (up to cacheTtlSeconds).
   * 
   * Defaults to true if omitted.
   */
  enabled?: boolean;

  /**
   * Optional audit metadata.
   * 
   * Populated by write tools; not enforced by schema or handler.
   * AWS console will not auto-populate these fields.
   */
  metadata?: {
    createdAt: string;
    updatedAt: string;
    createdBy: string;
  };

  /**
   * Optional human-readable description.
   */
  description?: string;
};

/**
 * Origin routing rule.
 * 
 * Modifies request.origin to direct traffic to a different ALB or origin.
 * The auth handler runs after origin modification.
 */
export type OriginRoutingRule = RoutingRuleBase & {
  /**
   * Action discriminator.
   * 
   * 'origin' describes what the rule does at runtime: sets request.origin.
   * This maps directly to the code path in the handler.
   */
  action: 'origin';

  /**
   * Target origin hostname.
   * 
   * MUST be an ALB DNS name or S3 bucket domain WITHOUT scheme and WITHOUT path.
   * 
   * Valid: 'wp-cluster-alb-123.us-east-2.elb.amazonaws.com'
   * Invalid: 'https://wp-cluster-alb-123.us-east-2.elb.amazonaws.com' (includes scheme)
   * Invalid: 'wp-cluster-alb-123.us-east-2.elb.amazonaws.com/path' (includes path)
   * 
   * Confusing origin and redirect target formats causes 502 (unreachable origin) or redirect loops.
   */
  target: string;
};

/**
 * Redirect routing rule.
 * 
 * Returns a redirect response immediately without contacting origin or running auth handler.
 */
export type RedirectRoutingRule = RoutingRuleBase & {
  /**
   * Action discriminator.
   */
  action: 'redirect';

  /**
   * HTTP redirect status code.
   * 
   * - 301: Moved Permanently
   * - 302: Found (temporary redirect)
   * - 303: See Other
   * - 307: Temporary Redirect (preserves method)
   * - 308: Permanent Redirect (preserves method)
   */
  redirectStatus: 301 | 302 | 303 | 307 | 308;

  /**
   * Redirect target URL.
   * 
   * MUST be a fully-qualified URL WITH scheme.
   * 
   * Valid: 'https://www.bu.edu/admissions'
   * Invalid: 'www.bu.edu/admissions' (missing scheme)
   * 
   * If preserveQuery is true, the original query string is appended.
   */
  target: string;

  /**
   * Preserve original query string in redirect.
   * 
   * When true, appends request.querystring to the Location header.
   * Example: request /old?foo=1, target https://new.example.com → Location: https://new.example.com?foo=1
   * 
   * Defaults to false if omitted.
   */
  preserveQuery?: boolean;
};

/**
 * Union type for all routing rules.
 * 
 * TypeScript discriminated union on the 'action' field.
 * Enables type narrowing: `if (rule.action === 'redirect')` narrows to RedirectRoutingRule.
 */
export type RoutingRule = OriginRoutingRule | RedirectRoutingRule;
