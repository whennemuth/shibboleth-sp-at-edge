import { CloudFrontClient, DistributionSummary, GetDistributionCommand, GetDistributionCommandOutput, ListDistributionsCommand, ListDistributionsResult, UpdateDistributionCommand, } from "@aws-sdk/client-cloudfront";
import { DeleteFunctionCommand, LambdaClient, ListVersionsByFunctionCommand, ListVersionsByFunctionCommandOutput } from "@aws-sdk/client-lambda";
import { EDGE_REQUEST_ORIGIN_FUNCTION_BASENAME } from '../lib/EdgeFunctionOriginRequest';
import { EDGE_RESPONSE_VIEWER_FUNCTION_BASENAME } from '../lib/EdgeFunctionViewerResponse';
import { IContext } from '../context/IContext';
import * as ctx from '../context/context.json';

const context = ctx as IContext;
const cloudFrontClient = new CloudFrontClient();
const { STACK_ID, REGION, TAGS: { Landscape } } = context;
process.env.AWS_REGION = REGION;
let dryrun:string;

if(process.argv.length > 2 && process.argv[2] === 'dryrun') {
  dryrun = 'true';
}

/**
 * This class represents a cloudfront distribution with functionality to remove all of its lambda@edge function associations.
 */
export class Distribution {
  private landscape:string

  constructor(landscape:string) {
    this.landscape = landscape;
  }

  /**
   * Remove the lambda@edge function associations from the cloudfront distribution
   */
  public disassociateFromCloudfrontDistribution = async () => {

    // 1) Lookup the distribution ID
    console.log('Listing distributions...');
    const listCommand = new ListDistributionsCommand({ });
    const response = await cloudFrontClient.send(listCommand) as ListDistributionsResult;
    const distributions = response.DistributionList?.Items?.filter((ds:DistributionSummary) => {
      return ds.Comment && ds.Comment == `shib-lambda-${this.landscape}-distribution`;
    }) as DistributionSummary[];
    if(distributions!.length == 0) {
      console.log('No such distribution, looks like it has already been deleted');
      return;
    }
    const Id = distributions[0]!.Id;

    // 2) Use the ID to Get the full distribution
    console.log(`Looking up distribution ${Id}`);
    const getCommand = new GetDistributionCommand({ Id });
    const output = await cloudFrontClient.send(getCommand) as GetDistributionCommandOutput;
    const DistributionConfig = output.Distribution?.DistributionConfig;
    if( ! DistributionConfig?.DefaultCacheBehavior || ! output.ETag) {
      throw new Error('Distribution config lookup failure!')
    }

    // 3) Modify the distribution to remove the edge lambda(s) from ALL behaviors
    console.log(`Removing lambda@edge function associations from distribution: ${Id}`);
    
    // Remove from default cache behavior
    console.log('Removing lambda@edge function associations from default cache behavior');
    DistributionConfig.DefaultCacheBehavior.LambdaFunctionAssociations = {
      Quantity: 0,
      Items: []
    };
    
    // Remove from all additional cache behaviors
    if (DistributionConfig.CacheBehaviors?.Items) {
      DistributionConfig.CacheBehaviors.Items.forEach(behavior => {
        console.log(`Removing lambda@edge function associations from cache behavior: ${behavior.PathPattern}`);
        behavior.LambdaFunctionAssociations = {
          Quantity: 0,
          Items: []
        };
      });
    }
    const updateCommand = new UpdateDistributionCommand({ Id, DistributionConfig, IfMatch: output.ETag });
    await cloudFrontClient.send(updateCommand);
  }
}

/**
 * This class represents a lambda@edge function.
 * Attempts to simply remove such lambda functions during a stack teardown will fail as explained in the following 
 * developer guide doc:
 * https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/lambda-edge-delete-replicas.html
 *   1) This class provides the functionality to "remove the function association from the last distribution"
 *   2) Delete prior versions
 * Only when 1) and 2) are performed can the edge function itself be deleted.
 */
export class Lambda {
  private name:string;
  private versions:any[] = [];
  private lambdaClient:LambdaClient;
  private _functionExists:boolean = true; // Assume it exists until proven otherwise

  constructor(name:string, lambdaClient:LambdaClient) {
    this.name = name;
    this.lambdaClient = lambdaClient;
  }

  private loadVersions = async () => {
    const { name, versions, lambdaClient, lambdaClient: { config: { region }} } = this;
    if(versions.length == 0) {
      const command = new ListVersionsByFunctionCommand({ FunctionName: name });
      try {
        const output:ListVersionsByFunctionCommandOutput = await lambdaClient.send(command);
        output.Versions?.forEach(version => {
          versions.push(getVersion(version.FunctionArn, lambdaClient))
        })
      }
      catch(e:any) {
        if(e.name && e.name == 'ResourceNotFoundException') {
          this._functionExists = false;
          const regionName = await region();
          console.log(`No such function ${name} in region ${regionName}`);
        }
        else {
          throw(e);
        }
      }
    }
  }

