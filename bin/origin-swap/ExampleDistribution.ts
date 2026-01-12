
import { CloudFrontClient, CreateDistributionWithTagsCommand, DeleteDistributionCommand, Distribution, DistributionConfig, GetDistributionCommand, ListDistributionsCommand, ListTagsForResourceCommand, Origins, UpdateDistributionCommand } from "@aws-sdk/client-cloudfront";
import { GetCallerIdentityCommand, STSClient } from "@aws-sdk/client-sts";
import { logHeader } from "../../lib/Util";
import { ExampleFunctionUrl } from "./ExampleFunctionUrl";
import { HostedZoneTools } from "./HostedZone";

/**
 * This class creates a disposable CloudFront distribution that is usable for testing.
 * The testing involves the "swapping" of origins and behaviors to work out the kinks
 * as a dress-rehearsal to implementing origin and behavior swapping in production distributions.
 */
export class ExampleDistribution {

  // Set by create functions
  private cloudFrontClient: CloudFrontClient;
  private origin: ExampleFunctionUrl;
  private distributionId: string | undefined;

  // Set by lookup function during delete operation
  private distribution: Distribution;

  constructor(private parms: { id: string, subdomain?:string, region: string }) {
    this.cloudFrontClient = new CloudFrontClient({ region: 'us-east-1' });
    this.origin = new ExampleFunctionUrl({ 
      id: this.parms.id, 
      region: this.parms.region 
    });
  }

  public async create(): Promise<void> {
    await this.createOrigin();
    await this.createDistribution();
  }

  /**
   * Lookup the distribution, knowing only its Name tag.
   */
  private lookupDistributionId = async ():Promise<void>  => {
    const { parms: { id:nameTagVal }} = this;
    console.log(`Looking up CloudFront distribution with Name tag: ${nameTagVal}`);

    // Get account ID
    const stsClient = new STSClient({ region: 'us-east-1' });
    const identity = await stsClient.send(new GetCallerIdentityCommand({}));
    const accountId = identity.Account!;

    // List all distributions
    const listCommand = new ListDistributionsCommand({});
    const listResponse = await this.cloudFrontClient.send(listCommand);

    // Find the distribution with the matching Name tag
    for (const dist of listResponse.DistributionList?.Items || []) {
      const arn = `arn:aws:cloudfront::${accountId}:distribution/${dist.Id}`;
      const tagsCommand = new ListTagsForResourceCommand({ Resource: arn });
      const tagsResponse = await this.cloudFrontClient.send(tagsCommand);
      
      const hasMatchingTag = tagsResponse.Tags?.Items?.some(tag => tag.Key === 'Name' && tag.Value === nameTagVal);
      if (hasMatchingTag) {
        this.distributionId = dist.Id;
        break;
      }
    }

    if (!this.distributionId) {
      throw new Error(`Distribution with Name tag '${nameTagVal}' not found`);
    }
    console.log(`Found distribution ID: ${this.distributionId}`);
  }

  private async lookupDistribution():Promise<void> {
    if(!this.distributionId) {
      throw new Error('Distribution ID not set for lookup');
    }

    const getCommand = new GetDistributionCommand({ Id: this.distributionId });
    const getResponse = await this.cloudFrontClient.send(getCommand);
    this.distribution = getResponse.Distribution!;
  }

  private async createOrigin(): Promise<void> {
    try {
      await this.origin.create();
    }
    catch (error) {
      console.error('Error creating origin:', error);
      console.log(`Attempting cleanup of origin due to failure.`);
      try {
        await this.origin.delete();
      }
      catch (cleanupError) {
        console.error('Error during cleanup of origin:', cleanupError);
      }
      throw error;
    }
  }

  private async createDistribution(): Promise<void> {

    logHeader(`Creating CloudFront Distribution for Origin Function URL`);
    
    const functionUrl = this.origin.getFunctionUrl();
    if (!functionUrl) {
      throw new Error('Function URL not available');
    }

    const origins: Origins = {
      Quantity: 1,
      Items: [
        {
          Id: 'lambda-origin',
          DomainName: functionUrl.replace('https://', '').replace('/', ''),
          CustomOriginConfig: {
            HTTPPort: 80,
            HTTPSPort: 443,
            OriginProtocolPolicy: 'https-only',
            OriginSslProtocols: {
              Quantity: 1,
              Items: ['TLSv1.2']
            }
          }
        }
      ]
    };


    /**
     * NOTE: The 'Host' header is intentionally omitted from the forwarded headers to prevent
     * issues with Lambda function URL host header validation. Including 'Host' can lead to
     * 403 Forbidden errors if the host does not match the expected value in the Lambda URL.
     * 
     * This is only a problem because we are trying to closely approximate Boston University
     * distributions that use the legacy cache settings where the "AllViewerExceptHostHeader"
     * is NOT an option. In a real-world scenario, it is recommended to include the 'Host' 
     * header, but point the distribution at an ALB instead.
     */
    const headerItems = ['Referer', 'User-Agent', 'X-Upstream'];
    // const headerItems = ['Host', 'Referer', 'User-Agent', 'X-Upstream'];

    const distributionConfig: DistributionConfig = {      
      CallerReference: `${this.parms.id}-${Date.now()}`,
      Comment: `Distribution for ${this.parms.id}`,
      Enabled: true,
      Origins: origins,
      DefaultCacheBehavior: {
        TargetOriginId: 'lambda-origin',
        ViewerProtocolPolicy: 'redirect-to-https',
        AllowedMethods: {
          Quantity: 7,
          Items: ['GET', 'HEAD', 'OPTIONS', 'PUT', 'POST', 'PATCH', 'DELETE'],
          CachedMethods: {
            Quantity: 2,
            Items: ['GET', 'HEAD']
          }
        },
        ForwardedValues: {
          QueryString: true,
          Cookies: {
            Forward: 'all'
          },
          Headers: {
            Quantity: headerItems.length,
            // Items: ['Host', 'Referer', 'User-Agent', 'X-Upstream']
            Items: headerItems
          }
        },
        Compress: true,
        MinTTL: 0
      },
      PriceClass: 'PriceClass_100'
    };

    const createDistributionCommand = new CreateDistributionWithTagsCommand({
      DistributionConfigWithTags:{
        DistributionConfig: distributionConfig,
        Tags: { Items: [ { Key: 'Name', Value: this.parms.id } ] }
      }
    });

    try {
      const response = await this.cloudFrontClient.send(createDistributionCommand);
      this.distributionId = response.Distribution?.Id;
      console.log(`Created CloudFront distribution: ${response.Distribution?.DomainName}`);      
    } catch (error) {
      if (error instanceof Error && (error.name === 'DistributionAlreadyExists' || error.name === 'ResourceConflictException')) {
        console.log(`Distribution already exists, aborting...`);
      } else {
        console.log('Error creating distribution:', error);
        console.log(`Attempting cleanup of origin due to failure.`);
        try {
          await this.origin.delete();
        }
        catch (cleanupError) {
          console.error('Error during cleanup of origin:', cleanupError);
        }
      }
      throw error;
    }    
  }

