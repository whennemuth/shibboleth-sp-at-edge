import { CacheBehaviors, CloudFrontClient, Distribution, EventType, GetDistributionCommand, Origins, ViewerCertificate } from "@aws-sdk/client-cloudfront";


export type LambdaEdgeFunction = {
  functionArn: string,
  region: string,
  eventType: EventType
}

export class SourceDistribution {

  private _distribution: Distribution;

  private constructor(private distributionId: string) { }

  private load = async ():Promise<void>  => {
    const client = new CloudFrontClient({ region: 'us-east-1' });
    const command = new GetDistributionCommand({
      Id: this.distributionId
    });
    const response = await client.send(command);
    this._distribution = response.Distribution!;
  }

  public get distribution():Distribution {
    return this._distribution;
  }

  public get certificate ():ViewerCertificate | undefined {
    return this._distribution.DistributionConfig?.ViewerCertificate;
  }

  public get alias():string | undefined {
    const aliases = this._distribution.DistributionConfig?.Aliases?.Items;
    if(aliases && aliases.length > 0) {
      return aliases[0];
    }
    return undefined;
  }

  public get origins():Origins | undefined {
    return this._distribution.DistributionConfig?.Origins;
  }

  public get customHeaders(): Record<string, string> {
    const _customHeaders: Record<string, string> = {};
    this._distribution.DistributionConfig?.Origins?.Items?.forEach(origin => {
      if (origin.CustomHeaders?.Items) {
        origin.CustomHeaders.Items.forEach(header => {
          const { HeaderName:name, HeaderValue:value } = header;
          if(name && value ) {
            _customHeaders[name] = value;
          }
        });
      }
    });
    return _customHeaders;
  }

  public get cacheBehaviors(): CacheBehaviors | undefined {
    return this._distribution.DistributionConfig?.CacheBehaviors;
  }

  public get defaultCacheBehavior() {
    return this._distribution.DistributionConfig?.DefaultCacheBehavior;
  }

  public get edgeFunctions():LambdaEdgeFunction[] {
    const _edgeFunctions: LambdaEdgeFunction[] = [];

    this.distribution.DistributionConfig?.CacheBehaviors?.Items?.forEach(behavior => {
      behavior.LambdaFunctionAssociations?.Items?.forEach(assoc => {
        // For now, only include functions associated with the /testing123 path because these are already for function URLs
        if(behavior.PathPattern === '/testing123') {
          _edgeFunctions.push({
            functionArn: assoc.LambdaFunctionARN!,
            region: 'us-east-1',
            eventType: assoc.EventType!
          });
        }
      });
    });
    return _edgeFunctions;
  }
      
  public static getInstance = async (distributionId: string):Promise<SourceDistribution> => {
    const instance = new SourceDistribution(distributionId);
    await instance.load();
    return instance;
  }
}