  /**
   * Delete all prior versions of the lambda@edge function
   */
  public dumpPriorVersions = async () => {
    await this.loadVersions();
    if(!this._functionExists) {
      return;
    }
    console.log(`Deleting versions for: ${this.name}`)
    if(this.versions.length == 0) {
      console.log(`No versions found for ${this.name}.`);
      return;
    }
    let versionCount = 0;
    for(const version of this.versions) {
      if(version.isPriorVersion()) {
        console.log(`Deleting prior version: ${version.version()}...`);
        await version.delete();
        versionCount++;
      }
      else {
        console.log(`Leaving the latest version alone: ${version.version()}`)
      }
    }
    console.log(`Deleted ${versionCount} prior versions for ${this.name}.`);
  }

  public functionExists = (): boolean => {
    return this._functionExists;
  }
}

/**
 * @param ms The number of milliseconds to sleep for
 * @returns 
 */
const sleep = (ms:number) => {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Returns an object representing a lambda function of a prior version built from a specified arn.
 * @param arn 
 * @returns 
 */
const getVersion = (arn:string|undefined, lambdaClient:LambdaClient) => {
  const getArnPart = (fromRight:number) => {
    const parts:string[] = (arn||'').split(':');
    return parts[parts.length - fromRight];
  }
  const getVersion = () => getArnPart(1); 
  const getName = () => getArnPart(2); 
  return {
    asString: () => { return arn; },
    isPriorVersion: () => { return /\d+/.test(getVersion()); },
    version: () => { return getVersion(); },
    delete: async () => {
      const input = { 
        FunctionName: getName(),
        Qualifier: getVersion()
      };
      const command = new DeleteFunctionCommand(input);
      if(dryrun) {
        console.log(`Dryrun delete: ${JSON.stringify(input)}`);
        return;
      }

      // Retry logic for replicated functions
      const maxRetries = 240;
      let retryCount = 0;
      
      while (retryCount < maxRetries) {
        try {
          console.log(`Attempting to delete ${JSON.stringify(input)} (attempt ${retryCount + 1})`);
          const response = await lambdaClient.send(command);
          console.log(`Successfully deleted version ${getVersion()}`);
          return;
        } catch (error: any) {
          if (error.name === 'InvalidParameterValueException' && 
              error.message?.includes('replicated function')) {
            retryCount++;
            const backoffTime = Math.min(1000 * Math.pow(2, retryCount), 30000); // Cap at 30 seconds
            console.log(`Replica still exists. Waiting ${backoffTime/1000}s before retry ${retryCount}/${maxRetries}...`);
            await sleep(backoffTime);
          } else {
            console.error(`Failed to delete version ${getVersion()}: ${error.message}`);
            throw error;
          }
        }
      }
      
      console.warn(`Failed to delete version ${getVersion()} after ${maxRetries} attempts. Replica may still be propagating.`);
    }
  }
};


/**
 * Delete all versions for all lambda functions
 */
const deleteVersions = async (functionList:string) => {

  // 1) "Orphan" every lambda@edge function from the cloudfront distribution.
  await (new Distribution(Landscape)).disassociateFromCloudfrontDistribution();

  // 2) Get an array of all the lambda functions to process (from env as comma-delimited list)
  const functionArray:string[] = [];
  if(functionList) {
    functionArray.push(...functionList.split(/\x20*,\x20*/));
  }

  // 3) Delete all prior versions of every lambda@edge function (leaving only current version).
  if(functionArray.length > 0) {
    const lambdaClientDefaultRegion = new LambdaClient();
    const defaultRegion = await lambdaClientDefaultRegion.config.region();
    const lambdaClientUsEast1 = new LambdaClient({ region: 'us-east-1' });
    for(var i=0; i<functionArray.length; i++) {
      const functionName = functionArray[i].trim();
      console.log(`\nProcessing Lambda for ${functionName} in region ${defaultRegion}`);
      var lambda = new Lambda(functionName, lambdaClientDefaultRegion);
      await lambda.dumpPriorVersions();
      if( ! lambda.functionExists() && defaultRegion !== 'us-east-1') {
        console.log(`\nProcessing Lambda for ${functionName} in region us-east-1`);
        lambda = new Lambda(functionName, lambdaClientUsEast1);
        await lambda.dumpPriorVersions();
      }
    }
  }
  else {
    console.log('FUNCTION_NAMES is missing!');
  }
}

deleteVersions(
 `${STACK_ID}-${Landscape}-${EDGE_REQUEST_ORIGIN_FUNCTION_BASENAME}, \
  ${STACK_ID}-${Landscape}-${EDGE_RESPONSE_VIEWER_FUNCTION_BASENAME}, \
  ${STACK_ID}-${Landscape}-app-function`
).then(() => {
  console.log('Completed. You should now be able to delete the stack.');
}).catch(e => {
  console.log(JSON.stringify(e, Object.getOwnPropertyNames(e), 2));
});
