import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { RoutingRule } from './types';

export interface RoutingCacheConfig {
  tableName: string;
  ttlSeconds: number;
  region?: string;  // AWS region where the DynamoDB table is deployed
}

/**
 * Module-level cache (persists across Lambda invocations within the same container).
 * Pattern from bu-protected-s3-object-lambda (BU production, 1+ years).
 */
interface CacheEntry {
  table: Map<string, RoutingRule>;
  timestamp: number;
}

const cache: CacheEntry = {
  table: new Map(),
  timestamp: 0,
};

// DynamoDB client is initialized lazily with the region from config
let ddbDocClient: DynamoDBDocumentClient;

/**
 * Load the full routing table from DynamoDB using Scan.
 * For for around 2000 rules (~400 KB), a single scan response is typical.
 * Implements pagination for tables that exceed 1 MB response limit.
 * 
 * Filters out disabled rules (enabled === false) at load time.
 * Re-enabling a rule (false → true) takes effect on next cache refresh (up to cacheTtlSeconds).
 */
async function loadRoutingTable(tableName: string, region: string): Promise<Map<string, RoutingRule>> {
  // Initialize DynamoDB client lazily with the correct region
  if (!ddbDocClient) {
    const ddbClient = new DynamoDBClient({ region });
    ddbDocClient = DynamoDBDocumentClient.from(ddbClient);
    console.log(`[Routing] Initialized DynamoDB client for region: ${region}`);
  }

  const table = new Map<string, RoutingRule>();
  let lastEvaluatedKey: Record<string, any> | undefined;
  let totalScanned = 0;
  let disabledCount = 0;

  do {
    const scanResult = await ddbDocClient.send(new ScanCommand({
      TableName: tableName,
      ExclusiveStartKey: lastEvaluatedKey,
    }));

    for (const item of scanResult.Items || []) {
      totalScanned++;
      
      // Type guard: ensure required fields exist
      if (!item.path || !item.action) {
        console.warn(`[Routing] Skipping malformed item (missing path or action): ${JSON.stringify(item)}`);
        continue;
      }

      // Filter out disabled rules
      if (item.enabled === false) {
        disabledCount++;
        continue;
      }

      table.set(item.path.toLowerCase(), item as RoutingRule);
    }

    lastEvaluatedKey = scanResult.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  console.log(`[Routing] Loaded ${table.size} enabled rules from DynamoDB (${totalScanned} scanned, ${disabledCount} disabled)`);
  return table;
}

/**
 * Get a routing rule for a given path, using longest-prefix-match for prefix rules.
 * Checks module-level cache first, refreshing if stale or empty.
 * 
 * Algorithm: 
 * - Try exact match first: if rule exists AND matchType is 'exact', return only if path equals exactly.
 * - If rule exists AND matchType is 'prefix' (or omitted), return (prefix match).
 * - Walk prefix chain from longest to shortest for remaining prefix-match rules.
 * 
 * Examples:
 *   Request: /cas/biology/faculty → tries /cas/biology/faculty, /cas/biology, /cas
 *   Rule: {path: '/cas', matchType: 'prefix'} matches /cas and /cas/biology
 *   Rule: {path: '/studentlink', matchType: 'exact'} matches /studentlink only, NOT /studentlink/foo
 */
export async function getRoutingRule(
  path: string,
  config: RoutingCacheConfig
): Promise<RoutingRule | null> {
  const now = Date.now();
  const ttlMs = config.ttlSeconds * 1000;
  const region = config.region || 'us-east-1';  // Default to us-east-1 if not specified.

  // Check if cache is empty or expired
  if (cache.table.size === 0 || now - cache.timestamp > ttlMs) {
    console.log('[Routing] Cache miss or expired, loading from DynamoDB');
    cache.table = await loadRoutingTable(config.tableName, region);
    cache.timestamp = now;
  } else {
    console.log('[Routing] Cache hit, using cached routing table');
  }

  // Longest-prefix-match: try path segments from longest to shortest
  const normalizedPath = path.toLowerCase().replace(/\/+$/, '') || '/';
  const segments = normalizedPath.split('/').filter(s => s.length > 0);
  
  // Try full path first (exact match lookup)
  const exactLookup = cache.table.get(normalizedPath);
  if (exactLookup) {
    const matchType = exactLookup.matchType || 'prefix';
    
    if (matchType === 'exact') {
      // Exact-match rule: only return if path equals exactly (no sub-paths)
      console.log(`[Routing] Exact match: ${path} (action: ${exactLookup.action})`);
      return exactLookup;
    } else {
      // Prefix-match rule at exact path: return it
      console.log(`[Routing] Prefix match (exact path): ${path} (action: ${exactLookup.action})`);
      return exactLookup;
    }
  }

  // Try progressively shorter prefixes (only for prefix-match rules)
  for (let depth = segments.length - 1; depth >= 1; depth--) {
    const prefixPath = '/' + segments.slice(0, depth).join('/');
    const rule = cache.table.get(prefixPath);
    
    if (rule) {
      const matchType = rule.matchType || 'prefix';
      
      if (matchType === 'prefix') {
        console.log(`[Routing] Prefix match: ${path} → ${prefixPath} (action: ${rule.action})`);
        return rule;
      }
      // If matchType is 'exact', skip it - it doesn't match this longer path
    }
  }

  // Try root path '/'
  const rootRule = cache.table.get('/');
  if (rootRule) {
    const matchType = rootRule.matchType || 'prefix';
    if (matchType === 'prefix') {
      console.log(`[Routing] Prefix match: ${path} → / (action: ${rootRule.action})`);
      return rootRule;
    }
  }

  console.log(`[Routing] No match for ${path}, falling through to default origin`);
  return null;
}
