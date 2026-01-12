import { SourceDistribution } from "./SwapSourceDistribution";
import { SwapParameters, TargetDistribution } from "./SwapTargetDistribution";

/**
 * Change the a origin and behaviors of one distribution (target) to "repoint" it at another 
 * origin, and add Lambda@Edge functions to its behaviors for authentication handling.
 * The new origin and behaviors will be derived from a "source" distribution.
 */
(async () => {

  let sourceDistribution: SourceDistribution;

  /**
   * The "source" distribution is the one set up by the CDK activity of this app.
   * Use the SDK to pull all information about that distribution.
   * @returns 
   */
  const lookupSourceDistribution = async (): Promise<boolean> => {

    sourceDistribution = await SourceDistribution.getInstance('E2BPX333UWF1YF');
    
    if(sourceDistribution.edgeFunctions.length === 0) {
      console.log('No edge functions found in source distribution.');
      return false;
    }
    
    return true;
  }

  /**
   * The "target" distribution is the one being "repointed" to a new origin with behavior updates.
   * Call that repointing or "swap" operation here.
   */
  const repointTargetDistribution = async (): Promise<void> => {
    const targetDistribution = new TargetDistribution({
      distributionId: 'E2J3MVCHM6IFVF',
      defaultBUCachingPolicyId: '5992aceb-c5a2-4c5c-8e45-540412871161',
      newOriginLimitToType: 'function-url',
      sourceDistribution
    } satisfies SwapParameters);

    await targetDistribution.validateParameters('behavior', 'origin');

    await targetDistribution.swapBehaviors();
    
    await targetDistribution.swapOrigin();

  }

  if(await lookupSourceDistribution()) {
    await repointTargetDistribution();
  }

})();
