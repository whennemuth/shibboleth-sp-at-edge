import { CloudFrontClient, DistributionConfig, DistributionSummary, GetDistributionConfigCommand, paginateListDistributions } from '@aws-sdk/client-cloudfront';
import { DeleteFunctionCommand, LambdaClient, paginateListVersionsByFunction } from '@aws-sdk/client-lambda';
import { distributionComment, EDGE_FUNCTION_BASENAMES, edgeFunctionName } from './EdgeFunctionConstants';

/**
 * Deletes a landscape's superseded Lambda@Edge function versions, while it keeps serving traffic.
 *
 * Every stack update that changes an edge function publishes a new version. CloudFormation tries to delete the
 * old one, but Lambda refuses until CloudFront has removed its replicas, which takes hours, so CloudFormation
 * gives up (DELETE_FAILED, skipped) and leaves the version behind, outside the stack. This deletes those old
 * versions once it can. Run it after a
 * deploy: each run deletes what earlier deploys left behind, and skips what the latest deploy just replaced
 * (still replicated) for the next run to delete.
 *
 * Unlike deleteEdgeLambdaVersions (a teardown tool), it never changes the distribution, and never deletes:
 *   - a version the distribution uses,
 *   - a version newer than the oldest one the distribution uses (it may belong to a deploy in progress),
 *   - any version of a function the distribution doesn't use at all (nothing shows which version is current).
 * Each deletion is attempted once: a version that is still replicated is reported as deferred, not retried.
 * It never throws for a single version's failure; failures are reported in the result.
 */

/** Lambda@Edge functions always live in us-east-1. */
const EDGE_REGION = 'us-east-1';

export type PruneEdgeLambdaVersionsParms = {
  /** The STACK_ID of the context the construct was deployed with. */
  stackId: string;
  /** The TAGS.Landscape of the context the construct was deployed with. */
  landscape: string;
  /** Report what would be deleted without deleting anything. */
  dryrun?: boolean;
  /** For tests. */
  cloudFrontClient?: CloudFrontClient;
  /** For tests. */
  lambdaClient?: LambdaClient;
};

export type EdgeFunctionVersion = { functionName: string; version: string };

export type PruneEdgeLambdaVersionsResult = {
  /** The landscape's distribution, or undefined if none was found (and so nothing was pruned). */
  distributionId?: string;
  /** Versions deleted (or that would be deleted, in a dry run). */
  deleted: EdgeFunctionVersion[];
  /** Versions in use, or newer than the oldest version in use. */
  kept: EdgeFunctionVersion[];
  /** Versions CloudFront still has replicas of: a later run can delete them. */
  deferred: EdgeFunctionVersion[];
  /** Versions that could not be deleted for any other reason. */
  failed: (EdgeFunctionVersion & { error: string })[];
};

/**
 * Find a landscape's distribution by its comment (see distributionComment()).
 */
export const findShibbolethDistribution = async (cloudFrontClient: CloudFrontClient, landscape: string): Promise<DistributionSummary | undefined> => {
  const comment = distributionComment(landscape);
  for await (const page of paginateListDistributions({ client: cloudFrontClient }, {})) {
    const match = page.DistributionList?.Items?.find(item => item.Comment === comment);
    if (match) return match;
  }
  return undefined;
};

/**
 * The versions of each function the distribution's cache behaviors use, by function name.
 * Association ARNs are qualified: arn:aws:lambda:us-east-1:<account>:function:<name>:<version>
 */
export const versionsInUse = (config: DistributionConfig): Map<string, Set<string>> => {
  const behaviors = [config.DefaultCacheBehavior, ...(config.CacheBehaviors?.Items ?? [])];
  const inUse = new Map<string, Set<string>>();
  for (const behavior of behaviors) {
    for (const association of behavior?.LambdaFunctionAssociations?.Items ?? []) {
      const parts = (association.LambdaFunctionARN ?? '').split(':');
      if (parts.length < 8) continue;
      const [ functionName, version ] = parts.slice(-2);
      inUse.set(functionName, (inUse.get(functionName) ?? new Set<string>()).add(version));
    }
  }
  return inUse;
};

const isReplicaError = (e: any): boolean =>
  e?.name === 'InvalidParameterValueException' && /replicated function/i.test(e?.message ?? '');

/**
 * Delete the superseded versions of a landscape's three Lambda@Edge functions.
 */
export const pruneEdgeLambdaVersions = async (parms: PruneEdgeLambdaVersionsParms): Promise<PruneEdgeLambdaVersionsResult> => {
  const { stackId, landscape, dryrun = false } = parms;
  const cloudFrontClient = parms.cloudFrontClient ?? new CloudFrontClient({ region: EDGE_REGION });
  const lambdaClient = parms.lambdaClient ?? new LambdaClient({ region: EDGE_REGION });
  const result: PruneEdgeLambdaVersionsResult = { deleted: [], kept: [], deferred: [], failed: [] };

  const distribution = await findShibbolethDistribution(cloudFrontClient, landscape);
  if ( ! distribution?.Id) {
    console.log(`No distribution with comment "${distributionComment(landscape)}": no edge function versions pruned.`);
    return result;
  }
  result.distributionId = distribution.Id;
  const { DistributionConfig } = await cloudFrontClient.send(new GetDistributionConfigCommand({ Id: distribution.Id }));
  const inUse = versionsInUse(DistributionConfig ?? {} as DistributionConfig);

  for (const basename of EDGE_FUNCTION_BASENAMES) {
    const functionName = edgeFunctionName(stackId, landscape, basename);
    const inUseVersions = inUse.get(functionName);
    if ( ! inUseVersions?.size) {
      console.log(`${functionName}: not used by distribution ${distribution.Id}, leaving its versions alone.`);
      continue;
    }
    const oldestInUse = Math.min(...[ ...inUseVersions ].map(Number));

    const versions: string[] = [];
    try {
      for await (const page of paginateListVersionsByFunction({ client: lambdaClient }, { FunctionName: functionName })) {
        versions.push(...(page.Versions ?? []).map(v => v.Version ?? '').filter(v => /^\d+$/.test(v)));
      }
    }
    catch (e: any) {
      if (e?.name === 'ResourceNotFoundException') {
        console.log(`${functionName}: no such function.`);
        continue;
      }
      throw e;
    }

    for (const version of versions) {
      const entry = { functionName, version };
      if (inUseVersions.has(version) || Number(version) > oldestInUse) {
        result.kept.push(entry);
        continue;
      }
      if (dryrun) {
        console.log(`${functionName}:${version}: would delete (dry run).`);
        result.deleted.push(entry);
        continue;
      }
      try {
        await lambdaClient.send(new DeleteFunctionCommand({ FunctionName: functionName, Qualifier: version }));
        console.log(`${functionName}:${version}: deleted.`);
        result.deleted.push(entry);
      }
      catch (e: any) {
        if (isReplicaError(e)) {
          console.log(`${functionName}:${version}: CloudFront still has replicas, deferred to a later run.`);
          result.deferred.push(entry);
        }
        else {
          console.warn(`${functionName}:${version}: delete failed: ${e?.message ?? e}`);
          result.failed.push({ ...entry, error: `${e?.name ?? 'Error'}: ${e?.message ?? e}` });
        }
      }
    }
  }
  return result;
};
