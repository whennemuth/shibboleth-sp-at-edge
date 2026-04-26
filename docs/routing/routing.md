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

Example rule:

```json
{
  "path": "/questrom",
  "routingType": "php",
  "targetOrigin": "example-alb-example-11111111111.us-east-2.elb.amazonaws.com"
}
```

## Routing Types

The routing types are the least well-defined aspect of the current implementation. The `php` type is implemented and tested, but probably misnamed. Other types are placeholders for future expansion. This aspect of the design is still fluid and may change. The current types are:

### php

Routes to an ALB serving WordPress/PHP:

```javascript
request.origin = {
  custom: {
    domainName: rule.targetOrigin,  // ALB DNS name
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

### static

Routes to an S3 bucket or static origin. Uses the same `custom` origin structure as the `php` type, with a different `domainName`.

### redirect

Returns an immediate redirect without reaching origin:

```javascript
return {
  status: rule.redirectStatus,  // 301, 302, etc.
  statusDescription: 'Found',
  headers: {
    location: [{ key: 'Location', value: rule.redirectTarget }]
  }
};
```

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

1. Paths must be exact or prefix-based. RegEx is not supported.
2. DynamoDB single-table design. Partitioning may be necessary above ~3,000 rules if Scan latency becomes problematic.
3. The `cluster` routing type is not implemented (single-target only).
4. The first request after a Lambda cold start queries DynamoDB (no cache yet).

## Related Documentation

- [lib/lambda/routing/routing-handler.ts](../../lib/lambda/routing/routing-handler.ts) — Implementation
- [lib/Distribution.ts](../../lib/Distribution.ts) — CloudFront construct with SAML path handling
- [.github/copilot-instructions.md](../../.github/copilot-instructions.md) — Architectural baseline
