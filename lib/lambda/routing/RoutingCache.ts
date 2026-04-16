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
 * For BU's 1,829 rules (~366 KB), a single scan response is typical.
 * Implements pagination for tables that exceed 1 MB response limit.
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

  do {
    const scanResult = await ddbDocClient.send(new ScanCommand({
      TableName: tableName,
      ExclusiveStartKey: lastEvaluatedKey,
    }));

    for (const item of scanResult.Items || []) {
      // Type guard: ensure required fields exist
      if (item.path && item.routingType) {
        table.set(item.path.toLowerCase(), item as RoutingRule);
      } else {
        console.warn(`[Routing] Skipping malformed item: ${JSON.stringify(item)}`);
      }
    }

    lastEvaluatedKey = scanResult.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  console.log(`[Routing] Loaded ${table.size} routing rules from DynamoDB`);
  return table;
}

/**
 * Get a routing rule for a given path, using longest-prefix-match.
 * Checks module-level cache first, refreshing if stale or empty.
 * 
 * Algorithm: Try path segments from longest to shortest:
 *   /cas/biology/faculty/smith → /cas/biology/faculty → /cas/biology → /cas
 */
export async function getRoutingRule(
  path: string,
  config: RoutingCacheConfig
): Promise<RoutingRule | null> {
  const now = Date.now();
  const ttlMs = config.ttlSeconds * 1000;
  const region = config.region || 'us-east-2';  // Default to us-east-2 for BU

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
  
  // Try full path first (exact match)
  const exactMatch = cache.table.get(normalizedPath);
  if (exactMatch) {
    console.log(`[Routing] Exact match: ${path} (${exactMatch.routingType})`);
    return exactMatch;
  }

  // Try progressively shorter prefixes
  for (let depth = segments.length - 1; depth >= 1; depth--) {
    const prefixPath = '/' + segments.slice(0, depth).join('/');
    const rule = cache.table.get(prefixPath);
    
    if (rule) {
      console.log(`[Routing] Prefix match: ${path} → ${prefixPath} (${rule.routingType})`);
      return rule;
    }
  }

  console.log(`[Routing] No match for ${path}, falling through to default origin`);
  return null;
}
