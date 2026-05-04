# Request Routing Layer

## Overview

The routing layer enables a single CloudFront distribution with one authentication stack to serve multiple backend clusters or static origins. Requests are directed to different backend ALBs, S3 origins, or redirects based on URL path patterns, without duplicating the Shibboleth authentication infrastructure.

## Architecture

The routing layer is a path-based router that runs after JWT validation but before SAML processing — added to the existing origin-request Lambda by way of a thin wrapper that delegates to the auth handler unchanged.

When `ROUTING.enabled` is true in context.json, the CDK synthesis-time decision in [lib/EdgeFunctionOriginRequest.ts](../../lib/EdgeFunctionOriginRequest.ts) deploys `routing-handler.js` instead of `edge-origin-request.js`. When routing is disabled or absent, the deployed function is the auth-only handler — byte-for-byte identical to pre-routing versions of the repo. The feature is fully opt-in: with `ROUTING.enabled` set to false or omitted, no DynamoDB resources are created and no routing code is bundled into the Lambda.

### Request Flow

```
User → CloudFront
         ↓
     Viewer-Request Lambda (JWT validation)
         ↓
     Origin-Request Lambda (routing + SAML + auth)
         ↓
     Selected Origin (based on DynamoDB rules)
```

### Components

**Origin-Request Lambda** ([lib/lambda/routing/routing-handler.ts](../../lib/lambda/routing/routing-handler.ts))
Queries DynamoDB for routing rules based on request path, modifies `request.origin` if a rule matches, then delegates to the auth handler. Preserves all auth handler functionality (SAML, JWT, security headers).

**DynamoDB Routing Table**
This is a persistent data store for the routing rules, and is cached in-memory within the Lambda for performance. It uses the the same approach as the `bu-protected-s3-object-lambda` infrastructure.

## Design Principles

### Authentication before routing

The routing handler runs after JWT validation (viewer-request) but before SAML processing (origin-request). Unauthenticated requests are blocked at the edge before any DynamoDB lookup. SAML paths (`/login`, `/assert`, `/logout`) have separate cache behaviors without routing functions, verified in [lib/Distribution.test.ts](../../lib/Distribution.test.ts).

### Avoid header duplication

The routing handler must not pre-populate `request.origin.custom.customHeaders` with any headers that the auth handler adds to `request.headers`. CloudFront returns 502 if the same header exists in both places simultaneously.

**1. Empty customHeaders requirement**

The routing handler must set `request.origin.custom.customHeaders = {}` when modifying origin. CloudFront returns 502 "invalid origin configuration" if the same header exists in both `origin.custom.customHeaders` and `request.headers` simultaneously. The auth handler adds security headers (`cloudfront-challenge`, `app_authorization`) to `request.headers`. If the routing handler pre-populates customHeaders, the auth handler's additions create dual-location state and trigger the 502 error. Leaving customHeaders empty ensures all headers exist in `request.headers` only.

**2. Host header preservation**

The routing handler modifies `request.origin.custom.domainName` (the ALB DNS name for TLS connection and routing) but does not modify `request.headers['host']`. CloudFront uses `domainName` for the TLS handshake (SNI) and connection routing. WordPress uses the `Host` header for site selection within a multisite cluster. Preserving the original Host header enables cluster routing without breaking WordPress multisite.

## Configuration

### Enabling routing (context.json)

```json
{
  "ROUTING": {
    "enabled": true,
    "defaultOriginType": "wordpress",
    "tableName": "custom-routing-table",
    "cacheTtlSeconds": 300
  }
}
```

**Context fields:**

- `enabled` — Boolean. Absence or false deploys the distribution without routing (zero added resources).
- `tableName` — (Optional) Override default DynamoDB table name. Default: `{STACK_ID}-routing-table-{Landscape}`
- `cacheTtlSeconds` — (Optional) Cache TTL in seconds. Default: 300 (5 minutes)
- `defaultOriginType` — `"wordpress"` or `"webrouter"`. Fallback origin when no rule matches.

