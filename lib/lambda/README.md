# Lambda@Edge Authentication Architecture

## Overview

Authentication processing is strategically split between **Viewer Request** and **Origin Request** Lambda@Edge functions to optimize performance while respecting AWS size limitations.

## Request Flow

```mermaid
sequenceDiagram
    participant Client
    participant Edge as CloudFront Edge
    participant VR as Viewer Request λ
    participant Cache as CloudFront Cache
    participant OR as Origin Request λ
    participant Origin as ALB/ECS

    Client->>Edge: HTTP Request
    Edge->>VR: Execute on EVERY request
    
    alt URI is /assert (SAML callback)
        VR->>VR: Add cache-bypass header
        VR->>OR: Forward to origin (skip cache)
        OR->>OR: Process SAML assertion (20-100KB)
        OR->>OR: Create JWT, set cookie
        OR->>Origin: Forward authenticated request
        Origin->>Client: Response with JWT cookie
    else Normal request with JWT
        VR->>VR: Validate JWT (500 bytes - 3KB)
        alt JWT valid
            VR->>Cache: Check cache
            alt Cache hit
                Cache->>Client: Return cached content
            else Cache miss
                Cache->>OR: Forward to origin
                OR->>OR: Add auth headers
                OR->>Origin: Forward request
                Origin->>Cache: Response
                Cache->>Client: Response (cached)
            end
        else JWT invalid
            VR->>Client: Redirect to IdP login
        end
    end
```

## Why Split Authentication?

### Size Limitations
- **Viewer Request**: 40 KB body size limit
- **Origin Request**: 1 MB body size limit

### Token Sizes
- **JWT tokens**: 500 bytes - 3 KB (header + payload + signature)
- **SAML assertions**: 20-100+ KB (Base64-encoded XML with attributes, groups, encryption)

### Performance Optimization

**Viewer Request Lambda** (runs on EVERY request, including cache hits):
- ✅ Validates JWT tokens (small, fast)
- ✅ Enforces authentication before cache
- ✅ Detects SAML callbacks and bypasses cache
- ✅ Minimal processing overhead

**Origin Request Lambda** (runs only on cache misses):
- ✅ Processes large SAML assertions (requires 1 MB limit)
- ✅ Handles IdP callbacks and token generation
- ✅ Adds authorization headers to origin requests
- ✅ Only executes when necessary

### Why Not Consolidate All Auth in Origin Request?

If all authentication logic was moved to origin request:
- ❌ **Caching must be disabled** - every request needs auth check
- ❌ **Performance degradation** - all requests hit origin
- ❌ **Increased origin load** - no cache protection
- ❌ **Higher latency** - no edge caching benefits
- ❌ **Increased costs** - more origin requests, more data transfer

By handling JWT validation in viewer request, authenticated users benefit from CloudFront's edge cache while still maintaining security on every request.

## Special Handling: SAML Assertion Callback

The `/assert` path (SAML callback from IdP) receives POST requests with large SAML assertions that:
1. Exceed the 40 KB viewer request limit
2. Must skip cache to be processed
3. Are handled by origin request Lambda (1 MB limit)
4. Result in JWT creation and cookie setting

The viewer request Lambda detects this path and adds a cache-bypass header, ensuring the request flows directly to origin request Lambda for processing.