  private deleteDistribution = async (): Promise<void> => {
    if (!this.distributionId) {
      console.log('No distribution ID available, skipping deletion');
      return;
    }

    logHeader(`Deleting CloudFront Distribution: ${this.distributionId}`);

    try {
      // Get the current distribution config
      const getCommand = new GetDistributionCommand({ Id: this.distributionId });
      const distResponse = await this.cloudFrontClient.send(getCommand);

      if (distResponse.Distribution?.DistributionConfig?.Enabled) {
        // Disable the distribution first
        console.log(`Disabling distribution ${this.distributionId}...`);
        const updateCommand = new UpdateDistributionCommand({
          Id: this.distributionId,
          DistributionConfig: {
            ...distResponse.Distribution.DistributionConfig,
            Enabled: false
          },
          IfMatch: distResponse.ETag
        });
        await this.cloudFrontClient.send(updateCommand);
        console.log(`Disabled distribution ${this.distributionId}. Waiting for deployment...`);

        // Wait for the disable to propagate (poll the status)
        console.log('Waiting for disable to complete...');
        let status = 'InProgress';
        let attempts = 0;
        const maxAttempts = 60; // Max 10 minutes (60 * 10s)
        while (status !== 'Deployed' && attempts < maxAttempts) {
          await new Promise(resolve => setTimeout(resolve, 10000)); // Wait 10 seconds
          const statusResponse = await this.cloudFrontClient.send(new GetDistributionCommand({ Id: this.distributionId }));
          status = statusResponse.Distribution?.Status || 'InProgress';
          console.log(`Distribution status: ${status} (attempt ${attempts + 1}/${maxAttempts})`);
          attempts++;
        }
        if (status !== 'Deployed') {
          throw new Error('Distribution disable did not complete within the expected time');
        }
      }

      // Get the current ETag for deletion
      const finalResponse = await this.cloudFrontClient.send(new GetDistributionCommand({ Id: this.distributionId }));

      // Now delete the distribution
      const deleteCommand = new DeleteDistributionCommand({
        Id: this.distributionId,
        IfMatch: finalResponse.ETag
      });
      await this.cloudFrontClient.send(deleteCommand);
      console.log(`Deleted CloudFront distribution: ${this.distributionId}`);
    } catch (error: any) {
      if (error.name === 'NoSuchDistribution') {
        console.log(`Distribution ${this.distributionId} does not exist, nothing to delete`);
      } else {
        console.log('Error deleting distribution:', error);
        throw error;
      }
    }
  }

  private deleteHostedZoneRecord = async (): Promise<void> => {
    const { 
      parms: { subdomain }, 
      distribution: { DomainName:distributionDomainName } = {} 
    } = this;

    // Validate parameters first.
    if(!subdomain) {
      console.log('No subdomain provided, skipping hosted zone record deletion.');
      return;
    }
    if(!distributionDomainName) {
      console.log('No distribution domain name available, cannot delete hosted zone record.');
      return;
    }

    // Delete the hosted zone record
    await new HostedZoneTools({ subdomain, distributionDomainName }).deleteRecord();
  }

  public async delete(distributionId?:string): Promise<void> {
    if(distributionId) {
      this.distributionId = distributionId;
    }
    else {
      // Lookup distribution ID by Name tag
      await this.lookupDistributionId();
      if(!this.distributionId) {
        console.log('No distribution found to delete.');
        return;
      }
    }

    await this.lookupDistribution();

    if(!this.distribution) {
      console.log(`No distribution found matching ID ${this.distributionId}.`);
      return;
    }

    await this.deleteHostedZoneRecord();

    await this.deleteDistribution();

    await this.origin.delete();
  }
}


if (require.main === module) {
  (async () => {
    const parms = { 
      id: 'example-distribution', 
      subdomain: 'wp2.warhen.work',
      region: 'us-east-2' 
    };

    // await new ExampleDistribution(parms).create();

    // To delete, implement deletion logic as needed
    await new ExampleDistribution(parms).delete();
  })();
}