When `ROUTING.enabled` is false or absent, the deployed function is `edge-origin-request.js` (auth only, estimated at 3.7 MB). When enabled, the deployed function is `routing-handler.js` (routing + auth, estimated at 5.0 MB). The size difference is the bundled DynamoDB SDK (the Lambda runtime does not include the DynamoDB client).

### Build requirement

Context changes are bundled into Lambda code at build time:

```bash
npm run build    # Required after context.json changes
cdk deploy       # Deploys new Lambda version
```

### DynamoDB table

The routing rules consumed by the handler are stored in a per-stack DynamoDB table provisioned by the CDK construct when `ROUTING.enabled` is true.

- **Table name:** `{STACK_ID}-routing-table-{Landscape}`
- **Region:** us-east-1 (same as Lambda@Edge origin-request)
- **Schema:** Partition key `path` (string), attributes vary by action type

**Path matching:** Paths are case-insensitive. Both keys and lookups are normalized to lowercase. WordPress routes are de-facto case-insensitive at BU.

Example rules:

```json
{
  "path": "/questrom",
  "action": "origin",
  "target": "questrom-alb-123.us-east-2.elb.amazonaws.com",
  "matchType": "prefix",
  "enabled": true
}
```

```json
{
  "path": "/studentlink",
  "action": "redirect",
  "matchType": "exact",
  "redirectStatus": 301,
  "target": "https://www.bu.edu/link",
  "preserveQuery": false,
  "enabled": true
}
```

## Why DynamoDB

A recurring question when reviewing this implementation: *if the Lambda loads the whole table on every cache event, why use DynamoDB at all? Why not a JSON file in S3, or a parameter in SSM?*

### The ability to support longest-prefix-match favors "load everything"

It can be beneficial to use a matching algorithm that is longest-prefix-match over URL paths. A request for `/cas/biology/faculty/smith` walks the path hierarchy from longest to shortest (`/cas/biology/faculty` → `/cas/biology` → `/cas`) and returns the first matching rule. There is no single key the Lambda can compute up front to retrieve one rule. The alternative—issuing five to ten single-key `Get` requests per incoming request to walk the prefix chain, most of which would miss—trades one warm-container Scan for sustained per-request latency. Loading the full table once per container and matching in memory is a good match for this scenario **regardless of the storage medium**.

### Once "load everything" is decided, storage choice is operational

DynamoDB has beneficial properties for this use case:

1. **Atomic per-rule writes.** A `PutItem` call is safe under concurrent edits. An S3-backed JSON file requires read-modify-write with locking or last-writer-wins semantics. Both are error-prone when multiple team members edit rules simultaneously.

2. **Console editor.** The AWS DynamoDB console provides a usable per-item editor out of the box. This matters most during Phase 1, when cluster assignments are mutated occasionally by team members for whom "edit the JSON blob in S3" is friction. An S3-backed JSON file is cheaper on paper but worse operationally.

3. **Performance.** DynamoDB is much faster than S3 in general, and is one of the fastest options for Lambda in CloudFront. If we fall through from cache more often than expected for some reason, DynamoDB's low latency is a safety net.

### Cached DynamoDB is a previously used pattern, but we are using it in a different way

The `bu-protected-s3-object-lambda` project is a partial precedent. The **module-level container caching pattern with TTL** is the same: compare `cachedProtectedSites` in `app.js` to `RoutingCache.ts`'s exported state. The **DynamoDB access pattern is different**: the S3 object lambda does a single `GetItem` against `PK='PROTECTED_SITES'` and `JSON.parse`s a blob, plus per-group `GetItem`s by composite key. It does not Scan.

The routing table Scans in order to support longest-prefix-match, which needs the whole table.  The S3 object lambda doesn't Scan because its lookups are exact-key.

### Why not store the whole table as one JSON-encoded item?

A single item at `PK='ROUTING_TABLE'` containing the full rule set as a JSON blob would be mechanically closer to the S3 object lambda's access pattern; one `GetItem`, one `JSON.parse`, then populate the in-memory Map. The reason not to do this: **the AWS console editor operates at the item level**. One giant JSON blob defeats the console editor, and the console editor is a primary motivation for choosing DynamoDB in the first place. The row-per-rule design is the right one. The Scan is the cost of admission.

