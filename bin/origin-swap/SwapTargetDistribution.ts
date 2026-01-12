import { CloudFrontClient, Distribution, DistributionConfig, GetDistributionCommand, UpdateDistributionCommand } from "@aws-sdk/client-cloudfront";
import { AUTH_PATHS } from 'shibboleth-sp';
import { HostedZoneTools } from "./HostedZone";
import { SourceDistribution } from "./SwapSourceDistribution";

export type SwapBehaviorParameters = {
  distributionId: string,
  defaultBUCachingPolicyId?: string,
  sourceDistribution?: SourceDistribution;
}

export type SwapOriginParameters = {
  distributionId: string,
  // Optional limit to specific origin type when selecting preferred origin to assign to behaviors
  newOriginLimitToType?: OriginType;
  sourceDistribution?: SourceDistribution;
}

export type SwapParameters = SwapBehaviorParameters & SwapOriginParameters;
export type OriginType = 'function-url' | 'alb' | 's3';

export const CACHE_POLICY_DISABLED_ID =  '4135ea2d-6df8-44a3-9df3-4b5a84be39ad'; // CachingDisabled                        
export const ALL_VIEWER = '216adef6-5c7f-47e4-b989-5492eafa07d3'; // AllViewer
export const ALL_VIEWER_EXCEPT_HOST_HEADER = '74f9a3ff-6f2a-4ef2-9bd6-6940e3575f1d'; // AllViewerExceptHostHeader

/**
 * Change the a origin and behaviors of one distribution (target) to "repoint" it at another 
 * origin, and add Lambda@Edge functions to its behaviors for authentication handling.
 * The new origin and behaviors will be derived from a "source" distribution.
 */
export class TargetDistribution {
  private distribution:Distribution;
  private distributionConfig:DistributionConfig;
  private etag: string | undefined;

  constructor(private parms:SwapParameters) { }

  private load = async ():Promise<void>  => {
    const client = new CloudFrontClient({ region: 'us-east-1' });
    const command = new GetDistributionCommand({
      Id: this.parms.distributionId
    });
    const response = await client.send(command);
    this.distribution = response.Distribution!;
    this.distributionConfig = response.Distribution!.DistributionConfig!;
    this.etag = response.ETag;
  }

  public validateParameters = async (...swapTypes: ('behavior' | 'origin')[]): Promise<void> => {
    if(!this.distribution) {
      await this.load();
    }

    if(!this.distributionConfig) {
      throw new Error('Distribution and/or DistributionConfig not found');
    }

    // If no swap types specified, default to both
    if(swapTypes.length === 0) {
      swapTypes = ['behavior', 'origin'];
    }

    const { distributionConfig: config } = this;

    const validateBehaviorParams = ():void => {
      const { sourceDistribution: { edgeFunctions=[] } = {}, defaultBUCachingPolicyId } = this.parms;
      if (!config.DefaultCacheBehavior) {
        throw new Error('DefaultCacheBehavior not found in distribution');
      }
      if (!defaultBUCachingPolicyId) {
        throw new Error('defaultBUCachingPolicyId is required but not provided in parameters');
      }
      if (edgeFunctions.length === 0) {
        throw new Error('edgeFunctions are required but not provided in parameters');
      }
    }

    const validateOriginParams = ():void => {
      const { sourceDistribution: { origins } = {} } = this.parms;
      if (!origins || origins.Quantity === 0) {
        throw new Error('newOrigins are required but not provided in parameters');
      }
    }

    if(swapTypes.includes('behavior')) {
      validateBehaviorParams();
    }

    if(swapTypes.includes('origin')) {
      validateOriginParams();
    }
  }

  /**
   * Determine the origin type by matching its domain name against known patterns.
   * @param domainName 
   * @returns 
   */
  private getOriginTypeFromDomain = (domainName:string):OriginType => {
    if(/\.lambda\-url\.[^\.]+\.on\.aws$/.test(domainName)) {
      return 'function-url';
    }
    else if(domainName.endsWith('elb.amazonaws.com')) {
      return 'alb';
    }
    else if(domainName.includes('.s3.')) {
      return 's3';
    }
    return 'function-url';
  }

  public swapOriginAndBehaviors = async ():Promise<void> => {
    await this.validateParameters('behavior', 'origin');
    // await this.swapBehaviors();
    await this.swapOrigin();
  }

