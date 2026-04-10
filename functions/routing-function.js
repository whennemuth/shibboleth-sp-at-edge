import cf from 'cloudfront';

// KVS handle — the store is associated with this function via CDK
const kvsHandle = cf.kvs();

// Maximum prefix depth to search (BU WordPress blogs are 1-2 segments deep)
const MAX_DEPTH = 3;

// IMPORTANT: Do not modify this line format - it's replaced by RoutingFunction.ts during CDK deployment
// Optional logging flag (set to false in production to reduce CloudWatch costs)
const ENABLE_LOGGING = false;

function log(message, data) {
    if (ENABLE_LOGGING) {
        console.log(message, data ? JSON.stringify(data) : '');
    }
}

async function handler(event) {
    var request = event.request;
    var host = (request.headers.host && request.headers.host.value || '').toLowerCase();
    var uri = request.uri.toLowerCase().replace(/\/+$/, '') || '/';
    var segments = uri.split('/').filter(function(s) { return s.length > 0; });

    log('Routing request', { uri: uri, host: host });

    // Cascading longest-prefix-match lookup
    // Try progressively shorter prefixes: /a/b/c -> /a/b -> /a
    for (var depth = Math.min(segments.length, MAX_DEPTH); depth >= 1; depth--) {
        var key = '/' + segments.slice(0, depth).join('/');
        try {
            var value = await kvsHandle.get(key);
            log('KVS hit', { key: key, value: value });
            return applyRule(request, value);
        } catch (e) {
            // Key not found — try shorter prefix
            continue;
        }
    }

    log('No KVS match - falling through to default origin', { uri: uri });
    // No match — fall through to default origin (webrouter or WordPress)
    return request;
}

function applyRule(request, value) {
    // Value format: "TYPE:data" where TYPE is C (cluster), R (redirect), S (s3), P (php)
    var colonIdx = value.indexOf(':');
    if (colonIdx === -1) return request;

    var type = value.substring(0, colonIdx);
    var data = value.substring(colonIdx + 1);

    switch (type) {
        case 'C':
            // Cluster routing: "C:alpha" or "C:beta" (origin domain resolved from known mapping)
            // For prototype: data is the full ALB domain name
            // e.g., "C:wp-alpha-alb-12345.us-east-2.elb.amazonaws.com"
            cf.updateRequestOrigin({
                domainName: data,
                port: 443,
                protocol: 'https',
                sslProtocols: ['TLSv1.2']
            });
            return request;

        case 'R':
            // Redirect: "R:301:https://target.url" or "R:302:https://target.url"
            var secondColon = data.indexOf(':');
            var status = parseInt(data.substring(0, secondColon), 10);
            var target = data.substring(secondColon + 1);
            return {
                statusCode: status || 301,
                statusDescription: status === 302 ? 'Found' : 'Moved Permanently',
                headers: { location: { value: target } }
            };

        case 'S':
            // Static S3 origin: "S:bucket-name.s3.amazonaws.com"
            cf.updateRequestOrigin({ domainName: data });
            return request;

        case 'P':
            // PHP app origin: "P:phpbin-alb-domain.elb.amazonaws.com"
            cf.updateRequestOrigin({ domainName: data });
            return request;

        default:
            return request;
    }
}