## Routing Actions

The schema uses two action types: `origin` and `redirect`. Each describes what the rule does at runtime.

### origin

Modifies `request.origin` to direct traffic to a different ALB or S3 origin. The auth handler runs after origin modification.

**Fields:**
- `action: 'origin'` — Required discriminator
- `path: string` — Required. URL path to match (case-insensitive).
- `target: string` — Required. ALB DNS name or S3 domain **WITHOUT scheme and WITHOUT path**.  
  Valid: `'wp-cluster-alb-123.us-east-2.elb.amazonaws.com'`  
  Invalid: `'https://wp-cluster-alb-123.us-east-2.elb.amazonaws.com'` (includes scheme)  
  Invalid: `'wp-cluster-alb-123.us-east-2.elb.amazonaws.com/path'` (includes path)  
  Confusing origin and redirect target formats causes 502 (unreachable origin) or redirect loops.
- `matchType?: 'exact' | 'prefix'` — Optional, defaults to `'prefix'`.  
  `'exact'`: Rule matches only the literal path. Request for `/studentlink/foo` does NOT match rule `/studentlink`.  
  `'prefix'`: Rule matches the path and all sub-paths (current behavior).
- `enabled?: boolean` — Optional, defaults to `true`. When `false`, the rule is filtered out by the cache layer at load time.
- `metadata?: object` — Optional audit fields (`createdAt`, `updatedAt`, `createdBy`). Populated by write tools, not enforced.
- `description?: string` — Optional human-readable description.

**Handler behavior:**

```javascript
request.origin = {
  custom: {
    domainName: rule.target,  // ALB DNS name or S3 domain
    port: 443,
    protocol: 'https',
    customHeaders: {},  // Empty - auth handler adds headers to request.headers
    path: '',
    sslProtocols: ['TLSv1.2'],
    readTimeout: 60,
    keepaliveTimeout: 5
  }
};
```

### redirect

Returns a redirect response immediately without contacting origin or running the auth handler.

**Fields:**
- `action: 'redirect'` — Required discriminator
- `path: string` — Required. URL path to match (case-insensitive).
- `target: string` — Required. Fully-qualified URL **WITH scheme**.  
  Valid: `'https://www.bu.edu/admissions'`  
  Invalid: `'www.bu.edu/admissions'` (missing scheme)
- `redirectStatus: 301 | 302 | 303 | 307 | 308` — Required. HTTP redirect status code.  
  `301`: Moved Permanently  
  `302`: Found (temporary)  
  `303`: See Other  
  `307`: Temporary Redirect (preserves method)  
  `308`: Permanent Redirect (preserves method)
- `preserveQuery?: boolean` — Optional, defaults to `false`. When `true`, appends `request.querystring` to the redirect target.  
  Example: Request `/old?foo=1`, target `https://new.example.com`, produces `Location: https://new.example.com?foo=1`.
- `matchType?: 'exact' | 'prefix'` — Optional, defaults to `'prefix'`. Same semantics as origin rules.
- `enabled?: boolean` — Optional, defaults to `true`.
- `metadata?: object` — Optional audit fields.
- `description?: string` — Optional description.

**Handler behavior:**

```javascript
let redirectTarget = rule.target;
if (rule.preserveQuery && request.querystring) {
  const separator = rule.target.includes('?') ? '&' : '?';
  redirectTarget = `${rule.target}${separator}${request.querystring}`;
}

return {
  status: rule.redirectStatus,
  statusDescription: 'Moved Permanently',  // or 'Found', etc.
  headers: {
    location: [{ key: 'Location', value: redirectTarget }]
  }
};
```

## Rule Matching Behavior

### Longest-prefix-match algorithm

For prefix-match rules (`matchType: 'prefix'` or omitted), the handler walks the path hierarchy from longest to shortest:

- Request `/cas/biology/faculty/smith`
- Tries: `/cas/biology/faculty/smith` (exact), `/cas/biology/faculty`, `/cas/biology`, `/cas`, `/`
- Returns first matching prefix rule

### Exact-match rules

Rules with `matchType: 'exact'` match only the literal path. Sub-paths fall through to the next matching rule or the default origin.

- Rule: `{path: '/studentlink', matchType: 'exact'}`
- Request `/studentlink` → matches
- Request `/studentlink/foo` → does NOT match, falls through

### Disabled rules

Rules with `enabled: false` are filtered out by the cache layer at load time. The handler does not see them. Re-enabling a rule (flipping `enabled: false` → `true` in DynamoDB) takes effect on the next cache refresh (up to `cacheTtlSeconds`, typically 5 minutes).

### Case-insensitivity

All paths are normalized to lowercase during lookup. WordPress routes are de-facto case-insensitive at BU. This is a semantic choice, not an implementation detail.

## Performance and Scaling

The cache pattern (module-level Map with ~5 minute TTL) provides sub-millisecond lookups on warm containers. Cold start overhead: 50–100 ms for DynamoDB client initialization plus 20–50 ms for the initial Scan.

The binding limit is the DynamoDB Scan response size (1 MB). At ~300 bytes per rule, the single-page Scan ceiling is approximately 3,000 rules. Current expected use cases hold dozens of rules; the ceiling is a far-future concern. Pagination is implemented in [lib/lambda/routing/RoutingCache.ts](../../lib/lambda/routing/RoutingCache.ts) for tables that exceed 1 MB.

## Operational Considerations

### Deployment

Routing rule changes in DynamoDB take effect within 5 minutes (cache TTL). No Lambda redeployment is needed unless routing logic changes.

### Testing

- Unit tests: [lib/lambda/routing/routing-handler.test.ts](../../lib/lambda/routing/routing-handler.test.ts)
- CDK construct tests: [lib/Distribution.test.ts](../../lib/Distribution.test.ts) (SAML path exclusion)

## Troubleshooting

### 502 "Invalid origin configuration"

CloudFront returns 502 with an error message mentioning "HeaderName or HeaderValue values are invalid."

**Cause:** A header exists in both `origin.custom.customHeaders` and `request.headers` simultaneously.

**Solution:** Verify that the routing handler sets `customHeaders: {}`. Check Lambda logs for the auth handler reporting headers in customHeaders — this indicates that the routing handler violated the empty-customHeaders invariant.

### Routing not applied

Requests go to the default origin even when a DynamoDB rule exists.

**Causes:**

1. Context not rebuilt — run `npm run build` after changing `ROUTING.enabled`.
2. DynamoDB TTL cache stale — wait 5 minutes after rule updates.
3. Path doesn't match — check the exact path in DynamoDB against the request URL.

**Debug:** Check Lambda@Edge logs in CloudWatch Logs (us-east-1). The handler logs routing decisions with `[Routing]` prefix.

## Known Limitations

1. **Regex not supported.** Path matching is exact or prefix-based only. Complex patterns require multiple rules or upstream/downstream transformation.
2. **Single-table Scan design.** Partitioning may be necessary above ~3,000 rules if Scan latency becomes problematic (the 1 MB Scan response limit is the ceiling).
3. **Cold-start DynamoDB query.** The first request after a Lambda cold start queries DynamoDB (no cache yet). Warm containers use the in-memory cache.
4. **Re-enable latency.** Disabled rules take up to `cacheTtlSeconds` (default 5 minutes) to take effect after re-enabling.
5. **Manual rule management.** No built-in validation or write tooling yet. Rules are edited via AWS console or custom scripts.

## Related Documentation

- [lib/lambda/routing/routing-handler.ts](../../lib/lambda/routing/routing-handler.ts) — Implementation
- [lib/Distribution.ts](../../lib/Distribution.ts) — CloudFront construct with SAML path handling
- [.github/copilot-instructions.md](../../.github/copilot-instructions.md) — Architectural baseline