  /**
   * Exchange the behaviors of the distribution to add authentication paths and
   * Lambda@Edge functions for authentication handling.
   * Temporarily, these behaviors will still point to the existing origin until the origin
   * is swapped in a separate operation.
   */
  public swapBehaviors = async ():Promise<void> => {
    const { ASSERT, LOGIN, LOGOUT, METADATA } = AUTH_PATHS;
    const { sourceDistribution: { edgeFunctions=[] } = {}, defaultBUCachingPolicyId } = this.parms;

    await this.validateParameters('behavior');

    const { distributionConfig: config } = this;

    // Update default cache behavior to use modern cache and origin request policies
    // Remove legacy behavior properties that would clash with those in the new policies.
    delete config.DefaultCacheBehavior!.ForwardedValues;
    delete config.DefaultCacheBehavior!.MinTTL;
    delete config.DefaultCacheBehavior!.MaxTTL;
    delete config.DefaultCacheBehavior!.DefaultTTL;

    // Determine the origin type of the current default behavior
    const defaultBehaviorOriginType = this.getOriginTypeFromDomain(
      config.Origins!.Items!.find(origin => {
        return origin.Id === config.DefaultCacheBehavior!.TargetOriginId; }
      )!.DomainName!
    );

    // Adjust default behavior policies based on origin type
    if(defaultBehaviorOriginType === 'function-url') {
      // If the default behavior is already using a function-url origin, set its policies accordingly
      config.DefaultCacheBehavior!.CachePolicyId = CACHE_POLICY_DISABLED_ID;
      config.DefaultCacheBehavior!.OriginRequestPolicyId = ALL_VIEWER_EXCEPT_HOST_HEADER;
    }
    else {
      // Set the BU caching policy and origin request policy
      config.DefaultCacheBehavior!.CachePolicyId = defaultBUCachingPolicyId;
      config.DefaultCacheBehavior!.OriginRequestPolicyId = ALL_VIEWER;
    }

    // Prepare Lambda associations
    const associations = edgeFunctions.map(f => ({
      LambdaFunctionARN: f.functionArn,
      EventType: f.eventType
    }));

    // Add associations to default behavior
    config.DefaultCacheBehavior!.LambdaFunctionAssociations = {
      Quantity: associations.length,
      Items: associations
    };

    // Add additional behaviors for auth paths
    if (!config.CacheBehaviors) {
      config.CacheBehaviors = { Quantity: 0, Items: [] };
    }
    if (!config.CacheBehaviors.Items) {
      config.CacheBehaviors.Items = [];
    }

    // Add the authentication specific behaviors
    const authPaths = [ASSERT, LOGIN, LOGOUT, METADATA];
    for (const path of authPaths) {
      const behavior = {
        PathPattern: path,
        TargetOriginId: config.DefaultCacheBehavior!.TargetOriginId, // not swapping the origin yet.
        ViewerProtocolPolicy: config.DefaultCacheBehavior!.ViewerProtocolPolicy,
        AllowedMethods: config.DefaultCacheBehavior!.AllowedMethods,
        CachePolicyId: CACHE_POLICY_DISABLED_ID,
        OriginRequestPolicyId: ALL_VIEWER,
        Compress: config.DefaultCacheBehavior!.Compress || false,
        SmoothStreaming: false, // Set to true if enabling Microsoft Smooth Streaming for this path
        FieldLevelEncryptionId: "", // Set to "" (no field-level encryption)
        LambdaFunctionAssociations: {
          Quantity: associations.length,
          Items: associations
        }
      };
      config.CacheBehaviors.Items.push(behavior);
    }
    config.CacheBehaviors.Quantity = (config.CacheBehaviors.Quantity || 0) + authPaths.length;

    // Update the distribution
    console.log('Updating distribution with: ', JSON.stringify(config, null, 2));
    const client = new CloudFrontClient({ region: 'us-east-1' });
    const updateCommand = new UpdateDistributionCommand({
      Id: this.parms.distributionId,
      DistributionConfig: config,
      IfMatch: this.etag
    });
    await client.send(updateCommand);
    console.log('Distribution updated successfully');
  }

