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
   * 
   * If a path suffix is needed, use the optional originPath field.
   */
  target: string;

  /**
   * Rewrite the request's Host header to match the target hostname.
   *
   * Default: false (preserve original Host header).
   *
   * When false (default): The Host header from the viewer request is preserved
   * and forwarded to the origin. This is required for ALB origins that serve
   * WordPress multisite, which uses Host to select the site.
   *
   * When true: The Host header is set to `target` before the request is sent
   * to the origin. This is required for S3 website endpoints, which use Host
   * to determine which bucket and content to serve.
   *
   * Setting this true with an ALB origin will break multisite Host-based
   * site selection. Setting this false with an S3 origin will cause S3 to
   * serve unexpected or wrong content.
   *
   * Webrouter equivalent: per-backend overrides in backend_hostheader.map
   * where the override value is the upstream hostname.
   */
  rewriteHostHeader?: boolean;

  /**
   * Origin path prefix prepended to the request URI when forwarding to origin.
   *
   * Default: omitted (no prefix).
   *
   * When set: CloudFront's native origin-path mechanism prepends this string
   * to the request URI. A request for `/admissions` with originPath `/_domains/example.com`
   * is sent to the origin as `/_domains/example.com/admissions`.
   *
   * Use this when the upstream serves multiple "logical hosts" from a single
   * origin via path namespacing — e.g., S3 buckets that serve multiple
   * domains from `_domains/<host>/` prefixes.
   *
   * Webrouter equivalent: path component on the upstream value in
   * hosts.map.erb (e.g., `people-protected ist-web-static-sites-prod.bu.edu/_domains/people.bu.edu`).
   *
   * Format: must start with `/` and must NOT end with `/`.
   * Valid: '/_domains/people.bu.edu', '/phpbin/wiki'
   * Invalid: 'phpbin/wiki' (no leading slash), '/phpbin/wiki/' (trailing slash)
   */
  originPath?: string;
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

  /**
   * Append the original request URI to the redirect target.
   *
   * Default: false (redirect to target as-is).
   *
   * When true: The viewer's request URI is appended to the target URL.
   * Example: request `/parking/permits/staff`, target
   * `https://www.bu.edu/parking-and-transportation` → Location:
   * `https://www.bu.edu/parking-and-transportation/permits/staff`
   *
   * Combines with preserveQuery: if both are true, request URI is
   * appended first, then query string.
   *
   * Webrouter equivalent: the `redirect` backend (as opposed to
   * `redirect_asis`).
   */
  preservePath?: boolean;
};

/**
 * Union type for all routing rules.
 * 
 * TypeScript discriminated union on the 'action' field.
 * Enables type narrowing: `if (rule.action === 'redirect')` narrows to RedirectRoutingRule.
 */
export type RoutingRule = OriginRoutingRule | RedirectRoutingRule;