  /**
   * Add custom headers from the source distribution to all origins in the target distribution.
   * @returns 
   */
  public appendCustomHeaders = async ():Promise<void> => {
    const { distributionConfig: config, parms: { sourceDistribution: { customHeaders } = {}} } = this;
    if( ! customHeaders ) {
      console.log('No custom headers to append.');
      return;
    }
    for (const origin of config.Origins!.Items!) {
      if( ! origin.CustomHeaders ) {
        origin.CustomHeaders = { Quantity: 0, Items: [] };
      }
      Object.entries(customHeaders).forEach(([HeaderName, HeaderValue]) => {
        origin.CustomHeaders!.Items?.push({ HeaderName, HeaderValue });
        origin.CustomHeaders!.Quantity! += 1;
      });
    }
  }

  /**
   * Swap the distribution origin and update all behaviors to point to the new origin.
   */
  public swapOrigin = async ():Promise<void> => {
    await this.validateParameters('origin');

    const { distributionConfig: config, getOriginTypeFromDomain, parms: { 
      sourceDistribution: {
        origins: newOrigins, certificate: newCert, alias: newAlias, cacheBehaviors, defaultCacheBehavior
      } = {}, defaultBUCachingPolicyId 
    } } = this;
    const { ViewerCertificate: initialCert, Aliases: { Items=[] } = {} } = config;
    const initialAlias = Items.length > 0 ? Items[0] : undefined;

    config.Origins = newOrigins;

    config.DefaultCacheBehavior = defaultCacheBehavior;
    
    config.CacheBehaviors = cacheBehaviors;

    // // Find the first origin matching the preferred type, or default to the first origin.
    // let preferredOrigin = config.Origins!.Items?.find(origin => {
    //   return this.parms.newOriginLimitToType === getOriginTypeFromDomain(origin.DomainName!);
    // }) || config.Origins!.Items![0];

    // // Update all behaviors to point to the new origin
    // config.DefaultCacheBehavior!.TargetOriginId = preferredOrigin.Id;
    // config.CacheBehaviors?.Items?.forEach(behavior => {

    //   // Get the domain name of the current behavior target origin
    //   const domainName = config.Origins!.Items!.find(origin => {
    //     return origin.Id === behavior.TargetOriginId; }
    //   )!.DomainName!;

    //   // Get the behavior origin type 
    //   const originType = getOriginTypeFromDomain(domainName);

    //   // Update behavior target origin
    //   behavior.TargetOriginId = preferredOrigin.Id;

    //   // Update behavior cache policy based on origin type
    //   behavior.CachePolicyId = originType === 'function-url' ? 
    //     CACHE_POLICY_DISABLED_ID : 
    //     defaultBUCachingPolicyId;

    //   // Update behavior origin request policy based on origin type
    //   behavior.OriginRequestPolicyId = originType === 'function-url' ? 
    //     ALL_VIEWER_EXCEPT_HOST_HEADER : 
    //     ALL_VIEWER;
    // });


    // Make sure the new distribution being "repointed" has the alias if it doesn't 
    // already have one and the one set up by the CDK activity of this app does.
    if(newAlias && !initialAlias) {
      config.Aliases = {
        Quantity: 1,
        Items: [newAlias]
      };

      // Add a route53 alias record if the distribution undergoing change never had one,
      // and the new alias is provided.
      const hostedZoneTools = new HostedZoneTools({
        subdomain: newAlias,
        distributionDomainName: this.distribution.DomainName!
      });
      if(await hostedZoneTools.canCreateRecord()) {
        await hostedZoneTools.createRecord();
      }
    }
    
    // Make sure the new distribution being "repointed" has a viewer certificate if it doesn't 
    // already have one and the one set up by the CDK activity of this app does.
    if(newCert && initialCert?.CloudFrontDefaultCertificate) {
      if(newCert.ACMCertificateArn || newCert.Certificate) {
        config.ViewerCertificate = newCert;
      }
    }

    // Update the distribution
    console.log('Updating distribution to use new origin...');
    const client = new CloudFrontClient({ region: 'us-east-1' });
    const updateCommand = new UpdateDistributionCommand({
      Id: this.parms.distributionId,
      DistributionConfig: config,
      IfMatch: this.etag
    });
    await client.send(updateCommand);
    console.log('Distribution origin updated successfully');
  }


  public getDistribution = async ():Promise<Distribution> => {
    if(!this.distribution) {
      await this.load();
    }
    return this.distribution as Distribution;
  }

  public printDistribution = async ():Promise<void> => {
    const dist = await this.getDistribution();
    console.log(JSON.stringify(dist, null, 2));
  }

}